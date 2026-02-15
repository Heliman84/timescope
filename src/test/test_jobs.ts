import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { add_job, load_all_jobs, rename_job, delete_job } from "../core/jobs";
import { TimeScopePaths } from "../core/paths";

/**
 * test_jobs_crud
 * Target: `src/core/jobs.ts`
 * Purpose: Ensure job management API (`add_job`, `rename_job`, `delete_job`, `load_all_jobs`)
 * behaves correctly for basic CRUD operations used throughout the extension.
 */
export function run_jobs_tests(): void {
    const testRoot = path.join(__dirname, "..", "..", "test-output", `jobs-${Date.now()}`);
    fs.mkdirSync(testRoot, { recursive: true });

    const paths: TimeScopePaths = {
        global_jobs_path: path.join(testRoot, "jobs.json"),
        global_log_path: path.join(testRoot, "logs.jsonl")
    };

    add_job(paths, "foo");
    add_job(paths, "bar");

    let jobs = load_all_jobs(paths);
    assert.ok(jobs.includes("foo"));
    assert.ok(jobs.includes("bar"));

    rename_job(paths, "bar", "baz");
    jobs = load_all_jobs(paths);
    assert.ok(jobs.includes("baz"));
    assert.ok(!jobs.includes("bar"));

    delete_job(paths, "foo");
    jobs = load_all_jobs(paths);
    assert.ok(!jobs.includes("foo"));

    console.log("✅ jobs tests passed");
}