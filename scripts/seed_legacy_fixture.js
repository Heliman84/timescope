// Generate test-workspace-legacy: a v0.2.0-style repo — .timescope/logs.jsonl with
// jobs but NO config.json, and an EMPTY global store (machine has never seen it).
// Opening it should auto-upgrade: config.json created + jobs cached (US-06).
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const C = path.join(ROOT, "out", "core");
const { Job } = require(path.join(C, "job"));
const { Event } = require(path.join(C, "event"));

const base = path.join(ROOT, "test-workspace-legacy");
const ts = path.join(base, ".timescope");
const vs = path.join(base, ".vscode");
const gs = path.join(base, "global-storage");
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(ts, { recursive: true });
fs.mkdirSync(vs, { recursive: true });
fs.mkdirSync(gs, { recursive: true });

fs.writeFileSync(path.join(vs, "settings.json"),
    JSON.stringify({ "timescope.global_storage_dir": "global-storage" }, null, 4) + "\n");
fs.writeFileSync(path.join(gs, ".gitkeep"), "");

const now = Date.now();
const day = (n, h) => now - n * 86400000 + h * 3600000;
const jobs = [
    Job.create({ title: "Meridian - Turbine - MechCAD" }),
    Job.create({ title: "Meridian - Turbine - EE CAD" }),
    Job.create({ title: "Admin - Billing" }),
];
const ev = [];
for (let d = 5; d >= 1; d--) {
    ev.push(Event.create(jobs[0], "start", day(d, 9)), Event.create(jobs[0], "stop", day(d, 11), "cad work"));
    if (d % 2 === 0) ev.push(Event.create(jobs[1], "start", day(d, 13)), Event.create(jobs[1], "stop", day(d, 15), "schematic"));
}
ev.push(Event.create(jobs[2], "start", day(1, 16)), Event.create(jobs[2], "stop", day(1, 16.5), "invoices"));

const header = JSON.stringify({ _format_version: 2 });
fs.writeFileSync(path.join(ts, "logs.jsonl"),
    [header, ...ev.sort((a, b) => a.timestamp - b.timestamp).map(e => e.toJSONL())].join("\n") + "\n");

console.log("test-workspace-legacy: .timescope/logs.jsonl with 3 jobs, NO config.json, empty global.");
console.log("config.json present?", fs.existsSync(path.join(ts, "config.json")));
console.log("jobs:", jobs.map(j => j.title).join(" | "));
