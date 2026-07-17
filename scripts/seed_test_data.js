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
 * plus a few workspace-only events under a "Meridian" job. This exercises
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
 * Usage:
 *   npm run seed-testdata                        synthetic data (~6 months of history)
 *   npm run seed-testdata -- --from-real         copy YOUR real global store instead
 *   npm run seed-testdata -- --from-real <dir>   ...from an explicit storage dir
 *
 * --from-real COPIES {jobs.json,logs.jsonl} from the real global storage into
 * the isolated test-workspace global store (the originals are never touched)
 * and writes an empty workspace store, so F5 shows exactly your real data.
 * Default real-storage location: %APPDATA%/Code/User/globalStorage/davidclass.timescope
 *
 * Overwrites {jobs.json,logs.jsonl} in the two test-workspace stores only.
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

// ---------------------------------------------------------------------------
// Task text generator, tuned to the real store's profile: free text, median
// ~45 chars / avg ~55, almost every task distinct, occasional very long notes
// (real data maxes out around 430 chars).
// ---------------------------------------------------------------------------

const TASK_ACTIONS = [
    "review", "revise", "detail out", "model", "simulate", "document",
    "debug", "measure and log", "assemble notes on", "follow up on",
];
const TASK_SUBJECTS = [
    "gearbox housing tolerances", "sensor board layout rev C", "test fixture base plate",
    "supplier drawings package", "BOM and sourcing options", "motor mount interface",
    "wiring harness routing", "firmware flash sequence", "client feedback items",
    "acceptance test procedure", "thermal sim boundary conditions", "cable strain relief",
];
const TASK_TAILS = [
    "", "", "", " and send summary to client", " before Thursday design review",
    " — still waiting on vendor response", " per last week's meeting notes",
    " and push updates to the shared drive", " (second pass)",
];
const TASK_LONG_NOTE =
    " Longer working notes: walked the whole assembly sequence with the shop, flagged two" +
    " interference issues near the rear bracket, agreed on a revised tolerance stack for the" +
    " mating flange, and captured open questions for the supplier call — needs a follow-up" +
    " session to close out the drawing changes.";

