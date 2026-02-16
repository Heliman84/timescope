import * as fs from "fs";
import * as path from "path";
import { TimeScopePaths } from "./paths";
import { Event, EventCollection, ValidationError } from "./event";

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
    if (!file_path || !fs.existsSync(file_path)) return [];
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
export function append_log_record(paths: TimeScopePaths, event: Event): void {
    const line = event.toJSONL() + "\n";

    // Ensure directories exist
    ensure_dir_exists(paths.global_log_path);
    if (paths.workspace_log_path) ensure_dir_exists(paths.workspace_log_path);

    // Dedup check: avoid appending the same record twice (e.g., on retry)
    try {
        const existing = safe_read_lines(paths.global_log_path);
        // Find last parsed record (skip header or malformed trailing lines)
        for (let i = existing.length - 1; i >= 0; i--) {
            const parsed_event = Event.fromJSONL(existing[i]);
            if (!parsed_event) continue;
            if (event.equals(parsed_event)) return; // duplicate
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
export function load_all_logs(paths: TimeScopePaths): EventCollection {
    // Return an EventCollection containing parsed events from global
    // and optional workspace mirrors. Header lines are ignored by parse_lines.
    const all_lines: string[] = [];
    all_lines.push(...safe_read_lines(paths.global_log_path));
    if (paths.workspace_log_path) all_lines.push(...safe_read_lines(paths.workspace_log_path));
    return EventCollection.parse_lines(all_lines);
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
    const col = EventCollection.parse_lines(lines);
    if (job) return col.filterByJob(job);
    return col;
}

/**
 * Load log entries including raw line text, source file, and line index. This
 * is useful for precise updates from the UI.
 */
export function load_all_log_entries(paths: TimeScopePaths): Array<{ record: Event; raw: string; source: "global" | "workspace"; lineIndex: number }> {
    const entries: Array<{ record: Event; raw: string; source: "global" | "workspace"; lineIndex: number }> = [];

    const pushLine = (line: string, src: "global" | "workspace", idx: number) => {
        try {
            const obj = JSON.parse(line);
            if (obj && (obj as any)[HEADER_KEY] !== undefined) return;
        } catch {
            // fall through to parse attempt
        }
        const parsed = Event.fromJSONL(line);
        if (parsed) entries.push({ record: parsed, raw: line, source: src, lineIndex: idx });
        else entries.push({ record: Event.create({ event: "stop", job: "__MALFORMED__", timestamp: 0, task: line }), raw: line, source: src, lineIndex: idx });
    };

    const global_lines = safe_read_lines(paths.global_log_path);
    for (let i = 0; i < global_lines.length; i++) pushLine(global_lines[i], "global", i);

    if (paths.workspace_log_path) {
        const ws_lines = safe_read_lines(paths.workspace_log_path);
        for (let i = 0; i < ws_lines.length; i++) pushLine(ws_lines[i], "workspace", i);
    }

    return entries;
}

export function rename_job_in_log_file(paths: TimeScopePaths, old_name: string, new_name: string) {
    function rewrite_file(file_path: string | null) {
        if (!file_path || !fs.existsSync(file_path)) return;
        const lines = safe_read_lines(file_path);
        const col = EventCollection.parse_lines(lines);
        const renamed = col.renameJob(old_name, new_name);
        const outLines = renamed.toLines();
        const toWrite = outLines.length === 0 ? [HEADER_LINE] : [HEADER_LINE, ...outLines];
        ensure_dir_exists(file_path);
        fs.writeFileSync(file_path, toWrite.join("\n") + "\n", "utf8");
    }

    rewrite_file(paths.global_log_path);
    if (paths.workspace_log_path) rewrite_file(paths.workspace_log_path);
}

export function update_log_entry(paths: TimeScopePaths, old_raw_line: string, new_record: Event): { globalReplaced: boolean; workspaceReplaced: boolean; errors?: ValidationError[] } {
    const result = { globalReplaced: false, workspaceReplaced: false, errors: undefined as ValidationError[] | undefined };

    function replace_in_file(file_path: string | undefined | null): boolean {
        if (!file_path || !fs.existsSync(file_path)) return false;
        const lines = safe_read_lines(file_path);
        const col = EventCollection.parse_lines(lines);

        // Determine target event to replace
        const parsedOld = Event.fromJSONL(old_raw_line);
        let newCol: EventCollection | null = null;
        if (parsedOld) {
            newCol = col.replaceEvent(parsedOld, new_record);
        } else {
            const match = col.toEvents().find(e => new_record.equals(e));
            if (match) newCol = col.replaceEvent(match, new_record);
            else return false;
        }

        const origLines = col.toLines();
        const newLines = newCol.toLines();
        const changed = origLines.length !== newLines.length || origLines.some((v, i) => v !== newLines[i]);
        if (!changed) return false;

        const toWrite = newLines.length === 0 ? [HEADER_LINE] : [HEADER_LINE, ...newLines];
        ensure_dir_exists(file_path);
        fs.writeFileSync(file_path, toWrite.join("\n") + "\n", "utf8");

        return true;
    }

    result.globalReplaced = replace_in_file(paths.global_log_path);
    result.workspaceReplaced = replace_in_file(paths.workspace_log_path);

    try {
        const validationErrors = load_event_collection_for_job(paths, new_record.job).validate({ startFromLatest: true });
        if (validationErrors.length > 0) result.errors = validationErrors;
    } catch (ex) {
        result.errors = [{ index: -1, code: "exception", message: String(ex) }];
    }

    return result;
}
