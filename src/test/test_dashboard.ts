import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { TimeScopePaths } from "../core/paths";
import { Event, ValidationError } from "../core/event";
import { EventRepository } from "../core/event_repository";
import { EventCollection } from "../core/event_collection";
import { Job } from "../core/job";
import { buildPayload, filterRelevantErrors } from "../dashboard/controller/dashboard_utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkPaths(suffix: string, withWorkspace = true): TimeScopePaths {
    const root = path.join(__dirname, "..", "..", "test-output", `dashboard-${suffix}-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    const base: TimeScopePaths = {
        global_jobs_path: path.join(root, "jobs.json"),
        global_log_path: path.join(root, "logs.jsonl"),
    } as TimeScopePaths;
    if (withWorkspace) {
        base.workspace_log_path = path.join(root, "ws-logs.jsonl");
        base.workspace_jobs_path = path.join(root, "ws-jobs.json");
    }
    return base;
}

function ev(job: Job, type: "start" | "stop" | "pause" | "resume", ts: number, task?: string): Event {
    return Event.create(job, type, ts, task);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1) buildPayload
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests buildPayload field mapping and sort order:
 * - Target: buildPayload in src/dashboard/controller/dashboard.ts
 * - What: maps Event domain objects to the flat shape the webview expects.
 * - Does: creates a few Events, runs buildPayload, and asserts all fields
 *   (event, job, timestamp, task, id, job_id, time_seed, line indices)
 *   are present and correctly mapped, and that the result is sorted
 *   descending by timestamp.
 * - Why: the webview edit flow depends on every field being present;
 *   a missing field (e.g. id, job_id, time_seed) silently breaks editing.
 */
export function run_buildPayload_tests(): void {
    const job = Job.create({ title: "alpha" });

    const e1 = ev(job, "start", 1000);
    const e2 = ev(job, "pause", 2000);
    const e3 = ev(job, "resume", 3000);
    const e4 = ev(job, "stop", 4000, "finished sprint");

    // Simulate line indices as if loaded from disk
    e1.setGlobalLineIndex(1);
    e1.setWorkspaceLineIndex(1);
    e2.setGlobalLineIndex(2);
    e3.setGlobalLineIndex(3);
    e4.setGlobalLineIndex(4);

    const payload = buildPayload([e1, e2, e3, e4]);

    // Descending sort: e4, e3, e2, e1
    assert.strictEqual(payload.length, 4, "payload should have 4 entries");
    assert.strictEqual(payload[0].timestamp, 4000, "first entry is latest timestamp");
    assert.strictEqual(payload[3].timestamp, 1000, "last entry is earliest timestamp");

    // Full field check on e4 (stop with task)
    const p4 = payload[0];
    assert.strictEqual(p4.event, "stop", "event type mapped");
    assert.strictEqual(p4.job, "alpha", "job title mapped as 'job'");
    assert.strictEqual(p4.timestamp, 4000, "timestamp mapped");
    assert.strictEqual(p4.task, "finished sprint", "task mapped");
    assert.strictEqual(p4.id, e4.id, "id mapped");
    assert.strictEqual(p4.job_id, job.id, "job_id mapped");
    assert.strictEqual(p4.time_seed, e4.time_seed, "time_seed mapped");
    assert.strictEqual(p4.global_line_index, 4, "global_line_index mapped");

    // Field check on e1 (start, has workspace)
    const p1 = payload[3];
    assert.strictEqual(p1.event, "start", "start mapped");
    assert.strictEqual(p1.workspace_line_index, 1, "workspace_line_index mapped");

    // Empty task becomes ""
    assert.strictEqual(payload[1].task, "", "undefined task becomes empty string");

    console.log("  ✓ buildPayload tests passed");
}

/**
 * Tests buildPayload with an empty array:
 * - Target: buildPayload in src/dashboard/controller/dashboard.ts
 * - What: edge case — no events.
 * - Does: calls buildPayload with [] and asserts empty result.
 * - Why: dashboard must handle the "no data" case gracefully.
 */
export function run_buildPayload_empty_tests(): void {
    const payload = buildPayload([]);
    assert.strictEqual(payload.length, 0, "empty events → empty payload");
    console.log("  ✓ buildPayload empty tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// 2) filterRelevantErrors
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests filterRelevantErrors matching logic:
 * - Target: filterRelevantErrors in src/dashboard/controller/dashboard.ts
 * - What: given validation errors, returns only those whose record matches
 *   one of the edited events (by type, job_title, timestamp, task).
 * - Does: constructs errors for matching and non-matching events, asserts
 *   only matching messages are returned.
 * - Why: ensures the UI shows relevant validation feedback after an edit,
 *   not noise from unrelated events.
 */
export function run_filterRelevantErrors_tests(): void {
    const jobA = Job.create({ title: "alpha" });
    const jobB = Job.create({ title: "beta" });

    const e1 = ev(jobA, "start", 1000);
    const e2 = ev(jobB, "stop", 2000, "task-b");

    // Errors: one matches e1, one matches e2, one matches neither
    const errors: ValidationError[] = [
        {
            index: 0,
            code: "test_err",
            message: "error for alpha start",
            record: e1.toDTO()
        },
        {
            index: 1,
            code: "test_err",
            message: "error for beta stop",
            record: e2.toDTO()
        },
        {
            index: 2,
            code: "unrelated",
            message: "error for something else",
            record: { id: "x", event: "pause", job_title: "gamma", timestamp: 9999, job_id: "y", time_seed: 9999 }
        },
    ];

    // Only e1 edited → should get only "error for alpha start"
    const result1 = filterRelevantErrors(errors, [e1]);
    assert.strictEqual(result1.length, 1, "one matching error");
    assert.strictEqual(result1[0], "error for alpha start");

    // Both edited
    const result2 = filterRelevantErrors(errors, [e1, e2]);
    assert.strictEqual(result2.length, 2, "two matching errors");

    // None edited
    const result3 = filterRelevantErrors(errors, []);
    assert.strictEqual(result3.length, 0, "no edits → no errors");

    console.log("  ✓ filterRelevantErrors tests passed");
}

/**
 * Tests filterRelevantErrors with errors that have no record:
 * - Target: filterRelevantErrors in src/dashboard/controller/dashboard.ts
 * - What: errors without a record field should be skipped.
 * - Does: passes errors with undefined record and asserts empty results.
 * - Why: defensive coding; validates the null-guard in the function.
 */
export function run_filterRelevantErrors_noRecord_tests(): void {
    const job = Job.create({ title: "alpha" });
    const e = ev(job, "start", 1000);
    const errors: ValidationError[] = [
        { index: 0, code: "no_rec", message: "no record attached" },
    ];

    const result = filterRelevantErrors(errors, [e]);
    assert.strictEqual(result.length, 0, "errors without record are ignored");

    console.log("  ✓ filterRelevantErrors no-record tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// 3) EventRepository.replaceEvent
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests replaceEvent happy path — global only:
 * - Target: EventRepository.replaceEvent in src/core/event_repository.ts
 * - What: replaces a single event in the global log when no workspace log exists.
 * - Does: appends start/stop, loads, replaces start with a new timestamp,
 *   reloads and verifies the new timestamp is persisted.
 * - Why: this is the core write path for dashboard timestamp edits.
 */
export function run_replaceEvent_global_tests(): void {
    const paths = mkPaths("replace-global", false);
    const repo = new EventRepository(paths);
    const job = Job.create({ title: "alpha" });

    const e1 = ev(job, "start", 1000);
    const e2 = ev(job, "stop", 2000);
    repo.appendEvent(e1);
    repo.appendEvent(e2);

    const collection = repo.loadAllEntries();
    const oldStart = collection.find(e => e.type === "start")!;
    assert.ok(oldStart, "should find start event");

    // Create replacement with updated timestamp
    const newStart = oldStart.withTimestamp(1500);
    const result = repo.replaceEvent(oldStart, newStart);

    assert.ok(result.globalReplaced, "global should be replaced");
    assert.strictEqual(result.workspaceReplaced, false, "no workspace → false");

    // Reload and verify
    const reloaded = repo.loadAllEntries();
    const updatedStart = reloaded.find(e => e.type === "start")!;
    assert.strictEqual(updatedStart.timestamp, 1500, "timestamp should be updated in file");

    console.log("  ✓ replaceEvent global-only tests passed");
}

/**
 * Tests replaceEvent happy path — both global and workspace:
 * - Target: EventRepository.replaceEvent in src/core/event_repository.ts
 * - What: replaces across both log files.
 * - Does: appends events (which writes to both), loads, replaces, verifies both flags true.
 * - Why: dashboard edits must propagate to all log files.
 */
export function run_replaceEvent_both_tests(): void {
    const paths = mkPaths("replace-both", true);
    const repo = new EventRepository(paths);
    const job = Job.create({ title: "alpha" });

    const e1 = ev(job, "start", 1000);
    const e2 = ev(job, "stop", 2000, "done");
    repo.appendEvent(e1);
    repo.appendEvent(e2);

    const collection = repo.loadAllEntries();
    const oldStop = collection.find(e => e.type === "stop")!;
    assert.ok(oldStop.isInGlobal, "stop should be in global");
    assert.ok(oldStop.isInWorkspace, "stop should be in workspace");

    const newStop = oldStop.withTimestamp(2500);
    const result = repo.replaceEvent(oldStop, newStop);

    assert.ok(result.globalReplaced, "global replaced");
    assert.ok(result.workspaceReplaced, "workspace replaced");

    // Verify both files have the new timestamp
    const checkFile = (p: string) => {
        const raw = fs.readFileSync(p, "utf8");
        assert.ok(raw.includes("2500"), `file ${p} should contain new timestamp`);
        assert.ok(!raw.includes('"timestamp":2000'), `file ${p} should no longer have old timestamp`);
    };
    checkFile(paths.global_log_path);
    checkFile(paths.workspace_log_path!);

    console.log("  ✓ replaceEvent both-files tests passed");
}

/**
 * Tests replaceEvent when the line doesn't match (content mismatch):
 * - Target: EventRepository.replaceEvent in src/core/event_repository.ts
 * - What: if the file was externally modified so the old line no longer
 *   exists, replaceEvent should return false for that file.
 * - Does: appends an event, manually corrupts the file, attempts replace.
 * - Why: ensures the dashboard can detect and report "line not found" failures.
 */
export function run_replaceEvent_noMatch_tests(): void {
    const paths = mkPaths("replace-nomatch", false);
    const repo = new EventRepository(paths);
    const job = Job.create({ title: "alpha" });

    const e1 = ev(job, "start", 1000);
    repo.appendEvent(e1);

    // Load to get the event with line indices
    const collection = repo.loadAllEntries();
    const oldStart = collection.find(e => e.type === "start")!;

    // Corrupt the file — replace the line with something else
    const header = JSON.stringify({ _format_version: 2 });
    fs.writeFileSync(paths.global_log_path, header + "\n" + '{"garbage":true}\n', "utf8");

    const newStart = oldStart.withTimestamp(1500);
    const result = repo.replaceEvent(oldStart, newStart);

    assert.strictEqual(result.globalReplaced, false, "should fail — line doesn't match");
    assert.strictEqual(result.workspaceReplaced, false, "no workspace");

    console.log("  ✓ replaceEvent no-match tests passed");
}

/**
 * Tests replaceEvent does not duplicate headers:
 * - Target: EventRepository.replaceEvent in src/core/event_repository.ts
 * - What: after a successful rewrite the file should have exactly one header.
 * - Does: appends events, replaces one, then counts header lines.
 * - Why: header duplication was a prior bug; ensures the fix is covered.
 */
export function run_replaceEvent_headerDedup_tests(): void {
    const paths = mkPaths("replace-header", false);
    const repo = new EventRepository(paths);
    const job = Job.create({ title: "alpha" });

    repo.appendEvent(ev(job, "start", 1000));
    repo.appendEvent(ev(job, "stop", 2000));

    const collection = repo.loadAllEntries();
    const oldStart = collection.find(e => e.type === "start")!;
    const newStart = oldStart.withTimestamp(1500);

    repo.replaceEvent(oldStart, newStart);

    const lines = fs.readFileSync(paths.global_log_path, "utf8")
        .split(/\r?\n/)
        .filter(l => l.trim().length > 0);

    const headerCount = lines.filter(l => {
        try { return JSON.parse(l)._format_version !== undefined; } catch { return false; }
    }).length;

    assert.strictEqual(headerCount, 1, "should have exactly one header after rewrite");
    assert.strictEqual(lines.length, 3, "header + 2 events");

    console.log("  ✓ replaceEvent header-dedup tests passed");
}

/**
 * Tests replaceEvent preserves malformed lines:
 * - Target: EventRepository.replaceEvent in src/core/event_repository.ts
 * - What: non-JSON or malformed lines should survive a rewrite unchanged.
 * - Does: manually writes a file with header + malformed + valid event,
 *   replaces the valid event, then asserts the malformed line is still there.
 * - Why: logs with orphans/corruption must not lose data on edit.
 */
export function run_replaceEvent_malformedPreserved_tests(): void {
    const paths = mkPaths("replace-malformed", false);
    const repo = new EventRepository(paths);
    const job = Job.create({ title: "alpha" });

    const startEv = ev(job, "start", 1000);
    const header = JSON.stringify({ _format_version: 2 });
    const malformed = "{ not valid json";
    const validLine = startEv.toJSONL();

    fs.writeFileSync(paths.global_log_path, [header, malformed, validLine].join("\n") + "\n", "utf8");

    // Load — the malformed line will be skipped, but the valid event gets indices
    const collection = repo.loadAllEntries();
    const loaded = collection.find(e => e.type === "start")!;
    assert.ok(loaded, "valid event should load");

    const updated = loaded.withTimestamp(1500);
    const result = repo.replaceEvent(loaded, updated);

    assert.ok(result.globalReplaced, "should replace the valid event");

    const lines = fs.readFileSync(paths.global_log_path, "utf8")
        .split(/\r?\n/)
        .filter(l => l.trim().length > 0);

    assert.ok(lines.includes(malformed), "malformed line preserved after rewrite");
    assert.ok(lines.some(l => l.includes("1500")), "new timestamp present");
    assert.ok(!lines.some(l => l.includes('"timestamp":1000')), "old timestamp removed");

    console.log("  ✓ replaceEvent malformed-preserved tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// 4) Full edit round-trip (append → load → replace → reload → verify)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests the full dashboard edit round-trip:
 * - Target: EventRepository.appendEvent + loadAllEntries + replaceEvent
 * - What: simulates the exact sequence the dashboard controller performs
 *   when a user edits a session timestamp.
 * - Does: appends a start/pause/resume/stop session, loads via loadAllEntries,
 *   builds a new Event via withTimestamp, replaces, refreshes, and verifies
 *   the edit persisted correctly and all other events are untouched.
 * - Why: end-to-end validation that the fix to the edit flow actually works.
 */
export function run_editRoundTrip_tests(): void {
    const paths = mkPaths("edit-roundtrip", true);
    const repo = new EventRepository(paths);
    const job = Job.create({ title: "alpha" });

    // Build a full session
    const start = ev(job, "start", 10000);
    const pause = ev(job, "pause", 20000);
    const resume = ev(job, "resume", 30000);
    const stop = ev(job, "stop", 40000, "sprint done");

    repo.appendEvent(start);
    repo.appendEvent(pause);
    repo.appendEvent(resume);
    repo.appendEvent(stop);

    // Step 1: load (same as controller does)
    const collection = repo.loadAllEntries();
    assert.strictEqual(collection.toEvents().length, 4, "4 events loaded");

    // Step 2: find the pause event by id (same as controller does)
    const oldPause = collection.find(e => e.id === pause.id)!;
    assert.ok(oldPause, "pause found by id");
    assert.strictEqual(oldPause.timestamp, 20000);

    // Step 3: build candidate with new timestamp (simulating what fromDTO would produce)
    const newPause = oldPause.withTimestamp(25000);

    // Step 4: replace
    const result = repo.replaceEvent(oldPause, newPause);
    assert.ok(result.globalReplaced, "global replaced");
    assert.ok(result.workspaceReplaced, "workspace replaced");

    // Step 5: reload (same as controller refreshEventCollection)
    const refreshed = repo.loadAllEntries();
    const events = refreshed.toEvents();
    assert.strictEqual(events.length, 4, "still 4 events");

    const updatedPause = refreshed.find(e => e.id === pause.id)!;
    assert.strictEqual(updatedPause.timestamp, 25000, "pause timestamp updated");

    // Other events untouched
    const s = refreshed.find(e => e.id === start.id)!;
    assert.strictEqual(s.timestamp, 10000, "start untouched");
    const r = refreshed.find(e => e.id === resume.id)!;
    assert.strictEqual(r.timestamp, 30000, "resume untouched");
    const st = refreshed.find(e => e.id === stop.id)!;
    assert.strictEqual(st.timestamp, 40000, "stop untouched");
    assert.strictEqual(st.task, "sprint done", "stop task untouched");

    console.log("  ✓ edit round-trip tests passed");
}

/**
 * Tests the dashboard edit flow with Event.fromDTO reconstruction:
 * - Target: Event.fromDTO + EventRepository.replaceEvent
 * - What: simulates the exact DTO reconstruction the controller does
 *   when the webview sends an edit payload.
 * - Does: builds the new_record DTO exactly as the webview would send it,
 *   passes it through Event.fromDTO, and verifies the resulting Event
 *   produces a correct toJSONL that replaceEvent can match.
 * - Why: validates the full DTO boundary used in the actual edit path.
 */
export function run_editViaDTO_tests(): void {
    const paths = mkPaths("edit-dto", false);
    const repo = new EventRepository(paths);
    const job = Job.create({ title: "my project" });

    const start = ev(job, "start", 5000);
    const stop = ev(job, "stop", 9000, "task x");
    repo.appendEvent(start);
    repo.appendEvent(stop);

    const collection = repo.loadAllEntries();
    const oldStop = collection.find(e => e.id === stop.id)!;

    // Simulate the DTO the webview sends (same structure as dashboard.js save handler)
    const dto = {
        id: oldStop.id,
        event: "stop" as const,
        job_title: "my project",
        timestamp: 9500,
        task: "task y",
        job_id: job.id,
        time_seed: oldStop.time_seed
    };

    const candidate = Event.fromDTO(dto);
    const result = repo.replaceEvent(oldStop, candidate);
    assert.ok(result.globalReplaced, "DTO-constructed event should match and replace");

    const refreshed = repo.loadAllEntries();
    const updated = refreshed.find(e => e.id === stop.id)!;
    assert.strictEqual(updated.timestamp, 9500, "timestamp updated via DTO path");
    assert.strictEqual(updated.task, "task y", "task updated via DTO path");

    console.log("  ✓ edit via DTO tests passed");
}

/**
 * Tests multiple sequential edits (batch edit_log_entries path):
 * - Target: EventRepository.replaceEvent called multiple times on same file
 * - What: simulates the batch edit handler editing multiple events in one save.
 * - Does: appends a session, replaces both start and stop timestamps,
 *   reloads and verifies both changes persisted.
 * - Why: the dashboard's edit_log_entries handler iterates over multiple edits;
 *   each replaceEvent rewrites the file, so subsequent edits must work on
 *   the already-rewritten file content.
 */
export function run_batchEdit_tests(): void {
    const paths = mkPaths("batch-edit", false);
    const repo = new EventRepository(paths);
    const job = Job.create({ title: "alpha" });

    const start = ev(job, "start", 1000);
    const stop = ev(job, "stop", 2000);
    repo.appendEvent(start);
    repo.appendEvent(stop);

    // Load once (controller does this before the loop)
    const collection = repo.loadAllEntries();

    // Edit 1: move start
    const oldStart = collection.find(e => e.id === start.id)!;
    const newStart = oldStart.withTimestamp(1100);
    const r1 = repo.replaceEvent(oldStart, newStart);
    assert.ok(r1.globalReplaced, "first edit succeeded");

    // Edit 2: move stop — file has already been rewritten by edit 1
    const oldStop = collection.find(e => e.id === stop.id)!;
    const newStop = oldStop.withTimestamp(2200);
    const r2 = repo.replaceEvent(oldStop, newStop);
    assert.ok(r2.globalReplaced, "second edit succeeded on rewritten file");

    // Verify both
    const final = repo.loadAllEntries();
    assert.strictEqual(final.find(e => e.id === start.id)!.timestamp, 1100, "start updated");
    assert.strictEqual(final.find(e => e.id === stop.id)!.timestamp, 2200, "stop updated");

    console.log("  ✓ batch edit tests passed");
}

/**
 * Tests that retiming an event to violate session order is rejected pre-save:
 * - Target: EventCollection.validateReplacement + EventRepository.replaceEvent
 * - What: simulates the dashboard controller's pre-save gate — if the user edits
 *   a pause timestamp to be earlier than the start, validateReplacement should
 *   return errors and replaceEvent should NOT be called (file untouched).
 * - Does: appends a session, attempts an invalid retime, verifies errors are
 *   produced and the file on disk is unchanged.
 * - Why: ensures users get feedback and the save fails when they try to reorder events.
 */
export function run_editRejected_invalidRetime_tests(): void {
    const paths = mkPaths("edit-rejected-retime", true);
    const repo = new EventRepository(paths);
    const j = Job.create({ title: "alpha" });

    const start = ev(j, "start", 10000);
    const pause = ev(j, "pause", 20000);
    const resume = ev(j, "resume", 30000);
    const stop = ev(j, "stop", 40000);

    repo.appendEvent(start);
    repo.appendEvent(pause);
    repo.appendEvent(resume);
    repo.appendEvent(stop);

    // Load collection (same as controller does)
    const collection = repo.loadAllEntries();
    const oldPause = collection.find(e => e.id === pause.id)!;
    assert.ok(oldPause, "pause found by id");

    // Attempt 1: retime pause BEFORE start — should be rejected
    const badCandidate1 = oldPause.withTimestamp(5000);
    const errors1 = collection.validateReplacement(oldPause, badCandidate1);
    assert.ok(errors1.length > 0, "retime before start yields validation errors");

    // Attempt 2: retime pause AFTER resume — should be rejected
    const badCandidate2 = oldPause.withTimestamp(35000);
    const errors2 = collection.validateReplacement(oldPause, badCandidate2);
    assert.ok(errors2.length > 0, "retime past resume yields validation errors");

    // Attempt 3: retime pause to same timestamp as start (non-increasing) — rejected
    const badCandidate3 = oldPause.withTimestamp(10000);
    const errors3 = collection.validateReplacement(oldPause, badCandidate3);
    assert.ok(errors3.length > 0, "timestamp equal to predecessor is rejected");

    // Since validation failed, replaceEvent should NOT be called.
    // Verify the file on disk is still unchanged.
    const refreshed = repo.loadAllEntries();
    const unchangedPause = refreshed.find(e => e.id === pause.id)!;
    assert.strictEqual(unchangedPause.timestamp, 20000, "file on disk was NOT modified");

    // Attempt 4: valid retime within the window — should pass
    const goodCandidate = oldPause.withTimestamp(25000);
    const noErrors = collection.validateReplacement(oldPause, goodCandidate);
    assert.strictEqual(noErrors.length, 0, "valid retime has no errors");

    // Now run the actual write (controller would proceed here)
    const result = repo.replaceEvent(oldPause, goodCandidate);
    assert.ok(result.globalReplaced || result.workspaceReplaced, "valid edit writes successfully");

    const final = repo.loadAllEntries();
    const updatedPause = final.find(e => e.id === pause.id)!;
    assert.strictEqual(updatedPause.timestamp, 25000, "valid retime persisted");

    console.log("  ✓ edit rejected (invalid retime) tests passed");
}

/**
 * Tests that batch edits with an invalid retime are caught by validateReplacements:
 * - Target: EventCollection.validateReplacements
 * - What: validates all proposed edits together before writing to disk.
 * - Does: creates a session, proposes moving pause past resume in a batch,
 *   verifies errors are returned.
 * - Why: the edit_log_entries handler should pre-validate all edits.
 */
export function run_batchEditRejected_tests(): void {
    const paths = mkPaths("batch-edit-rejected", false);
    const repo = new EventRepository(paths);
    const j = Job.create({ title: "alpha" });

    const start = ev(j, "start", 1000);
    const pause = ev(j, "pause", 2000);
    const resume = ev(j, "resume", 3000);
    const stop = ev(j, "stop", 4000);

    repo.appendEvent(start);
    repo.appendEvent(pause);
    repo.appendEvent(resume);
    repo.appendEvent(stop);

    const collection = repo.loadAllEntries();
    const oldPause = collection.find(e => e.id === pause.id)!;
    const oldResume = collection.find(e => e.id === resume.id)!;

    // Invalid batch: swap pause and resume timestamps
    const edits = [
        { oldEvent: oldPause, newEvent: oldPause.withTimestamp(3000) },
        { oldEvent: oldResume, newEvent: oldResume.withTimestamp(2000) },
    ];
    const errors = collection.validateReplacements(edits);
    assert.ok(errors.length > 0, "swapping timestamps produces validation errors");

    // File untouched since we didn't write
    const refreshed = repo.loadAllEntries();
    assert.strictEqual(refreshed.find(e => e.id === pause.id)!.timestamp, 2000, "pause untouched");
    assert.strictEqual(refreshed.find(e => e.id === resume.id)!.timestamp, 3000, "resume untouched");

    console.log("  ✓ batch edit rejected (invalid retime) tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// 5) Edge cases
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests buildPayload with events that have no task:
 * - Target: buildPayload in src/dashboard/controller/dashboard.ts
 * - What: events with undefined task should produce task: "" in payload.
 * - Does: creates events without task, checks payload.
 * - Why: webview depends on task always being a string, not undefined.
 */
export function run_buildPayload_noTask_tests(): void {
    const job = Job.create({ title: "alpha" });
    const e = ev(job, "start", 1000); // no task

    const payload = buildPayload([e]);
    assert.strictEqual(payload[0].task, "", "undefined task → empty string");

    console.log("  ✓ buildPayload no-task tests passed");
}

/**
 * Tests filterRelevantErrors task matching (empty vs undefined):
 * - Target: filterRelevantErrors in src/dashboard/controller/dashboard.ts
 * - What: an event with undefined task should match a DTO record with "" task.
 * - Does: constructs error with task: "" and event with undefined task.
 * - Why: the `(e.task || "") === (rec.task || "")` guard must coerce both sides.
 */
export function run_filterRelevantErrors_taskCoercion_tests(): void {
    const job = Job.create({ title: "alpha" });
    const e = ev(job, "start", 1000); // task is undefined

    const errors: ValidationError[] = [
        {
            index: 0,
            code: "test",
            message: "should match",
            record: { ...e.toDTO(), task: "" }  // DTO has "" instead of undefined
        }
    ];

    const result = filterRelevantErrors(errors, [e]);
    assert.strictEqual(result.length, 1, "undefined task matches empty string task");

    console.log("  ✓ filterRelevantErrors task-coercion tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Exported runners
// ═══════════════════════════════════════════════════════════════════════════

export function run_dashboard_buildPayload_tests(): void {
    console.log("dashboard: buildPayload");
    run_buildPayload_tests();
    run_buildPayload_empty_tests();
    run_buildPayload_noTask_tests();
}

export function run_dashboard_filterRelevantErrors_tests(): void {
    console.log("dashboard: filterRelevantErrors");
    run_filterRelevantErrors_tests();
    run_filterRelevantErrors_noRecord_tests();
    run_filterRelevantErrors_taskCoercion_tests();
}

export function run_dashboard_replaceEvent_tests(): void {
    console.log("dashboard: replaceEvent");
    run_replaceEvent_global_tests();
    run_replaceEvent_both_tests();
    run_replaceEvent_noMatch_tests();
    run_replaceEvent_headerDedup_tests();
    run_replaceEvent_malformedPreserved_tests();
}

export function run_dashboard_editRoundTrip_tests(): void {
    console.log("dashboard: edit round-trip");
    run_editRoundTrip_tests();
    run_editViaDTO_tests();
    run_batchEdit_tests();
    run_editRejected_invalidRetime_tests();
    run_batchEditRejected_tests();
}
