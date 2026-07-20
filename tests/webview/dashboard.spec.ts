import { test, expect } from "@playwright/test";

import { build_fixture, FixtureData } from "./fixtures";
import { open_dashboard, posted_messages, reply, to_datetime_input_value } from "./harness";

// Fixture: Alpha today 09:00–10:30 (1 pause/resume pair), Beta today
// 13:00–14:00, Alpha 40 days ago 10:00–11:00. Time is frozen at FIXED_NOW,
// and the default preset (Last 4 Weeks) is applied on load, so the 40-days-ago
// session is filtered out until a wider preset is chosen.

interface EditLogEntriesPayload {
    edits: Array<{ id: string; new_record: Record<string, unknown> }>;
}

let fx: FixtureData;

test.beforeEach(async ({ page }) => {
    fx = build_fixture();
    await open_dashboard(page, fx.payload);
});

/** Open the edit modal for today's Alpha session and move its stop event 1 h later. */
async function edit_alpha_stop(page: import("@playwright/test").Page): Promise<Date> {
    await page
        .locator("#session_table_body tr", { hasText: "morning work" })
        .locator("button.session-edit-btn")
        .click();
    const new_stop = new Date(fx.alpha_stop_ts + 3600_000);
    await page
        .locator(".session-event-row")
        .nth(3)
        .locator("input[type='datetime-local']")
        .fill(to_datetime_input_value(new_stop.getTime()));
    await page.click("#session_edit_save");
    return new_stop;
}

test("loads, requests data, and renders charts, filters, and table", async ({ page }) => {
    const posted = await posted_messages(page);
    expect(posted[0]).toEqual({ type: "request_data" });

    // Default preset is Last 4 Weeks, applied on load (was bug #31)
    await expect(page.locator("#preset_range")).toHaveValue("last_4_weeks");

    // Job legend: "All" + one checkbox per job, all checked initially
    await expect(page.locator("#job_all_checkbox")).toBeChecked();
    await expect(page.locator("#job_legend .legend-job-box")).toHaveCount(2);
    for (const box of await page.locator("#job_legend .legend-job-box").all()) {
        await expect(box).toBeChecked();
    }

    // Default filter applied: the 40-days-ago "old work" session is excluded,
    // leaving the two "today" sessions (newest first).
    const rows = page.locator("#session_table_body tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Beta");
    await expect(rows.nth(1)).toContainText("morning work");

    // Charts exist in Chart.js's registry with the rendered data
    const pie_labels = await page.evaluate(() => (window as any).Chart.getChart("pie_chart")?.data.labels);
    expect(pie_labels?.slice().sort()).toEqual(["Alpha", "Beta"]);
    const has_bar_chart = await page.evaluate(() => !!(window as any).Chart.getChart("stacked_bar_chart"));
    expect(has_bar_chart).toBe(true);

    // Built-in Chart.js legends are disabled (custom legend replaces them)
    const pie_legend_on = await page.evaluate(() => (window as any).Chart.getChart("pie_chart")?.options.plugins.legend.display);
    const bar_legend_on = await page.evaluate(() => (window as any).Chart.getChart("stacked_bar_chart")?.options.plugins.legend.display);
    expect(pie_legend_on).toBe(false);
    expect(bar_legend_on).toBe(false);
});

test("computes durations and pause/resume pairs per session", async ({ page }) => {
    // Alpha 09:00–10:30 minus 15 min pause = 1.25h, one pause/resume pair
    // (td 0=Date, 1=Client/Project, 2=Task, 3=Duration, ..., 7=P/R)
    const alpha_row = page.locator("#session_table_body tr", { hasText: "morning work" });
    await expect(alpha_row.locator("td").nth(3)).toHaveText("1.25h");
    await expect(alpha_row.locator("td").nth(7)).toHaveText("1");

    // Beta 13:00–14:00, no pauses
    const beta_row = page.locator("#session_table_body tr", { hasText: "Beta" });
    await expect(beta_row.locator("td").nth(3)).toHaveText("1.00h");
    await expect(beta_row.locator("td").nth(7)).toHaveText("0");
});

test("date preset filters sessions", async ({ page }) => {
    await page.selectOption("#preset_range", "last_3_months");
    await expect(page.locator("#session_table_body tr")).toHaveCount(3);

    await page.selectOption("#preset_range", "today");
    await expect(page.locator("#session_table_body tr")).toHaveCount(2);
});

test("job legend checkboxes filter sessions and sync the All checkbox", async ({ page }) => {
    await page.locator("#job_legend .legend-job-box[value='Beta']").uncheck();
    await expect(page.locator("#session_table_body tr")).toHaveCount(1);
    await expect(page.locator("#session_table_body tr")).toContainText("Alpha");
    await expect(page.locator("#job_all_checkbox")).not.toBeChecked();

    // Unchecking every job empties the table
    await page.locator("#job_legend .legend-job-box[value='Alpha']").uncheck();
    await expect(page.locator("#session_table_body tr")).toHaveCount(0);

    // "All" re-checks every job
    await page.locator("#job_all_checkbox").check();
    await expect(page.locator("#session_table_body tr")).toHaveCount(2);
});

