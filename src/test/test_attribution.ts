import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { Event } from "../core/event";
import { Job } from "../core/job";
import { Registry } from "../core/registry";
import { RepoConfig, REPO_CONFIG_FORMAT_VERSION, write_repo_config } from "../core/repo_config";
import { workspace_timescope_paths } from "../core/workspace_paths";
import { append_owned_event } from "../core/global_index";
import { build_attributed_payload } from "../dashboard/controller/attribution";

function mkdir_tmp(suffix: string): string {
    const root = path.join(__dirname, "..", "..", "test-output", `attribution-${suffix}-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    return root;
}

function ev(job: Job, type: "start" | "stop" | "pause" | "resume", ts: number, task?: string): Event {
    return Event.create(job, type, ts, task);
}

/**
 * Builds a small two-repo fixture: repo A is bound to a client/project, repo B is
 * unbound. Both repos are registered. A scratch log and a stray on-disk index.jsonl
 * (with different content) round out the fixture.
 */
function build_fixture(root: string): {
    registry: Registry;
    scratch_path: string;
    index_path: string;
    repoA_id: string;
    repoB_id: string;
    boundJob: Job;
    legacyJob: Job;
    unboundJob: Job;
    scratchJob: Job;
} {
    const repoA_path = path.join(root, "repoA");
    const repoB_path = path.join(root, "repoB");
    fs.mkdirSync(repoA_path, { recursive: true });
    fs.mkdirSync(repoB_path, { recursive: true });

    const repoA_id = "repoA1234567";
    const repoB_id = "repoB1234567";

    // repoA is bound to client/project; its log carries a task-type job and a
    // legacy job whose id becomes an alias of that task-type.
    const boundJob = Job.create({ title: "Development" }); // job_id used directly as task-type id below
    const legacyJob = Job.create({ title: "Old Style Work" });

    const configA: RepoConfig = {
        repo_id: repoA_id,
        format_version: REPO_CONFIG_FORMAT_VERSION,
        binding: { client_id: "client-1", project_id: "project-1" },
    };
    write_repo_config(workspace_timescope_paths(repoA_path).config_path, configA);

    const logA = workspace_timescope_paths(repoA_path).log_path;
    append_owned_event(logA, ev(boundJob, "start", 1000));
    append_owned_event(logA, ev(boundJob, "stop", 2000));
    append_owned_event(logA, ev(legacyJob, "start", 3000));
    append_owned_event(logA, ev(legacyJob, "stop", 4000));

    // repoB is unbound (no binding) but has a resolvable task-type job.
    const unboundJob = Job.create({ title: "Design Work" });
    const configB: RepoConfig = {
        repo_id: repoB_id,
        format_version: REPO_CONFIG_FORMAT_VERSION,
    };
    write_repo_config(workspace_timescope_paths(repoB_path).config_path, configB);

    const logB = workspace_timescope_paths(repoB_path).log_path;
    append_owned_event(logB, ev(unboundJob, "start", 5000));
    append_owned_event(logB, ev(unboundJob, "stop", 6000));

    // scratch.jsonl: an off-project job with no resolvable task-type at all.
    const scratchJob = Job.create({ title: "Personal Errand" });
    const scratch_path = path.join(root, "scratch.jsonl");
    append_owned_event(scratch_path, ev(scratchJob, "start", 7000));
    append_owned_event(scratch_path, ev(scratchJob, "stop", 8000));

    let registry = Registry.empty()
        .upsert_repo({ id: repoA_id, name: "Repo A", path: repoA_path, last_seen: 1 })
        .upsert_repo({ id: repoB_id, name: "Repo B", path: repoB_path, last_seen: 1 })
        .upsert_client({ id: "client-1", name: "Acme Corp" })
        .upsert_project({ id: "project-1", name: "Website Revamp", client_id: "client-1" })
        .upsert_task_type({ id: boundJob.id, name: "Development" })
        .upsert_task_type({ id: unboundJob.id, name: "Design" });

    // Adopt the legacy job's id as an alias of the "Development" task-type.
    registry = registry.add_task_type_alias(boundJob.id, legacyJob.id);

    // A stray index.jsonl on disk, with DIFFERENT content than any owned source —
    // proves it is never read (and never modified).
    const index_path = path.join(root, "index.jsonl");
    const decoyJob = Job.create({ title: "Decoy Job From Index" });
    fs.writeFileSync(
        index_path,
        JSON.stringify({ _format_version: 2 }) + "\n" + ev(decoyJob, "start", 999).toJSONL() + "\n",
        "utf8"
    );

    return { registry, scratch_path, index_path, repoA_id, repoB_id, boundJob, legacyJob, unboundJob, scratchJob };
}

/**
 * Tests build_attributed_payload — the happy-path hierarchy resolution:
 * - Target: build_attributed_payload in src/dashboard/controller/attribution.ts
 * - What: reads owned sources only (registered repo logs + scratch), tags each event's
 *   source repo, and resolves client/project (from the source repo's binding) and
 *   task_type (from job_id, direct or alias) per event.
 * - Why: this is the payload the webview will group sessions by (#15 hierarchy).
 */
export function run_build_attributed_payload_bound_repo_tests(): void {
    const root = mkdir_tmp("bound");
    const fx = build_fixture(root);

    const payload = build_attributed_payload({
        registry: fx.registry,
        scratch_path: fx.scratch_path,
        current_workspace_repo_id: fx.repoA_id,
    });

    // 8 events total: 4 from repoA, 2 from repoB, 2 from scratch. None from index.jsonl.
    assert.strictEqual(payload.length, 8, "reads only owned sources, not index.jsonl");
    assert.ok(!payload.some(p => p.job === "Decoy Job From Index"), "index.jsonl content never surfaces");

    // Bound repo (repoA), direct task-type id job: client + project + task_type all resolved.
    const boundStart = payload.find(p => p.id === ev(fx.boundJob, "start", 1000).id)!;
    assert.ok(boundStart, "bound job start present");
    assert.strictEqual(boundStart.source_repo_id, fx.repoA_id, "tagged with source repo");
    assert.deepStrictEqual(boundStart.client, { id: "client-1", name: "Acme Corp" }, "client resolved from repo binding");
    assert.deepStrictEqual(boundStart.project, { id: "project-1", name: "Website Revamp" }, "project resolved from repo binding");
    assert.deepStrictEqual(boundStart.task_type, { id: fx.boundJob.id, name: "Development" }, "task_type resolved by direct id");
    assert.strictEqual(boundStart.job, "Development", "flat job title preserved alongside hierarchy fields");

    // Bound repo, legacy job whose id is only an alias: task_type still resolves via alias.
    const legacyStart = payload.find(p => p.id === ev(fx.legacyJob, "start", 3000).id)!;
    assert.ok(legacyStart, "legacy job start present");
    assert.deepStrictEqual(legacyStart.task_type, { id: fx.boundJob.id, name: "Development" }, "task_type resolved via alias");
    assert.deepStrictEqual(legacyStart.client, { id: "client-1", name: "Acme Corp" }, "legacy job in bound repo still gets client");
    assert.strictEqual(legacyStart.job, "Old Style Work", "legacy flat job title preserved");

    console.log("  ✓ build_attributed_payload bound-repo tests passed");
}

/**
 * Tests build_attributed_payload for an unbound repo: task_type resolves (when the
 * job_id matches) but client/project are absent — this is the "task-type alone" case.
 */
export function run_build_attributed_payload_unbound_repo_tests(): void {
    const root = mkdir_tmp("unbound");
    const fx = build_fixture(root);

    const payload = build_attributed_payload({
        registry: fx.registry,
        scratch_path: fx.scratch_path,
        current_workspace_repo_id: fx.repoB_id,
    });

    const unboundStart = payload.find(p => p.id === ev(fx.unboundJob, "start", 5000).id)!;
    assert.ok(unboundStart, "unbound repo job present");
    assert.strictEqual(unboundStart.source_repo_id, fx.repoB_id, "tagged with source repo");
    assert.deepStrictEqual(unboundStart.task_type, { id: fx.unboundJob.id, name: "Design" }, "task_type still resolves without a binding");
    assert.strictEqual(unboundStart.client, undefined, "unbound repo → no client");
    assert.strictEqual(unboundStart.project, undefined, "unbound repo → no project");
    assert.strictEqual(unboundStart.job, "Design Work", "flat job title preserved");

    console.log("  ✓ build_attributed_payload unbound-repo tests passed");
}

/**
 * Tests build_attributed_payload for scratch-sourced events with no resolvable
 * task-type at all — the "Unassigned"-style fallback: no client/project/task_type,
 * flat job title preserved, source_repo_id absent.
 */
export function run_build_attributed_payload_unassigned_tests(): void {
    const root = mkdir_tmp("unassigned");
    const fx = build_fixture(root);

    const payload = build_attributed_payload({
        registry: fx.registry,
        scratch_path: fx.scratch_path,
    });

    const scratchStart = payload.find(p => p.id === ev(fx.scratchJob, "start", 7000).id)!;
    assert.ok(scratchStart, "scratch job present");
    assert.strictEqual(scratchStart.source_repo_id, undefined, "scratch events carry no source_repo_id");
    assert.strictEqual(scratchStart.task_type, undefined, "no resolvable task_type");
    assert.strictEqual(scratchStart.client, undefined, "no client");
    assert.strictEqual(scratchStart.project, undefined, "no project");
    assert.strictEqual(scratchStart.job, "Personal Errand", "flat job title preserved for unassigned fallback");

    console.log("  ✓ build_attributed_payload unassigned (scratch) tests passed");
}

/**
 * Tests dedup-by-id: the same event id appearing in two owned sources lands once.
 */
export function run_build_attributed_payload_dedup_tests(): void {
    const root = mkdir_tmp("dedup");
    const repo_path = path.join(root, "repo");
    fs.mkdirSync(repo_path, { recursive: true });
    const repo_id = "repoDup1234";

    const job = Job.create({ title: "Shared Work" });
    const startEvent = ev(job, "start", 1000);

    const log_path = workspace_timescope_paths(repo_path).log_path;
    append_owned_event(log_path, startEvent);

    const scratch_path = path.join(root, "scratch.jsonl");
    // Same event (same id) also present in scratch — should not be double-counted.
    append_owned_event(scratch_path, startEvent);
    append_owned_event(scratch_path, ev(job, "stop", 2000));

    const registry = Registry.empty().upsert_repo({ id: repo_id, name: "Repo", path: repo_path, last_seen: 1 });

    const payload = build_attributed_payload({ registry, scratch_path });

    assert.strictEqual(payload.length, 2, "duplicate event id across sources counted once");

    console.log("  ✓ build_attributed_payload dedup tests passed");
}

/**
 * Tests that the on-disk index.jsonl is never modified by build_attributed_payload
 * (it must not be read, and certainly must not be written).
 */
export function run_build_attributed_payload_does_not_touch_index_tests(): void {
    const root = mkdir_tmp("no-touch-index");
    const fx = build_fixture(root);

    const before = fs.readFileSync(fx.index_path, "utf8");
    build_attributed_payload({ registry: fx.registry, scratch_path: fx.scratch_path });
    const after = fs.readFileSync(fx.index_path, "utf8");

    assert.strictEqual(after, before, "index.jsonl on disk is untouched");

    console.log("  ✓ build_attributed_payload does-not-touch-index tests passed");
}

export function run_attribution_tests(): void {
    console.log("attribution: build_attributed_payload");
    run_build_attributed_payload_bound_repo_tests();
    run_build_attributed_payload_unbound_repo_tests();
    run_build_attributed_payload_unassigned_tests();
    run_build_attributed_payload_dedup_tests();
    run_build_attributed_payload_does_not_touch_index_tests();
}
