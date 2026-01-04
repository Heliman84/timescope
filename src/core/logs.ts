import * as fs from "fs";
import * as path from "path";
import { TimeScopePaths } from "./paths";

//
// CONSTANTS
//

// Longest event name is "resume" (6 chars)
// We pad to 8 so there are 2 spaces after it.
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

function format_event(event: string): string {
    const raw = `"event":"${event}"`;
    return raw.padEnd(raw.length + (EVENT_PAD - event.length), " ");
}

function format_log_line(record: any): string {
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

export function append_log_record(paths: TimeScopePaths, record: any) {
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

export function load_all_logs(paths: TimeScopePaths): any[] {
    const global_lines = safe_read_lines(paths.global_log_path);
    const workspace_lines = paths.workspace_log_path
        ? safe_read_lines(paths.workspace_log_path)
        : [];

    // Merge global + workspace (global is canonical, but workspace may contain extra)
    const merged = [...global_lines, ...workspace_lines];

    // Parse JSONL safely
    const parsed = merged.map(line => {
        try {
            return JSON.parse(line);
        } catch {
            return null;
        }
    });

    return parsed.filter(x => x !== null);
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
                continue;
            }

            // Only modify matching job names
            if (obj.job === old_name) {
                obj.job = new_name;
            }

            // Re-format using the same padded JSONL output
            const new_line = format_log_line(obj);
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