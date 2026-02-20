#!/usr/bin/env ts-node

import * as fs from "fs";
import * as path from "path";

/**
 * repair_orphaned_sessions.ts
 *
 * Scans a TimeScope JSONL log file for orphaned sessions — sessions with
 * structurally invalid event sequences — and inserts synthetic events to
 * make every session well-formed: start → [pause → resume]* → stop.
 *
 * Orphan patterns resolved:
 *   • Missing stop:  session left open when a new start appears for the same
 *                    job, or at end-of-file. A synthetic stop is inserted with
 *                    timestamp = last_session_event + 1 second.
 *   • Missing start: a stop/pause/resume appears for a job that has no open
 *                    session. A synthetic start is inserted with
 *                    timestamp = orphan_event − 1 second.
 *   • Invalid state-machine transitions (e.g., consecutive pauses, running →
 *                    resume without pause): the old session is closed and a
 *                    new one opened with appropriate synthetic events.
 *
 * Supports both v1 and v2 log formats. Synthetic events are written in
 * whichever format the file uses (detected from the header version).
 *
 * Output:
 *   • Repaired log file (in-place, atomic write).  Unchanged if no repairs.
 *   • Summary report: <log-dir>/orphan_repair_report_<epoch>.md
 *
 * Usage:
 *   npx ts-node scripts/repair_orphaned_sessions.ts <path-to-logs.jsonl>
 */

// ═══════════════════════════════════════════════════════════════════════
// Types & constants
// ═══════════════════════════════════════════════════════════════════════

type EventType = "start" | "stop" | "pause" | "resume";
type SessionState = "idle" | "running" | "paused";

const VALID_EVENTS: ReadonlySet<string> = new Set(["start", "stop", "pause", "resume"]);
const ONE_SECOND = 1000;

interface ParsedEvent {
    event: EventType;
    job: string;
    timestamp: number;
    task?: string;
    // v2-only fields (present when record has id/job_id/time_seed)
    id?: string;
    job_id?: string;
    time_seed?: number;
    is_v2: boolean;
}

interface JobTracker {
    state: SessionState;
    last_ts: number;
    last_type: EventType;
    job_title: string;
    job_id: string; // derived or explicit
    last_output_idx: number; // index in output_lines of this job's most recent event
}

interface Insertion {
    event_type: EventType;
    job: string;
    timestamp: number;
    task?: string;
    formatted_line: string;
}

interface RepairEntry {
    index: number;
    job: string;
    job_id: string;
    trigger_line: number | null; // null → EOF
    trigger_type: string;
    state_before: SessionState;
    last_event_ts: number;
    problem: string;
    insertions: Insertion[];
}

// ═══════════════════════════════════════════════════════════════════════
// Hashing & ID generation helpers  (mirrors core — no VS Code deps)
// ═══════════════════════════════════════════════════════════════════════

