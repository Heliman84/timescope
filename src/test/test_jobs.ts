import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { TimeScopePaths } from "../core/paths";
import { Job } from "../core/job";
import { JobRepository } from "../core/job_repository";

/**
 * Tests JobRepository CRUD:
 * - Target: JobRepository in src/core/job_repository.ts
 * - What: exercises save/load/update/delete with Job domain objects.
 * - Does: writes two jobs, renames one, deletes the other, and reloads to verify persistence semantics.
 * - Why: ensures the repository’s OOP persistence path matches expected identity and mutation rules.
 */
export async function run_job_repository_tests(): Promise<void> {
    const testRoot = path.join(__dirname, "..", "..", "test-output", `jobs-${Date.now()}`);
    fs.mkdirSync(testRoot, { recursive: true });

    const paths: TimeScopePaths = {
        global_jobs_path: path.join(testRoot, "jobs.json"),
        global_log_path: path.join(testRoot, "logs.jsonl"),
    };

    const repo = new JobRepository(paths);

    const jobFoo = Job.create({ title: "foo", created: 1 });
    const jobBar = Job.create({ title: "bar", created: 2 });

    await repo.save(jobFoo);
    await repo.save(jobBar);

    let loaded = await repo.loadAll();
    assert.strictEqual(loaded.size(), 2, "should load two jobs after save");
    assert.ok(loaded.findById(jobFoo.id)?.title === "foo");
    assert.ok(loaded.findById(jobBar.id)?.title === "bar");

    // Update (rename) bar -> baz
    const renamedBar = jobBar.rename("baz");
    await repo.update(renamedBar);

    loaded = await repo.loadAll();
    const reBar = loaded.findById(jobBar.id);
    assert.ok(reBar, "renamed job should still exist by id");
    assert.strictEqual(reBar!.title, "baz", "rename should change title");
    assert.strictEqual(reBar!.id, jobBar.id, "rename should preserve id");

    // Delete foo
    await repo.delete(jobFoo.id);
    loaded = await repo.loadAll();
    assert.strictEqual(loaded.size(), 1, "delete should remove job");
    assert.ok(!loaded.hasId(jobFoo.id), "deleted job id should be absent");

    console.log("✅ job repository tests passed");
}