test("reset restores the default Last 4 Weeks preset with all jobs", async ({ page }) => {
    await page.selectOption("#preset_range", "last_3_months");
    await page.locator("#job_legend .legend-job-box[value='Beta']").uncheck();

    await page.click("#clear_filters_btn");

    await expect(page.locator("#preset_range")).toHaveValue("last_4_weeks");
    await expect(page.locator("#job_all_checkbox")).toBeChecked();
    await expect(page.locator("#session_table_body tr")).toHaveCount(2);
});

test("edit modal shows the session's events and sends a complete DTO on save", async ({ page }) => {
    await page
        .locator("#session_table_body tr", { hasText: "morning work" })
        .locator("button.session-edit-btn")
        .click();

    await expect(page.locator("#session_edit_modal")).toBeVisible();

    // start, pause, resume, stop — with the stop task prefilled
    const event_rows = page.locator(".session-event-row");
    await expect(event_rows).toHaveCount(4);
    await expect(event_rows.nth(0).locator(".e-label")).toHaveText("start");
    await expect(event_rows.nth(3).locator(".e-label")).toHaveText("stop");
    await expect(event_rows.nth(3).locator(".e-task input")).toHaveValue("morning work");

    // Move the stop event one hour later (minute precision — see #32)
    const new_stop = new Date(fx.alpha_stop_ts + 3600_000);
    await event_rows.nth(3).locator("input[type='datetime-local']").fill(to_datetime_input_value(new_stop.getTime()));
    await page.click("#session_edit_save");

    // Save disables while waiting for the controller's edit_result
    await expect(page.locator("#session_edit_save")).toBeDisabled();
    await expect(page.locator("#session_edit_save")).toHaveText("Saving…");

    const posted = await posted_messages(page);
    const edit_msg = posted.find((m) => m.type === "edit_log_entries");
    expect(edit_msg).toBeTruthy();
    const { edits } = edit_msg!.payload as EditLogEntriesPayload;
    expect(edits).toHaveLength(1);
    expect(edits[0].new_record).toEqual({
        id: edits[0].id,
        event: "stop",
        job_title: "Alpha",
        timestamp: new_stop.getTime(),
        job_id: "alpha",
        time_seed: fx.alpha_stop_ts,
        task: "morning work",
    });
});

test("edit_result errors keep the modal open; success closes it", async ({ page }) => {
    const new_stop = await edit_alpha_stop(page);

    // Controller rejects the edit → inline error, Save re-enabled, modal open
    await reply(page, {
        type: "edit_result",
        payload: { summary: { errors: ["stop must come after resume"] }, payload: fx.payload },
    });
    await expect(page.locator("#session_error")).toBeVisible();
    await expect(page.locator("#session_error")).toContainText("stop must come after resume");
    await expect(page.locator("#session_edit_save")).toBeEnabled();
    await expect(page.locator("#session_edit_modal")).toBeVisible();

    // Controller accepts → modal closes and the table re-renders from the new payload
    const updated = fx.payload.map((e) =>
        e.timestamp === fx.alpha_stop_ts ? { ...e, timestamp: new_stop.getTime() } : e
    );
    await reply(page, {
        type: "edit_result",
        payload: { summary: {}, payload: updated },
    });
    await expect(page.locator("#session_edit_modal")).toBeHidden();
    const alpha_row = page.locator("#session_table_body tr", { hasText: "morning work" });
    await expect(alpha_row.locator("td").nth(3)).toHaveText("2.25h");
});

test("active filters and sort survive an edit_result data reload", async ({ page }) => {
    // Establish non-default state: wider preset, Beta hidden, duration-sorted
    await page.selectOption("#preset_range", "last_3_months");
    await page.locator("#job_legend .legend-job-box[value='Beta']").uncheck();
    await page.locator("#session_table th[data-sort='duration'] .th-label").click();
    await expect(page.locator("#session_table_body tr")).toHaveCount(2); // Alpha only

    // Edit round-trip
    const new_stop = await edit_alpha_stop(page);
    const updated = fx.payload.map((e) =>
        e.timestamp === fx.alpha_stop_ts ? { ...e, timestamp: new_stop.getTime() } : e
    );
    await reply(page, { type: "edit_result", payload: { summary: {}, payload: updated } });
    await expect(page.locator("#session_edit_modal")).toBeHidden();

    // Every piece of filter/sort state survived the reload
    await expect(page.locator("#preset_range")).toHaveValue("last_3_months");
    await expect(page.locator("#job_legend .legend-job-box[value='Beta']")).not.toBeChecked();
    await expect(page.locator("#session_table th[data-sort='duration']")).toHaveClass(/sort-desc/);
    const rows = page.locator("#session_table_body tr");
    await expect(rows).toHaveCount(2);
    for (const row of await rows.all()) await expect(row).toContainText("Alpha");
    // Duration desc: the edited (now 2.25h) session leads
    await expect(rows.nth(0).locator("td").nth(3)).toHaveText("2.25h");
});

