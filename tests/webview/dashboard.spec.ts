import { test, expect } from "@playwright/test";

import { build_fixture } from "./fixtures";
import { open_dashboard, posted_messages, reply } from "./harness";

// Fixture: Alpha today 09:00–10:30 (1 pause/resume pair), Beta today
// 13:00–14:00, Alpha 40 days ago 10:00–11:00. Default preset is "today".

test("loads, requests data, and renders charts, filters, and table", async ({ page }) => {
    const fx = build_fixture();
    await open_dashboard(page, fx.payload);

    const posted = await posted_messages(page);
    expect(posted[0]).toEqual({ type: "request_data" });

    // Job filter: "All" + one checkbox per job, all checked initially
    await expect(page.locator("#job_all_checkbox")).toBeChecked();
    await expect(page.locator("#job_filter_container .job-box")).toHaveCount(2);
    for (const box of await page.locator("#job_filter_container .job-box").all()) {
        await expect(box).toBeChecked();
    }

    // Initial render shows ALL sessions regardless of the preset select
    // (current behavior: the summary_data handler renders unfiltered; the
    // preset only applies once a filter control is touched), newest first.
    const rows = page.locator("#session_table_body tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Beta");
    await expect(rows.nth(1)).toContainText("morning work");
    await expect(rows.nth(2)).toContainText("old work");

    // Charts exist in Chart.js's registry with the filtered data
    const pieLabels = await page.evaluate(() => (window as any).Chart.getChart("pie_chart")?.data.labels);
    expect(pieLabels?.slice().sort()).toEqual(["Alpha", "Beta"]);
    const barChart = await page.evaluate(() => !!(window as any).Chart.getChart("stacked_bar_chart"));
    expect(barChart).toBe(true);
});

test("computes durations and pause/resume pairs per session", async ({ page }) => {
    const fx = build_fixture();
    await open_dashboard(page, fx.payload);

    // Alpha 09:00–10:30 minus 15 min pause = 1.25h, one pause/resume pair
    const alphaRow = page.locator("#session_table_body tr", { hasText: "morning work" });
    await expect(alphaRow.locator("td").nth(2)).toHaveText("1.25h");
    await expect(alphaRow.locator("td").nth(6)).toHaveText("1");

    // Beta 13:00–14:00, no pauses
    const betaRow = page.locator("#session_table_body tr", { hasText: "Beta" });
    await expect(betaRow.locator("td").nth(2)).toHaveText("1.00h");
    await expect(betaRow.locator("td").nth(6)).toHaveText("0");
});

test("date preset filters sessions", async ({ page }) => {
    const fx = build_fixture();
    await open_dashboard(page, fx.payload);

    await page.selectOption("#preset_range", "last_3_months");
    await expect(page.locator("#session_table_body tr")).toHaveCount(3);

    await page.selectOption("#preset_range", "today");
    await expect(page.locator("#session_table_body tr")).toHaveCount(2);
});

test("job checkboxes filter sessions and sync the All checkbox", async ({ page }) => {
    const fx = build_fixture();
    await open_dashboard(page, fx.payload);

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
    const fx = build_fixture();
    await open_dashboard(page, fx.payload);

    await page.selectOption("#preset_range", "last_3_months");
    await page.locator("#job_filter_container .job-box[value='Beta']").uncheck();

    await page.click("#clear_filters_btn");

    await expect(page.locator("#preset_range")).toHaveValue("this_month");
    await expect(page.locator("#job_all_checkbox")).toBeChecked();
    await expect(page.locator("#session_table_body tr")).toHaveCount(2);
});

test("edit modal shows the session's events and sends a complete DTO on save", async ({ page }) => {
    const fx = build_fixture();
    await open_dashboard(page, fx.payload);

    const alphaRow = page.locator("#session_table_body tr", { hasText: "morning work" });
    await alphaRow.locator("button.session-edit-btn").click();

    const modal = page.locator("#session_edit_modal");
    await expect(modal).toBeVisible();

    // start, pause, resume, stop — with the stop task prefilled
    const eventRows = page.locator(".session-event-row");
    await expect(eventRows).toHaveCount(4);
    await expect(eventRows.nth(0).locator(".e-label")).toHaveText("start");
    await expect(eventRows.nth(3).locator(".e-label")).toHaveText("stop");
    await expect(eventRows.nth(3).locator(".e-task input")).toHaveValue("morning work");

    // Move the stop event one hour later
    const newStop = new Date(fx.alpha_stop_ts + 3600_000);
    const localValue = new Date(newStop.getTime() - newStop.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16); // minute precision: the datetime-local input has no step attr
    await eventRows.nth(3).locator("input[type='datetime-local']").fill(localValue);
    await page.click("#session_edit_save");

    // Save disables while waiting for the controller's edit_result
    await expect(page.locator("#session_edit_save")).toBeDisabled();
    await expect(page.locator("#session_edit_save")).toHaveText("Saving…");

    const posted = await posted_messages(page);
    const editMsg = posted.find((m) => m.type === "edit_log_entries");
    expect(editMsg).toBeTruthy();
    expect(editMsg.payload.edits).toHaveLength(1);
    const rec = editMsg.payload.edits[0].new_record;
    expect(rec).toEqual({
        id: editMsg.payload.edits[0].id,
        event: "stop",
        job_title: "Alpha",
        timestamp: newStop.getTime(),
        job_id: "alpha",
        time_seed: fx.alpha_stop_ts,
        task: "morning work",
    });
});

test("edit_result errors keep the modal open; success closes it", async ({ page }) => {
    const fx = build_fixture();
    await open_dashboard(page, fx.payload);

    await page
        .locator("#session_table_body tr", { hasText: "morning work" })
        .locator("button.session-edit-btn")
        .click();
    const stopRow = page.locator(".session-event-row").nth(3);
    const newStop = new Date(fx.alpha_stop_ts + 3600_000);
    const localValue = new Date(newStop.getTime() - newStop.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16); // minute precision: the datetime-local input has no step attr
    await stopRow.locator("input[type='datetime-local']").fill(localValue);
    await page.click("#session_edit_save");

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
        e.timestamp === fx.alpha_stop_ts ? { ...e, timestamp: newStop.getTime() } : e
    );
    await reply(page, {
        type: "edit_result",
        payload: { summary: {}, payload: updated },
    });
    await expect(page.locator("#session_edit_modal")).toBeHidden();
    const alphaRow = page.locator("#session_table_body tr", { hasText: "morning work" });
    await expect(alphaRow.locator("td").nth(2)).toHaveText("2.25h");
});

test("highlighting marks matching session rows", async ({ page }) => {
    const fx = build_fixture();
    await open_dashboard(page, fx.payload);

    await page.evaluate((day) => (window as any).highlight_session_rows("Alpha", day), fx.today);
    const highlighted = page.locator("#session_table_body tr.session-highlighted");
    await expect(highlighted).toHaveCount(1);
    await expect(highlighted).toContainText("Alpha");

    await page.evaluate(() => (window as any).clear_session_highlights());
    await expect(page.locator("#session_table_body tr.session-highlighted")).toHaveCount(0);
});
