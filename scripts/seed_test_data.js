/**
 * Seed realistic test data into test-workspace/global-storage/ so an F5
 * Extension Development Host has jobs and weeks of sessions to display.
 *
 * Timestamps are generated relative to NOW so the dashboard's presets
 * (Today / This Week / This Month) always have data — static seed files
 * would age out of range.
 *
 * Uses the compiled domain classes (out/core) so record IDs, field order,
 * and the v2 format header are exactly what the extension reads.
 *
 * Usage: npm run seed-testdata   (compiles first, then runs this)
 * Overwrites test-workspace/global-storage/{jobs.json,logs.jsonl} only.
 */

const fs = require("fs");
const path = require("path");

const { Job } = require("../out/core/job");
const { Event } = require("../out/core/event");

const TARGET_DIR = path.resolve(__dirname, "..", "test-workspace", "global-storage");

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

function main() {
    const jobs = {
        client_a: Job.create({ title: "Client A", created: at(35, 8, 0) }),
        client_b: Job.create({ title: "Client B", created: at(30, 8, 0) }),
        internal: Job.create({ title: "Internal", created: at(28, 8, 0) }),
    };

    const events = [];
    const session = (job, dayOffset, startH, startM, stopH, stopM, task, withPause) => {
        events.push(Event.create(job, "start", at(dayOffset, startH, startM)));
        if (withPause) {
            events.push(Event.create(job, "pause", at(dayOffset, startH + 1, 15)));
            events.push(Event.create(job, "resume", at(dayOffset, startH + 1, 30)));
        }
        events.push(Event.create(job, "stop", at(dayOffset, stopH, stopM), task));
    };

    // ~4 weeks of weekday history, newest day = today
    for (let day = 27; day >= 0; day--) {
        if (is_weekend(day)) continue;
        session(jobs.client_a, day, 9, 0, 11, 30, "design review", day % 2 === 0);
        if (day % 3 !== 0) {
            session(jobs.client_b, day, 13, 0, 15, 45, "site inspection notes", false);
        }
        if (day % 5 === 0) {
            session(jobs.internal, day, 16, 0, 17, 0, "invoicing + admin", false);
        }
    }

    events.sort((a, b) => a.timestamp - b.timestamp);

    fs.mkdirSync(TARGET_DIR, { recursive: true });

    const jobDTOs = Object.values(jobs).map((j) => ({
        job_id: j.id,
        job_title: j.title,
        created: j.createdAt,
        job_seed: j.seed,
    }));
    fs.writeFileSync(path.join(TARGET_DIR, "jobs.json"), JSON.stringify(jobDTOs, null, 2) + "\n");

    const lines = [JSON.stringify({ _format_version: 2 }), ...events.map((e) => e.toJSONL())];
    fs.writeFileSync(path.join(TARGET_DIR, "logs.jsonl"), lines.join("\n") + "\n");

    console.log(`Seeded ${jobDTOs.length} jobs and ${events.length} events into ${TARGET_DIR}`);
    console.log("Press F5 — the dashboard now has ~4 weeks of sessions.");
}

main();
