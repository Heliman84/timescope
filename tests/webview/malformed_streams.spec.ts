import { test, expect } from "@playwright/test";

import { build_malformed_fixture, MalformedFixtureData } from "./fixtures";
import { open_dashboard } from "./harness";

// Pins how build_sessions_from_events (dashboard.js) renders malformed /
// unbalanced event streams — production reality (the real log carries 145
// pause vs 122 resume events). Scenarios per issue #42's test-coverage note;
// one single-purpose job per scenario, all "today" relative to FIXED_NOW.
//
// Note the deliberate divergence from the Node side: EventRepository
// finalizes dangling sessions; the webview drops them.

let fx: MalformedFixtureData;

test.beforeEach(async ({ page }) => {
    fx = build_malformed_fixture();
    await open_dashboard(page, fx.payload);
});

test("dangling start and stop-without-start produce no sessions", async ({ page }) => {
    // Orphan + Skip + Twice's two sessions = 4 rows; Dangle and Ghost nowhere.
    const rows = page.locator("#session_table_body tr");
    await expect(rows).toHaveCount(4);
    for (const job of fx.jobs_without_sessions) {
        await expect(page.locator("#session_table_body")).not.toContainText(job);
    }

    // Legend and pie only know the jobs that produced sessions.
    await expect(page.locator("#job_legend .legend-job-box")).toHaveCount(3);
    const pie_labels = await page.evaluate(() => (window as any).Chart.getChart("pie_chart")?.data.labels);
    expect(pie_labels?.slice().sort()).toEqual(["Orphan", "Skip", "Twice"]);
});

test("pause never resumed: paused tail excluded from duration, no pair counted", async ({ page }) => {
    // Orphan 09:00–10:00, paused at 09:30 with no resume → 0.50h active.
    const row = page.locator("#session_table_body tr", { hasText: "orphan work" });
    await expect(row.locator("td").nth(2)).toHaveText("0.50h");
    // The dangling pause is NOT a pause/resume pair.
    await expect(row.locator("td").nth(6)).toHaveText("0");
});

test("resume without a pause is ignored", async ({ page }) => {
    // Skip 10:00–11:00 with an orphan resume at 10:30 → full 1.00h, no pairs.
    const row = page.locator("#session_table_body tr", { hasText: "skip work" });
    await expect(row.locator("td").nth(2)).toHaveText("1.00h");
    await expect(row.locator("td").nth(6)).toHaveText("0");
});

test("double start finalizes the first session at the second start", async ({ page }) => {
    // Twice: start 13:00, start 14:00, stop 15:30 → two sessions.
    // First session 13:00–14:00 (task from its start event), second 14:00–15:30.
    const first = page.locator("#session_table_body tr", { hasText: "twice-first" });
    await expect(first).toHaveCount(1);
    await expect(first.locator("td").nth(2)).toHaveText("1.00h");

    const second = page.locator("#session_table_body tr", { hasText: "twice-stop" });
    await expect(second).toHaveCount(1);
    await expect(second.locator("td").nth(2)).toHaveText("1.50h");

    // Table is newest-first: the 14:00 session outranks the 13:00 one.
    const rows = page.locator("#session_table_body tr");
    await expect(rows.nth(0)).toContainText("twice-stop");
    await expect(rows.nth(1)).toContainText("twice-first");
});
