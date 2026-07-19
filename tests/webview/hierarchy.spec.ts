import { test, expect } from "@playwright/test";

import { build_hierarchy_fixture, HierarchyFixtureData } from "./fixtures";
import { open_dashboard } from "./harness";

// Four sessions, all "today" (inside the default Last 4 Weeks preset):
// - Bound: repoA, client+project+task_type all resolved (09:00-10:00)
// - Bound-alias: same task_type as Bound but a DIFFERENT flat job title —
//   the legacy-alias case (#15 convert_legacy_job) — must group with Bound
//   under the same hierarchy label (11:00-11:30)
// - Unbound: repoB, task_type resolves but no client/project (13:00-14:00)
// - Unassigned: no resolvable task_type at all — flat job title (15:00-15:30)

let fx: HierarchyFixtureData;

test.beforeEach(async ({ page }) => {
    fx = build_hierarchy_fixture();
    await open_dashboard(page, fx.payload);
});

test("bound-repo session renders as Client › Project › Task-type", async ({ page }) => {
    const row = page.locator("#session_table_body tr", { hasText: "canonical-task work" });
    await expect(row.locator("td").nth(1)).toHaveText(fx.bound_label);
});

test("a legacy-aliased job sharing the task-type groups with the canonical session under one label", async ({ page }) => {
    const legacy_row = page.locator("#session_table_body tr", { hasText: "legacy-alias work" });
    await expect(legacy_row.locator("td").nth(1)).toHaveText(fx.bound_label);

    // Legend shows one grouped entry for the shared task-type, not two —
    // proves the two differently-titled flat jobs collapsed into one group.
    const legend_rows = await page.locator("#job_legend .legend-text").allTextContents();
    expect(legend_rows.filter(t => t === fx.bound_label)).toHaveLength(1);
});

test("unbound-repo session renders as the task-type alone (no client/project)", async ({ page }) => {
    const row = page.locator("#session_table_body tr", { hasText: "no-binding work" });
    await expect(row.locator("td").nth(1)).toHaveText(fx.unbound_label);
});

test("a session with no resolvable task-type falls back to its flat job title (Unassigned)", async ({ page }) => {
    const row = page.locator("#session_table_body tr", { hasText: "unassigned-errand work" });
    await expect(row.locator("td").nth(1)).toHaveText(fx.unassigned_label);
});

test("the job legend lists the three distinct hierarchy labels", async ({ page }) => {
    const legend_rows = await page.locator("#job_legend .legend-text").allTextContents();
    // "All" plus one row per distinct group: bound (shared), unbound, unassigned
    expect(legend_rows.sort()).toEqual(
        ["All", fx.bound_label, fx.unassigned_label, fx.unbound_label].sort()
    );
});

test("the edit modal still opens and matches events for a grouped (hierarchy-labelled) session", async ({ page }) => {
    await page
        .locator("#session_table_body tr", { hasText: "canonical-task work" })
        .locator("button.session-edit-btn")
        .click();

    // Exactly the two events of the Bound session (start/stop), not the
    // legacy-aliased session's events, even though they share a label.
    await expect(page.locator(".session-event-row")).toHaveCount(2);
    await expect(page.locator("#session_edit_modal")).toBeVisible();
});
