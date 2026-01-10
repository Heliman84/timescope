import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { append_log_record, load_all_logs, rename_job_in_log_file } from "../core/logs";
import { TimeScopePaths } from "../core/paths";

export function run_logs_tests(): void {
    const testRoot = path.join(__dirname, "..", "..", "test-output", `logs-${Date.now()}`);
    fs.mkdirSync(testRoot, { recursive: true });

    const paths: TimeScopePaths = {
        global_jobs_path: path.join(testRoot, "jobs.json"),
        global_log_path: path.join(testRoot, "logs.jsonl")
    };

    // Write some records
    append_log_record(paths, { event: "start", job: "alpha", timestamp: 100 });
    append_log_record(paths, { event: "pause", job: "alpha", timestamp: 200 });
    append_log_record(paths, { event: "stop", job: "alpha", timestamp: 300, task: "done" });

    const loaded = load_all_logs(paths);
    assert.strictEqual(loaded.length, 3, "expected three log records");
    assert.strictEqual(loaded[0].event, "start");
    assert.strictEqual(loaded[2].event, "stop");
    assert.strictEqual((loaded[2] as any).task, "done");

    // Rename the job inside the log file and verify
    rename_job_in_log_file(paths, "alpha", "beta");
    const renamed = load_all_logs(paths);
    assert.strictEqual(renamed.every(r => r.job === "beta"), true, "all jobs should be renamed to 'beta'");

    console.log("✅ logs tests passed");
}