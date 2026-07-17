import * as path from "path";
import * as assert from "assert";

// ---------------------------------------------------------------------------
// Typed view of the plain-JS webview module (src/dashboard/webview/filter_state.js).
// The module is vanilla JS so the webview can load it without a build step;
// tests require() it directly from source and cast to this interface.
// ---------------------------------------------------------------------------

interface FilterState {
    preset: string;
    start_day: string | null;
    end_day: string | null;
    jobs: string[] | null;
    duration_min_h: number | null;
    duration_max_h: number | null;
    pauses_min: number | null;
    pauses_max: number | null;
    source: "merged" | "global" | "workspace";
    sort_key: string;
    sort_dir: "asc" | "desc";
}

interface FilterSession {
    job: string;
    start: number;
    stop: number;
    duration_ms: number;
    task: string;
    pause_pairs: number;
    has_global: boolean;
    has_workspace: boolean;
}

interface PresetRange {
    start_day: string | null;
    end_day: string | null;
}

interface FilterStateModule {
    create_default_filter_state(now: Date): FilterState;
    resolve_preset_range(preset: string, now: Date): PresetRange;
    apply_filters(sessions: FilterSession[], state: FilterState): FilterSession[];
    sort_sessions(sessions: FilterSession[], sort_key: string, sort_dir: "asc" | "desc"): FilterSession[];
    get_local_day(timestamp: number): string;
}

/* eslint-disable @typescript-eslint/no-var-requires */
const fs_module = require(
    path.join(__dirname, "..", "..", "src", "dashboard", "webview", "filter_state.js")
) as FilterStateModule;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fixed "now": Wednesday 2026-07-15, 12:00 local. */
function fixed_now(): Date {
    return new Date(2026, 6, 15, 12, 0, 0, 0);
}

/** Timestamp for a local calendar day at a given hour. */
function ts(year: number, month1: number, day: number, hour = 10): number {
    return new Date(year, month1 - 1, day, hour, 0, 0, 0).getTime();
}

let session_seq = 0;
function make_session(overrides: Partial<FilterSession>): FilterSession {
    session_seq += 1;
    const start = overrides.start ?? ts(2026, 7, 10);
    const duration_ms = overrides.duration_ms ?? 3600_000;
    return {
        job: "Alpha",
        start,
        stop: start + duration_ms,
        duration_ms,
        task: `task-${session_seq}`,
        pause_pairs: 0,
        has_global: true,
        has_workspace: true,
        ...overrides,
    };
}

function hours(h: number): number {
    return Math.round(h * 3600_000);
}

