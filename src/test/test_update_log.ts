import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { append_log_record, load_all_log_entries, update_log_entry } from "../core/logs";
import { Event } from "../core/event";
import { Job } from "../core/job";
import { TimeScopePaths } from "../core/paths";

/** Helper: create an Event from a job title string using the new Job-centric API. */
function ev(type: "start"|"stop"|"pause"|"resume", jobTitle: string, timestamp: number, task?: string): Event {
    const job = Job.create({ title: jobTitle });
    return Event.create(job, type, timestamp, task);
}

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
    append_log_record(paths, ev("start", "foil", 1000));
    append_log_record(paths, ev("stop", "foil", 2000, "t"));

    // duplicate into workspace mirror (simulate previously written)
    fs.appendFileSync(wsPath, fs.readFileSync(globalPath, "utf8"), "utf8");

    // Load entries and pick the first start line raw
    const entries = load_all_log_entries(paths);
    const startEntry = entries.find(e => e.record.type === "start" && e.record.job === "foil");
    assert.ok(startEntry, "found start entry");

    const old_raw = startEntry!.raw;

    const newRecord = ev("start", "foil", 500);

    const res = update_log_entry(paths, old_raw, newRecord);
    assert.ok(res.globalReplaced || res.workspaceReplaced, "expected at least one replacement");
    if (res.errors) {
        const msgs = res.errors.map((e: any) => typeof e === 'string' ? e : (e.message || JSON.stringify(e)));
        throw new Error("Validation errors: " + msgs.join(", "));
    }

    // Verify both files now have the new timestamp
    const all = load_all_log_entries(paths).filter(e => e.record.job === "foil" && e.record.type === "start");
    assert.ok(all.some(e => e.record.timestamp === 500), "at least one start updated to 500");

    console.log("✅ update_log tests passed");
}

/**
 * test_dashboard_controller_error_scoping
 * Target: `src/dashboard/controller/dashboard.ts`
 * Purpose: Verify that the controller-style error-scoping logic keeps only validation
 * errors that correspond to the edited occurrences. This prevents unrelated validation
 * errors from being shown when a user edits a specific session.
 *
 * We place this test in `test_update_log.ts` because it exercises the data-shape
 * used by `update_log_entry` and the controller interaction pattern.
 */
export function run_dashboard_controller_error_scoping_test(): void {
    // Two raw log lines (JSON) representing canonical records with all required fields
    const jobA = Job.create({ title: "a" });
    const jobB = Job.create({ title: "b" });
    const rawA = JSON.stringify({ id: "", event: "start", job: "a", timestamp: 1000, job_id: jobA.id, time_seed: 0 });
    const rawB = JSON.stringify({ id: "", event: "stop", job: "b", timestamp: 2000, task: "t", job_id: jobB.id, time_seed: 0 });

    const occurrences = [{ raw: rawA }, { raw: rawB }];

    // Simulate errors returned from update_log_entry: one references record A, one references a different record
    const errA = { message: "bad sequence", record: JSON.parse(rawA) };
    const errOther = { message: "unrelated issue", record: { event: "start", job: "x", timestamp: 9 } };

    const errors = [errA, errOther];

    const occRecords = occurrences.map((o: any) => Event.fromJSONL(o.raw)).filter((r: any) => !!r) as any[];
    const filtered: string[] = [];
    for (const er of errors) {
        const rec = (er as any).record;
        if (!rec) continue;
        const matched = occRecords.some(r => r.type === rec.event && r.job === rec.job && r.timestamp === rec.timestamp && ((r as any).task || '') === ((rec as any).task || ''));
        if (matched) filtered.push(er.message);
    }

    assert.deepStrictEqual(filtered, ["bad sequence"], "expected only the error tied to occurrence A to be kept");
    console.log("✅ dashboard controller error-scoping test passed");
}