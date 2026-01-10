import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { append_log_record, load_all_log_entries, update_log_entry } from "../core/logs";
import { TimeScopePaths } from "../core/paths";
import { LogRecord } from "../core/types";

export function run_update_log_tests(): void {
    const testRoot = path.join(__dirname, "..", "..", "test-output", `update-${Date.now()}`);
    fs.mkdirSync(testRoot, { recursive: true });

    const globalPath = path.join(testRoot, "logs-global.jsonl");
    const wsPath = path.join(testRoot, "logs-ws.jsonl");

    const paths: TimeScopePaths = {
        global_jobs_path: path.join(testRoot, "jobs.json"),
        global_log_path: globalPath,
        workspace_log_path: wsPath
    };

    // create matching records in both files
    append_log_record(paths, { event: "start", job: "foil", timestamp: 1000 });
    append_log_record(paths, { event: "stop", job: "foil", timestamp: 2000, task: "t" });

    // duplicate into workspace mirror (simulate previously written)
    fs.appendFileSync(wsPath, fs.readFileSync(globalPath, "utf8"), "utf8");

    // Load entries and pick the first start line raw
    const entries = load_all_log_entries(paths);
    const startEntry = entries.find(e => e.record.event === "start" && e.record.job === "foil");
    assert.ok(startEntry, "found start entry");

    const old_raw = startEntry!.raw;

    const newRecord: LogRecord = { event: "start", job: "foil", timestamp: 500 };

    const res = update_log_entry(paths, old_raw, newRecord);
    assert.ok(res.globalReplaced || res.workspaceReplaced, "expected at least one replacement");
    if (res.errors) {
        throw new Error("Validation errors: " + res.errors.join(", "));
    }

    // Verify both files now have the new timestamp
    const all = load_all_log_entries(paths).filter(e => e.record.job === "foil" && e.record.event === "start");
    assert.ok(all.some(e => e.record.timestamp === 500), "at least one start updated to 500");

    console.log("✅ update_log tests passed");
}