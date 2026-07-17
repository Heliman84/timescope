/**
 * Deterministic fixture data for dashboard webview tests.
 *
 * Shape mirrors buildPayload() in src/dashboard/controller/dashboard_utils.ts:
 * timestamp-descending array of { event, job, timestamp, task, id, job_id,
 * time_seed, global_line_index, workspace_line_index }.
 *
 * Time is frozen: fixtures are generated relative to FIXED_NOW, and the
 * harness pins the page clock to the same instant (page.clock.setFixedTime).
 * This removes the old "run straddling local midnight" flake — the dashboard's
 * relative date presets now resolve against a fixed, known day.
 */

export interface FixtureEvent {
    event: string;
    job: string;
    timestamp: number;
    task: string;
    id: string;
    job_id: string;
    time_seed: number;
    global_line_index: number;
    workspace_line_index: number;
}

/**
 * The frozen "now" all fixtures and the page clock share:
 * Wednesday 2026-07-15, 12:00 local. Chosen mid-week and mid-month so the
 * this_week / this_month presets have a non-trivial span to assert against.
 */
export const FIXED_NOW = new Date(2026, 6, 15, 12, 0, 0, 0);

/** Same local-day formatting the dashboard uses (get_local_day). */
function local_day(timestamp: number): string {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function at_local_time(base: Date, hours: number, minutes: number): number {
    const d = new Date(base);
    d.setHours(hours, minutes, 0, 0);
    return d.getTime();
}

export interface FixtureData {
    payload: FixtureEvent[];
    /** Local day string of the two "today" sessions. */
    today: string;
    /** Timestamp of the stop event of today's Alpha session. */
    alpha_stop_ts: number;
}

/**
 * Three closed sessions (relative to FIXED_NOW = 2026-07-15):
 * - Alpha, today 09:00–10:30 with one pause/resume pair (09:45–10:00), task "morning work"
 * - Beta,  today 13:00–14:00, task "beta task"
 * - Alpha, 40 days ago 10:00–11:00 (inside "last 3 months", outside "last 14 days")
 *
 * Kept intentionally small: this fixture backs the edit-modal, highlighting,
 * and build-info tests. Filtering behaviour is exercised by build_filter_fixture.
 */
export function build_fixture(now: Date = FIXED_NOW): FixtureData {
    const old = new Date(now.getTime() - 40 * 24 * 3600 * 1000);

    let line = 0;
    const ev = (
        event: string,
        job: string,
        job_id: string,
        timestamp: number,
        task = ""
    ): FixtureEvent => ({
        event,
        job,
        timestamp,
        task,
        id: `fx-${line}`,
        job_id,
        time_seed: timestamp,
        global_line_index: ++line,
        workspace_line_index: line,
    });

    const alpha_stop_ts = at_local_time(now, 10, 30);

    const events: FixtureEvent[] = [
        ev("start", "Alpha", "alpha", at_local_time(old, 10, 0)),
        ev("stop", "Alpha", "alpha", at_local_time(old, 11, 0), "old work"),
        ev("start", "Alpha", "alpha", at_local_time(now, 9, 0)),
        ev("pause", "Alpha", "alpha", at_local_time(now, 9, 45)),
        ev("resume", "Alpha", "alpha", at_local_time(now, 10, 0)),
        ev("stop", "Alpha", "alpha", alpha_stop_ts, "morning work"),
        ev("start", "Beta", "beta", at_local_time(now, 13, 0)),
        ev("stop", "Beta", "beta", at_local_time(now, 14, 0), "beta task"),
    ];

    return {
        payload: events.slice().sort((a, b) => b.timestamp - a.timestamp),
        today: local_day(now.getTime()),
        alpha_stop_ts,
    };
}

/** One planned session in the filtering fixture. */
export interface FilterFixtureSession {
    job: string;
    /** Local day of the session ("YYYY-MM-DD"). */
    day: string;
    /** Active duration in hours (pause gaps are zero-length, so span == active). */
    hours: number;
    /** Number of pause/resume pairs. */
    pauses: number;
    /** Log provenance — controls has_global/has_workspace for the #3 source seam. */
    source: "merged" | "global" | "workspace";
}

export interface FilterFixtureData {
    payload: FixtureEvent[];
    /** All job names, in creation order. */
    jobs: string[];
    /** Jobs whose session falls inside the default Last-4-Weeks window. */
    jobs_in_default_range: string[];
}

/**
 * A twelve-job fixture built for filter/sort coverage (relative to FIXED_NOW):
 *
 * - 12 jobs → exercises the scrollable legend and palette wrap (10-colour base).
 * - Sessions placed on preset boundaries: 06-18 (Last-4-Weeks start boundary,
 *   Wolf), 06-10 (outside the default window, Vega).
 * - Duration spread 0.5h..8h with exact boundary values for the range filter.
 * - Pause spread 0..3 pairs (zero-length gaps keep durations exact).
 * - One global-only and one workspace-only session for the source seam.
 *
 * Eleven of the twelve sessions fall inside the default Last-4-Weeks window;
 * only Vega (06-10) falls outside it.
 */
export function build_filter_fixture(now: Date = FIXED_NOW): FilterFixtureData {
    const plan: FilterFixtureSession[] = [
        { job: "Acme", day: local_day(at_local_time(now, 9, 0)), hours: 1.0, pauses: 0, source: "merged" },      // today 07-15
        { job: "Beacon", day: shift_day(now, -1), hours: 2.0, pauses: 1, source: "merged" },                     // 07-14
        { job: "Cobalt", day: shift_day(now, -2), hours: 3.0, pauses: 2, source: "merged" },                     // 07-13
        { job: "Delta", day: shift_day(now, -3), hours: 1.0, pauses: 0, source: "merged" },                      // 07-12
        { job: "Ember", day: shift_day(now, -4), hours: 1.0, pauses: 0, source: "global" },                      // 07-11 global-only
        { job: "Flint", day: shift_day(now, -5), hours: 0.5, pauses: 0, source: "workspace" },                   // 07-10 workspace-only
        { job: "Gale", day: shift_day(now, -6), hours: 1.0, pauses: 0, source: "merged" },                       // 07-09
        { job: "Harbor", day: shift_day(now, -7), hours: 1.0, pauses: 1, source: "merged" },                     // 07-08
        { job: "Iris", day: shift_day(now, -8), hours: 1.0, pauses: 0, source: "merged" },                       // 07-07
        { job: "Juno", day: shift_day(now, -13), hours: 4.0, pauses: 3, source: "merged" },                      // 07-02 inside default window
        { job: "Wolf", day: shift_day(now, -27), hours: 8.0, pauses: 0, source: "merged" },                      // 06-18 Last-4-Weeks start boundary
        { job: "Vega", day: shift_day(now, -35), hours: 1.0, pauses: 0, source: "merged" },                      // 06-10 outside the default window
    ];

    let line = 0;
    const events: FixtureEvent[] = [];

    const push = (
        event: string,
        job: string,
        job_id: string,
        timestamp: number,
        source: FilterFixtureSession["source"],
        task = ""
    ): void => {
        line += 1;
        events.push({
            event,
            job,
            timestamp,
            task,
            id: `ff-${line}`,
            job_id,
            time_seed: timestamp,
            global_line_index: source === "workspace" ? -1 : line,
            workspace_line_index: source === "global" ? -1 : line,
        });
    };

    for (const s of plan) {
        const job_id = s.job.toLowerCase();
        const base = new Date(`${s.day}T00:00:00`);
        const start = at_local_time(base, 9, 0);
        const active_ms = Math.round(s.hours * 3600_000);
        const stop = start + active_ms;

        push("start", s.job, job_id, start, s.source);
        // Zero-length pause gaps: paused time is 0, so active duration == span.
        for (let p = 0; p < s.pauses; p++) {
            const at = start + 60_000 * (p + 1);
            push("pause", s.job, job_id, at, s.source);
            push("resume", s.job, job_id, at, s.source);
        }
        push("stop", s.job, job_id, stop, s.source, `${s.job} work`);
    }

    return {
        payload: events.slice().sort((a, b) => b.timestamp - a.timestamp),
        jobs: plan.map(s => s.job),
        jobs_in_default_range: plan.filter(s => s.day >= shift_day(now, -27)).map(s => s.job),
    };
}

/** Local-day string N days before `now` (N negative = past). */
function shift_day(now: Date, delta_days: number): string {
    const d = new Date(now);
    d.setDate(now.getDate() + delta_days);
    return local_day(d.getTime());
}
