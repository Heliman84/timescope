#!/usr/bin/env ts-node

import * as fs from "fs";
import * as path from "path";

/**
 * One-time developer script to upgrade v1 log.jsonl files to the v2 event
 * record format defined in record_format_spec.md.
 *
 * Old format (v1):
 *   {"event":"start", "job":"MyJob", "timestamp":1771119496661}
 *   {"event":"stop",  "job":"MyJob", "timestamp":1771120113000, "task":"did stuff"}
 *
 * New format (v2):
 *   {"id":"k3t2a-4-a9f", "event":"start", "job":"MyJob", "timestamp":1771119496661, "job_id":"k3f9g", "time_seed":1771119496661}
 *   {"id":"k3t2b-3-a9f", "event":"stop",  "job":"MyJob", "timestamp":1771120113000, "task":"did stuff", "job_id":"k3f9g", "time_seed":1771120113000}
 *
 * Added fields:
 *   - id        : deterministic record ID  (<time5>-<bucket1>-<jobHash3>)
 *   - job_id    : stable 5-char job identifier derived from job title (treated as seed)
 *   - time_seed : original timestamp (immutable, used for ID generation)
 *
 * Assumptions:
 *   - Job titles have NOT been renamed, so the `job` field in the log IS the seed title.
 *   - The original timestamp becomes `time_seed` (it was the creation timestamp).
 *
 * Usage:
 *   npx ts-node scripts/upgrade_log_to_v2.ts <path-to-logs.jsonl>
 *
 * The script:
 *   - Writes the upgraded file atomically (temp file + rename).
 *   - Is idempotent: re-running on an already-upgraded file prints a message and exits.
 *   - Preserves header lines, blank lines, and cosmetic padding per spec.
 *   - Skips (and preserves verbatim) any line that cannot be parsed.
 */

// ---------------------------------------------------------------------------
// Shared hashing & ID helpers (mirrors Job.fnv1a32 / Job.computeJobIdFromSeed
// and Event.generate_record_id exactly — no VS Code deps)
// ---------------------------------------------------------------------------

type EventType = "start" | "stop" | "pause" | "resume";
const VALID_EVENT_TYPES: readonly string[] = ["start", "stop", "pause", "resume"];

