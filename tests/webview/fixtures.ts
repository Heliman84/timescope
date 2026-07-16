/**
 * Deterministic fixture data for dashboard webview tests.
 *
 * Shape mirrors buildPayload() in src/dashboard/controller/dashboard_utils.ts:
 * timestamp-descending array of { event, job, timestamp, task, id, job_id,
 * time_seed, global_line_index, workspace_line_index }.
 *
 * Timestamps are generated relative to "now" so the dashboard's relative
 * date presets (today / this month / last 3 months) behave predictably.
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
 * Three closed sessions:
 * - Alpha, today 09:00–10:30 with one pause/resume pair (09:45–10:00), task "morning work"
 * - Beta,  today 13:00–14:00, task "beta task"
 * - Alpha, 40 days ago 10:00–11:00 (inside "last 3 months", outside "this month" and "today")
 */
export function build_fixture(): FixtureData {
    // Known flake window: "today" is stamped here, but the dashboard recomputes
    // its own "today" at filter time — a run straddling local midnight can
    // disagree. Accepted: the window is one page-load wide.
    const now = new Date();
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
