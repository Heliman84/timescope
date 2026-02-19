import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { TimeScopePaths } from "../core/paths";
import { Event } from "../core/event";
import { EventRepository } from "../core/event_repository";
import { Job } from "../core/job";

/** Helper: create an Event with a Job domain object. */
function ev(type: "start" | "stop" | "pause" | "resume", job: Job, ts: number, task?: string): Event {
    return Event.create(job, type, ts, task);
}

/**
 * Basic append/load tests for EventRepository.
 * - Writes events (global log).
 * - Verifies header presence and EventCollection filtering.
 * - Validates session reconstruction for a single start/stop pair.
 */
export function run_event_repository_basic_tests(): void {
    const testRoot = path.join(__dirname, "..", "..", "test-output", `event-repo-${Date.now()}`);
    fs.mkdirSync(testRoot, { recursive: true });

    const paths: TimeScopePaths = {
        global_jobs_path: path.join(testRoot, "jobs.json"),
        global_log_path: path.join(testRoot, "logs.jsonl"),
        workspace_log_path: path.join(testRoot, "ws-logs.jsonl"),
    };

    const repo = new EventRepository(paths);
    const jobA = Job.create({ title: "alpha" });
    const jobB = Job.create({ title: "beta" });

    repo.appendEvent(ev("start", jobA, 100));
    repo.appendEvent(ev("stop", jobA, 200));
    repo.appendEvent(ev("start", jobB, 300));

    const raw = fs.readFileSync(paths.global_log_path, "utf8");
    const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
    assert.ok(lines[0].includes("_format_version"), "first line should be header");

    const colA = repo.loadEventCollectionForJob(jobA);
    assert.strictEqual(colA.toEvents().length, 2, "jobA should have two events");
    const sessions = repo.loadSessions("global");
    assert.strictEqual(sessions.length, 1, "should reconstruct one session for jobA");
    assert.ok(sessions[0].stopEvent, "session should have stop event");

    console.log("✅ event repository basic tests passed");
}

/**
 * Rename tests for EventRepository.renameJobInLogByJob.
 * Ensures titles change while job_id remains stable across global/workspace logs.
 */
export function run_event_repository_rename_tests(): void {
    const testRoot = path.join(__dirname, "..", "..", "test-output", `event-repo-rename-${Date.now()}`);
    fs.mkdirSync(testRoot, { recursive: true });

    const paths: TimeScopePaths = {
        global_jobs_path: path.join(testRoot, "jobs.json"),
        global_log_path: path.join(testRoot, "logs.jsonl"),
        workspace_log_path: path.join(testRoot, "ws-logs.jsonl"),
    };

    const repo = new EventRepository(paths);
    const jobAlpha = Job.create({ title: "alpha" });
    const jobBeta = Job.create({ title: "beta" });

    repo.appendEvent(ev("start", jobAlpha, 10));
    repo.appendEvent(ev("stop", jobAlpha, 20));
    repo.appendEvent(ev("start", jobBeta, 30));
    repo.appendEvent(ev("stop", jobBeta, 40));

    // Pre-rename assertions
    let raw = fs.readFileSync(paths.global_log_path, "utf8");
    let parsed = raw.split(/\r?\n/).filter(l => l.trim()).slice(1).map(l => JSON.parse(l));
    assert.ok(parsed.some(p => p.job === "alpha"), "before rename, alpha should exist");

    const renamed = jobAlpha.rename("gamma");
    repo.renameJobInLogByJob(renamed);

    raw = fs.readFileSync(paths.global_log_path, "utf8");
    parsed = raw.split(/\r?\n/).filter(l => l.trim()).slice(1).map(l => JSON.parse(l));

    // All records with the original id should now have the new title
    assert.ok(parsed.filter(p => p.job_id === jobAlpha.id).every(p => p.job === "gamma"), "records with alpha id should be retitled to gamma");
    // Records for other jobs remain untouched
    assert.ok(parsed.filter(p => p.job_id === jobBeta.id).every(p => p.job === "beta"), "beta records should remain beta");

    console.log("✅ event repository rename tests passed");
}