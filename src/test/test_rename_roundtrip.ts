import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { append_log_record, rename_job_in_log_file } from "../core/logs";
import { TimeScopePaths } from "../core/paths";
import { Event, EventCollection } from "../core/event";
import { Job } from "../core/job";

/** Helper: create an Event from a job title string using the new Job-centric API. */
function ev(type: "start"|"stop"|"pause"|"resume", jobTitle: string, timestamp: number, task?: string): Event {
    const job = Job.create({ title: jobTitle });
    return Event.create(job, type, timestamp, task);
}

/**
 * test_rename_roundtrip
 * Target: `src/core/logs.ts` + `src/core/event.ts`
 * Purpose: Verify that `rename_job_in_log_file` rewrites log files correctly and
 * that the round-tripped file matches the expected serialized output (including header).
 */
export function run_rename_roundtrip_test(): void {
    const testRoot = path.join(__dirname, "..", "..", "test-output", `rename-${Date.now()}`);
    fs.mkdirSync(testRoot, { recursive: true });

    const globalPath = path.join(testRoot, "logs-global.jsonl");

    const paths: TimeScopePaths = {
        global_jobs_path: path.join(testRoot, "jobs.json"),
        global_log_path: globalPath
    };

    const recs: Event[] = [
        ev("start", "alpha", 100),
        ev("pause", "alpha", 200),
        ev("stop", "alpha", 300, "done"),
        ev("start", "beta", 400),
        ev("stop", "beta", 500)
    ];

    for (const r of recs) append_log_record(paths, r);

    // Rename alpha -> gamma
    rename_job_in_log_file(paths, "alpha", "gamma");

    const raw = fs.readFileSync(globalPath, "utf8");
    const lines = raw.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    // Expected: same records but alpha -> gamma
    const expectedEvents = recs.map(r => (r.job === "alpha" ? r.withJob("gamma") : r));
    const expectedLines = EventCollection.fromArray(expectedEvents).toLines();
    // files now include a file-level header as the first line
    const headerLine = JSON.stringify({ _format_version: 2 });
    expectedLines.unshift(headerLine);

    assert.strictEqual(lines.length, expectedLines.length, "line count should match expected");
    for (let i = 0; i < lines.length; i++) {
        assert.strictEqual(lines[i], expectedLines[i], `line ${i} should match expected`);
    }

    console.log("✅ rename roundtrip test passed");
}
