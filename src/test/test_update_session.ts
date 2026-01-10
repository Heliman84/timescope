import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { append_log_record, load_all_log_entries, update_log_entry } from "../core/logs";
import { TimeScopePaths } from "../core/paths";
import { LogRecord } from "../core/types";

export function run_update_session_tests(): void {
    const testRoot = path.join(__dirname, "..", "..", "test-output", `updatesession-${Date.now()}`);
    fs.mkdirSync(testRoot, { recursive: true });

    const paths: TimeScopePaths = {
        global_jobs_path: path.join(testRoot, "jobs.json"),
        global_log_path: path.join(testRoot, "logs.jsonl"),
        workspace_log_path: path.join(testRoot, "ws_logs.jsonl")
    };

    // Create session with start, pause, resume, stop
    append_log_record(paths, { event: "start", job: "sess", timestamp: 1000 });
    append_log_record(paths, { event: "pause", job: "sess", timestamp: 1500 });
    append_log_record(paths, { event: "resume", job: "sess", timestamp: 2000 });
    append_log_record(paths, { event: "stop", job: "sess", timestamp: 3000, task: "work" });

    // Update start and stop
    const entries = load_all_log_entries(paths);
    const startEnt = entries.find(e => e.record.event === 'start' && e.record.job === 'sess')!;
    const stopEnt = entries.find(e => e.record.event === 'stop' && e.record.job === 'sess')!;

    const res1 = update_log_entry(paths, startEnt.raw, { event: 'start', job: 'sess', timestamp: 800 });
    const res2 = update_log_entry(paths, stopEnt.raw, { event: 'stop', job: 'sess', timestamp: 2500, task: 'work' });

    if (res1.errors && res1.errors.length) throw new Error('res1 errors: ' + res1.errors.join(','));
    if (res2.errors && res2.errors.length) throw new Error('res2 errors: ' + res2.errors.join(','));

    const updated = load_all_log_entries(paths).filter(e => e.record.job === 'sess');
    const startUpdated = updated.find(e => e.record.event === 'start' && e.record.timestamp === 800);
    const stopUpdated = updated.find(e => e.record.event === 'stop' && e.record.timestamp === 2500);

    assert.ok(startUpdated, 'start should be updated');
    assert.ok(stopUpdated, 'stop should be updated');

    console.log('✅ update session tests passed');
}