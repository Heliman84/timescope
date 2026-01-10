import * as fs from "fs";
import * as path from "path";
import { TimeScopePaths } from "./paths";
import { LogRecord, Event } from "./types";

/**
 * Formatting constants and helpers for JSONL log records.
 */
const EVENT_PAD = 8; 

//
// HELPERS
//

function ensure_dir_exists(file_path: string) {
    const dir = path.dirname(file_path);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function format_event(event: Event): string {
    const raw = `"event":"${event}"`;
    return raw.padEnd(raw.length + (EVENT_PAD - event.length), " ");
}

function format_log_line(record: LogRecord): string {
    const event_part = format_event(record.event);
    const job_part = `"job":"${record.job}"`;
    const timestamp_part = `"timestamp":${record.timestamp}`;

    if (record.event === "stop") {
        const task_part = `"task":"${record.task || ""}"`;
        return `{${event_part}, ${job_part}, ${timestamp_part}, ${task_part}}`;
    }

    return `{${event_part}, ${job_part}, ${timestamp_part}}`;
} 

function safe_read_lines(file_path: string): string[] {
    if (!fs.existsSync(file_path)) return [];
    const raw = fs.readFileSync(file_path, "utf8");
    return raw
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 0);
}

//
// PUBLIC API
//

/**
 * Append a typed log record to the global (canonical) log, and to the
 * workspace mirror if one is present.
 */
export function append_log_record(paths: TimeScopePaths, record: LogRecord): void {
    const line = format_log_line(record) + "\n";

    // Ensure directories exist
    ensure_dir_exists(paths.global_log_path);
    if (paths.workspace_log_path) {
        ensure_dir_exists(paths.workspace_log_path);
    }

    // Write to global (canonical)
    fs.appendFileSync(paths.global_log_path, line, "utf8");

    // Write to workspace mirror (if present)
    if (paths.workspace_log_path) {
        fs.appendFileSync(paths.workspace_log_path, line, "utf8");
    }
}

/**
 * Load all logs (global + workspace mirror) and return only valid LogRecord entries.
 */
export function load_all_logs(paths: TimeScopePaths): LogRecord[] {
    // Backwards compatible API - returns only parsed records (no source/raw)
    return load_all_log_entries(paths).map(e => e.record);
}

/**
 * Load log entries including raw line text, source file, and line index. This
 * is useful for precise updates from the UI.
 */
export function load_all_log_entries(paths: TimeScopePaths): Array<import("./types").LogEntry> {
    const entries: Array<import("./types").LogEntry> = [];

    const global_lines = safe_read_lines(paths.global_log_path);
    for (let i = 0; i < global_lines.length; i++) {
        const line = global_lines[i];
        const parsed = try_parse_line(line);
        if (parsed) {
            entries.push({ record: parsed, raw: line, source: "global", lineIndex: i });
        } else {
            // still include malformed lines as raw entries (they'll be shown but not editable)
            entries.push({ record: { event: "start", job: "", timestamp: 0 } as any, raw: line, source: "global", lineIndex: i });
        }
    }

    if (paths.workspace_log_path) {
        const ws_lines = safe_read_lines(paths.workspace_log_path);
        for (let i = 0; i < ws_lines.length; i++) {
            const line = ws_lines[i];
            const parsed = try_parse_line(line);
            if (parsed) {
                entries.push({ record: parsed, raw: line, source: "workspace", lineIndex: i });
            } else {
                entries.push({ record: { event: "start", job: "", timestamp: 0 } as any, raw: line, source: "workspace", lineIndex: i });
            }
        }
    }

    return entries;
}

function try_parse_line(line: string): LogRecord | null {
    try {
        const obj = JSON.parse(line);
        if (!obj || typeof obj.event !== "string" || typeof obj.job !== "string" || typeof obj.timestamp !== "number") return null;
        if (obj.event === "stop") {
            if (obj.task !== undefined && typeof obj.task !== "string") return null;
            return { event: "stop", job: obj.job, timestamp: obj.timestamp, task: obj.task };
        }
        if (obj.event === "start" || obj.event === "pause" || obj.event === "resume") {
            return { event: obj.event, job: obj.job, timestamp: obj.timestamp } as LogRecord;
        }
        return null;
    } catch {
        return null;
    }
} 

