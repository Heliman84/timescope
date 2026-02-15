import * as fs from "fs";
import * as path from "path";
import { TimeScopePaths } from "./paths";
import { LogRecord, Event } from "./types";
import { EventCollection, ValidationError, parseLogLine } from "./event";

const HEADER_KEY = "_format_version";
const HEADER_LINE = JSON.stringify({ _format_version: 1 });

/**
 * Helpers
 */
function ensure_dir_exists(file_path: string) {
    const dir = path.dirname(file_path);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
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
    const line = EventCollection.formatRecord(record) + "\n";

    // Ensure directories exist
    ensure_dir_exists(paths.global_log_path);
    if (paths.workspace_log_path) {
        ensure_dir_exists(paths.workspace_log_path);
    }

    // Dedup check: avoid appending the same record twice (e.g., on retry)
    try {
        const existing = safe_read_lines(paths.global_log_path);
        // Find last parsed record (skip header or malformed trailing lines)
        for (let i = existing.length - 1; i >= 0; i--) {
            const parsed = parseLogLine(existing[i]);
            if (!parsed) continue;
            if (EventCollection.recordsEqual(parsed, record)) return; // duplicate
            break;
        }
    } catch {
        // ignore and proceed to append
    }

    // Write to global (canonical). If the file doesn't exist, create it with a header.
    if (!fs.existsSync(paths.global_log_path)) {
        ensure_dir_exists(paths.global_log_path);
        fs.writeFileSync(paths.global_log_path, HEADER_LINE + "\n" + line, "utf8");
    } else {
        fs.appendFileSync(paths.global_log_path, line, "utf8");
    }

    // Write to workspace mirror (if present)
    if (paths.workspace_log_path) {
        if (!fs.existsSync(paths.workspace_log_path)) {
            ensure_dir_exists(paths.workspace_log_path);
            fs.writeFileSync(paths.workspace_log_path, HEADER_LINE + "\n" + line, "utf8");
        } else {
            fs.appendFileSync(paths.workspace_log_path, line, "utf8");
        }
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
 * Load only the parsed `LogRecord`s for a specific job from the global canonical log.
 */
// Deprecated: use `load_event_collection_for_job(paths, job).toRecords()` instead
// kept for compatibility historically but not exported as primary API

/**
 * Load an `EventCollection` for a specific job from the global canonical log.
 */
export function load_event_collection_for_job(paths: TimeScopePaths, job?: string) {
    const lines = safe_read_lines(paths.global_log_path);
    const col = EventCollection.fromLines(lines);
    if (job) return col.filterByJob(job);
    return col;
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
        // Skip file-level header lines
        try {
            const obj = JSON.parse(line);
            if (obj && (obj as any)[HEADER_KEY] !== undefined) continue;
        } catch {
            // fall through to parse attempt
        }

        const parsed = parseLogLine(line);
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
            try {
                const obj = JSON.parse(line);
                if (obj && (obj as any)[HEADER_KEY] !== undefined) continue;
            } catch {}

            const parsed = parseLogLine(line);
            if (parsed) {
                entries.push({ record: parsed, raw: line, source: "workspace", lineIndex: i });
            } else {
                entries.push({ record: { event: "start", job: "", timestamp: 0 } as any, raw: line, source: "workspace", lineIndex: i });
            }
        }
    }

    return entries;
}

// Parsing of lines is provided by `parseLogLine` in event.ts

export function rename_job_in_log_file(paths: TimeScopePaths, old_name: string, new_name: string) {
    function rewrite_file(file_path: string | null) {
        if (!file_path || !fs.existsSync(file_path)) return;

        const lines = safe_read_lines(file_path);
        const rewritten: string[] = [];

        for (const line of lines) {
            const parsed = parseLogLine(line);
            if (!parsed) {
                // keep malformed lines unchanged
                rewritten.push(line);
                continue;
            }

            // Only modify matching job names
            let record: LogRecord = parsed;
            if (record.job === old_name) {
                record = { ...parsed, job: new_name } as LogRecord;
            }

            const new_line = EventCollection.formatRecord(record);
            rewritten.push(new_line);
        }

        // Ensure the resulting file has a header on the first line. If the
        // original file already contained a header we preserved it above as an
        // unchanged line; otherwise inject the canonical header.
        if (rewritten.length === 0) {
            rewritten.unshift(HEADER_LINE);
        } else {
            try {
                const firstObj = JSON.parse(rewritten[0]);
                if (!firstObj || (firstObj as any)[HEADER_KEY] === undefined) {
                    rewritten.unshift(HEADER_LINE);
                }
            } catch {
                rewritten.unshift(HEADER_LINE);
            }
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
export function update_log_entry(paths: TimeScopePaths, old_raw_line: string, new_record: LogRecord): { globalReplaced: boolean; workspaceReplaced: boolean; errors?: ValidationError[] } {
    const result = { globalReplaced: false, workspaceReplaced: false, errors: undefined as ValidationError[] | undefined };

    function replace_in_file(file_path: string | undefined | null): boolean {
        if (!file_path || !fs.existsSync(file_path)) return false;

        let replaced = false;
        const lines = safe_read_lines(file_path);
        const rewritten: string[] = [];

        for (const line of lines) {
            if (!replaced && line === old_raw_line) {
                // Exact replacement
                rewritten.push(EventCollection.formatRecord(new_record));
                replaced = true;
                continue;
            }
            rewritten.push(line);
        }

        if (!replaced) {
            // Try field-based replacement: find lines that parse and match event+job+timestamp of old line
            for (let i = 0; i < rewritten.length; i++) {
                const parsed = parseLogLine(rewritten[i]);
                if (!parsed) continue;
                if (parsed.event === new_record.event && parsed.job === new_record.job && parsed.timestamp === new_record.timestamp) {
                    // same timestamp -> replace
                    rewritten[i] = EventCollection.formatRecord(new_record);
                    replaced = true;
                    break;
                }
            }
        }

        if (replaced) {
            ensure_dir_exists(file_path);
            // Ensure header exists on write
            if (rewritten.length === 0) {
                rewritten.unshift(HEADER_LINE);
            } else {
                try {
                    const firstObj = JSON.parse(rewritten[0]);
                    if (!firstObj || (firstObj as any)[HEADER_KEY] === undefined) {
                        rewritten.unshift(HEADER_LINE);
                    }
                } catch {
                    rewritten.unshift(HEADER_LINE);
                }
            }

            fs.writeFileSync(file_path, rewritten.join("\n") + "\n", "utf8");
        }

        return replaced;
    }

    // Do replacements
    result.globalReplaced = replace_in_file(paths.global_log_path);
    result.workspaceReplaced = replace_in_file(paths.workspace_log_path);

    // Validate job sequence for the affected job using the global (canonical) log only
    try {
        const validationErrors = load_event_collection_for_job(paths, new_record.job).validate({ startFromLatest: true });
        if (validationErrors.length > 0) {
            result.errors = validationErrors;
        }
    } catch (ex) {
        result.errors = [{ index: -1, code: "exception", message: String(ex) }];
    }

    return result;
}

// validation moved to src/core/event.ts