function fnv1a32(str: string): number {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

function compute_job_id(seed_title: string): string {
    return (fnv1a32(seed_title) >>> 0).toString(36).toLowerCase().padStart(5, "0").slice(0, 5);
}

function compute_time5(ms: number): string {
    return (Math.floor(ms / 1000) >>> 0).toString(36).padStart(5, "0").slice(-5);
}

function compute_bucket1(ms: number, et: EventType): string {
    const ms_part = Math.floor(ms) % 1000;
    const bucket = Math.min(Math.floor(ms_part / 111), 8);
    const ord: Record<EventType, number> = { start: 0, pause: 1, resume: 2, stop: 3 };
    return (bucket * 4 + ord[et]).toString(36);
}

function compute_job_hash3(jid: string): string {
    return (fnv1a32(jid) >>> 0).toString(36).toLowerCase().padStart(3, "0").slice(0, 3);
}

function generate_record_id(ts: number, et: EventType, jid: string): string {
    return `${compute_time5(ts)}-${compute_bucket1(ts, et)}-${compute_job_hash3(jid)}`;
}

// ═══════════════════════════════════════════════════════════════════════
// JSONL formatting helpers  (mirrors Event.toJSONL / upgrade script)
// ═══════════════════════════════════════════════════════════════════════

const EVENT_PAD = 8;
const JOB_PAD   = 30;

function format_v2_line(r: {
    id: string; event: string; job: string; timestamp: number;
    task?: string; job_id: string; time_seed: number;
}): string {
    const idv  = JSON.stringify(r.id);
    const ev   = JSON.stringify(r.event);
    const jv   = JSON.stringify(r.job);
    const tv   = String(r.timestamp);
    const jiv  = JSON.stringify(r.job_id);
    const tsv  = String(r.time_seed);
    const pe   = " ".repeat(Math.max(1, EVENT_PAD - r.event.length));
    const pj   = " ".repeat(Math.max(1, JOB_PAD  - r.job.length));
    const isPR = r.event === "pause" || r.event === "resume";
    const pfx  = isPR ? '{  "id":' : '{"id":  ';
    const gap  = "  ";
    if (r.task !== undefined) {
        const tkv = JSON.stringify(r.task);
        return `${pfx}${idv},${gap}"event":${ev}${pe}, "job":${jv}${pj}, "timestamp":${tv}, "task":${tkv}, "job_id":${jiv}, "time_seed":${tsv}}`;
    }
    const ph = " ".repeat(12);
    return `${pfx}${idv},${gap}"event":${ev}${pe}, "job":${jv}${pj}, "timestamp":${tv},${ph} "job_id":${jiv}, "time_seed":${tsv}}`;
}

function format_v1_line(r: {
    event: string; job: string; timestamp: number; task?: string;
}): string {
    const ev = JSON.stringify(r.event);
    const jv = JSON.stringify(r.job);
    const tv = String(r.timestamp);
    const pe = " ".repeat(Math.max(1, EVENT_PAD - r.event.length));
    const pj = " ".repeat(Math.max(1, JOB_PAD  - r.job.length));
    if (r.task !== undefined) {
        const tkv = JSON.stringify(r.task);
        return `{"event":${ev}${pe}, "job":${jv}${pj}, "timestamp":${tv}, "task":${tkv}}`;
    }
    return `{"event":${ev}${pe}, "job":${jv}${pj}, "timestamp":${tv}}`;
}

// ═══════════════════════════════════════════════════════════════════════
// State machine
// ═══════════════════════════════════════════════════════════════════════

function is_valid_transition(s: SessionState, et: EventType): boolean {
    switch (s) {
        case "idle":    return et === "start";
        case "running": return et === "pause" || et === "stop";
        case "paused":  return et === "resume" || et === "stop";
    }
}

function next_state_for(et: EventType): SessionState {
    switch (et) {
        case "start":  return "running";
        case "stop":   return "idle";
        case "pause":  return "paused";
        case "resume": return "running";
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Synthetic event creation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build a formatted synthetic event line.
 * For v2 files, a proper record ID / job_id / time_seed are generated.
 */
function make_synthetic(
    et: EventType,
    job: string,
    job_id: string,
    ts: number,
    is_v2: boolean,
    task?: string,
): Insertion {
    let formatted_line: string;
    if (is_v2) {
        const id = generate_record_id(ts, et, job_id);
        formatted_line = format_v2_line({
            id, event: et, job, timestamp: ts, task, job_id, time_seed: ts,
        });
    } else {
        formatted_line = format_v1_line({ event: et, job, timestamp: ts, task });
    }
    return { event_type: et, job, timestamp: ts, task, formatted_line };
}

// ═══════════════════════════════════════════════════════════════════════
// Timestamp helpers
// ═══════════════════════════════════════════════════════════════════════

// Human-readable local timestamp helpers
function pad2(n: number): string { return String(n).padStart(2, "0"); }

function formatLocalISO(ms: number): string {
    const d = new Date(ms);
    const tzOffsetMin = -d.getTimezoneOffset(); // minutes east of UTC
    const sign = tzOffsetMin >= 0 ? "+" : "-";
    const absMin = Math.abs(tzOffsetMin);
    const tzHH = pad2(Math.floor(absMin / 60));
    const tzMM = pad2(absMin % 60);
    const tz = `${sign}${tzHH}:${tzMM}`;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${tz}`;
}

function formatLocalForFilename(ms: number): string {
    const d = new Date(ms);
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function fmt_date(ms: number): string { return formatLocalISO(ms); }

/**
 * Compute timestamp for a synthetic **stop** that closes an orphaned session.
 * Preferred: last_event + 1 s.  Clamped to stay before the triggering event.
 */
function calc_stop_ts(last_ts: number, trigger_ts: number | null): number {
    if (trigger_ts === null) return last_ts + ONE_SECOND; // EOF — no upper bound
    const preferred = last_ts + ONE_SECOND;
    if (preferred < trigger_ts) return preferred;
    // Tight fit — place as close to trigger as possible
    return Math.max(last_ts + 1, trigger_ts - 1);
}

/**
 * Compute timestamp for a synthetic **start** before an orphaned non-start event.
 * Preferred: event − 1 s.  Clamped to stay after the previous event for this job.
 */
function calc_start_ts(event_ts: number, prev_job_ts: number | null): number {
    const preferred = event_ts - ONE_SECOND;
    if (prev_job_ts === null || preferred > prev_job_ts) return preferred;
    // Tight fit — place as close to previous as possible
    return Math.min(prev_job_ts + 1, event_ts - 1);
}

// ═══════════════════════════════════════════════════════════════════════
// Detection helpers
// ═══════════════════════════════════════════════════════════════════════

function is_header(o: any): boolean {
    return o && typeof o === "object" && o._format_version !== undefined;
}

function is_event_record(o: any): boolean {
    return (
        o && typeof o === "object" &&
        typeof o.event === "string" && VALID_EVENTS.has(o.event) &&
        typeof o.job   === "string" &&
        typeof o.timestamp === "number"
    );
}

function has_v2_fields(o: any): boolean {
    return typeof o.id === "string" && typeof o.job_id === "string" && typeof o.time_seed === "number";
}

function parse_event(o: any): ParsedEvent {
    const v2 = has_v2_fields(o);
    return {
        event:     o.event as EventType,
        job:       o.job,
        timestamp: o.timestamp,
        task:      typeof o.task === "string" ? o.task : undefined,
        id:        v2 ? o.id        : undefined,
        job_id:    v2 ? o.job_id    : undefined,
        time_seed: v2 ? o.time_seed : undefined,
        is_v2:     v2,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// Problem descriptions
// ═══════════════════════════════════════════════════════════════════════

function describe_problem(state: SessionState, event_type: string): string {
    if (state === "idle") {
        return `${event_type} event with no open session (state: idle)`;
    }
    if (event_type === "start") {
        return `New session started while previous session still open (state: ${state})`;
    }
    return `Invalid transition: ${state} → ${event_type}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Report generation
// ═══════════════════════════════════════════════════════════════════════

function generate_report(params: {
    input_path: string;
    is_v2: boolean;
    original_event_count: number;
    synthetic_count: number;
    session_count: number;
    repairs: RepairEntry[];
    all_jobs: Set<string>;
}): string {
    const { input_path, is_v2, original_event_count, synthetic_count,
            session_count, repairs, all_jobs } = params;
    const total    = original_event_count + synthetic_count;
    const affected = new Set(repairs.map(r => r.job));

    const out: string[] = [];
    out.push("# TimeScope — Orphan Session Repair Report");
    out.push("");
    out.push(`| Field | Value |`);
    out.push(`|-------|-------|`);
    out.push(`| Date | ${formatLocalISO(Date.now())} |`);
    out.push(`| Input | \`${input_path}\` |`);
    out.push(`| Format | ${is_v2 ? "v2" : "v1"} |`);
    out.push("");
    out.push("## Summary");
    out.push("");
    out.push(`| Metric | Count |`);
    out.push(`|--------|------:|`);
    out.push(`| Original events | ${original_event_count} |`);
    out.push(`| Synthetic events inserted | ${synthetic_count} |`);
    out.push(`| Total events (output) | ${total} |`);
    out.push(`| Sessions (output) | ${session_count} |`);
    out.push(`| Repairs performed | ${repairs.length} |`);
    out.push(`| Jobs affected | ${affected.size} of ${all_jobs.size} |`);
    out.push("");

    if (repairs.length === 0) {
        out.push("> No orphans detected. All sessions are well-formed.");
        out.push("");
    } else {
        out.push("## Repairs");
        out.push("");

        for (const r of repairs) {
            const triggerDesc = r.trigger_line === null
                ? "EOF"
                : `line ${r.trigger_line} (\`${r.trigger_type}\` at ${fmt_date(r.last_event_ts)})`;

            out.push(`### #${r.index}  ${r.job}  \`${r.job_id}\``);
            out.push("");
            out.push(`| | |`);
            out.push(`|---|---|`);
            out.push(`| **Problem** | ${r.problem} |`);
            out.push(`| **Trigger** | ${triggerDesc} |`);
            out.push(`| **State** | ${r.state_before} (last event: ${r.last_event_ts > 0 ? fmt_date(r.last_event_ts) : "N/A"}) |`);
            out.push("");

            if (r.insertions.length > 0) {
                out.push(`| Inserted | Timestamp |`);
                out.push(`|----------|-----------|`);
                for (const ins of r.insertions) {
                    out.push(`| \`${ins.event_type}\` | ${fmt_date(ins.timestamp)} (${ins.timestamp}) |`);
                }
                out.push("");
            }
        }
    }

    return out.join("\n") + "\n";
}

// ═══════════════════════════════════════════════════════════════════════
// File I/O
// ═══════════════════════════════════════════════════════════════════════

function write_atomic(target: string, content: string): void {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.repair_tmp.${process.pid}.${Date.now()}`);
    fs.writeFileSync(tmp, content, { encoding: "utf8", flag: "w" });
    fs.renameSync(tmp, target);
}

// ═══════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════

function usage(): never {
    console.error("Usage: npx ts-node scripts/repair_orphaned_sessions.ts <path-to-logs.jsonl>");
    process.exit(2);
}

if (process.argv.length < 3) usage();

const log_path = process.argv[2];
if (!log_path) usage();

try {
    if (!fs.existsSync(log_path)) {
        throw new Error(`File not found: ${log_path}`);
    }

    const raw   = fs.readFileSync(log_path, "utf8");
    const lines = raw.split(/\r?\n/);

    // ── Tracking state ────────────────────────────────────────────────
    let file_is_v2 = false;
    const output_lines: string[]       = [];
    const repairs: RepairEntry[]       = [];
    const job_states                   = new Map<string, JobTracker>();
    const all_jobs                     = new Set<string>();
    let original_event_count           = 0;
    let session_count                  = 0; // completed sessions in output

    // ── Process every line ────────────────────────────────────────────
    for (let i = 0; i < lines.length; i++) {
        const line    = lines[i];
        const trimmed = line.trim();

        // Blank lines — preserve
        if (trimmed === "") { output_lines.push(""); continue; }

        // Try to parse as JSON
        let obj: any;
        try { obj = JSON.parse(trimmed); } catch {
            output_lines.push(line);
            continue;
        }

        // Header — detect format version and preserve
        if (is_header(obj)) {
            file_is_v2 = (obj._format_version >= 2);
            output_lines.push(line);
            continue;
        }

        // Non-event JSON — preserve
        if (!is_event_record(obj)) { output_lines.push(line); continue; }

        // ── Valid event record ────────────────────────────────────────
        original_event_count++;
        const event  = parse_event(obj);
        const job_id = event.job_id || compute_job_id(event.job);
        all_jobs.add(event.job);

        const tracker       = job_states.get(job_id);
        const current_state = tracker?.state ?? "idle" as SessionState;
        const last_ts       = tracker?.last_ts ?? 0;

        if (is_valid_transition(current_state, event.event)) {
            // ── Valid transition — output as-is ───────────────────────
            output_lines.push(line);
            job_states.set(job_id, {
                state:     next_state_for(event.event),
                last_ts:   event.timestamp,
                last_type: event.event,
                job_title: event.job,
                job_id,
                last_output_idx: output_lines.length - 1,
            });
            if (event.event === "stop") session_count++;
        } else {
            // ── Invalid transition — repair ──────────────────────────
            const insertions: Insertion[] = [];
            let s  = current_state;
            let lt = last_ts;

            // Step 1: Close the currently open session
            if (s !== "idle") {
                const ts  = calc_stop_ts(lt, event.timestamp);
                const ins = make_synthetic("stop", tracker!.job_title, job_id, ts, file_is_v2,
                    "[repaired]");
                insertions.push(ins);
                s  = "idle";
                lt = ts;
                session_count++;
            }

            // Step 2: Open a new session if the incoming event is not start
            if (s === "idle" && event.event !== "start") {
                const ts  = calc_start_ts(event.timestamp, lt > 0 ? lt : null);
                const ins = make_synthetic("start", event.job, job_id, ts, file_is_v2);
                insertions.push(ins);
                s  = "running";
                lt = ts;
            }

            // Step 3: Handle remaining rare invalid transitions
            //   e.g., running → resume needs an intermediate pause
            if (!is_valid_transition(s, event.event)) {
                if (s === "running" && event.event === "resume") {
                    const ts  = Math.floor((lt + event.timestamp) / 2);
                    const ins = make_synthetic("pause", event.job, job_id, ts, file_is_v2);
                    insertions.push(ins);
                    s  = "paused";
                    lt = ts;
                }
                // Any other pathological case would be a new code path to add;
                // after steps 1–3 the transition should now be valid.
            }

            // Record the repair
            const repair: RepairEntry = {
                index:        repairs.length + 1,
                job:          event.job,
                job_id,
                trigger_line: i + 1,           // 1-based line number
                trigger_type: event.event,
                state_before: current_state,
                last_event_ts: last_ts,
                problem:      describe_problem(current_state, event.event),
                insertions,
            };
            repairs.push(repair);

            // Output synthetic events, then the original event
            for (const ins of insertions) {
                output_lines.push(ins.formatted_line);
            }
            output_lines.push(line);

            // Update tracker to reflect both synthetic events + actual event
            job_states.set(job_id, {
                state:     next_state_for(event.event),
                last_ts:   event.timestamp,
                last_type: event.event,
                job_title: event.job,
                job_id,
                last_output_idx: output_lines.length - 1,
            });
            if (event.event === "stop") session_count++;
        }
    }

    // ── EOF: close all still-open sessions (insert right after last event) ─
    // Collect EOF repairs, then splice into output_lines from bottom to top
    // so earlier indices are not shifted by later insertions.
    const eof_repairs: { tracker: JobTracker; jid: string; ins: Insertion; repair: RepairEntry }[] = [];

    for (const [jid, tracker] of job_states) {
        if (tracker.state === "idle") continue;

        const ts  = tracker.last_ts + ONE_SECOND;
        const ins = make_synthetic("stop", tracker.job_title, tracker.job_id, ts, file_is_v2,
            "[repaired]");

        const repair: RepairEntry = {
            index:         repairs.length + 1,
            job:           tracker.job_title,
            job_id:        tracker.job_id,
            trigger_line:  null,
            trigger_type:  "EOF",
            state_before:  tracker.state,
            last_event_ts: tracker.last_ts,
            problem:       `Open session at end of file (state: ${tracker.state})`,
            insertions:    [ins],
        };
        repairs.push(repair);
        eof_repairs.push({ tracker, jid, ins, repair });
        session_count++;
    }

    // Sort by descending output index so splicing doesn't shift earlier indices
    eof_repairs.sort((a, b) => b.tracker.last_output_idx - a.tracker.last_output_idx);
    for (const { tracker, jid, ins } of eof_repairs) {
        output_lines.splice(tracker.last_output_idx + 1, 0, ins.formatted_line);

        job_states.set(jid, {
            state:     "idle",
            last_ts:   ins.timestamp,
            last_type: "stop",
            job_title: tracker.job_title,
            job_id:    tracker.job_id,
            last_output_idx: tracker.last_output_idx + 1,
        });
    }

    // ── Compute totals ────────────────────────────────────────────────
    const synthetic_count = repairs.reduce((sum, r) => sum + r.insertions.length, 0);

    // ── Write repaired log (only if something changed) ────────────────
    if (repairs.length > 0) {
        // Trim trailing blanks, ensure single trailing newline
        while (output_lines.length > 0 && output_lines[output_lines.length - 1] === "") {
            output_lines.pop();
        }
        write_atomic(log_path, output_lines.join("\n") + "\n");
    }

    // ── Write report ──────────────────────────────────────────────────
    const report = generate_report({
        input_path: log_path,
        is_v2: file_is_v2,
        original_event_count,
        synthetic_count,
        session_count,
        repairs,
        all_jobs,
    });

    const report_path = path.join(
        path.dirname(log_path),
        `orphan_repair_report_${formatLocalForFilename(Date.now())}.md`,
    );
    fs.writeFileSync(report_path, report, "utf8");

    // ── Console summary ───────────────────────────────────────────────
    console.log("Repair complete.");
    console.log(`  Original events:  ${original_event_count}`);
    console.log(`  Repairs:          ${repairs.length}`);
    console.log(`  Synthetic events: ${synthetic_count}`);
    console.log(`  Sessions:         ${session_count}`);
    console.log(`  Output:           ${log_path}`);
    console.log(`  Report:           ${report_path}`);
    process.exit(0);

} catch (err) {
    console.error("Repair failed:", (err as Error).message || err);
    process.exit(1);
}