export function rename_job_in_log_file(paths: TimeScopePaths, old_name: string, new_name: string) {
    function rewrite_file(file_path: string | null) {
        if (!file_path || !fs.existsSync(file_path)) return;

        const lines = safe_read_lines(file_path);
        const rewritten: string[] = [];

        for (const line of lines) {
            let obj: any;
            try {
                obj = JSON.parse(line);
            } catch {
                // Keep malformed line unchanged
                rewritten.push(line);
                continue;
            }

            if (!obj || typeof obj.event !== "string" || typeof obj.job !== "string" || typeof obj.timestamp !== "number") {
                // Keep malformed or unexpected lines unchanged
                rewritten.push(line);
                continue;
            }

            // Only modify matching job names
            if (obj.job === old_name) {
                obj.job = new_name;
            }

            // Re-format using typed record
            let record: LogRecord;
            if (obj.event === "stop") {
                record = { event: "stop", job: obj.job, timestamp: obj.timestamp, task: typeof obj.task === "string" ? obj.task : "" };
            } else {
                record = { event: obj.event as Event, job: obj.job, timestamp: obj.timestamp };
            }

            const new_line = format_log_line(record);
            rewritten.push(new_line);
        }

        ensure_dir_exists(file_path);
        fs.writeFileSync(file_path, rewritten.join("\n") + "\n", "utf8");
    }

    // Rewrite global canonical log
    rewrite_file(paths.global_log_path);

    // Rewrite workspace mirror (if present)
    if (paths.workspace_log_path) {
        rewrite_file(paths.workspace_log_path);
    }
}

/**
 * Replace a single log entry across global and workspace logs. It will first
 * attempt to replace an exact matching raw line; if not found it will attempt
 * to find matching record fields (event+job+timestamp) and replace those.
 * After replacement, the job's event sequence is validated to avoid creating
 * invalid start/stop ordering.
 */
export function update_log_entry(paths: TimeScopePaths, old_raw_line: string, new_record: LogRecord): { globalReplaced: boolean; workspaceReplaced: boolean; errors?: string[] } {
    const result = { globalReplaced: false, workspaceReplaced: false, errors: undefined as string[] | undefined };

    function replace_in_file(file_path: string | undefined | null): boolean {
        if (!file_path || !fs.existsSync(file_path)) return false;

        let replaced = false;
        const lines = safe_read_lines(file_path);
        const rewritten: string[] = [];

        for (const line of lines) {
            if (!replaced && line === old_raw_line) {
                // Exact replacement
                rewritten.push(format_log_line(new_record));
                replaced = true;
                continue;
            }
            rewritten.push(line);
        }

        if (!replaced) {
            // Try field-based replacement: find lines that parse and match event+job+timestamp of old line
            for (let i = 0; i < rewritten.length; i++) {
                const parsed = try_parse_line(rewritten[i]);
                if (!parsed) continue;
                if (parsed.event === new_record.event && parsed.job === new_record.job && parsed.timestamp === new_record.timestamp) {
                    // same timestamp -> replace
                    rewritten[i] = format_log_line(new_record);
                    replaced = true;
                    break;
                }
            }
        }

        if (replaced) {
            ensure_dir_exists(file_path);
            fs.writeFileSync(file_path, rewritten.join("\n") + "\n", "utf8");
        }

        return replaced;
    }

    // Do replacements
    result.globalReplaced = replace_in_file(paths.global_log_path);
    result.workspaceReplaced = replace_in_file(paths.workspace_log_path);

    // Validate job sequence for the affected job using the global (canonical) log only
    try {
        const global_lines = safe_read_lines(paths.global_log_path);
        const parsed: LogRecord[] = [];
        for (const l of global_lines) {
            const p = try_parse_line(l);
            if (p && p.job === new_record.job) parsed.push(p);
        }
        const validationErrors = validate_job_sequence(parsed);
        if (validationErrors.length > 0) {
            result.errors = validationErrors;
        }
    } catch (ex) {
        result.errors = [String(ex)];
    }

    return result;
}

function validate_job_sequence(records: LogRecord[]): string[] {
    // Simple validation: ensure that for a given job, starts/stops alternate and no stop occurs before a start.
    const errors: string[] = [];
    const sorted = records.slice().sort((a, b) => a.timestamp - b.timestamp);

    let expecting: "start" | "stop" = "start";

    for (const r of sorted) {
        if (r.event === "start") {
            if (expecting !== "start") {
                errors.push(`Unexpected start at ${r.timestamp} for job ${r.job}`);
            }
            expecting = "stop";
        } else if (r.event === "stop") {
            if (expecting !== "stop") {
                errors.push(`Unexpected stop at ${r.timestamp} for job ${r.job}`);
            }
            expecting = "start";
        }
        // pause/resume are allowed anytime; they don't flip expecting.
    }

    return errors;
}