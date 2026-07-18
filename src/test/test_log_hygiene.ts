import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { TimeScopePaths } from "../core/paths";
import { Event } from "../core/event";
import { EventRepository } from "../core/event_repository";
import { Job } from "../core/job";
import {
    split_concatenated_jsonl,
    sanitize_lines,
    has_repairable_damage,
    compact_log_file,
    HEADER_LINE,
} from "../core/log_sanitizer";
import { append_line_safe, write_file_atomic } from "../utils/fs_utils";

function mkPaths(suffix: string, withWorkspace = false): TimeScopePaths {
    const root = path.join(__dirname, "..", "..", "test-output", `log-hygiene-${suffix}-${Date.now()}`);
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
 * Tests split_concatenated_jsonl:
 * - Target: split_concatenated_jsonl in src/core/log_sanitizer.ts
 * - What: splitting a physical line holding multiple concatenated JSON objects.
 * - Why: production logs contain glued records (append to file missing trailing newline).
 */
export function run_split_concatenated_jsonl_tests(): void {
    const job = Job.create({ title: "alpha" });
    const a = ev(job, "start", 100).toJSONL();
    const b = ev(job, "stop", 200).toJSONL();

    // Single object stays whole.
    assert.deepStrictEqual(split_concatenated_jsonl(a), [a], "single object should not split");

    // Two glued objects split cleanly (padding-tolerant).
    const glued = a + b;
    const parts = split_concatenated_jsonl(glued);
    assert.strictEqual(parts.length, 2, "glued pair should split into two");
    assert.ok(Event.fromJSONL(parts[0]) !== null, "first part should parse as event");
    assert.ok(Event.fromJSONL(parts[1]) !== null, "second part should parse as event");

    // Braces inside string values must not fool the splitter.
    const tricky = Job.create({ title: 'we}{ird "job"' });
    const t = ev(tricky, "start", 300).toJSONL();
    assert.deepStrictEqual(split_concatenated_jsonl(t), [t], "braces in strings should not split");
    const gluedTricky = t + a;
    const trickyParts = split_concatenated_jsonl(gluedTricky);
    assert.strictEqual(trickyParts.length, 2, "tricky glued pair should still split into two");
    assert.ok(Event.fromJSONL(trickyParts[0]) !== null, "tricky first part should parse");

    // Garbage or partial-prefix lines stay whole (no risky salvage).
    assert.deepStrictEqual(split_concatenated_jsonl("{ not json"), ["{ not json"], "garbage stays whole");
    const partialPrefix = a.slice(0, 20) + b;
    assert.deepStrictEqual(split_concatenated_jsonl(partialPrefix), [partialPrefix], "partial prefix stays whole");
}

/**
 * Tests sanitize_lines:
 * - Target: sanitize_lines/has_repairable_damage in src/core/log_sanitizer.ts
 * - What: in-memory healing of concatenated lines + damage report (header, malformed, pause/resume counts).
 * - Why: every load must see healed logical lines; damage is surfaced, never silently rewritten.
 */
export function run_sanitize_lines_tests(): void {
    const job = Job.create({ title: "alpha" });
    const start = ev(job, "start", 100).toJSONL();
    const pause = ev(job, "pause", 200).toJSONL();
    const resume = ev(job, "resume", 300).toJSONL();
    const stop = ev(job, "stop", 400).toJSONL();

    // Clean file: nothing to report.
    const clean = sanitize_lines([HEADER_LINE, start, pause, resume, stop]);
    assert.deepStrictEqual(clean.lines, [HEADER_LINE, start, pause, resume, stop], "clean lines unchanged");
    assert.strictEqual(clean.report.concatenated_lines_split, 0);
    assert.strictEqual(clean.report.malformed_lines, 0);
    assert.strictEqual(clean.report.missing_header, false);
    assert.strictEqual(clean.report.pause_events, 1);
    assert.strictEqual(clean.report.resume_events, 1);
    assert.strictEqual(has_repairable_damage(clean.report), false, "clean file has no repairable damage");

    // Concatenated line heals into two logical lines.
    const healed = sanitize_lines([HEADER_LINE, start + stop]);
    assert.strictEqual(healed.lines.length, 3, "header + two healed lines");
    assert.ok(Event.fromJSONL(healed.lines[1]) !== null, "healed line 1 parses");
    assert.ok(Event.fromJSONL(healed.lines[2]) !== null, "healed line 2 parses");
    assert.strictEqual(healed.report.concatenated_lines_split, 1);
    assert.strictEqual(has_repairable_damage(healed.report), true, "concatenation is repairable damage");

    // Missing header is repairable damage; malformed garbage is reported but preserved.
    const damaged = sanitize_lines([start, "{ not json", stop]);
    assert.strictEqual(damaged.report.missing_header, true);
    assert.strictEqual(damaged.report.malformed_lines, 1);
    assert.ok(damaged.lines.includes("{ not json"), "malformed line preserved in memory");
    assert.strictEqual(has_repairable_damage(damaged.report), true, "missing header is repairable damage");

    // Unbalanced pause/resume is reported but is NOT repairable damage by itself.
    const unbalanced = sanitize_lines([HEADER_LINE, start, pause, stop]);
    assert.strictEqual(unbalanced.report.pause_events, 1);
    assert.strictEqual(unbalanced.report.resume_events, 0);
    assert.strictEqual(has_repairable_damage(unbalanced.report), false, "imbalance alone is not compactable damage");

    // Light mode (hot-path reads): healing + repair detection intact, no event counting.
    const light = sanitize_lines([HEADER_LINE, start + stop, pause], { count_events: false });
    assert.strictEqual(light.lines.length, 4, "light mode still heals concatenation");
    assert.strictEqual(light.report.concatenated_lines_split, 1, "light mode still detects splits");
    assert.strictEqual(has_repairable_damage(light.report), true, "light mode still flags repairable damage");
    assert.strictEqual(light.report.pause_events, 0, "light mode skips event counting");
}

/**
 * Tests append_line_safe:
 * - Target: append_line_safe in src/utils/fs_utils.ts
 * - What: appends always land on their own line, even when the file lacks a trailing newline.
 * - Why: closes the concatenation bug class permanently (issue #42 acceptance).
 */
export function run_append_line_safe_tests(): void {
    const root = path.join(__dirname, "..", "..", "test-output", `append-safe-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });

    // New file: single line with trailing newline.
    const fresh = path.join(root, "fresh.jsonl");
    append_line_safe(fresh, '{"a":1}');
    assert.strictEqual(fs.readFileSync(fresh, "utf8"), '{"a":1}\n', "fresh file gets line + newline");

    // Well-formed file: plain append.
    append_line_safe(fresh, '{"b":2}');
    assert.strictEqual(fs.readFileSync(fresh, "utf8"), '{"a":1}\n{"b":2}\n', "normal append");

    // File missing its trailing newline: newline injected first — two valid lines, no gluing.
    const torn = path.join(root, "torn.jsonl");
    fs.writeFileSync(torn, '{"a":1}', "utf8");
    append_line_safe(torn, '{"b":2}');
    const lines = fs.readFileSync(torn, "utf8").split("\n").filter(l => l.length > 0);
    assert.strictEqual(lines.length, 2, "torn file should yield two physical lines");
    assert.doesNotThrow(() => lines.map(l => JSON.parse(l)), "both lines must be valid JSON");
}

/**
 * Tests write_file_atomic:
 * - Target: write_file_atomic in src/utils/fs_utils.ts
 * - What: temp-file + rename replacement of file contents, no temp litter.
 * - Why: full-file rewrites must never tear the log on crash (issue #42 acceptance).
 */
export function run_write_file_atomic_tests(): void {
    const root = path.join(__dirname, "..", "..", "test-output", `atomic-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    const target = path.join(root, "logs.jsonl");

    write_file_atomic(target, "one\n");
    assert.strictEqual(fs.readFileSync(target, "utf8"), "one\n", "atomic write creates file");

    write_file_atomic(target, "two\n");
    assert.strictEqual(fs.readFileSync(target, "utf8"), "two\n", "atomic write replaces existing file");

    const leftovers = fs.readdirSync(root).filter(f => f !== "logs.jsonl");
    assert.deepStrictEqual(leftovers, [], "no temp files left behind");

    // Parent directory need not pre-exist — the helper creates it.
    const nested = path.join(root, "a", "b", "c", "logs.jsonl");
    write_file_atomic(nested, "deep\n");
    assert.strictEqual(fs.readFileSync(nested, "utf8"), "deep\n", "atomic write creates missing parent dirs");
}

/**
 * Tests append_line_safe / write_file_atomic create missing parent directories:
 * - Target: src/utils/fs_utils.ts
 * - Why: the low-level write helpers are self-sufficient — callers need not
 *   pre-create the directory (closes an ENOENT race on first write).
 */
export function run_write_helpers_mkdir_tests(): void {
    const root = path.join(__dirname, "..", "..", "test-output", `mkdir-${Date.now()}`);

    const appendTarget = path.join(root, "x", "y", "append.jsonl");
    append_line_safe(appendTarget, '{"a":1}');
    assert.strictEqual(fs.readFileSync(appendTarget, "utf8"), '{"a":1}\n', "append_line_safe creates missing parent dirs");
}

/**
 * Tests EventRepository sanitized reads + newline-safe appends:
 * - Target: EventRepository read/append paths in src/core/event_repository.ts
 * - What: concatenated records on disk are visible to loads (healed in memory); appending to a
 *   file missing its trailing newline never glues records.
 * - Why: the production log's glued line currently vanishes from all analysis — this pins the fix.
 */
export function run_repository_sanitized_load_tests(): void {
    const job = Job.create({ title: "alpha" });
    const start = ev(job, "start", 100).toJSONL();
    const stop = ev(job, "stop", 200).toJSONL();

    // Glued pair on disk → both events load; session reconstructs.
    const paths = mkPaths("sanitized-load");
    fs.writeFileSync(paths.global_log_path, HEADER_LINE + "\n" + start + stop + "\n", "utf8");
    const repo = new EventRepository(paths);
    const col = repo.loadEventCollectionForJob(job);
    assert.strictEqual(col.toEvents().length, 2, "both glued events should load");
    const sessions = repo.loadSessions("global");
    assert.strictEqual(sessions.length, 1, "glued start/stop should form one session");
    assert.ok(sessions[0].stopEvent, "session should be closed");

    // Append to a global log missing its trailing newline → no gluing on disk.
    const paths2 = mkPaths("append-newline");
    fs.writeFileSync(paths2.global_log_path, HEADER_LINE + "\n" + start, "utf8"); // no trailing \n
    const repo2 = new EventRepository(paths2);
    repo2.appendEvent(ev(job, "stop", 300));
    const rawLines = fs.readFileSync(paths2.global_log_path, "utf8").split("\n").filter(l => l.trim().length > 0);
    assert.strictEqual(rawLines.length, 3, "header + two event lines on disk");
    for (const line of rawLines.slice(1)) {
        assert.ok(Event.fromJSONL(line) !== null, `line should parse cleanly: ${line}`);
    }
}

/**
 * Tests compact_log_file:
 * - Target: compact_log_file in src/core/log_sanitizer.ts
 * - What: repairs concatenation on disk, restores canonical serialization and header,
 *   writes a .bak first, lands atomically, is idempotent, preserves unparseable lines.
 * - Why: issue #42 acceptance notes, verbatim.
 */
export function run_compact_log_tests(): void {
    const job = Job.create({ title: "alpha" });
    const start = ev(job, "start", 100);
    const stop = ev(job, "stop", 200);

    const root = path.join(__dirname, "..", "..", "test-output", `compact-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    const logPath = path.join(root, "logs.jsonl");

    // Damaged file: glued pair, one non-canonical (reordered keys) record, garbage, no header.
    const dto = stop.toDTO();
    const reordered = JSON.stringify({
        event: dto.event, id: dto.id, job: dto.job_title,
        timestamp: dto.timestamp, job_id: dto.job_id, time_seed: dto.time_seed,
    });
    const original = start.toJSONL() + start.toJSONL().replace(/"start"/, '"pause"') // glued pair (2nd differs)
        + "\n" + reordered + "\n" + "{ garbage line\n";
    fs.writeFileSync(logPath, original, "utf8");

    const result = compact_log_file(logPath);
    assert.strictEqual(result.changed, true, "compaction should report changes");
    assert.ok(result.backup_path, "backup path should be reported");
    assert.strictEqual(fs.readFileSync(result.backup_path!, "utf8"), original, ".bak preserves original bytes");

    const after = fs.readFileSync(logPath, "utf8");
    const lines = after.split("\n").filter(l => l.trim().length > 0);
    assert.strictEqual(lines[0], HEADER_LINE, "header restored on first line");
    assert.ok(after.endsWith("\n"), "compacted file ends with newline");
    assert.ok(lines.includes("{ garbage line"), "unparseable line preserved verbatim");
    const eventLines = lines.filter(l => l !== HEADER_LINE && l !== "{ garbage line");
    assert.strictEqual(eventLines.length, 3, "three event records after split");
    for (const line of eventLines) {
        const parsed = Event.fromJSONL(line);
        assert.ok(parsed !== null, `event line should parse: ${line}`);
        assert.strictEqual(line, parsed!.toJSONL(), "record should be in canonical serialization");
    }

    // Idempotent: second run changes nothing and does not touch the backup.
    const bakBytes = fs.readFileSync(result.backup_path!, "utf8");
    const second = compact_log_file(logPath);
    assert.strictEqual(second.changed, false, "second compaction is a no-op");
    assert.strictEqual(fs.readFileSync(logPath, "utf8"), after, "file unchanged by second run");
    assert.strictEqual(fs.readFileSync(result.backup_path!, "utf8"), bakBytes, "backup untouched by no-op run");

    // Missing file: graceful no-op.
    const missing = compact_log_file(path.join(root, "nope.jsonl"));
    assert.strictEqual(missing.changed, false, "missing file is a no-op");

    // New damage later: a fresh compaction must NOT clobber the earlier backup.
    fs.appendFileSync(logPath, start.toJSONL() + stop.toJSONL() + "\n", "utf8");
    const third = compact_log_file(logPath);
    assert.strictEqual(third.changed, true, "new damage should compact again");
    assert.notStrictEqual(third.backup_path, result.backup_path, "second backup gets a distinct name");
    assert.strictEqual(fs.readFileSync(result.backup_path!, "utf8"), bakBytes, "original .bak preserved");
}
