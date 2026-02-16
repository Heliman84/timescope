import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { append_log_record, load_all_log_entries, update_log_entry } from "../core/logs";
import { Event } from "../core/event";
import { TimeScopePaths } from "../core/paths";

/**
 * test_update_session_flow
 * Target: `src/core/logs.ts` + session mutation helpers
 * Purpose: Verify editing session boundaries (start/pause/resume/stop) updates
 * timestamps correctly and that validation errors are not produced for valid edits.
 */
export function run_update_session_tests(): void {
    const testRoot = path.join(__dirname, "..", "..", "test-output", `updatesession-${Date.now()}`);
    fs.mkdirSync(testRoot, { recursive: true });

    const paths: TimeScopePaths = {
        global_jobs_path: path.join(testRoot, "jobs.json"),
        global_log_path: path.join(testRoot, "logs.jsonl"),
        workspace_log_path: path.join(testRoot, "ws_logs.jsonl")
    };

    // Create session with start, pause, resume, stop
    append_log_record(paths, Event.create({ event: "start", job: "sess", timestamp: 1000 }));
    append_log_record(paths, Event.create({ event: "pause", job: "sess", timestamp: 1500 }));
    append_log_record(paths, Event.create({ event: "resume", job: "sess", timestamp: 2000 }));
    append_log_record(paths, Event.create({ event: "stop", job: "sess", timestamp: 3000, task: "work" }));

    // Update start and stop
    const entries = load_all_log_entries(paths);
    const startEnt = entries.find(e => e.record.type === 'start' && e.record.job === 'sess')!;
    const stopEnt = entries.find(e => e.record.type === 'stop' && e.record.job === 'sess')!;
    const res1 = update_log_entry(paths, startEnt.raw, Event.create({ event: 'start', job: 'sess', timestamp: 800 }));
    const res2 = update_log_entry(paths, stopEnt.raw, Event.create({ event: 'stop', job: 'sess', timestamp: 2500, task: 'work' }));

    if (res1.errors && res1.errors.length) {
        const msgs = res1.errors.map((e: any) => typeof e === 'string' ? e : (e.message || JSON.stringify(e)));
        throw new Error('res1 errors: ' + msgs.join(','));
    }
    if (res2.errors && res2.errors.length) {
        const msgs = res2.errors.map((e: any) => typeof e === 'string' ? e : (e.message || JSON.stringify(e)));
        throw new Error('res2 errors: ' + msgs.join(','));
    }

    const updated = load_all_log_entries(paths).filter(e => e.record.job === 'sess');
    const startUpdated = updated.find(e => e.record.type === 'start' && e.record.timestamp === 800);
    const stopUpdated = updated.find(e => e.record.type === 'stop' && e.record.timestamp === 2500);

    assert.ok(startUpdated, 'start should be updated');
    assert.ok(stopUpdated, 'stop should be updated');

    console.log('✅ update session tests passed');
}