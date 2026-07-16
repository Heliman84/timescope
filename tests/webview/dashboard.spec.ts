import { test, expect } from "@playwright/test";

import { build_fixture, FixtureData } from "./fixtures";
import { open_dashboard, posted_messages, reply, to_datetime_input_value } from "./harness";

// Fixture: Alpha today 09:00–10:30 (1 pause/resume pair), Beta today
// 13:00–14:00, Alpha 40 days ago 10:00–11:00. Default preset is "today".

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

    // Job filter: "All" + one checkbox per job, all checked initially
    await expect(page.locator("#job_all_checkbox")).toBeChecked();
    await expect(page.locator("#job_filter_container .job-box")).toHaveCount(2);
    for (const box of await page.locator("#job_filter_container .job-box").all()) {
        await expect(box).toBeChecked();
    }

    // KNOWN BUG #31: initial render ignores the preset select ("Today") and
    // shows ALL sessions until a filter control is touched. Update this
    // assertion (3 → 2 rows) when #31 is fixed.
    const rows = page.locator("#session_table_body tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Beta");
    await expect(rows.nth(1)).toContainText("morning work");
    await expect(rows.nth(2)).toContainText("old work");

    // Charts exist in Chart.js's registry with the rendered data
    const pie_labels = await page.evaluate(() => (window as any).Chart.getChart("pie_chart")?.data.labels);
    expect(pie_labels?.slice().sort()).toEqual(["Alpha", "Beta"]);
    const has_bar_chart = await page.evaluate(() => !!(window as any).Chart.getChart("stacked_bar_chart"));
    expect(has_bar_chart).toBe(true);
});

test("computes durations and pause/resume pairs per session", async ({ page }) => {
    // Alpha 09:00–10:30 minus 15 min pause = 1.25h, one pause/resume pair
    const alpha_row = page.locator("#session_table_body tr", { hasText: "morning work" });
    await expect(alpha_row.locator("td").nth(2)).toHaveText("1.25h");
    await expect(alpha_row.locator("td").nth(6)).toHaveText("1");

    // Beta 13:00–14:00, no pauses
    const beta_row = page.locator("#session_table_body tr", { hasText: "Beta" });
    await expect(beta_row.locator("td").nth(2)).toHaveText("1.00h");
    await expect(beta_row.locator("td").nth(6)).toHaveText("0");
});

test("date preset filters sessions", async ({ page }) => {
    await page.selectOption("#preset_range", "last_3_months");
    await expect(page.locator("#session_table_body tr")).toHaveCount(3);

    await page.selectOption("#preset_range", "today");
    await expect(page.locator("#session_table_body tr")).toHaveCount(2);
});

test("job checkboxes filter sessions and sync the All checkbox", async ({ page }) => {
    await page.locator("#job_filter_container .job-box[value='Beta']").uncheck();
    await expect(page.locator("#session_table_body tr")).toHaveCount(1);
    await expect(page.locator("#session_table_body tr")).toContainText("Alpha");
    await expect(page.locator("#job_all_checkbox")).not.toBeChecked();

    // Unchecking every job empties the table
    await page.locator("#job_filter_container .job-box[value='Alpha']").uncheck();
    await expect(page.locator("#session_table_body tr")).toHaveCount(0);

    // "All" re-checks every job
    await page.locator("#job_all_checkbox").check();
    await expect(page.locator("#session_table_body tr")).toHaveCount(2);
});

test("clear filters resets to this-month preset with all jobs", async ({ page }) => {
    await page.selectOption("#preset_range", "last_3_months");
    await page.locator("#job_filter_container .job-box[value='Beta']").uncheck();

    await page.click("#clear_filters_btn");

    await expect(page.locator("#preset_range")).toHaveValue("this_month");
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
    await expect(alpha_row.locator("td").nth(2)).toHaveText("2.25h");
});

test("highlighting marks matching session rows", async ({ page }) => {
    await page.evaluate((day) => (window as any).highlight_session_rows("Alpha", day), fx.today);
    const highlighted = page.locator("#session_table_body tr.session-highlighted");
    await expect(highlighted).toHaveCount(1);
    await expect(highlighted).toContainText("Alpha");

    await page.evaluate(() => (window as any).clear_session_highlights());
    await expect(page.locator("#session_table_body tr.session-highlighted")).toHaveCount(0);
});
