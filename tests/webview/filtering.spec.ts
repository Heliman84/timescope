import { test, expect, Page } from "@playwright/test";

import { build_filter_fixture, FilterFixtureData, FixtureEvent, FIXED_NOW } from "./fixtures";
import { open_dashboard } from "./harness";

// The 12-job filter fixture (see build_filter_fixture). Time is frozen at
// FIXED_NOW = 2026-07-15; the harness pins the page clock to the same instant.

let ff: FilterFixtureData;

test.beforeEach(async ({ page }) => {
    ff = build_filter_fixture();
    await open_dashboard(page, ff.payload);
});

/** Job names currently rendered in the sessions table, in row order. */
async function table_jobs(page: Page): Promise<string[]> {
    return page.locator("#session_table_body tr td:nth-child(2)").allTextContents();
}

/** The pie chart's current job → hours map, read from the live Chart.js instance. */
async function pie_data(page: Page): Promise<Record<string, number>> {
    return page.evaluate(() => {
        const chart = (window as any).Chart.getChart("pie_chart");
        const out: Record<string, number> = {};
        chart.data.labels.forEach((label: string, i: number) => { out[label] = chart.data.datasets[0].data[i]; });
        return out;
    });
}

/** The pie chart's job → colour map, read from the live Chart.js instance. */
async function pie_colors(page: Page): Promise<Record<string, string>> {
    return page.evaluate(() => {
        const chart = (window as any).Chart.getChart("pie_chart");
        const out: Record<string, string> = {};
        chart.data.labels.forEach((label: string, i: number) => { out[label] = chart.data.datasets[0].backgroundColor[i]; });
        return out;
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Default preset applied on load
// ═══════════════════════════════════════════════════════════════════════════

test("default Last 14 Days preset is applied on load across table and charts", async ({ page }) => {
    await expect(page.locator("#preset_range")).toHaveValue("last_14");

    // Start/end inputs are populated with the resolved default range
    await expect(page.locator("#start_date")).toHaveValue("2026-07-02");
    await expect(page.locator("#end_date")).toHaveValue("2026-07-15");

    // Ten of the twelve jobs fall inside the window; Wolf and Vega are excluded
    const jobs = await table_jobs(page);
    expect(jobs.sort()).toEqual(ff.jobs_in_last_14.slice().sort());
    expect(jobs).not.toContain("Wolf");
    expect(jobs).not.toContain("Vega");

    // Charts agree with the table
    const pie = await pie_data(page);
    expect(Object.keys(pie).sort()).toEqual(ff.jobs_in_last_14.slice().sort());
});

// ═══════════════════════════════════════════════════════════════════════════
// Preset ↔ date field interaction
// ═══════════════════════════════════════════════════════════════════════════

test("selecting a preset fills the start/end date fields", async ({ page }) => {
    await page.selectOption("#preset_range", "this_month");
    await expect(page.locator("#start_date")).toHaveValue("2026-07-01");
    await expect(page.locator("#end_date")).toHaveValue("2026-07-15");

    await page.selectOption("#preset_range", "all");
    await expect(page.locator("#start_date")).toHaveValue("");
    await expect(page.locator("#end_date")).toHaveValue("");
});

test("editing a date field flips the preset to Custom", async ({ page }) => {
    await page.locator("#start_date").fill("2026-07-05");
    await page.locator("#start_date").blur();
    await expect(page.locator("#preset_range")).toHaveValue("custom");
});

test("first date entered fills both start and end (single-day rule)", async ({ page }) => {
    // Clear both by choosing "all", then enter a single start date
    await page.selectOption("#preset_range", "all");
    await page.locator("#start_date").fill("2026-07-10");
    await page.locator("#start_date").blur();

    await expect(page.locator("#end_date")).toHaveValue("2026-07-10");

    // Only the 07-10 session (Flint) remains
    expect(await table_jobs(page)).toEqual(["Flint"]);
});

// ═══════════════════════════════════════════════════════════════════════════
// Job legend ↔ table dropdown sync
// ═══════════════════════════════════════════════════════════════════════════

test("unchecking a legend job updates the table dropdown and charts", async ({ page }) => {
    await page.locator("#job_legend .legend-job-box[value='Acme']").uncheck();

    // Dropdown reflects the same selection
    await expect(page.locator("#job_dropdown_list .dropdown-job-box[value='Acme']")).not.toBeChecked();
    // Both "All" boxes clear
    await expect(page.locator("#job_all_checkbox")).not.toBeChecked();
    await expect(page.locator("#job_dropdown_all")).not.toBeChecked();

    // Acme is gone from the table and the pie
    expect(await table_jobs(page)).not.toContain("Acme");
    expect(Object.keys(await pie_data(page))).not.toContain("Acme");
});

test("unchecking a dropdown job updates the legend and charts", async ({ page }) => {
    await page.locator("#job_dropdown_summary").click(); // open the <details>
    await page.locator("#job_dropdown_list .dropdown-job-box[value='Beacon']").uncheck();

    await expect(page.locator("#job_legend .legend-job-box[value='Beacon']")).not.toBeChecked();
    expect(await table_jobs(page)).not.toContain("Beacon");
});

test("the dropdown summary reflects the selection count", async ({ page }) => {
    await expect(page.locator("#job_dropdown_summary")).toHaveText("All jobs");
    await page.locator("#job_legend .legend-job-box[value='Acme']").uncheck();
    await expect(page.locator("#job_dropdown_summary")).toHaveText(/jobs$/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Palette stability
// ═══════════════════════════════════════════════════════════════════════════

test("job colours stay stable when other jobs are filtered out", async ({ page }) => {
    // Widen to include all 12 jobs so the palette wraps (10-colour base)
    await page.selectOption("#preset_range", "last_3_months");

    const before = await pie_colors(page);

    // Remove several jobs
    await page.locator("#job_legend .legend-job-box[value='Cobalt']").uncheck();
    await page.locator("#job_legend .legend-job-box[value='Delta']").uncheck();

    const after = await pie_colors(page);

    // Every job that remains kept its exact colour
    for (const job of Object.keys(after)) {
        expect(after[job]).toBe(before[job]);
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// Duration range filter
// ═══════════════════════════════════════════════════════════════════════════

test("duration range filters inclusively and recalculates charts", async ({ page }) => {
    await page.selectOption("#preset_range", "all"); // all 12 sessions in play

    // Sessions with duration between 2h and 4h inclusive:
    // Beacon 2h, Cobalt 3h, Juno 4h (Acme/Delta/... 1h excluded, Wolf 8h excluded)
    await page.locator("#dur_min").fill("2");
    await page.locator("#dur_max").fill("4");

    // Range inputs are debounced — poll until the pipeline has re-run
    await expect.poll(async () => (await table_jobs(page)).sort())
        .toEqual(["Beacon", "Cobalt", "Juno"]);

    // Pie recalculated to the same set
    await expect.poll(async () => Object.keys(await pie_data(page)).sort())
        .toEqual(["Beacon", "Cobalt", "Juno"]);
});

test("an empty duration bound is unbounded", async ({ page }) => {
    await page.selectOption("#preset_range", "all");
    await page.locator("#dur_min").fill("4"); // max left empty

    // 4h and up: Juno 4h, Wolf 8h (debounced — poll)
    await expect.poll(async () => (await table_jobs(page)).sort()).toEqual(["Juno", "Wolf"]);
});

// ═══════════════════════════════════════════════════════════════════════════
// Pause range filter
// ═══════════════════════════════════════════════════════════════════════════

test("pause range filters inclusively", async ({ page }) => {
    await page.selectOption("#preset_range", "all");

    // Pause pairs: Acme 0, Beacon 1, Harbor 1, Cobalt 2, Juno 3
    await page.locator("#pause_min").fill("1");
    await page.locator("#pause_max").fill("2");

    // Range inputs are debounced — poll until the pipeline has re-run
    await expect.poll(async () => (await table_jobs(page)).sort())
        .toEqual(["Beacon", "Cobalt", "Harbor"]);
});

// ═══════════════════════════════════════════════════════════════════════════
// Sorting
// ═══════════════════════════════════════════════════════════════════════════

test("clicking a column header sorts and toggles direction", async ({ page }) => {
    await page.selectOption("#preset_range", "all");

    // Default sort is start desc (newest first): Acme (07-15) leads
    let jobs = await table_jobs(page);
    expect(jobs[0]).toBe("Acme");
    expect(jobs[jobs.length - 1]).toBe("Vega"); // 06-20, oldest

    // First click on a new column sorts descending (reverse alphabetical)
    await page.locator("#session_table th[data-sort='job']").click();
    jobs = await table_jobs(page);
    expect(jobs).toEqual([...jobs].sort((a, b) => b.localeCompare(a)));
    await expect(page.locator("#session_table th[data-sort='job']")).toHaveClass(/sort-desc/);

    // Second click toggles to ascending
    await page.locator("#session_table th[data-sort='job']").click();
    jobs = await table_jobs(page);
    expect(jobs).toEqual([...jobs].sort((a, b) => a.localeCompare(b)));
    await expect(page.locator("#session_table th[data-sort='job']")).toHaveClass(/sort-asc/);
});

test("sorting by duration orders by active hours", async ({ page }) => {
    await page.selectOption("#preset_range", "all");
    await page.locator("#session_table th[data-sort='duration']").click(); // desc

    const jobs = await table_jobs(page);
    // Longest first: Wolf 8h, then Juno 4h, then Cobalt 3h
    expect(jobs.slice(0, 3)).toEqual(["Wolf", "Juno", "Cobalt"]);
});

// ═══════════════════════════════════════════════════════════════════════════
// Empty state
// ═══════════════════════════════════════════════════════════════════════════

test("empty state appears when no sessions match and hides when they do", async ({ page }) => {
    await expect(page.locator("#empty_state")).toBeHidden();

    // A window with no sessions
    await page.selectOption("#preset_range", "all");
    await page.locator("#dur_min").fill("100");

    await expect(page.locator("#empty_state")).toBeVisible();
    await expect(page.locator("#session_table_body tr")).toHaveCount(0);

    // Clearing the impossible bound brings sessions back
    await page.locator("#dur_min").fill("");
    await expect(page.locator("#empty_state")).toBeHidden();
});

// ═══════════════════════════════════════════════════════════════════════════
// Reset
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// HTML/attribute injection hardening
// ═══════════════════════════════════════════════════════════════════════════

test("job and task names with HTML metacharacters render as text and stay filterable", async ({ page }) => {
    const hostile_job = `Ac"me <img src=x onerror="window.__pwned=1"> &Co`;
    const start = FIXED_NOW.getTime() - 3600_000;
    const payload: FixtureEvent[] = [
        { event: "stop", job: hostile_job, timestamp: start + 3600_000, task: `<b>"task"</b>`, id: "x-2", job_id: "x", time_seed: start + 3600_000, global_line_index: 2, workspace_line_index: 2 },
        { event: "start", job: hostile_job, timestamp: start, task: "", id: "x-1", job_id: "x", time_seed: start, global_line_index: 1, workspace_line_index: 1 },
    ];
    await open_dashboard(page, payload);

    // No injected element executed or exists
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
    await expect(page.locator("#session_table_body img, #job_legend img")).toHaveCount(0);

    // The names render as literal text in legend and table
    await expect(page.locator("#job_legend .legend-row").nth(1)).toContainText(hostile_job);
    await expect(page.locator("#session_table_body tr td").nth(1)).toHaveText(hostile_job);
    await expect(page.locator("#session_table_body tr td").nth(3)).toHaveText(`<b>"task"</b>`);

    // The checkbox round-trips the exact name: unchecking hides the session
    const box = page.locator("#job_legend .legend-job-box");
    await expect(box).toHaveCount(1);
    await box.uncheck();
    await expect(page.locator("#session_table_body tr")).toHaveCount(0);
    await box.check();
    await expect(page.locator("#session_table_body tr")).toHaveCount(1);
});

test("reset restores every filter to its default", async ({ page }) => {
    await page.selectOption("#preset_range", "all");
    await page.locator("#dur_min").fill("2");
    await page.locator("#pause_max").fill("1");
    await page.locator("#job_legend .legend-job-box[value='Acme']").uncheck();

    await page.click("#clear_filters_btn");

    await expect(page.locator("#preset_range")).toHaveValue("last_14");
    await expect(page.locator("#dur_min")).toHaveValue("");
    await expect(page.locator("#pause_max")).toHaveValue("");
    await expect(page.locator("#job_all_checkbox")).toBeChecked();
    expect((await table_jobs(page)).sort()).toEqual(ff.jobs_in_last_14.slice().sort());
});