// ═══════════════════════════════════════════════════════════════════════════
// create_default_filter_state
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests the default filter state:
 * - Target: create_default_filter_state in src/dashboard/webview/filter_state.js
 * - What: the state the dashboard applies on first render.
 * - Why: issue #5 requires "Last 14 Days" as the default AND actually applied
 *   on load (bug #31 was the old "Today" default never being applied). The
 *   resolved start/end days make the default self-applying.
 */
export function run_default_filter_state_tests(): void {
    const state = fs_module.create_default_filter_state(fixed_now());

    assert.strictEqual(state.preset, "last_14", "default preset is Last 14 Days");
    assert.strictEqual(state.start_day, "2026-07-02", "start day resolved: 13 days before now");
    assert.strictEqual(state.end_day, "2026-07-15", "end day resolved: today");
    assert.strictEqual(state.jobs, null, "null jobs = all jobs (new jobs stay included)");
    assert.strictEqual(state.duration_min_h, null);
    assert.strictEqual(state.duration_max_h, null);
    assert.strictEqual(state.pauses_min, null);
    assert.strictEqual(state.pauses_max, null);
    assert.strictEqual(state.source, "merged", "issue #3 seam defaults to merged view");
    assert.strictEqual(state.sort_key, "start", "default sort: newest first");
    assert.strictEqual(state.sort_dir, "desc");

    console.log("  ✓ default filter state tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// resolve_preset_range
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests preset → local-day range resolution:
 * - Target: resolve_preset_range in filter_state.js
 * - What: every quick-select preset resolves to an inclusive local-day range
 *   relative to an injected "now"; all/custom resolve to unbounded.
 * - Why: this is the heart of the date filter; boundary math must be exact
 *   (off-by-one here silently hides or leaks sessions at range edges).
 */
export function run_resolve_preset_range_tests(): void {
    const now = fixed_now(); // Wednesday 2026-07-15

    assert.deepStrictEqual(
        fs_module.resolve_preset_range("today", now),
        { start_day: "2026-07-15", end_day: "2026-07-15" });
    assert.deepStrictEqual(
        fs_module.resolve_preset_range("this_week", now),
        { start_day: "2026-07-13", end_day: "2026-07-15" }, "week starts Monday");
    assert.deepStrictEqual(
        fs_module.resolve_preset_range("last_7", now),
        { start_day: "2026-07-09", end_day: "2026-07-15" }, "7 days inclusive of today");
    assert.deepStrictEqual(
        fs_module.resolve_preset_range("last_14", now),
        { start_day: "2026-07-02", end_day: "2026-07-15" }, "14 days inclusive of today");
    assert.deepStrictEqual(
        fs_module.resolve_preset_range("this_month", now),
        { start_day: "2026-07-01", end_day: "2026-07-15" });
    assert.deepStrictEqual(
        fs_module.resolve_preset_range("last_3_months", now),
        { start_day: "2026-05-01", end_day: "2026-07-15" }, "first of month two months back");
    assert.deepStrictEqual(
        fs_module.resolve_preset_range("last_year", now),
        { start_day: "2025-08-01", end_day: "2026-07-15" }, "first of month eleven months back");
    assert.deepStrictEqual(
        fs_module.resolve_preset_range("all", now),
        { start_day: null, end_day: null }, "all = unbounded");
    assert.deepStrictEqual(
        fs_module.resolve_preset_range("custom", now),
        { start_day: null, end_day: null }, "custom = caller-managed fields");

    // Sunday: this_week must reach back to the previous Monday
    const sunday = new Date(2026, 6, 19, 12, 0, 0, 0);
    assert.deepStrictEqual(
        fs_module.resolve_preset_range("this_week", sunday),
        { start_day: "2026-07-13", end_day: "2026-07-19" });

    // Monday: this_week starts today
    const monday = new Date(2026, 6, 13, 12, 0, 0, 0);
    assert.deepStrictEqual(
        fs_module.resolve_preset_range("this_week", monday),
        { start_day: "2026-07-13", end_day: "2026-07-13" });

    // Year boundary: last_14 from early January crosses into the previous year
    const january = new Date(2026, 0, 5, 12, 0, 0, 0);
    assert.deepStrictEqual(
        fs_module.resolve_preset_range("last_14", january),
        { start_day: "2025-12-23", end_day: "2026-01-05" });
    assert.deepStrictEqual(
        fs_module.resolve_preset_range("last_3_months", january),
        { start_day: "2025-11-01", end_day: "2026-01-05" });

    console.log("  ✓ resolve_preset_range tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// apply_filters — one dimension at a time
// ═══════════════════════════════════════════════════════════════════════════

function state_with(overrides: Partial<FilterState>): FilterState {
    const base = fs_module.create_default_filter_state(fixed_now());
    return { ...base, start_day: null, end_day: null, ...overrides };
}

/**
 * Tests date-range filtering:
 * - What: sessions are kept when the local day of their start falls inside
 *   [start_day, end_day], boundaries inclusive; null bounds are open-ended.
 * - Why: issue #5's presets and manual start/end fields both reduce to this
 *   comparison; boundary days must be included, matching the old sidebar.
 */
export function run_apply_filters_date_tests(): void {
    const sessions = [
        make_session({ job: "Edge-start", start: ts(2026, 7, 2) }),
        make_session({ job: "Inside", start: ts(2026, 7, 10) }),
        make_session({ job: "Edge-end", start: ts(2026, 7, 15) }),
        make_session({ job: "Before", start: ts(2026, 7, 1) }),
        make_session({ job: "After", start: ts(2026, 7, 16) }),
    ];

    const bounded = fs_module.apply_filters(sessions, state_with({ start_day: "2026-07-02", end_day: "2026-07-15" }));
    assert.deepStrictEqual(bounded.map(s => s.job), ["Edge-start", "Inside", "Edge-end"], "boundary days are inclusive");

    const open_start = fs_module.apply_filters(sessions, state_with({ start_day: null, end_day: "2026-07-02" }));
    assert.deepStrictEqual(open_start.map(s => s.job), ["Edge-start", "Before"], "null start = open-ended past");

    const open_end = fs_module.apply_filters(sessions, state_with({ start_day: "2026-07-15", end_day: null }));
    assert.deepStrictEqual(open_end.map(s => s.job), ["Edge-end", "After"], "null end = open-ended future");

    const unbounded = fs_module.apply_filters(sessions, state_with({}));
    assert.strictEqual(unbounded.length, 5, "both bounds null = everything");

    console.log("  ✓ apply_filters date tests passed");
}

/**
 * Tests job filtering:
 * - What: jobs === null keeps every job; an array keeps only listed jobs;
 *   an empty array keeps nothing (all boxes unchecked).
 * - Why: the legend checkboxes and the table's job dropdown both write this
 *   one field — its semantics define their shared behavior.
 */
export function run_apply_filters_job_tests(): void {
    const sessions = [
        make_session({ job: "Alpha" }),
        make_session({ job: "Beta" }),
        make_session({ job: "Gamma" }),
    ];

    assert.strictEqual(fs_module.apply_filters(sessions, state_with({ jobs: null })).length, 3, "null = all jobs");
    assert.deepStrictEqual(
        fs_module.apply_filters(sessions, state_with({ jobs: ["Alpha", "Gamma"] })).map(s => s.job),
        ["Alpha", "Gamma"]);
    assert.strictEqual(fs_module.apply_filters(sessions, state_with({ jobs: [] })).length, 0, "empty array = nothing");

    console.log("  ✓ apply_filters job tests passed");
}

/**
 * Tests duration range filtering:
 * - What: inclusive "greater than _ and less than _" in hours; null = unbounded.
 * - Why: issue #5 explicitly requires boundary values to be included, and
 *   hour→ms conversion invites float error (0.1h is not representable exactly),
 *   so exact-boundary sessions are the regression risk.
 */
export function run_apply_filters_duration_tests(): void {
    const sessions = [
        make_session({ job: "Short", duration_ms: hours(0.5) }),
        make_session({ job: "ExactMin", duration_ms: hours(2) }),
        make_session({ job: "Mid", duration_ms: hours(3) }),
        make_session({ job: "ExactMax", duration_ms: hours(4) }),
        make_session({ job: "Long", duration_ms: hours(8) }),
    ];

    const both = fs_module.apply_filters(sessions, state_with({ duration_min_h: 2, duration_max_h: 4 }));
    assert.deepStrictEqual(both.map(s => s.job), ["ExactMin", "Mid", "ExactMax"], "both boundaries inclusive");

    const min_only = fs_module.apply_filters(sessions, state_with({ duration_min_h: 4 }));
    assert.deepStrictEqual(min_only.map(s => s.job), ["ExactMax", "Long"], "null max = unbounded above");

    const max_only = fs_module.apply_filters(sessions, state_with({ duration_max_h: 0.5 }));
    assert.deepStrictEqual(max_only.map(s => s.job), ["Short"], "null min = unbounded below");

    // Float-hazard boundary: 0.1h = 360000 ms, but 0.1 * 3600000 ≠ 360000 in IEEE754
    const tenth = [make_session({ job: "Tenth", duration_ms: 360_000 })];
    assert.strictEqual(
        fs_module.apply_filters(tenth, state_with({ duration_min_h: 0.1, duration_max_h: 0.1 })).length,
        1, "exact 0.1h session survives a [0.1, 0.1] range despite float error");

    console.log("  ✓ apply_filters duration tests passed");
}

/**
 * Tests pause/resume range filtering:
 * - What: inclusive integer range on the session's pause/resume pair count.
 * - Why: same contract as duration per issue #5 ("same concept as Duration").
 */
export function run_apply_filters_pauses_tests(): void {
    const sessions = [
        make_session({ job: "None", pause_pairs: 0 }),
        make_session({ job: "One", pause_pairs: 1 }),
        make_session({ job: "Three", pause_pairs: 3 }),
        make_session({ job: "Five", pause_pairs: 5 }),
    ];

    const both = fs_module.apply_filters(sessions, state_with({ pauses_min: 1, pauses_max: 3 }));
    assert.deepStrictEqual(both.map(s => s.job), ["One", "Three"], "boundaries inclusive");

    const min_only = fs_module.apply_filters(sessions, state_with({ pauses_min: 3 }));
    assert.deepStrictEqual(min_only.map(s => s.job), ["Three", "Five"]);

    const max_only = fs_module.apply_filters(sessions, state_with({ pauses_max: 0 }));
    assert.deepStrictEqual(max_only.map(s => s.job), ["None"], "max 0 keeps pause-free sessions");

    console.log("  ✓ apply_filters pauses tests passed");
}

/**
 * Tests source filtering (issue #3 seam):
 * - What: "merged" keeps everything; "global"/"workspace" keep sessions whose
 *   events came from that log.
 * - Why: issue #5's architecture must not lock out issue #3's local/global
 *   scope selector — this proves the filter model already carries it.
 */
export function run_apply_filters_source_tests(): void {
    const sessions = [
        make_session({ job: "Both", has_global: true, has_workspace: true }),
        make_session({ job: "GlobalOnly", has_global: true, has_workspace: false }),
        make_session({ job: "WorkspaceOnly", has_global: false, has_workspace: true }),
    ];

    assert.strictEqual(fs_module.apply_filters(sessions, state_with({ source: "merged" })).length, 3);
    assert.deepStrictEqual(
        fs_module.apply_filters(sessions, state_with({ source: "global" })).map(s => s.job),
        ["Both", "GlobalOnly"]);
    assert.deepStrictEqual(
        fs_module.apply_filters(sessions, state_with({ source: "workspace" })).map(s => s.job),
        ["Both", "WorkspaceOnly"]);

    console.log("  ✓ apply_filters source tests passed");
}

/**
 * Tests filter composition and purity:
 * - What: all dimensions AND together; the input array and its sessions are
 *   never mutated.
 * - Why: one filtered set must drive charts and table alike (scope decision),
 *   and the codebase convention is immutability outside Runtime.
 */
export function run_apply_filters_combined_tests(): void {
    const keeper = make_session({ job: "Alpha", start: ts(2026, 7, 10), duration_ms: hours(3), pause_pairs: 2 });
    const sessions = [
        keeper,
        make_session({ job: "Beta", start: ts(2026, 7, 10), duration_ms: hours(3), pause_pairs: 2 }), // wrong job
        make_session({ job: "Alpha", start: ts(2026, 6, 10), duration_ms: hours(3), pause_pairs: 2 }), // wrong date
        make_session({ job: "Alpha", start: ts(2026, 7, 10), duration_ms: hours(9), pause_pairs: 2 }), // wrong duration
        make_session({ job: "Alpha", start: ts(2026, 7, 10), duration_ms: hours(3), pause_pairs: 0 }), // wrong pauses
    ];
    const snapshot = JSON.stringify(sessions);

    const result = fs_module.apply_filters(sessions, state_with({
        start_day: "2026-07-02", end_day: "2026-07-15",
        jobs: ["Alpha"],
        duration_min_h: 2, duration_max_h: 4,
        pauses_min: 1, pauses_max: 3,
    }));

    assert.strictEqual(result.length, 1, "all dimensions AND together");
    assert.strictEqual(result[0], keeper, "sessions pass through by reference");
    assert.strictEqual(JSON.stringify(sessions), snapshot, "input is not mutated");

    console.log("  ✓ apply_filters combined tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// sort_sessions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests table sorting:
 * - Target: sort_sessions in filter_state.js
 * - What: sorts by each sortable column key in either direction, returning a
 *   new array (input untouched); job names compare case-insensitively.
 * - Why: issue #5 puts sorting in scope; the table renders whatever order
 *   this returns, with start-descending as the dashboard default.
 */
export function run_sort_sessions_tests(): void {
    const a = make_session({ job: "beta", start: ts(2026, 7, 10), duration_ms: hours(1), pause_pairs: 2 });
    const b = make_session({ job: "Alpha", start: ts(2026, 7, 12), duration_ms: hours(3), pause_pairs: 0 });
    const c = make_session({ job: "Gamma", start: ts(2026, 7, 11), duration_ms: hours(2), pause_pairs: 1 });
    const sessions = [a, b, c];

    assert.deepStrictEqual(fs_module.sort_sessions(sessions, "start", "desc").map(s => s.job),
        ["Alpha", "Gamma", "beta"], "start desc = newest first (default)");
    assert.deepStrictEqual(fs_module.sort_sessions(sessions, "start", "asc").map(s => s.job),
        ["beta", "Gamma", "Alpha"]);
    assert.deepStrictEqual(fs_module.sort_sessions(sessions, "stop", "asc").map(s => s.job),
        ["beta", "Gamma", "Alpha"]);
    assert.deepStrictEqual(fs_module.sort_sessions(sessions, "duration", "asc").map(s => s.job),
        ["beta", "Gamma", "Alpha"]);
    assert.deepStrictEqual(fs_module.sort_sessions(sessions, "pauses", "desc").map(s => s.job),
        ["beta", "Gamma", "Alpha"]);
    assert.deepStrictEqual(fs_module.sort_sessions(sessions, "job", "asc").map(s => s.job),
        ["Alpha", "beta", "Gamma"], "job sort is case-insensitive");

    // "date" (local day column) orders like start
    assert.deepStrictEqual(fs_module.sort_sessions(sessions, "date", "asc").map(s => s.job),
        ["beta", "Gamma", "Alpha"]);

    const sorted = fs_module.sort_sessions(sessions, "start", "asc");
    assert.notStrictEqual(sorted, sessions, "returns a new array");
    assert.deepStrictEqual(sessions.map(s => s.job), ["beta", "Alpha", "Gamma"], "input order untouched");

    console.log("  ✓ sort_sessions tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// get_local_day
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests local-day formatting:
 * - What: timestamp → "YYYY-MM-DD" in local time, zero-padded.
 * - Why: exported so dashboard.js and the date filter share one definition of
 *   "day" — a UTC/local mismatch here would shift sessions across midnight.
 */
export function run_get_local_day_tests(): void {
    assert.strictEqual(fs_module.get_local_day(ts(2026, 7, 15, 0)), "2026-07-15", "midnight stays on its day");
    assert.strictEqual(fs_module.get_local_day(ts(2026, 7, 15, 23)), "2026-07-15", "late evening stays on its day");
    assert.strictEqual(fs_module.get_local_day(ts(2026, 1, 5)), "2026-01-05", "zero-padded month and day");

    console.log("  ✓ get_local_day tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Exported runner
// ═══════════════════════════════════════════════════════════════════════════

export function run_filter_state_tests(): void {
    console.log("filter_state: defaults & presets");
    run_default_filter_state_tests();
    run_resolve_preset_range_tests();
    console.log("filter_state: apply_filters");
    run_apply_filters_date_tests();
    run_apply_filters_job_tests();
    run_apply_filters_duration_tests();
    run_apply_filters_pauses_tests();
    run_apply_filters_source_tests();
    run_apply_filters_combined_tests();
    console.log("filter_state: sorting & utilities");
    run_sort_sessions_tests();
    run_get_local_day_tests();
}