function make_task(seed) {
    const action = TASK_ACTIONS[seed % TASK_ACTIONS.length];
    const subject = TASK_SUBJECTS[(seed * 7 + 3) % TASK_SUBJECTS.length];
    const tail = TASK_TAILS[(seed * 13 + 5) % TASK_TAILS.length];
    let task = `${action} ${subject}${tail}`;
    if (seed % 17 === 0) task += TASK_LONG_NOTE; // rare very-long note
    if (seed % 23 === 0) task = "admin"; // rare terse entry (real min is 4 chars)
    return task;
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

// --from-real: copy the user's actual global store into the isolated
// test-workspace global store (read-only on the source), and clear the
// workspace store so the dashboard shows exactly the real data.
function seed_from_real(realDir) {
    const jobsSrc = path.join(realDir, "jobs.json");
    const logsSrc = path.join(realDir, "logs.jsonl");
    if (!fs.existsSync(jobsSrc) || !fs.existsSync(logsSrc)) {
        console.error(`--from-real: could not find jobs.json + logs.jsonl in:\n  ${realDir}`);
        console.error("Pass the storage folder explicitly: npm run seed-testdata -- --from-real <dir>");
        process.exit(1);
    }

    fs.mkdirSync(GLOBAL_DIR, { recursive: true });
    fs.copyFileSync(jobsSrc, path.join(GLOBAL_DIR, "jobs.json"));
    fs.copyFileSync(logsSrc, path.join(GLOBAL_DIR, "logs.jsonl"));

    // Empty workspace store: v2 header only, no jobs
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    fs.writeFileSync(path.join(WORKSPACE_DIR, "jobs.json"), "[]\n");
    fs.writeFileSync(path.join(WORKSPACE_DIR, "logs.jsonl"), JSON.stringify({ _format_version: 2 }) + "\n");

    const lineCount = fs.readFileSync(logsSrc, "utf8").trim().split("\n").length - 1;
    console.log(`Copied REAL data → ${GLOBAL_DIR}`);
    console.log(`  source: ${realDir} (untouched)`);
    console.log(`  ~${lineCount} events; workspace store cleared.`);
    console.log("Press F5 — the dashboard shows your real tracking data in the isolated test storage.");
}

/**
 * Where the user's real global store lives: the timescope.global_storage_dir
 * setting when configured (read from the VS Code user settings.json), else
 * the extension's default globalStorage folder.
 */
function default_real_dir() {
    const appdata = process.env.APPDATA || path.join(require("os").homedir(), "AppData", "Roaming");

    const settingsPath = path.join(appdata, "Code", "User", "settings.json");
    try {
        const raw = fs.readFileSync(settingsPath, "utf8");
        // settings.json is JSONC; pull just the one key rather than parsing it all
        const m = raw.match(/"timescope\.global_storage_dir"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (m) {
            const configured = JSON.parse(`"${m[1]}"`);
            if (configured.trim()) {
                if (!path.isAbsolute(configured)) {
                    console.error(`--from-real: timescope.global_storage_dir is relative ("${configured}") — it resolves against a workspace folder at runtime, which this script can't know.`);
                    console.error("Pass the folder explicitly: npm run seed-testdata -- --from-real <dir>");
                    process.exit(1);
                }
                console.log(`--from-real: using configured timescope.global_storage_dir`);
                return configured;
            }
        }
    } catch {
        // no readable settings file → fall through to the default location
    }

    return path.join(appdata, "Code", "User", "globalStorage", "davidclass.timescope");
}

function main() {
    const args = process.argv.slice(2);
    const fromRealIdx = args.indexOf("--from-real");
    if (fromRealIdx !== -1) {
        const explicit = args[fromRealIdx + 1];
        seed_from_real(explicit ? path.resolve(explicit) : default_real_dir());
        return;
    }

    // Titles mirror the real store's shape: hierarchical "Project - Subsystem -
    // Discipline" names, 12–33 chars (real profile: 11–35, avg 27).
    const jobs = {
        gearbox: Job.create({ title: "Northwind - Gearbox - MechCAD", created: at(190, 8, 0) }),
        controls: Job.create({ title: "Northwind - Controls - EE CAD", created: at(170, 8, 0) }),
        fixture: Job.create({ title: "Halcyon - Fixture - Design Review", created: at(160, 8, 0) }),
        firmware: Job.create({ title: "Halcyon - Sensor Bd - Firmware", created: at(150, 8, 0) }),
        internal: Job.create({ title: "Internal R&D", created: at(140, 8, 0) }),
    };

    // ── Global store: ~4 weeks of dense weekday history, newest day = today ──
    // Pauses on ~60% of sessions (real profile: ~0.9 pauses per session).
    const globalEvents = [];
    for (let day = 27; day >= 0; day--) {
        if (is_weekend(day)) continue;
        push_session(globalEvents, jobs.gearbox, day, 9, 0, 11, 30, make_task(day * 3 + 1), day % 5 !== 0);
        if (day % 3 !== 0) {
            push_session(globalEvents, jobs.controls, day, 13, 0, 15, 45, make_task(day * 3 + 2), day % 2 === 0);
        }
        if (day % 2 === 0) {
            push_session(globalEvents, jobs.firmware, day, 16, 0, 17, 30, make_task(day * 3 + 3), false);
        }
        if (day % 5 === 0) {
            push_session(globalEvents, jobs.internal, day, 8, 0, 8, 45, "invoicing + admin", false);
        }
    }

    // ── Older history: sparser sessions back to ~6 months so the wide presets
    //    (Last 3 Months / Last Year) and old-date filtering have real data ──
    for (let day = 180; day > 27; day--) {
        if (is_weekend(day)) continue;
        if (day % 4 === 0) {
            push_session(globalEvents, jobs.gearbox, day, 9, 30, 12, 0, make_task(day * 5 + 1), day % 8 === 0);
        }
        if (day % 6 === 0) {
            push_session(globalEvents, jobs.fixture, day, 14, 0, 16, 30, make_task(day * 5 + 2), day % 12 === 0);
        }
        if (day % 20 === 0) {
            push_session(globalEvents, jobs.internal, day, 8, 0, 9, 0, "monthly bookkeeping", false);
        }
    }

    const global = write_store(GLOBAL_DIR, Object.values(jobs), globalEvents);

    // ── Workspace store: cross-file dedup/merge fixture ──
    // Duplicates: the last week of global events, re-emitted with identical IDs
    // (record IDs are deterministic) → loadAllEntries must collapse them.
    const cutoff = Date.now() - WEEK_MS;
    const duplicates = globalEvents.filter((e) => e.timestamp >= cutoff);

    // Unique: a workspace-only "Meridian" job + a novel-time Northwind session,
    // none of which exists in the global log (distinct job.id or timestamp → fresh IDs).
    const localClient = Job.create({ title: "Meridian - Onsite Commissioning", created: at(6, 8, 0) });
    const uniqueEvents = [];
    push_session(uniqueEvents, localClient, 1, 10, 0, 12, 0, "walkthrough with site electrician, punch list captured", false);
    push_session(uniqueEvents, jobs.gearbox, 1, 19, 0, 20, 30, "after-hours notes on the rear bracket interference fix", false);

    const workspaceJobs = [...Object.values(jobs), localClient];
    const workspaceEvents = [...duplicates, ...uniqueEvents];
    const workspace = write_store(WORKSPACE_DIR, workspaceJobs, workspaceEvents);

    console.log(`Global    → ${global.jobs} jobs, ${global.events} events  (${GLOBAL_DIR})`);
    console.log(`Workspace → ${workspace.jobs} jobs, ${workspace.events} events  (${WORKSPACE_DIR})`);
    console.log(`            ${duplicates.length} duplicate the last week of global (dedup on merge), ${uniqueEvents.length} unique.`);
    console.log("Press F5 — totals should be unchanged by the duplicates; the 'Meridian' job and the unique sessions appear once.");
}

main();
