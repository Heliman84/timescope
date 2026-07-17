/**
 * Seed realistic test data into the isolated F5 test-workspace so an Extension
 * Development Host has jobs and weeks of sessions to display.
 *
 * Writes TWO stores:
 *   - global    → test-workspace/global-storage/{jobs.json,logs.jsonl}
 *   - workspace → test-workspace/.timescope/{jobs.json,logs.jsonl}
 *
 * The workspace log deliberately re-emits the last week of global events with
 * their EXACT SAME IDs (record IDs are deterministic: f(timestamp, type, job.id)),
 * plus a few workspace-only events under a "Local Client" job. This exercises
 * the extension's cross-file merge — loadAllEntries dedupes by event ID, so the
 * duplicates must collapse (totals unchanged) while the unique events/job surface
 * once in the summary.
 *
 * Timestamps are generated relative to NOW so the dashboard's presets
 * (Today / This Week / This Month) always have data — static seed files
 * would age out of range.
 *
 * Uses the compiled domain classes (out/core) so record IDs, field order,
 * and the v2 format header are exactly what the extension reads.
 *
 * Usage: npm run seed-testdata   (compiles first, then runs this)
 * Overwrites {jobs.json,logs.jsonl} in both stores only.
 */

const fs = require("fs");
const path = require("path");

const { Job } = require("../out/core/job");
const { Event } = require("../out/core/event");

const GLOBAL_DIR = path.resolve(__dirname, "..", "test-workspace", "global-storage");
const WORKSPACE_DIR = path.resolve(__dirname, "..", "test-workspace", ".timescope");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function at(dayOffset, hours, minutes) {
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    d.setHours(hours, minutes, 0, 0);
    return d.getTime();
}

function is_weekend(dayOffset) {
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    return d.getDay() === 0 || d.getDay() === 6;
}

// Build a start[/pause/resume]/stop session into the given events array.
function push_session(events, job, dayOffset, startH, startM, stopH, stopM, task, withPause) {
    events.push(Event.create(job, "start", at(dayOffset, startH, startM)));
    if (withPause) {
        events.push(Event.create(job, "pause", at(dayOffset, startH + 1, 15)));
        events.push(Event.create(job, "resume", at(dayOffset, startH + 1, 30)));
    }
    events.push(Event.create(job, "stop", at(dayOffset, stopH, stopM), task));
}

// Write a {jobs.json, logs.jsonl} store, matching the exact on-disk format the
// extension reads (canonical DTO fields, v2 header, one JSONL event per line).
function write_store(dir, jobList, events) {
    fs.mkdirSync(dir, { recursive: true });

    const jobDTOs = jobList.map((j) => ({
        job_id: j.id,
        job_title: j.title,
        created: j.createdAt,
        job_seed: j.seed,
    }));
    fs.writeFileSync(path.join(dir, "jobs.json"), JSON.stringify(jobDTOs, null, 2) + "\n");

    const sorted = events.slice().sort((a, b) => a.timestamp - b.timestamp);
    const lines = [JSON.stringify({ _format_version: 2 }), ...sorted.map((e) => e.toJSONL())];
    fs.writeFileSync(path.join(dir, "logs.jsonl"), lines.join("\n") + "\n");

    return { jobs: jobDTOs.length, events: sorted.length };
}

function main() {
    const jobs = {
        client_a: Job.create({ title: "Client A", created: at(35, 8, 0) }),
        client_b: Job.create({ title: "Client B", created: at(30, 8, 0) }),
        internal: Job.create({ title: "Internal", created: at(28, 8, 0) }),
    };

    // ── Global store: ~4 weeks of weekday history, newest day = today ──
    const globalEvents = [];
    for (let day = 27; day >= 0; day--) {
        if (is_weekend(day)) continue;
        push_session(globalEvents, jobs.client_a, day, 9, 0, 11, 30, "design review", day % 2 === 0);
        if (day % 3 !== 0) {
            push_session(globalEvents, jobs.client_b, day, 13, 0, 15, 45, "site inspection notes", false);
        }
        if (day % 5 === 0) {
            push_session(globalEvents, jobs.internal, day, 16, 0, 17, 0, "invoicing + admin", false);
        }
    }

    const global = write_store(GLOBAL_DIR, Object.values(jobs), globalEvents);

    // ── Workspace store: cross-file dedup/merge fixture ──
    // Duplicates: the last week of global events, re-emitted with identical IDs
    // (record IDs are deterministic) → loadAllEntries must collapse them.
    const cutoff = Date.now() - WEEK_MS;
    const duplicates = globalEvents.filter((e) => e.timestamp >= cutoff);

    // Unique: a workspace-only "Local Client" job + a novel-time Client A session,
    // none of which exists in the global log (distinct job.id or timestamp → fresh IDs).
    const localClient = Job.create({ title: "Local Client", created: at(6, 8, 0) });
    const uniqueEvents = [];
    push_session(uniqueEvents, localClient, 1, 10, 0, 12, 0, "workspace-only meeting", false);
    push_session(uniqueEvents, jobs.client_a, 1, 19, 0, 20, 30, "after-hours workspace note", false);

    const workspaceJobs = [...Object.values(jobs), localClient];
    const workspaceEvents = [...duplicates, ...uniqueEvents];
    const workspace = write_store(WORKSPACE_DIR, workspaceJobs, workspaceEvents);

    console.log(`Global    → ${global.jobs} jobs, ${global.events} events  (${GLOBAL_DIR})`);
    console.log(`Workspace → ${workspace.jobs} jobs, ${workspace.events} events  (${WORKSPACE_DIR})`);
    console.log(`            ${duplicates.length} duplicate the last week of global (dedup on merge), ${uniqueEvents.length} unique.`);
    console.log("Press F5 — totals should be unchanged by the duplicates; the 'Local Client' job and the unique sessions appear once.");
}

main();
