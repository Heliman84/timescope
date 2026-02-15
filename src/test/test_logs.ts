import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { append_log_record, load_all_logs, rename_job_in_log_file, load_all_log_entries } from "../core/logs";
import { parseLogLine } from "../core/event";
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

/**
 * test_logs_header_and_event_parse
 * Target: `src/core/logs.ts` + `src/core/event.ts`
 * Purpose: Verify that `append_log_record` writes a file-level header (`_format_version`) and
 * that `parseLogLine` correctly ignores header lines while `load_all_log_entries` still
 * returns the appended records. This ensures backward-compatible header handling.
 */
export function run_logs_header_and_event_parse(): void {
    const testRoot = path.join(__dirname, "..", "..", "test-output", `header-${Date.now()}`);
    fs.mkdirSync(testRoot, { recursive: true });

    const globalPath = path.join(testRoot, "logs.jsonl");
    const paths: TimeScopePaths = {
        global_jobs_path: path.join(testRoot, "jobs.json"),
        global_log_path: globalPath,
        workspace_log_path: path.join(testRoot, "ws.jsonl")
    };

    append_log_record(paths, { event: "start", job: "hdr", timestamp: 1111 });

    const raw = fs.readFileSync(globalPath, "utf8");
    const firstLine = raw.split(/\r?\n/)[0];
    const parsed = JSON.parse(firstLine);
    assert.ok(parsed._format_version, "expected header with _format_version");

    const headerResult = parseLogLine(firstLine);
    assert.strictEqual(headerResult, null, "parseLogLine should ignore header lines");

    const entries = load_all_log_entries(paths);
    const rec = entries.find(e => e.record && (e.record as any).job === "hdr");
    assert.ok(rec, "expected to find the appended record despite header");

    console.log("✅ logs header & parse tests passed");
}