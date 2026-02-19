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
 * Tests for appendValidated guardrails (no overlapping sessions, valid transitions).
 */
export function run_event_repository_validation_tests(): void {
    const testRoot = path.join(__dirname, "..", "..", "test-output", `event-validated-${Date.now()}`);
    fs.mkdirSync(testRoot, { recursive: true });

    const paths: TimeScopePaths = {
        global_jobs_path: path.join(testRoot, "jobs.json"),
        global_log_path: path.join(testRoot, "logs.jsonl"),
    };

    const repo = new EventRepository(paths);
    const job = Job.create({ title: "alpha" });

    // Valid start then stop
    repo.appendValidated(ev("start", job, 100));
    repo.appendValidated(ev("stop", job, 200));

    // New session after stop is allowed
    repo.appendValidated(ev("start", job, 300));

    // A second start without closing should throw
    assert.throws(() => repo.appendValidated(ev("start", job, 400)), /Cannot start a new session/);

    // Close the second session
    repo.appendValidated(ev("stop", job, 500));

    // Validate sessions reconstructed correctly
    const sessions = repo.loadSessions("global");
    assert.strictEqual(sessions.length, 2, "should have two sessions reconstructed");
    assert.ok(sessions.every(s => s.stopEvent), "all sessions should be closed");

    console.log("✅ event repository validation tests passed");
}