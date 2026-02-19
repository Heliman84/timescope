import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { TimeScopePaths } from "../core/paths";
import { Event } from "../core/event";
import { EventRepository } from "../core/event_repository";
import { Job } from "../core/job";

function ev(type: "start" | "stop" | "pause" | "resume", job: Job, ts: number, task?: string): Event {
    return Event.create(job, type, ts, task);
}

/**
 * Ensures renameJobInLogByJob rewrites titles while preserving job_id.
 */
export function run_rename_roundtrip_test(): void {
    const testRoot = path.join(__dirname, "..", "..", "test-output", `rename-${Date.now()}`);
    fs.mkdirSync(testRoot, { recursive: true });

    const paths: TimeScopePaths = {
        global_jobs_path: path.join(testRoot, "jobs.json"),
        global_log_path: path.join(testRoot, "logs-global.jsonl"),
        workspace_log_path: path.join(testRoot, "logs-ws.jsonl"),
    };

    const repo = new EventRepository(paths);
    const jobAlpha = Job.create({ title: "alpha" });
    const jobBeta = Job.create({ title: "beta" });

    repo.appendEvent(ev("start", jobAlpha, 100));
    repo.appendEvent(ev("pause", jobAlpha, 200));
    repo.appendEvent(ev("stop", jobAlpha, 300, "done"));
    repo.appendEvent(ev("start", jobBeta, 400));
    repo.appendEvent(ev("stop", jobBeta, 500));

    // Pre-rename assertions
    let raw = fs.readFileSync(paths.global_log_path, "utf8");
    let parsed = raw.split(/\r?\n/).filter(l => l.trim()).slice(1).map(l => JSON.parse(l));
    assert.ok(parsed.some(p => p.job === "alpha"), "alpha should appear before rename");

    const renamed = jobAlpha.rename("gamma");
    repo.renameJobInLogByJob(renamed);

    raw = fs.readFileSync(paths.global_log_path, "utf8");
    parsed = raw.split(/\r?\n/).filter(l => l.trim()).slice(1).map(l => JSON.parse(l));

    // alpha titles should be gone, replaced by gamma while keeping job_id
    assert.ok(parsed.every(p => p.job !== "alpha"), "no record should retain title alpha");
    assert.ok(parsed.filter(p => p.job_id === jobAlpha.id).every(p => p.job === "gamma"), "records with alpha id should be renamed to gamma");
    assert.ok(parsed.filter(p => p.job_id === jobBeta.id).every(p => p.job === "beta"), "other jobs remain untouched");

    console.log("✅ rename roundtrip test passed");
}