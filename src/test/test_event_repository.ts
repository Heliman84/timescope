import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { TimeScopePaths } from "../core/paths";
import { Event } from "../core/event";
import { EventRepository } from "../core/event_repository";
import { Job } from "../core/job";

function mkPaths(suffix: string, withWorkspace = true): TimeScopePaths {
    const root = path.join(__dirname, "..", "..", "test-output", `event-repo-${suffix}-${Date.now()}`);
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

/**
 * Tests append/load behavior of EventRepository:
 * - Target: EventRepository.appendEvent/loadEventCollectionForJob/loadSessions/loadLastSession in src/core/event_repository.ts
 * - What: appends multiple events, ensures header is written, loads collections and sessions correctly.
 * - Does: writes start/stop for one job, start for another, then validates EventCollection, sessions, and last session retrieval.
 * - Why: guarantees the repository’s canonical write/read path and session reconstruction are intact after OOP refactor.
 */
export function run_event_repository_append_and_load_tests(): void {
    // No workspace → events are owned by the global-owned store, so "global" reads apply.
    const paths = mkPaths("basic", false);
    const repo = new EventRepository(paths);
    const jobA = Job.create({ title: "alpha" });
    const jobB = Job.create({ title: "beta" });

    repo.appendEvent(ev(jobA, "start", 100));
    repo.appendEvent(ev(jobA, "stop", 200));
    repo.appendEvent(ev(jobB, "start", 300));

    const raw = fs.readFileSync(paths.global_log_path, "utf8");
    const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
    assert.ok(lines[0].includes("_format_version"), "first line should be header");

    const colA = repo.loadEventCollectionForJob(jobA);
    assert.strictEqual(colA.toEvents().length, 2, "jobA should have two events");

    const sessions = repo.loadSessions("global");
    assert.strictEqual(sessions.length, 2, "two sessions (jobA closed + jobB open)");
    const closedSession = sessions.find(s => s.stopEvent);
    assert.ok(closedSession, "one session should be closed");
    assert.ok(closedSession!.job.equals(jobA), "closed session should be jobA");

    const last = repo.loadLastSession("global");
    assert.ok(last, "loadLastSession should return a session");
    // jobB has the latest start timestamp (300), so it's the "last" session
    assert.ok(last!.job.equals(jobB), "last session should be jobB (latest start)");
}

/**
 * Tests renameJobInLogByJob across both global and workspace logs:
 * - Target: EventRepository.renameJobInLogByJob in src/core/event_repository.ts
 * - What: rename a job’s title while preserving job_id in all logs.
 * - Does: mirrors global log to workspace, performs rename, asserts only matching job_id entries change title; others remain.
 * - Why: ensures log rewrite keeps identity stable and updates both locations consistently.
 */
export function run_event_repository_rename_tests(): void {
    const paths = mkPaths("rename");
    const repo = new EventRepository(paths);
    const jobAlpha = Job.create({ title: "alpha" });
    const jobBeta = Job.create({ title: "beta" });

    // renameJobInLogByJob rewrites both owned stores (global-owned + workspace); write
    // the same events into each directly so both files carry the pre-rename data.
    const header = JSON.stringify({ _format_version: 2 });
    const seed = [
        header,
        ev(jobAlpha, "start", 10).toJSONL(),
        ev(jobAlpha, "stop", 20).toJSONL(),
        ev(jobBeta, "start", 30).toJSONL(),
        ev(jobBeta, "stop", 40).toJSONL(),
    ].join("\n") + "\n";
    fs.writeFileSync(paths.global_log_path, seed, "utf8");
    if (paths.workspace_log_path) fs.writeFileSync(paths.workspace_log_path, seed, "utf8");

    const renamed = jobAlpha.rename("gamma");
    repo.renameJobInLogByJob(renamed);

    const checkFile = (p: string | undefined | null) => {
        if (!p) return;
        const parsed = fs.readFileSync(p, "utf8").split(/\r?\n/).filter(l => l.trim()).slice(1).map(l => JSON.parse(l));
        assert.ok(parsed.every(r => r.job_id === renamed.id ? r.job === "gamma" : true), "alpha records retitled to gamma");
        assert.ok(parsed.filter(r => r.job_id === jobBeta.id).every(r => r.job === "beta"), "beta records unchanged");
    };

    checkFile(paths.global_log_path);
    checkFile(paths.workspace_log_path);
}

/**
 * Tests appendValidated transition guards:
 * - Target: EventRepository.appendValidated in src/core/event_repository.ts
 * - What: valid sequence, new session after stop, and rejection of overlapping/illegal transitions.
 * - Does: appends a start/pause/resume/stop sequence, starts a second session, then asserts throws on overlapping start/resume.
 * - Why: enforces domain invariants so logs cannot encode invalid session flows.
 */
export function run_event_repository_validation_tests(): void {
    const paths = mkPaths("validate", false);
    const repo = new EventRepository(paths);
    const job = Job.create({ title: "alpha" });

    repo.appendValidated(ev(job, "start", 100));
    repo.appendValidated(ev(job, "pause", 150));
    repo.appendValidated(ev(job, "resume", 200));
    repo.appendValidated(ev(job, "stop", 300));

    // New session after stop is allowed
    repo.appendValidated(ev(job, "start", 400));
    repo.appendValidated(ev(job, "stop", 500));

    // Attempting to start at timestamp 450 is rejected because the last
    // event (stop) has timestamp 500 and timestamps must increase.
    assert.throws(() => repo.appendValidated(ev(job, "start", 450)), /timestamps must increase/i);
    assert.throws(() => repo.appendValidated(ev(job, "resume", 600)), /open session/i);

    const sessions = repo.loadSessions("global");
    assert.strictEqual(sessions.length, 2, "two sessions after second stop");
}

/**
 * Tests loadLastNSessions merge logic:
 * - Target: EventRepository.loadLastNSessions in src/core/event_repository.ts
 * - What: combines global and workspace logs ordered by timestamp.
 * - Does: writes jobA to global, jobB to workspace, then asks for last two sessions across both.
 * - Why: ensures cross-log chronological merge works for dashboards and recovery flows.
 */
export function run_event_repository_last_sessions_tests(): void {
    const paths = mkPaths("last", true);
    const repo = new EventRepository(paths);
    const jobA = Job.create({ title: "alpha" });
    const jobB = Job.create({ title: "beta" });

    const header = JSON.stringify({ _format_version: 2 });
    // global-owned store written directly (jobA)
    fs.writeFileSync(
        paths.global_log_path,
        [header, ev(jobA, "start", 100).toJSONL(), ev(jobA, "stop", 200).toJSONL()].join("\n") + "\n",
        "utf8"
    );
    // workspace log written directly (jobB)
    if (paths.workspace_log_path) {
        const lines = [header, ev(jobB, "start", 150).toJSONL(), ev(jobB, "stop", 250).toJSONL()];
        fs.writeFileSync(paths.workspace_log_path, lines.join("\n") + "\n", "utf8");
    }

    const lastBoth = repo.loadLastNSessions("both", 2);
    assert.strictEqual(lastBoth.length, 2, "should return two sessions across logs");
    // Chronological order: jobA (start 100) first, jobB (start 150) second
    assert.ok(lastBoth[0].job.equals(jobA), "first session should be jobA");
    assert.ok(lastBoth[1].job.equals(jobB), "second session should be jobB");
}

/**
 * Tests dedupe behavior in appendEvent:
 * - Target: EventRepository.appendEvent dedupe logic in src/core/event_repository.ts
 * - What: duplicate last event should be ignored.
 * - Does: appends identical start twice and checks only one record is persisted (plus header).
 * - Why: prevents log bloat and duplicate semantic events.
 */
export function run_event_repository_dedupe_tests(): void {
    const paths = mkPaths("dedupe", false);
    const repo = new EventRepository(paths);
    const job = Job.create({ title: "alpha" });

    const e1 = ev(job, "start", 1);
    repo.appendEvent(e1);
    repo.appendEvent(ev(job, "start", 1)); // equal

    const raw = fs.readFileSync(paths.global_log_path, "utf8");
    const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
    assert.strictEqual(lines.length, 2, "header + one unique event only");
}

/**
 * Tests renameJobInLogByJob preservation rules:
 * - Target: EventRepository.renameJobInLogByJob in src/core/event_repository.ts
 * - What: malformed lines and headers must survive rewrites unchanged.
 * - Does: writes header + malformed + valid, runs rename, then asserts malformed line stays and valid line is retitled.
 * - Why: protects logs from destructive rewrites when encountering bad data.
 */
export function run_event_repository_malformed_preservation_tests(): void {
    const paths = mkPaths("malformed", false);
    const repo = new EventRepository(paths);
    const job = Job.create({ title: "alpha" });

    // Write custom file with malformed + header + valid
    const header = JSON.stringify({ _format_version: 2 });
    const malformed = "{ not json";
    const good = ev(job, "start", 1).toJSONL();
    fs.writeFileSync(paths.global_log_path, [header, malformed, good].join("\n") + "\n", "utf8");

    const renamed = job.rename("gamma");
    repo.renameJobInLogByJob(renamed);

    const lines = fs.readFileSync(paths.global_log_path, "utf8").split(/\r?\n/).filter(l => l.length > 0);
    assert.strictEqual(lines[1], malformed, "malformed line should be preserved in-place");
    const parsed = JSON.parse(lines[2]);
    assert.strictEqual(parsed.job, "gamma", "renamed title should be applied");
}

/**
 * Tests that appendEvent sets global_line_index and workspace_line_index on the Event:
 * - Target: EventRepository.appendEvent line index tracking in src/core/event_repository.ts
 * - What: after appending, the Event object's line indices reflect where it was written.
 * - Does: appends to fresh and existing files, with and without workspace; checks dedupe path.
 * - Why: ensures the fix that sets line indices after writing actually works, so downstream
 *   consumers (dashboard, replaceEvent) can find events in their file without reloading.
 */
export function run_event_repository_line_index_tests(): void {
    // ── Case 1: Opted-in workspace owns the event (single-owner, #48 48c) ──
    {
        const paths = mkPaths("lineindex-fresh", true);
        const repo = new EventRepository(paths);
        const job = Job.create({ title: "alpha" });
        const e = ev(job, "start", 100);

        assert.strictEqual(e.global_line_index, -1, "before append global should be -1");
        assert.strictEqual(e.workspace_line_index, -1, "before append workspace should be -1");

        repo.appendEvent(e);

        // Owned solely by the workspace log — the global-owned store is untouched.
        assert.strictEqual(e.workspace_line_index, 1, "first event in new workspace file should be line 1");
        assert.strictEqual(e.global_line_index, -1, "opted-in event is not written to the global-owned store");
        assert.ok(e.isPersisted, "event should be persisted");
        assert.ok(e.isInWorkspace, "event should be in workspace");
        assert.ok(!e.isInGlobal, "event should NOT be in the global-owned store");
    }

    // ── Case 2: Subsequent workspace-owned appends increment the workspace index ──
    {
        const paths = mkPaths("lineindex-multi", true);
        const repo = new EventRepository(paths);
        const job = Job.create({ title: "alpha" });

        const e1 = ev(job, "start", 100);
        repo.appendEvent(e1);
        assert.strictEqual(e1.workspace_line_index, 1, "e1 workspace at line 1");
        assert.strictEqual(e1.global_line_index, -1, "e1 not in global-owned store");

        const e2 = ev(job, "stop", 200);
        repo.appendEvent(e2);
        assert.strictEqual(e2.workspace_line_index, 2, "e2 workspace at line 2");
        assert.strictEqual(e2.global_line_index, -1, "e2 not in global-owned store");

        const e3 = ev(job, "start", 300);
        repo.appendEvent(e3);
        assert.strictEqual(e3.workspace_line_index, 3, "e3 workspace at line 3");
        assert.strictEqual(e3.global_line_index, -1, "e3 not in global-owned store");
    }

    // ── Case 3: No workspace — workspace_line_index stays -1 ──
    {
        const paths = mkPaths("lineindex-noworkspace", false);
        const repo = new EventRepository(paths);
        const job = Job.create({ title: "alpha" });
        const e = ev(job, "start", 100);

        repo.appendEvent(e);

        assert.strictEqual(e.global_line_index, 1, "global index set without workspace");
        assert.strictEqual(e.workspace_line_index, -1, "workspace index stays -1 when no workspace log");
        assert.ok(e.isInGlobal, "in global");
        assert.ok(!e.isInWorkspace, "not in workspace");
    }

    // ── Case 4: Dedupe path — duplicate sets global index to existing position ──
    {
        const paths = mkPaths("lineindex-dedupe", false);
        const repo = new EventRepository(paths);
        const job = Job.create({ title: "alpha" });

        const e1 = ev(job, "start", 100);
        repo.appendEvent(e1);
        assert.strictEqual(e1.global_line_index, 1, "original at line 1");

        // Create an equal event (same content, different object)
        const e2 = ev(job, "start", 100);
        assert.strictEqual(e2.global_line_index, -1, "e2 not yet persisted");

        repo.appendEvent(e2);
        // Dedupe path should set global index to the line where the duplicate was found
        assert.ok(e2.global_line_index >= 0, "dedupe path should set global index");
        assert.strictEqual(e2.global_line_index, 1, "dedupe should point to existing line");
    }

    // ── Case 5: loadAllEntries round-trip — indices match what appendEvent set ──
    {
        const paths = mkPaths("lineindex-roundtrip", true);
        const repo = new EventRepository(paths);
        const job = Job.create({ title: "alpha" });

        const e1 = ev(job, "start", 100);
        const e2 = ev(job, "stop", 200);
        repo.appendEvent(e1);
        repo.appendEvent(e2);

        const collection = repo.loadAllEntries();
        const loaded = collection.toEvents();
        assert.strictEqual(loaded.length, 2, "should load two events");

        // After loadAllEntries, events should have same indices
        assert.strictEqual(loaded[0].global_line_index, e1.global_line_index, "e1 global index matches after reload");
        assert.strictEqual(loaded[0].workspace_line_index, e1.workspace_line_index, "e1 workspace index matches after reload");
        assert.strictEqual(loaded[1].global_line_index, e2.global_line_index, "e2 global index matches after reload");
        assert.strictEqual(loaded[1].workspace_line_index, e2.workspace_line_index, "e2 workspace index matches after reload");
    }

    console.log("  ✓ line index tracking tests passed");
}

/** Count non-header event lines in a JSONL file (0 if the file is absent). */
function count_events(file_path: string): number {
    if (!fs.existsSync(file_path)) return 0;
    return fs.readFileSync(file_path, "utf8")
        .split(/\r?\n/)
        .filter(l => l.trim().length > 0)
        .map(l => JSON.parse(l))
        .filter(o => o._format_version === undefined)
        .length;
}

/** Build 48c-style paths: scratch is the global-owned store, plus a derived index. */
function mkOwnedPaths(suffix: string, withWorkspace: boolean): TimeScopePaths {
    const paths = mkPaths(suffix, withWorkspace);
    const dir = path.dirname(paths.global_log_path);
    paths.scratch_path = path.join(dir, "scratch.jsonl");
    paths.global_index_path = path.join(dir, "index.jsonl");
    return paths;
}

/**
 * Tests single-owner writes + index replication after the cutover (#48 48c):
 * - Target: EventRepository.appendEvent in src/core/event_repository.ts
 * - What: an event lands in exactly ONE owned store — the workspace log when opted in,
 *   otherwise the global-owned scratch — and always replicates into the derived index.
 *   The legacy global `logs.jsonl` is never written. Dedupe writes neither twice.
 * - Why: this is the local-first write model — one owner per event, global index derived.
 */
export function run_event_repository_replication_tests(): void {
    // ── Case 1: No workspace — scratch owns the event; index mirrors it ──
    {
        const paths = mkOwnedPaths("owned-scratch", false);
        const repo = new EventRepository(paths);
        const job = Job.create({ title: "alpha" });

        repo.appendEvent(ev(job, "start", 100));
        repo.appendEvent(ev(job, "stop", 200));

        assert.strictEqual(count_events(paths.scratch_path!), 2, "scratch owns non-workspace events");
        assert.strictEqual(count_events(paths.global_index_path!), 2, "both events replicated to the index");
        assert.strictEqual(count_events(paths.global_log_path), 0, "legacy global logs.jsonl is never written");
    }

    // ── Case 2: Workspace opted in — workspace owns it; scratch untouched ──
    {
        const paths = mkOwnedPaths("owned-workspace", true);
        const repo = new EventRepository(paths);
        const job = Job.create({ title: "alpha" });

        repo.appendEvent(ev(job, "start", 100));

        assert.strictEqual(count_events(paths.workspace_log_path!), 1, "workspace log owns the event");
        assert.strictEqual(count_events(paths.global_index_path!), 1, "event replicated to the index");
        assert.strictEqual(count_events(paths.scratch_path!), 0, "opted-in session must not write scratch");
    }

    // ── Case 3: Dedupe — an equal re-append writes neither owner nor index twice ──
    {
        const paths = mkOwnedPaths("owned-dedupe", false);
        const repo = new EventRepository(paths);
        const job = Job.create({ title: "alpha" });

        repo.appendEvent(ev(job, "start", 100));
        repo.appendEvent(ev(job, "start", 100)); // equal — deduped

        assert.strictEqual(count_events(paths.scratch_path!), 1, "dedupe does not double-write the owner");
        assert.strictEqual(count_events(paths.global_index_path!), 1, "dedupe does not double-write the index");
    }

    console.log("  ✓ single-owner write + index replication tests passed");
}