test("clicking a bar segment highlights matching rows; clicking again clears (toggle)", async ({ page }) => {
    // Pixel-click the center of Alpha's segment on today's bar through
    // Chart.js hit-testing — not by calling the highlight helpers directly
    const segment = async () => {
        // The chart sits below the fold; mouse.click doesn't scroll, so bring
        // it into view before mapping canvas coords to viewport coords
        await page.locator("#stacked_bar_chart").scrollIntoViewIfNeeded();
        const pos = await page.evaluate((day) => {
            const chart = (window as any).Chart.getChart("stacked_bar_chart");
            const ds_idx = chart.data.datasets.findIndex((d: any) => d.label === "Alpha");
            const day_idx = chart.data.labels.indexOf(day);
            const el = chart.getDatasetMeta(ds_idx).data[day_idx];
            return { x: el.x, y: (el.y + el.base) / 2 };
        }, fx.today);
        const box = (await page.locator("#stacked_bar_chart").boundingBox())!;
        return { x: box.x + pos.x, y: box.y + pos.y };
    };

    let p = await segment();
    await page.mouse.click(p.x, p.y);
    const highlighted = page.locator("#session_table_body tr.session-highlighted");
    await expect(highlighted).toHaveCount(1);
    await expect(highlighted).toContainText("Alpha");

    p = await segment();
    await page.mouse.click(p.x, p.y);
    await expect(page.locator("#session_table_body tr.session-highlighted")).toHaveCount(0);
});

test("edit_result warnings keep the modal open with the warning shown; batch edits post together", async ({ page }) => {
    // Batch: move both the start and the stop of today's Alpha session
    await page
        .locator("#session_table_body tr", { hasText: "morning work" })
        .locator("button.session-edit-btn")
        .click();
    const event_rows = page.locator(".session-event-row");
    const new_start = new Date(fx.alpha_stop_ts - 2 * 3600_000);
    const new_stop = new Date(fx.alpha_stop_ts + 3600_000);
    await event_rows.nth(0).locator("input[type='datetime-local']").fill(to_datetime_input_value(new_start.getTime()));
    await event_rows.nth(3).locator("input[type='datetime-local']").fill(to_datetime_input_value(new_stop.getTime()));
    await page.click("#session_edit_save");

    const posted = await posted_messages(page);
    const edit_msg = posted.find((m) => m.type === "edit_log_entries");
    const { edits } = edit_msg!.payload as EditLogEntriesPayload;
    expect(edits).toHaveLength(2);
    expect(edits.map((e) => e.new_record.event).sort()).toEqual(["start", "stop"]);

    // Warnings without errors: modal stays open, warning visible, Save re-enabled
    await reply(page, {
        type: "edit_result",
        payload: { summary: { warnings: ["overlaps a session of another job"] }, payload: fx.payload },
    });
    await expect(page.locator("#session_edit_modal")).toBeVisible();
    await expect(page.locator("#session_warning")).toBeVisible();
    await expect(page.locator("#session_warning")).toContainText("overlaps a session of another job");
    await expect(page.locator("#session_edit_save")).toBeEnabled();

    // User acknowledges by cancelling
    await page.click("#session_edit_cancel");
    await expect(page.locator("#session_edit_modal")).toBeHidden();
});

test("edit modal: Escape cancels, Enter saves", async ({ page }) => {
    const open_modal = () =>
        page
            .locator("#session_table_body tr", { hasText: "morning work" })
            .locator("button.session-edit-btn")
            .click();

    // Escape closes without saving
    await open_modal();
    await expect(page.locator("#session_edit_modal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#session_edit_modal")).toBeHidden();

    // Enter acts as Save (no edits → modal just closes, nothing posted)
    await open_modal();
    await page.keyboard.press("Enter");
    await expect(page.locator("#session_edit_modal")).toBeHidden();
    const posted = await posted_messages(page);
    expect(posted.find((m) => m.type === "edit_log_entries")).toBeUndefined();
});

test("highlighting marks matching session rows", async ({ page }) => {
    await page.evaluate((day) => (window as any).highlight_session_rows("Alpha", day), fx.today);
    const highlighted = page.locator("#session_table_body tr.session-highlighted");
    await expect(highlighted).toHaveCount(1);
    await expect(highlighted).toContainText("Alpha");

    await page.evaluate(() => (window as any).clear_session_highlights());
    await expect(page.locator("#session_table_body tr.session-highlighted")).toHaveCount(0);
});

test("build info footer falls back to 'no build info' when the controller sends none", async ({ page }) => {
    await expect(page.locator("#build_info_footer")).toHaveText("no build info");
});

test("build info footer shows the controller-provided build string", async ({ page }) => {
    await open_dashboard(page, fx.payload, "v0.3.0 @ a1b2c3d (2026-07-16T00:00:00.000Z)");
    await expect(page.locator("#build_info_footer")).toHaveText("v0.3.0 @ a1b2c3d (2026-07-16T00:00:00.000Z)");
});
