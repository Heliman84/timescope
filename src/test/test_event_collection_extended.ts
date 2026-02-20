import * as assert from "assert";
import { Event } from "../core/event";
import { EventCollection } from "../core/event_collection";
import { Job } from "../core/job";

function job(title = "alpha"): Job { return Job.create({ title }); }
function ev(j: Job, type: "start" | "stop" | "pause" | "resume", ts: number, task?: string): Event {
    return Event.create(j, type, ts, task);
}

// ═══════════════════════════════════════════════════════════════════════════
// EventCollection.fromLines / fromArray
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests EventCollection.fromLines parser:
 * - Target: EventCollection.fromLines/parse_lines in src/core/event_collection.ts
 * - What: parses JSONL lines, skipping headers and malformed lines.
 * - Does: builds lines from events, adds garbage, parses, checks count.
 * - Why: this is the primary load path for log files.
 */
export function run_ec_fromLines_tests(): void {
    const j = job();
    const e1 = ev(j, "start", 1000);
    const e2 = ev(j, "stop", 2000);

    const lines = [
        '{"_format_version":2}',     // header — skipped
        e1.toJSONL(),
        '{ not valid json',          // malformed — skipped
        e2.toJSONL(),
        '',                          // empty — skipped
    ];

    const col = EventCollection.fromLines(lines);
    const events = col.toEvents();
    assert.strictEqual(events.length, 2, "two valid events parsed");
    assert.strictEqual(events[0].type, "start");
    assert.strictEqual(events[1].type, "stop");

    // parse_lines alias
    const col2 = EventCollection.parse_lines(lines);
    assert.strictEqual(col2.toEvents().length, 2);

    // Empty input
    const empty = EventCollection.fromLines([]);
    assert.strictEqual(empty.toEvents().length, 0);

    console.log("  ✓ EventCollection.fromLines tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// sorted / serialize / toLines
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests EventCollection sorted ordering:
 * - Target: EventCollection.sorted in src/core/event_collection.ts
 * - What: returns events in ascending timestamp order regardless of insertion order.
 * - Does: adds events out of order, calls sorted, checks ascending.
 * - Why: validation, session construction, and UI all depend on sorted order.
 */
export function run_ec_sorted_tests(): void {
    const j = job();
    const e1 = ev(j, "start", 3000);
    const e2 = ev(j, "pause", 1000);
    const e3 = ev(j, "resume", 2000);

    const col = EventCollection.fromArray([e1, e2, e3]);
    const sorted = col.sorted();
    assert.strictEqual(sorted[0].timestamp, 1000);
    assert.strictEqual(sorted[1].timestamp, 2000);
    assert.strictEqual(sorted[2].timestamp, 3000);

    // toLines produces sorted JSONL
    const lines = col.toLines();
    assert.strictEqual(lines.length, 3);
    // First line is the earliest timestamp
    assert.ok(lines[0].includes("1000"));

    console.log("  ✓ EventCollection.sorted tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// filterByJob
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests EventCollection.filterByJob:
 * - Target: EventCollection.filterByJob in src/core/event_collection.ts
 * - What: returns only events for the specified job.
 * - Does: mixes events from two jobs, filters by one, checks count.
 * - Why: used when loading events for a specific job/session.
 */
export function run_ec_filterByJob_tests(): void {
    const jA = job("alpha");
    const jB = job("beta");

    const col = EventCollection.fromArray([
        ev(jA, "start", 100),
        ev(jB, "start", 200),
        ev(jA, "stop", 300),
        ev(jB, "stop", 400),
    ]);

    const filtered = col.filterByJob(jA);
    assert.strictEqual(filtered.toEvents().length, 2);
    assert.ok(filtered.toEvents().every(e => e.job_id === jA.id));

    console.log("  ✓ EventCollection.filterByJob tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// replaceEvent / retimeEvent / updateEvent
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests EventCollection immutable transforms:
 * - Target: replaceEvent/retimeEvent/updateEvent in src/core/event_collection.ts
 * - What: each returns a new collection with the change; original untouched.
 * - Does: creates collection, performs each transform, verifies result and original.
 * - Why: these are the domain-level edit operations underlying dashboard edits.
 */
export function run_ec_transform_tests(): void {
    const j = job();
    const e1 = ev(j, "start", 1000);
    const e2 = ev(j, "stop", 2000);
    const col = EventCollection.fromArray([e1, e2]);

    // replaceEvent
    const e1b = ev(j, "start", 1500);
    const col2 = col.replaceEvent(e1, e1b);
    assert.strictEqual(col2.toEvents()[0].timestamp, 1500, "replaced");
    assert.strictEqual(col.toEvents()[0].timestamp, 1000, "original untouched");

    // replaceEvent with non-existent target returns same-content collection
    const eX = ev(job("nope"), "start", 9999);
    const col3 = col.replaceEvent(eX, e1b);
    assert.strictEqual(col3.toEvents().length, 2, "no-op when target not found");
    assert.strictEqual(col3.toEvents()[0].timestamp, 1000, "events unchanged");

    // retimeEvent
    const col4 = col.retimeEvent(e2, 2500);
    assert.strictEqual(col4.toEvents()[1].timestamp, 2500, "retimed");
    assert.strictEqual(col.toEvents()[1].timestamp, 2000, "original untouched");

    // updateEvent with custom updater
    const col5 = col.updateEvent(e2, e => e.withTask("new task"));
    assert.strictEqual(col5.toEvents()[1].task, "new task", "updated");
    assert.strictEqual(col.toEvents()[1].task, undefined, "original untouched");

    console.log("  ✓ EventCollection transform tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// mapEvents / rewrite
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests EventCollection.mapEvents and rewrite:
 * - Target: mapEvents/rewrite in src/core/event_collection.ts
 * - What: mapEvents applies a function to every event; rewrite can also remove events (return null).
 * - Does: maps all timestamps, rewrites to remove stops, checks results.
 * - Why: used for bulk transformations (e.g. job rename across events).
 */
export function run_ec_map_rewrite_tests(): void {
    const j = job();
    const e1 = ev(j, "start", 1000);
    const e2 = ev(j, "stop", 2000);
    const col = EventCollection.fromArray([e1, e2]);

    // mapEvents: shift all timestamps by 1000
    const col2 = col.mapEvents(e => e.withTimestamp(e.timestamp + 1000));
    assert.strictEqual(col2.toEvents()[0].timestamp, 2000);
    assert.strictEqual(col2.toEvents()[1].timestamp, 3000);
    assert.strictEqual(col.toEvents()[0].timestamp, 1000, "original untouched");

    // rewrite: remove stop events
    const col3 = col.rewrite(e => e.isStop() ? null : e);
    assert.strictEqual(col3.toEvents().length, 1, "stop removed");
    assert.strictEqual(col3.toEvents()[0].type, "start");

    // rewrite: keep all
    const col4 = col.rewrite(e => e);
    assert.strictEqual(col4.toEvents().length, 2);

    // rewrite: remove all
    const col5 = col.rewrite(() => null);
    assert.strictEqual(col5.toEvents().length, 0);

    console.log("  ✓ EventCollection map/rewrite tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// withUpdatedJob
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests EventCollection.withUpdatedJob:
 * - Target: withUpdatedJob in src/core/event_collection.ts
 * - What: updates all events referencing a specific job_id to use a new Job object.
 * - Does: creates events for two jobs, renames one via withUpdatedJob, checks results.
 * - Why: this is the domain-level job rename applied to the event collection.
 */
export function run_ec_withUpdatedJob_tests(): void {
    const jA = job("alpha");
    const jB = job("beta");

    const col = EventCollection.fromArray([
        ev(jA, "start", 100),
        ev(jB, "start", 200),
        ev(jA, "stop", 300),
    ]);

    const renamedA = jA.rename("alpha-v2");
    const col2 = col.withUpdatedJob(renamedA);
    const events = col2.toEvents();

    // alpha events should now have new title
    assert.strictEqual(events[0].job_title, "alpha-v2");
    assert.strictEqual(events[2].job_title, "alpha-v2");

    // beta event untouched
    assert.strictEqual(events[1].job_title, "beta");

    // Original untouched
    assert.strictEqual(col.toEvents()[0].job_title, "alpha");

    // Validation
    assert.throws(() => col.withUpdatedJob({} as any), /must be a Job/);

    console.log("  ✓ EventCollection.withUpdatedJob tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// currentState
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests EventCollection.currentState:
 * - Target: currentState in src/core/event_collection.ts
 * - What: returns "idle", "running", or "paused" based on the event sequence.
 * - Does: checks state at various points in a session lifecycle.
 * - Why: used for UI state determination.
 */
export function run_ec_currentState_tests(): void {
    const j = job();

    // Empty → idle
    const empty = new EventCollection();
    assert.strictEqual(empty.currentState(), "idle");

    // Start → running
    const running = EventCollection.fromArray([ev(j, "start", 100)]);
    assert.strictEqual(running.currentState(), "running");

    // Start → pause → paused
    const paused = EventCollection.fromArray([ev(j, "start", 100), ev(j, "pause", 200)]);
    assert.strictEqual(paused.currentState(), "paused");

    // Start → pause → resume → running
    const resumed = EventCollection.fromArray([ev(j, "start", 100), ev(j, "pause", 200), ev(j, "resume", 300)]);
    assert.strictEqual(resumed.currentState(), "running");

    // Full session → idle
    const stopped = EventCollection.fromArray([ev(j, "start", 100), ev(j, "stop", 200)]);
    assert.strictEqual(stopped.currentState(), "idle");

    console.log("  ✓ EventCollection.currentState tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// add / firstEvent / lastEvent / get / find
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests EventCollection accessors:
 * - Target: add/firstEvent/lastEvent/get/find in src/core/event_collection.ts
 * - What: accessor methods for collection navigation.
 * - Does: builds a collection, checks each accessor.
 * - Why: these are foundational and used everywhere.
 */
export function run_ec_accessor_tests(): void {
    const j = job();
    const e1 = ev(j, "start", 100);
    const e2 = ev(j, "stop", 200);

    const col = new EventCollection();
    assert.strictEqual(col.firstEvent(), null, "empty → null");
    assert.strictEqual(col.lastEvent(), null, "empty → null");

    col.add(e1);
    col.add(e2);
    assert.strictEqual(col.firstEvent()!.timestamp, 100);
    assert.strictEqual(col.lastEvent()!.timestamp, 200);
    assert.strictEqual(col.get(0).timestamp, 100);
    assert.strictEqual(col.get(1).timestamp, 200);

    // get out of bounds
    assert.throws(() => col.get(-1), /out of bounds/);
    assert.throws(() => col.get(2), /out of bounds/);
    assert.throws(() => col.get(1.5), /out of bounds/);

    // find
    const found = col.find(e => e.isStop());
    assert.ok(found);
    assert.strictEqual(found!.type, "stop");

    const notFound = col.find(e => e.isPause());
    assert.strictEqual(notFound, undefined);

    console.log("  ✓ EventCollection accessor tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// appendValidated
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests EventCollection.appendValidated:
 * - Target: appendValidated in src/core/event_collection.ts
 * - What: validates transitions before appending; throws on violations.
 * - Does: builds a valid sequence and tests rejection of invalid next events.
 * - Why: guards session construction integrity at the collection level.
 */
export function run_ec_appendValidated_tests(): void {
    const j = job();
    const col = new EventCollection();

    // First event must be start
    assert.throws(() => col.appendValidated(ev(j, "stop", 100)), /must be start/);

    col.appendValidated(ev(j, "start", 100));
    col.appendValidated(ev(j, "pause", 200));
    col.appendValidated(ev(j, "resume", 300));
    col.appendValidated(ev(j, "stop", 400));
    assert.strictEqual(col.toEvents().length, 4);

    // After stop, only start of new session allowed, but appendValidated uses
    // last event's validateTransition which requires start after stop
    // but start→start is invalid; let's just check resume after stop fails
    assert.throws(() => col.appendValidated(ev(j, "resume", 500)));

    console.log("  ✓ EventCollection.appendValidated tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// validateReplacement / validateReplacements
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests EventCollection.validateReplacement:
 * - Target: validateReplacement in src/core/event_collection.ts
 * - What: pre-save validation rejects edits that would break session ordering.
 * - Does: builds a session, tries retiming an event before its predecessor
 *   and after its successor, checks that errors are returned. Also verifies
 *   valid retimes pass.
 * - Why: prevents users from saving edits that corrupt the session timeline.
 */
export function run_ec_validateReplacement_tests(): void {
    const j = job();
    const e1 = ev(j, "start", 1000);
    const e2 = ev(j, "pause", 2000);
    const e3 = ev(j, "resume", 3000);
    const e4 = ev(j, "stop", 4000);
    const col = EventCollection.fromArray([e1, e2, e3, e4]);

    // Valid retime: move pause within its valid window (1000 < x < 3000)
    const validMove = e2.withTimestamp(2500);
    const noErrors = col.validateReplacement(e2, validMove);
    assert.strictEqual(noErrors.length, 0, "valid retime has no errors");

    // Invalid: move pause BEFORE start (ts < 1000)
    const beforeStart = e2.withTimestamp(500);
    const errsBefore = col.validateReplacement(e2, beforeStart);
    assert.ok(errsBefore.length > 0, "retime before predecessor yields errors");
    assert.ok(errsBefore.some(e => e.code === "must_start" || e.code === "timestamp_non_increasing" || e.code === "invalid_transition"),
        "error identifies ordering/transition violation");

    // Invalid: move pause AFTER resume (ts > 3000) — breaks pause→resume ordering
    const afterResume = e2.withTimestamp(3500);
    const errsAfter = col.validateReplacement(e2, afterResume);
    assert.ok(errsAfter.length > 0, "retime past successor yields errors");

    // Invalid: move pause to exactly the same timestamp as start
    const sameAsStart = e2.withTimestamp(1000);
    const errsSame = col.validateReplacement(e2, sameAsStart);
    assert.ok(errsSame.length > 0, "timestamp equal to predecessor is non-increasing");

    // Cross-job events should be ignored — only the target job is validated
    const jB = job("beta");
    const mixed = EventCollection.fromArray([
        e1, e2, e3, e4,
        ev(jB, "start", 1500),
        ev(jB, "stop", 2500)
    ]);
    const crossNoErrors = mixed.validateReplacement(e2, validMove);
    assert.strictEqual(crossNoErrors.length, 0, "cross-job events do not interfere");

    console.log("  ✓ EventCollection.validateReplacement tests passed");
}

/**
 * Tests EventCollection.validateReplacements (batch):
 * - Target: validateReplacements in src/core/event_collection.ts
 * - What: validates multiple proposed edits together.
 * - Does: edits two events validly, then edits one invalidly mixed in.
 * - Why: batch edit handler needs to validate the combined effect.
 */
export function run_ec_validateReplacements_tests(): void {
    const j = job();
    const e1 = ev(j, "start", 1000);
    const e2 = ev(j, "pause", 2000);
    const e3 = ev(j, "resume", 3000);
    const e4 = ev(j, "stop", 4000);
    const col = EventCollection.fromArray([e1, e2, e3, e4]);

    // Both valid: shift pause and resume forward slightly
    const validEdits = [
        { oldEvent: e2, newEvent: e2.withTimestamp(2100) },
        { oldEvent: e3, newEvent: e3.withTimestamp(3100) },
    ];
    const noErrors = col.validateReplacements(validEdits);
    assert.strictEqual(noErrors.length, 0, "both valid → no errors");

    // One invalid: move pause past resume
    const badEdits = [
        { oldEvent: e2, newEvent: e2.withTimestamp(3500) },
        { oldEvent: e3, newEvent: e3.withTimestamp(3100) },
    ];
    const errs = col.validateReplacements(badEdits);
    assert.ok(errs.length > 0, "combined effect produces errors");

    console.log("  ✓ EventCollection.validateReplacements tests passed");
}
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// Cross-job overlap warnings
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

/**
 * Tests cross-job overlap warning detection:
 * - Target: _detectCrossJobOverlaps / validateReplacement in src/core/event_collection.ts
 * - What: retiming an event into another job's active session window produces
 *   a warning (severity: "warning"), NOT an error. The save should still succeed.
 * - Does: creates two jobs with non-overlapping sessions, retimes an event from
 *   job A into job B's window, verifies a warning is returned with correct severity
 *   and code. Also verifies no warning when timestamps don't overlap.
 * - Why: users should be informed when edits create cross-job overlaps, but
 *   different jobs are independent timelines so it shouldn't block the save.
 */
export function run_ec_crossJobOverlap_tests(): void {
    const jA = job("alpha");
    const jB = job("beta");

    // Job A: 1000–4000, Job B: 5000–8000 (no overlap)
    const col = EventCollection.fromArray([
        ev(jA, "start", 1000),
        ev(jA, "stop",  4000),
        ev(jB, "start", 5000),
        ev(jB, "stop",  8000),
    ]);

    const eA_stop = col.toEvents().find(e => e.job_id === jA.id && e.isStop())!;

    // Retime job A's stop into job B's session window → should produce a warning
    const intoB = eA_stop.withTimestamp(6000);
    const results = col.validateReplacement(eA_stop, intoB);
    const warnings = results.filter(e => e.severity === "warning");
    const errors = results.filter(e => e.severity !== "warning");

    assert.ok(warnings.length > 0, "retiming into another job's session produces a warning");
    assert.ok(warnings.every(w => w.code === "cross_job_overlap"), "warning has code 'cross_job_overlap'");
    assert.ok(warnings[0].message.includes("beta"), "warning mentions the overlapping job name");
    assert.strictEqual(errors.length, 0, "no same-job errors for a valid same-job retime");

    // Retime job A's stop to 4500 — between jobs, no overlap with B → no warning
    const betweenJobs = eA_stop.withTimestamp(4500);
    const noOverlap = col.validateReplacement(eA_stop, betweenJobs);
    const noWarnings = noOverlap.filter(e => e.severity === "warning");
    assert.strictEqual(noWarnings.length, 0, "no overlap → no warning");

    // Retime job A's stop to exactly job B's start (5000) → not inside B's window (boundary exclusive)
    const atBoundary = eA_stop.withTimestamp(5000);
    const boundaryResults = col.validateReplacement(eA_stop, atBoundary);
    const boundaryWarnings = boundaryResults.filter(e => e.severity === "warning");
    assert.strictEqual(boundaryWarnings.length, 0, "timestamp at boundary is not inside the window");

    // Open session (no stop) — retime into an open session window
    const openCol = EventCollection.fromArray([
        ev(jA, "start", 1000),
        ev(jA, "stop",  4000),
        ev(jB, "start", 5000),  // B is still running, no stop
    ]);
    const eA_stop2 = openCol.toEvents().find(e => e.job_id === jA.id && e.isStop())!;
    const intoOpen = eA_stop2.withTimestamp(6000);
    const openResults = openCol.validateReplacement(eA_stop2, intoOpen);
    const openWarnings = openResults.filter(e => e.severity === "warning");
    assert.ok(openWarnings.length > 0, "retiming into an open session produces a warning");
    assert.ok(openWarnings[0].message.includes("open session"), "warning mentions open session");

    console.log("  \u2713 EventCollection cross-job overlap warning tests passed");
}
// ═══════════════════════════════════════════════════════════════════════════
// Exported runner
// ═══════════════════════════════════════════════════════════════════════════

export function run_event_collection_extended_tests(): void {
    console.log("event collection: fromLines");
    run_ec_fromLines_tests();
    console.log("event collection: sorted/toLines");
    run_ec_sorted_tests();
    console.log("event collection: filterByJob");
    run_ec_filterByJob_tests();
    console.log("event collection: transforms");
    run_ec_transform_tests();
    console.log("event collection: map/rewrite");
    run_ec_map_rewrite_tests();
    console.log("event collection: withUpdatedJob");
    run_ec_withUpdatedJob_tests();
    console.log("event collection: currentState");
    run_ec_currentState_tests();
    console.log("event collection: accessors");
    run_ec_accessor_tests();
    console.log("event collection: appendValidated");
    run_ec_appendValidated_tests();
    console.log("event collection: validateReplacement");
    run_ec_validateReplacement_tests();
    console.log("event collection: validateReplacements (batch)");
    run_ec_validateReplacements_tests();
    console.log("event collection: cross-job overlap warnings");
    run_ec_crossJobOverlap_tests();
}
