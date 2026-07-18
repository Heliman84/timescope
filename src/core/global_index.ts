import * as fs from "fs";
import { Event } from "./event";
import { Registry } from "./registry";
import { workspace_timescope_paths } from "./workspace_paths";
import { HEADER_LINE, sanitize_lines } from "./log_sanitizer";
import { ensure_dir_sync, append_line_safe, write_file_atomic, readJSONLSafe } from "../utils/fs_utils";

/**
 * Append one event to an owned event log (`index.jsonl` / `scratch.jsonl`), using
 * the same JSONL format as `logs.jsonl`: a format header on the first line, then
 * one event per line. Appends are newline-safe so records can never concatenate.
 *
 * Unlike EventRepository.appendEvent this does not track line indices — the index
 * and scratch are derived/owned event streams, not edited in place by line number.
 */
export function append_owned_event(file_path: string, event: Event): void {
    ensure_dir_sync(file_path);
    const empty = !fs.existsSync(file_path) || fs.statSync(file_path).size === 0;
    if (empty) {
        fs.writeFileSync(file_path, HEADER_LINE + "\n" + event.toJSONL() + "\n", "utf8");
    } else {
        append_line_safe(file_path, event.toJSONL());
    }
}

/** Map a Registry's repos to their committed `.timescope/logs.jsonl` paths. */
export function registry_log_paths(registry: Registry): string[] {
    return registry.repos.map(r => workspace_timescope_paths(r.path).log_path);
}

/**
 * Rebuild the derived global `index.jsonl` from the owned sources — every repo's
 * committed log plus the global scratch log. Events are de-duplicated by id (the
 * same event appearing in two sources lands once) and sorted by timestamp, then
 * the file is written atomically with a header. Missing source files are skipped.
 *
 * Returns the number of unique events written and how many source logs existed.
 */
export function rebuild_index(
    index_path: string,
    source_log_paths: string[],
    scratch_path: string | undefined
): { event_count: number; source_count: number } {
    const by_id = new Map<string, Event>();

    const read_events = (p: string | undefined): boolean => {
        if (!p || !fs.existsSync(p)) return false;
        const { lines } = sanitize_lines(readJSONLSafe(p), { count_events: false });
        for (const line of lines) {
            const event = Event.fromJSONL(line);
            if (!event) continue;
            if (!by_id.has(event.id)) by_id.set(event.id, event);
        }
        return true;
    };

    let source_count = 0;
    for (const p of source_log_paths) {
        if (read_events(p)) source_count++;
    }
    read_events(scratch_path);

    const events = Array.from(by_id.values()).sort((a, b) => a.timestamp - b.timestamp);
    const body = [HEADER_LINE, ...events.map(e => e.toJSONL())].join("\n") + "\n";
    write_file_atomic(index_path, body);

    return { event_count: events.length, source_count };
}