function fnv1a32(str: string): number {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/** Compute a stable 5-char job_id from a seed title (mirrors Job.computeJobIdFromSeed). */
function compute_job_id(seed_title: string): string {
    const hash32 = fnv1a32(seed_title);
    return (hash32 >>> 0).toString(36).toLowerCase().padStart(5, "0").slice(0, 5);
}

/** Base-36 encode seconds, left-padded to 5 chars (mirrors Event.compute_time5). */
function compute_time5(timestamp_ms: number): string {
    const seconds = Math.floor(timestamp_ms / 1000);
    return (seconds >>> 0).toString(36).padStart(5, "0").slice(-5);
}

/** Single base-36 bucket char from ms + event type (mirrors Event.compute_bucket1). */
function compute_bucket1(timestamp_ms: number, event_type: EventType): string {
    const ms_part = Math.floor(timestamp_ms) % 1000;
    const bucket = Math.min(Math.floor(ms_part / 111), 8);
    const type_map: Record<EventType, number> = { start: 0, pause: 1, resume: 2, stop: 3 };
    const type_ord = type_map[event_type];
    const value = bucket * 4 + type_ord;
    return value.toString(36);
}

/** Stable 3-char hash of a job_id (mirrors Event.compute_job_hash3). */
function compute_job_hash3(job_id: string): string {
    const hash32 = fnv1a32(job_id);
    return (hash32 >>> 0).toString(36).toLowerCase().padStart(3, "0").slice(0, 3);
}

/** Generate the full deterministic record ID (mirrors Event.generate_record_id). */
function generate_record_id(time_seed: number, event_type: EventType, job_id: string): string {
    const time5 = compute_time5(time_seed);
    const bucket1 = compute_bucket1(time_seed, event_type);
    const job_hash3 = compute_job_hash3(job_id);
    return `${time5}-${bucket1}-${job_hash3}`;
}

// ---------------------------------------------------------------------------
// JSONL formatting helpers (mirrors Event.toJSONL padding)
// ---------------------------------------------------------------------------

const EVENT_PAD = 8;
const JOB_PAD = 30;
const ID_PAD = 13;

function format_v2_line(record: {
    id: string;
    event: string;
    job: string;
    timestamp: number;
    task?: string;
    job_id: string;
    time_seed: number;
}): string {
    const id_val = JSON.stringify(record.id);
    const event_val = JSON.stringify(record.event);
    const job_val = JSON.stringify(record.job);
    const ts_val = String(record.timestamp);
    const job_id_val = JSON.stringify(record.job_id);
    const time_seed_val = String(record.time_seed);

    const pad_event = " ".repeat(Math.max(1, EVENT_PAD - record.event.length));
    const pad_job = " ".repeat(Math.max(1, JOB_PAD - record.job.length));

    // Column alignment: the ID value starts at the same position for all event types.
    // start/stop:   {"id":  "value"  — 2 spaces after the colon (before value)
    // pause/resume: {  "id":"value"  — 2 spaces after { (before key)
    const is_pause_resume = record.event === "pause" || record.event === "resume";
    const id_prefix = is_pause_resume ? '{  "id":' : '{"id":  ';
    const event_gap = "  ";

    if (record.task !== undefined) {
        const task_val = JSON.stringify(record.task);
        return `${id_prefix}${id_val},${event_gap}"event":${event_val}${pad_event}, "job":${job_val}${pad_job}, "timestamp":${ts_val}, "task":${task_val}, "job_id":${job_id_val}, "time_seed":${time_seed_val}}`;
    }
    const TASK_PLACEHOLDER = " ".repeat(12); // visual alignment when task is absent
    return `${id_prefix}${id_val},${event_gap}"event":${event_val}${pad_event}, "job":${job_val}${pad_job}, "timestamp":${ts_val},${TASK_PLACEHOLDER} "job_id":${job_id_val}, "time_seed":${time_seed_val}}`;
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

function is_header(obj: any): boolean {
    return obj && typeof obj === "object" && obj._format_version !== undefined;
}

function is_v2_record(obj: any): boolean {
    return (
        obj &&
        typeof obj === "object" &&
        typeof obj.id === "string" &&
        typeof obj.job_id === "string" &&
        typeof obj.time_seed === "number"
    );
}

function is_v1_record(obj: any): boolean {
    return (
        obj &&
        typeof obj === "object" &&
        typeof obj.event === "string" &&
        VALID_EVENT_TYPES.includes(obj.event) &&
        typeof obj.job === "string" &&
        typeof obj.timestamp === "number" &&
        obj.id === undefined &&
        obj.job_id === undefined &&
        obj.time_seed === undefined
    );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function usage(): never {
    console.error("Usage: npx ts-node scripts/upgrade_log_to_v2.ts <path-to-logs.jsonl>");
    process.exit(2);
}

if (process.argv.length < 3) usage();

const log_path = process.argv[2];
if (!log_path) usage();

function write_atomic(target_path: string, content: string): void {
    const dir = path.dirname(target_path);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp_name = `.upgrade_log_v2.tmp.${process.pid}.${Date.now()}`;
    const tmp_path = path.join(dir, tmp_name);
    fs.writeFileSync(tmp_path, content, { encoding: "utf8", flag: "w" });
    fs.renameSync(tmp_path, target_path);
}

try {
    if (!fs.existsSync(log_path)) {
        throw new Error(`File not found: ${log_path}`);
    }

    const raw = fs.readFileSync(log_path, "utf8");
    const lines = raw.split(/\r?\n/);

    let upgraded_count = 0;
    let already_v2_count = 0;
    let skipped_count = 0;
    let header_count = 0;
    const output_lines: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();

        // Preserve blank lines
        if (trimmed === "") {
            output_lines.push("");
            continue;
        }

        // Try to parse as JSON
        let obj: any;
        try {
            obj = JSON.parse(trimmed);
        } catch {
            // Unparseable — preserve verbatim
            output_lines.push(line);
            skipped_count++;
            console.warn(`  SKIP (unparseable): ${trimmed.slice(0, 80)}...`);
            continue;
        }

        // Header line — upgrade to v2
        if (is_header(obj)) {
            output_lines.push(JSON.stringify({ _format_version: 2 }));
            header_count++;
            continue;
        }

        // Already v2 — preserve (idempotent)
        if (is_v2_record(obj)) {
            output_lines.push(trimmed);
            already_v2_count++;
            continue;
        }

        // v1 record — upgrade
        if (is_v1_record(obj)) {
            const event_type = obj.event as EventType;
            const job_title: string = obj.job;
            const timestamp: number = obj.timestamp;
            const task: string | undefined = typeof obj.task === "string" ? obj.task : undefined;

            // Derive new fields
            const job_id = compute_job_id(job_title);
            const time_seed = timestamp; // original timestamp becomes immutable time_seed
            const id = generate_record_id(time_seed, event_type, job_id);

            const v2_line = format_v2_line({
                id,
                event: event_type,
                job: job_title,
                timestamp,
                ...(task !== undefined ? { task } : {}),
                job_id,
                time_seed,
            });

            output_lines.push(v2_line);
            upgraded_count++;
            continue;
        }

        // Unknown format — preserve verbatim
        output_lines.push(line);
        skipped_count++;
        console.warn(`  SKIP (unrecognized): ${trimmed.slice(0, 80)}...`);
    }

    // If everything was already v2, report and exit
    if (upgraded_count === 0 && already_v2_count > 0) {
        console.log("Already upgraded (all records are v2).");
        process.exit(0);
    }

    if (upgraded_count === 0 && already_v2_count === 0 && header_count > 0) {
        console.log("No event records found — only header(s). Nothing to upgrade.");
        process.exit(0);
    }

    // Remove trailing empty lines, then ensure single trailing newline
    while (output_lines.length > 0 && output_lines[output_lines.length - 1] === "") {
        output_lines.pop();
    }
    const output_content = output_lines.join("\n") + "\n";

    // Write atomically
    write_atomic(log_path, output_content);

    console.log("Upgrade complete.");
    console.log(`  Upgraded:    ${upgraded_count} record(s)`);
    console.log(`  Already v2:  ${already_v2_count} record(s)`);
    console.log(`  Skipped:     ${skipped_count} line(s)`);
    console.log(`  Headers:     ${header_count}`);
    console.log(`  Output:      ${log_path}`);
    process.exit(0);
} catch (err) {
    console.error("Upgrade failed:", (err as Error).message || err);
    process.exit(1);
}
