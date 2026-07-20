import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { TimeScopePaths } from "../core/paths";
import { EventRepository } from "../core/event_repository";
import { RegistryRepository } from "../core/registry_repository";
import { enable_local_logging } from "../core/local_opt_in";
import { workspace_timescope_paths } from "../core/workspace_paths";
import { append_owned_event, rebuild_index, registry_log_paths } from "../core/global_index";
import { Job } from "../core/job";
import { Event } from "../core/event";
import { write_file_atomic } from "../utils/fs_utils";

function mkdir_tmp(suffix: string): string {
    const root = path.join(__dirname, "..", "..", "test-output", `multi-instance-${suffix}-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    return root;
}

/** Read non-header event lines from a JSONL file. */
function event_lines(file_path: string): Record<string, unknown>[] {
    if (!fs.existsSync(file_path)) return [];
    const raw = fs.readFileSync(file_path, "utf8");
    return raw
        .split(/\r?\n/)
        .filter(l => l.trim().length > 0)
        .map(l => JSON.parse(l))
        .filter(o => (o as Record<string, unknown>)._format_version === undefined) as Record<string, unknown>[];
}

/**
 * Tests that two independent "windows" (each on its own opted-in repo, sharing one global
 * storage dir) don't cross-talk on disk (#47 multi-instance safety):
 * - Target: EventRepository.appendValidated (src/core/event_repository.ts), enable_local_logging
 *   (src/core/local_opt_in.ts), rebuild_index (src/core/global_index.ts).
 * - What: interleaved start/pause/resume/stop across two repos land only in their own owned
 *   `.timescope/logs.jsonl`; both repos register in the shared registry; rebuild_index
 *   converges to the dedup'd union of both logs.
 * - Why: local-first storage's "one owner per event" invariant must hold across concurrently
 *   active windows on different repos, not just within a single window.
 */
export function run_multi_instance_no_crosstalk_tests(): void {
    const root = mkdir_tmp("no-crosstalk");
    const global_dir = path.join(root, "global");
    const repo1_root = path.join(root, "repo1");
    const repo2_root = path.join(root, "repo2");
    fs.mkdirSync(global_dir, { recursive: true });
    fs.mkdirSync(repo1_root, { recursive: true });
    fs.mkdirSync(repo2_root, { recursive: true });

    const shared: Pick<TimeScopePaths, "global_jobs_path" | "global_log_path" | "registry_path" | "global_index_path" | "scratch_path"> = {
        global_jobs_path: path.join(global_dir, "jobs.json"),
        global_log_path: path.join(global_dir, "logs.jsonl"),
        registry_path: path.join(global_dir, "registry.json"),
        global_index_path: path.join(global_dir, "index.jsonl"),
        scratch_path: path.join(global_dir, "scratch.jsonl"),
    };
    const registry_repo = new RegistryRepository(shared.registry_path);

    // Two independent storage stacks ("windows"), each opted into its own repo.
    const paths1: TimeScopePaths = { ...shared };
    const paths2: TimeScopePaths = { ...shared };
    const repo_id1 = enable_local_logging(paths1, repo1_root, "repo1", registry_repo, 1000);
    const repo_id2 = enable_local_logging(paths2, repo2_root, "repo2", registry_repo, 2000);
    assert.notStrictEqual(repo_id1, repo_id2, "the two windows mint distinct repo ids");

    const repo1_events = new EventRepository(paths1);
    const repo2_events = new EventRepository(paths2);
    const job1 = Job.create({ title: "alpha" });
    const job2 = Job.create({ title: "beta" });

    // Interleave start/pause/resume/stop across the two windows' repos.
    repo1_events.appendValidated(Event.create(job1, "start", 100));
    repo2_events.appendValidated(Event.create(job2, "start", 105));
    repo1_events.appendValidated(Event.create(job1, "pause", 110));
    repo2_events.appendValidated(Event.create(job2, "pause", 115));
    repo1_events.appendValidated(Event.create(job1, "resume", 120));
    repo2_events.appendValidated(Event.create(job2, "resume", 125));
    repo1_events.appendValidated(Event.create(job1, "stop", 130));
    repo2_events.appendValidated(Event.create(job2, "stop", 135));

    // Each repo's log holds only its own four events.
    const ws1 = workspace_timescope_paths(repo1_root);
    const ws2 = workspace_timescope_paths(repo2_root);
    const lines1 = event_lines(ws1.log_path);
    const lines2 = event_lines(ws2.log_path);
    assert.strictEqual(lines1.length, 4, "repo1's log holds exactly its own four events");
    assert.strictEqual(lines2.length, 4, "repo2's log holds exactly its own four events");
    assert.ok(lines1.every(l => l.job === "alpha"), "repo1's log contains only job1 events");
    assert.ok(lines2.every(l => l.job === "beta"), "repo2's log contains only job2 events");

    // Both repos are registered via the registration path.
    const registry = registry_repo.load();
    assert.strictEqual(registry.repos.length, 2, "registry holds both repos");
    assert.ok(registry.find_by_id(repo_id1), "repo1 registered");
    assert.ok(registry.find_by_id(repo_id2), "repo2 registered");

    // rebuild_index converges to the dedup'd union of both logs.
    const sources = registry_log_paths(registry);
    const result = rebuild_index(shared.global_index_path!, sources, shared.scratch_path);
    assert.strictEqual(result.event_count, 8, "index converges to the union of both repos' events");
    const index_lines = event_lines(shared.global_index_path!);
    assert.strictEqual(index_lines.filter(l => l.job === "alpha").length, 4, "index carries all of repo1's events");
    assert.strictEqual(index_lines.filter(l => l.job === "beta").length, 4, "index carries all of repo2's events");
}

/**
 * Tests that rebuild_index recovers from the accepted append-vs-rebuild lost write on
 * `index.jsonl` (#47 multi-instance safety):
 * - Target: rebuild_index in src/core/global_index.ts
 * - What: a derived-index race (an atomic rewrite from a stale in-memory snapshot clobbers a
 *   concurrently appended line) is accepted — `index.jsonl` is disposable/rebuildable, not a
 *   source of truth — but rebuild_index from the owned sources must converge back to the
 *   dedup'd truth regardless.
 * - Why: pins the documented invariant (`index.jsonl` is derived/rebuildable/disposable) with
 *   a concrete race reproduction, so a regression that makes rebuild depend on index state
 *   would be caught.
 */
export function run_multi_instance_index_convergence_tests(): void {
    const root = mkdir_tmp("index-convergence");
    const scratch_path = path.join(root, "scratch.jsonl");
    const index_path = path.join(root, "index.jsonl");
    const job = Job.create({ title: "gamma" });

    // Owned source of truth: two events land in scratch.jsonl.
    const e1 = Event.create(job, "start", 100);
    const e2 = Event.create(job, "stop", 200);
    append_owned_event(scratch_path, e1);
    append_owned_event(scratch_path, e2);

    // Build the index from those two, then take a "stale" snapshot of it (as another
    // in-memory writer would hold before a third event lands).
    rebuild_index(index_path, [], scratch_path);
    const stale_snapshot = fs.readFileSync(index_path, "utf8");
    assert.strictEqual(event_lines(index_path).length, 2, "index starts with the two owned events");

    // A third owned event lands (both in scratch — the source of truth — and appended
    // directly to index.jsonl, simulating the append side of the race).
    const e3 = Event.create(job, "start", 300);
    append_owned_event(scratch_path, e3);
    append_owned_event(index_path, e3);
    assert.strictEqual(event_lines(index_path).length, 3, "index append lands the third event");

    // The lost write: a concurrent writer rewrites index.jsonl atomically from its stale
    // (pre-third-event) in-memory snapshot, clobbering the just-appended line.
    write_file_atomic(index_path, stale_snapshot);
    assert.strictEqual(event_lines(index_path).length, 2, "the stale atomic rewrite loses the third event's line");

    // rebuild_index from the owned sources (scratch — unaffected by the index race)
    // converges the index back to the dedup'd truth: all three events, once each.
    const result = rebuild_index(index_path, [], scratch_path);
    assert.strictEqual(result.event_count, 3, "rebuild_index recovers the lost event from the owned source");
    const recovered = event_lines(index_path);
    assert.strictEqual(recovered.length, 3, "index converges to three events after rebuild");
    assert.strictEqual(new Set(recovered.map(l => l.id)).size, 3, "no duplicate ids after rebuild");
}
