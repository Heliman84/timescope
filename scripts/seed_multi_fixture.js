/**
 * Seed the two-repo multi-instance F5 fixture under test-workspace-multi/.
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

const base = path.resolve(__dirname, "..", "test-workspace-multi");
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

    const repo_id = generate_repo_id();
    fs.writeFileSync(path.join(ts, "config.json"),
        JSON.stringify({ repo_id, format_version: 2, jobs: [{ job_id: job.id, job_title: job.title }] }, null, 2) + "\n");

    console.log(`${name}: job "${jobTitle}" (job_id ${job.id}, repo_id ${repo_id}) + 1 seed session`);
    return { repo_id, job };
}

// A stand-in for "the same workspace opened twice": a separate folder that shares
// repoA's repo_id, so both windows contest the SAME instance lock (the lock keys on
// repo_id, not path — this sidesteps VS Code's "folder already open" focus behavior).
// Its log carries an OPEN (unstopped) session so the second window would normally hit
// orphan-recovery — which a live foreign lock must suppress (#47).
function makeSameRepoDouble(name, source) {
    const ts = path.join(base, name, ".timescope");
    const vs = path.join(base, name, ".vscode");
    fs.mkdirSync(ts, { recursive: true });
    fs.mkdirSync(vs, { recursive: true });

    fs.writeFileSync(path.join(vs, "settings.json"),
        JSON.stringify({ "timescope.global_storage_dir": "../shared-global" }, null, 4) + "\n");

    const header = JSON.stringify({ _format_version: 2 });
    fs.writeFileSync(path.join(ts, "logs.jsonl"),
        [header,
            Event.create(source.job, "start", nowMinus(20)).toJSONL(),
        ].join("\n") + "\n");

    fs.writeFileSync(path.join(ts, "config.json"),
        JSON.stringify({ repo_id: source.repo_id, format_version: 2, jobs: [{ job_id: source.job.id, job_title: source.job.title }] }, null, 2) + "\n");

    console.log(`${name}: shares repoA's repo_id ${source.repo_id} + 1 OPEN session (for the double-open warning + recovery-suppression test)`);
}

fs.rmSync(base, { recursive: true, force: true });
const repoA = makeRepo("repoA", "Client-A - Firmware", 90);
makeRepo("repoB", "Client-B - PCB Layout", 120);
makeSameRepoDouble("repoA-dup", repoA);

const shared = path.join(base, "shared-global");
fs.mkdirSync(shared, { recursive: true });
fs.writeFileSync(path.join(shared, ".gitkeep"), "");
console.log("shared-global/ created (empty).");
console.log("  Different-repo test : open repoA and repoB in two Dev Hosts.");
console.log("  Same-repo test      : open repoA and repoA-dup in two Dev Hosts (same repo_id).");
