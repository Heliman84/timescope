import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { Job } from "../core/job";
import { Event } from "../core/event";
import { read_repo_config, write_repo_config } from "../core/repo_config";
import { derive_repo_jobs, ensure_repo_jobs_cache } from "../core/repo_jobs";

function mkdir_tmp(suffix: string): string {
    const root = path.join(__dirname, "..", "..", "test-output", `repo-jobs-${suffix}-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    return root;
}

function write_log(dir: string, events: Event[]): string {
    const p = path.join(dir, "logs.jsonl");
    const header = JSON.stringify({ _format_version: 2 });
    fs.writeFileSync(p, [header, ...events.map(e => e.toJSONL())].join("\n") + "\n", "utf8");
    return p;
}

/**
 * Tests deriving a repo's jobs from its owned log (US-06):
 * - Target: derive_repo_jobs in src/core/repo_jobs.ts
 * - What: unique job_id → most-recent title (a rename in the log is reflected).
 */
export function run_derive_repo_jobs_tests(): void {
    const root = mkdir_tmp("derive");
    const jobA = Job.create({ title: "Lantern - EE CAD" });
    const jobB = Job.create({ title: "Admin - Invoicing" });
    const jobA2 = jobA.rename("Lantern - EE CAD rev2"); // same job_id, newer title

    const log = write_log(root, [
        Event.create(jobA, "start", 100),
        Event.create(jobA, "stop", 200),
        Event.create(jobB, "start", 300),
        Event.create(jobB, "stop", 400),
        Event.create(jobA2, "start", 500), // rename appears later
        Event.create(jobA2, "stop", 600),
    ]);

    const jobs = derive_repo_jobs(log);
    assert.strictEqual(jobs.length, 2, "two distinct jobs derived");
    const a = jobs.find(j => j.job_id === jobA.id)!;
    assert.ok(a, "jobA present by id");
    assert.strictEqual(a.job_title, "Lantern - EE CAD rev2", "most-recent title wins after rename");
    assert.ok(jobs.find(j => j.job_id === jobB.id), "jobB present");

    // Missing / absent log → empty.
    assert.strictEqual(derive_repo_jobs(path.join(root, "nope.jsonl")).length, 0, "absent log → no jobs");
    assert.strictEqual(derive_repo_jobs(undefined).length, 0, "undefined log → no jobs");
}

/**
 * Tests the config.json job-cache auto-upgrade (US-06):
 * - Target: ensure_repo_jobs_cache in src/core/repo_jobs.ts
 * - What: a repo log with no config gets a config.json + cached jobs (+ minted repo_id);
 *   the write is idempotent (no churn); a new job in the log updates the cache; an existing
 *   repo_id is preserved.
 */
export function run_ensure_repo_jobs_cache_tests(): void {
    const root = mkdir_tmp("cache");
    const jobA = Job.create({ title: "Lantern - EE CAD" });
    const log = write_log(root, [Event.create(jobA, "start", 100), Event.create(jobA, "stop", 200)]);
    const config_path = path.join(root, "config.json");

    // Legacy repo (log, no config) → auto-upgrade: config created with jobs + a repo_id.
    assert.strictEqual(read_repo_config(config_path), null, "no config yet");
    const cached = ensure_repo_jobs_cache(config_path, log);
    assert.strictEqual(cached.length, 1, "one job cached");
    const cfg = read_repo_config(config_path)!;
    assert.ok(/^[0-9a-f]{12}$/.test(cfg.repo_id), "repo_id minted");
    assert.strictEqual(cfg.format_version, 2, "config upgraded to v2");
    assert.strictEqual(cfg.jobs!.length, 1, "job persisted to config.json");
    assert.strictEqual(cfg.jobs![0].job_title, "Lantern - EE CAD", "job title cached");

    // Idempotent: same log → no rewrite (config.json is committed; avoid churn).
    const mtime_before = fs.statSync(config_path).mtimeMs;
    ensure_repo_jobs_cache(config_path, log);
    assert.strictEqual(fs.statSync(config_path).mtimeMs, mtime_before, "unchanged job set must not rewrite config.json");

    // A new job in the log updates the cache, preserving the existing repo_id.
    const jobB = Job.create({ title: "Admin - Invoicing" });
    fs.appendFileSync(log, Event.create(jobB, "start", 300).toJSONL() + "\n", "utf8");
    const updated = ensure_repo_jobs_cache(config_path, log);
    assert.strictEqual(updated.length, 2, "cache grows to include the new job");
    const cfg2 = read_repo_config(config_path)!;
    assert.strictEqual(cfg2.repo_id, cfg.repo_id, "repo_id preserved across cache update");
    assert.strictEqual(cfg2.jobs!.length, 2, "config.json now caches both jobs");
}

/**
 * Regression (#15): the US-06 job-cache rewrite must preserve the repo's Client/Project
 * binding and pinned task-types. Before the fix, `ensure_repo_jobs_cache` wrote a fresh
 * `{repo_id, format_version, jobs}` object, clobbering the binding a run after a new
 * session changed the derived job set — so Start re-prompted for the binding every time.
 */
export function run_repo_jobs_cache_preserves_binding_tests(): void {
    const root = mkdir_tmp("preserve");
    const jobA = Job.create({ title: "Lantern - EE CAD" });
    const log = write_log(root, [Event.create(jobA, "start", 100), Event.create(jobA, "stop", 200)]);
    const config_path = path.join(root, "config.json");

    // Opt-in + bind, as the Start flow does: config carries a binding + pinned task-types.
    ensure_repo_jobs_cache(config_path, log);
    const bound = read_repo_config(config_path)!;
    write_repo_config(config_path, {
        ...bound,
        binding: { client_id: "cli1", project_id: "prj1" },
        pinned_task_types: ["tt1", "tt2"],
    });

    // A later session adds a job → cache rewrites. Binding + pins must survive.
    const jobB = Job.create({ title: "Admin - Invoicing" });
    fs.appendFileSync(log, Event.create(jobB, "start", 300).toJSONL() + "\n", "utf8");
    ensure_repo_jobs_cache(config_path, log);

    const after = read_repo_config(config_path)!;
    assert.deepStrictEqual(after.binding, { client_id: "cli1", project_id: "prj1" }, "binding survives cache rewrite");
    assert.deepStrictEqual(after.pinned_task_types, ["tt1", "tt2"], "pinned task-types survive cache rewrite");
    assert.strictEqual(after.jobs!.length, 2, "cache still updated to both jobs");
    assert.strictEqual(after.repo_id, bound.repo_id, "repo_id preserved");
}
