import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { Event } from "../core/event";
import { Job } from "../core/job";
import { append_owned_event, rebuild_index, registry_log_paths } from "../core/global_index";
import { Registry } from "../core/registry";
import { workspace_timescope_paths } from "../core/workspace_paths";

function mkdir_tmp(suffix: string): string {
    const root = path.join(__dirname, "..", "..", "test-output", `global-index-${suffix}-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    return root;
}

function ev(job: Job, type: "start" | "stop" | "pause" | "resume", ts: number, task?: string): Event {
    return Event.create(job, type, ts, task);
}

/** Read non-header event lines from a JSONL file. */
function event_lines(file_path: string): Record<string, unknown>[] {
    const raw = fs.readFileSync(file_path, "utf8");
    return raw
        .split(/\r?\n/)
        .filter(l => l.trim().length > 0)
        .map(l => JSON.parse(l))
        .filter(o => (o as Record<string, unknown>)._format_version === undefined) as Record<string, unknown>[];
}

/**
 * Tests append_owned_event:
 * - Target: append_owned_event in src/core/global_index.ts
 * - What: writes a header on the first event, appends subsequent events newline-safely.
 * - Why: index.jsonl and scratch.jsonl are owned event logs in the same JSONL format as logs.jsonl.
 */
export function run_append_owned_event_tests(): void {
    const root = mkdir_tmp("append");
    const file_path = path.join(root, "scratch.jsonl");
    const job = Job.create({ title: "alpha" });

    append_owned_event(file_path, ev(job, "start", 100));

    const raw1 = fs.readFileSync(file_path, "utf8");
    const lines1 = raw1.split(/\r?\n/).filter(l => l.trim().length > 0);
    assert.ok(lines1[0].includes("_format_version"), "first line is the format header");
    assert.strictEqual(lines1.length, 2, "header + one event");

    append_owned_event(file_path, ev(job, "stop", 200));
    assert.strictEqual(event_lines(file_path).length, 2, "second append adds an event, not a header");

    // Newline-safe: strip the trailing newline, then append again — must not concatenate.
    const torn = fs.readFileSync(file_path, "utf8").replace(/\n$/, "");
    fs.writeFileSync(file_path, torn, "utf8");
    append_owned_event(file_path, ev(job, "start", 300));
    assert.strictEqual(event_lines(file_path).length, 3, "torn trailing newline is healed on append");
}

/**
 * Tests rebuild_index:
 * - Target: rebuild_index in src/core/global_index.ts
 * - What: unions events from every source log plus scratch, dedups by event id, sorts by timestamp,
 *   writes the index atomically with a header.
 * - Why: the derived index is rebuildable from the owned sources (repo logs + scratch); the same
 *   event id appearing in two sources must land once.
 */
export function run_rebuild_index_tests(): void {
    const root = mkdir_tmp("rebuild");
    const jobA = Job.create({ title: "alpha" });
    const jobB = Job.create({ title: "beta" });

    const repo1 = path.join(root, "repo1-logs.jsonl");
    const repo2 = path.join(root, "repo2-logs.jsonl");
    const scratch = path.join(root, "scratch.jsonl");
    const index = path.join(root, "index.jsonl");

    // repo1: jobA start/stop
    append_owned_event(repo1, ev(jobA, "start", 100));
    append_owned_event(repo1, ev(jobA, "stop", 400));
    // repo2: jobB start — plus a DUPLICATE of jobA's start (same job + ts ⇒ same id)
    append_owned_event(repo2, ev(jobB, "start", 200));
    append_owned_event(repo2, ev(jobA, "start", 100));
    // scratch: jobB stop
    append_owned_event(scratch, ev(jobB, "stop", 300));

    const result = rebuild_index(index, [repo1, repo2], scratch);

    assert.strictEqual(result.source_count, 2, "two repo sources contributed");
    // 4 unique events: jobA start(100), jobB start(200), jobB stop(300), jobA stop(400)
    assert.strictEqual(result.event_count, 4, "duplicate jobA start deduped away");

    const events = event_lines(index);
    assert.ok(events[0]._format_version === undefined, "no header in event_lines");
    assert.strictEqual(events.length, 4, "index holds four unique events");
    // Sorted ascending by timestamp.
    const ts = events.map(e => e.timestamp as number);
    assert.deepStrictEqual(ts, [100, 200, 300, 400], "index sorted by timestamp");

    // Index carries a header on line 0.
    const firstLine = fs.readFileSync(index, "utf8").split(/\r?\n/)[0];
    assert.ok(firstLine.includes("_format_version"), "rebuilt index starts with a header");

    // Rebuild is idempotent — running again yields the same four events.
    const again = rebuild_index(index, [repo1, repo2], scratch);
    assert.strictEqual(again.event_count, 4, "rebuild is idempotent");

    // A missing source path is skipped, not counted or crashed on.
    const withMissing = rebuild_index(index, [repo1, path.join(root, "nope.jsonl")], undefined);
    assert.strictEqual(withMissing.source_count, 1, "missing source path not counted");
    assert.strictEqual(withMissing.event_count, 2, "only repo1's two events remain when scratch omitted");
}

/**
 * Tests registry_log_paths:
 * - Target: registry_log_paths in src/core/global_index.ts
 * - What: maps a Registry's repo entries to their `.timescope/logs.jsonl` paths.
 * - Why: the rebuild command walks registered repos to find their owned logs.
 */
export function run_registry_log_paths_tests(): void {
    const reg = Registry.empty()
        .upsert_repo({ id: "a", name: "Lantern", path: path.join("/work", "lantern"), last_seen: 1 })
        .upsert_repo({ id: "b", name: "Altium", path: path.join("/work", "altium"), last_seen: 2 });

    const paths = registry_log_paths(reg);
    assert.strictEqual(paths.length, 2, "one log path per repo");
    assert.strictEqual(paths[0], workspace_timescope_paths(path.join("/work", "lantern")).log_path, "maps to .timescope/logs.jsonl");
    assert.strictEqual(paths[1], workspace_timescope_paths(path.join("/work", "altium")).log_path, "second repo maps too");
}
