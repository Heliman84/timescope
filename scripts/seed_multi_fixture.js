/**
 * Seed the two-repo multi-instance F5 fixture under test-multi/.
 *
 * Two repos (repoA, repoB) each pin TimeScope storage to a shared sibling dir
 * (`../shared-global`) so two Extension Development Host windows share ONE global
 * index / registry / scratch while keeping independent, workspace-scoped local logs
 * and timers. Exercises the #48 foundation for #47 (multi-instance).
 *
 * Each repo is pre-opted-in (committed `.timescope/` with a config.json job cache +
 * one seed session under a distinct job), so opening it immediately shows its job.
 *
 * The `.timescope/` data and `shared-global/` contents are gitignored (regenerate
 * with this script); the pinned `.vscode/settings.json` files are tracked.
 *
 *   npm run seed-multi        (or: node scripts/seed_multi_fixture.js)
 */
const fs = require("fs");
const path = require("path");

const { Job } = require("../out/core/job");
const { Event } = require("../out/core/event");
const { generate_repo_id } = require("../out/core/repo_config");

const base = path.resolve(__dirname, "..", "test-multi");
const nowMinus = (mins) => Date.now() - mins * 60000;

function makeRepo(name, jobTitle, sessionMins) {
    const ts = path.join(base, name, ".timescope");
    const vs = path.join(base, name, ".vscode");
    fs.mkdirSync(ts, { recursive: true });
    fs.mkdirSync(vs, { recursive: true });

    fs.writeFileSync(path.join(vs, "settings.json"),
        JSON.stringify({ "timescope.global_storage_dir": "../shared-global" }, null, 4) + "\n");

    const job = Job.create({ title: jobTitle });
    const header = JSON.stringify({ _format_version: 2 });
    fs.writeFileSync(path.join(ts, "logs.jsonl"),
        [header,
            Event.create(job, "start", nowMinus(sessionMins + 30)).toJSONL(),
            Event.create(job, "stop", nowMinus(30), "seed session").toJSONL(),
        ].join("\n") + "\n");

    fs.writeFileSync(path.join(ts, "config.json"),
        JSON.stringify({ repo_id: generate_repo_id(), format_version: 2, jobs: [{ job_id: job.id, job_title: job.title }] }, null, 2) + "\n");

    console.log(`${name}: job "${jobTitle}" (job_id ${job.id}) + 1 seed session`);
}

fs.rmSync(base, { recursive: true, force: true });
makeRepo("repoA", "Client-A - Firmware", 90);
makeRepo("repoB", "Client-B - PCB Layout", 120);

const shared = path.join(base, "shared-global");
fs.mkdirSync(shared, { recursive: true });
fs.writeFileSync(path.join(shared, ".gitkeep"), "");
console.log("shared-global/ created (empty). Open repoA and repoB in separate windows.");
