import { TimeScopePaths } from "./paths";
import { Event, EventCollection, ValidationError } from "./event";
import { EventRepository } from "./event_repository";

//
// PUBLIC API
//

/**
 * Append a typed log record to the global (canonical) log, and to the
 * workspace mirror if one is present.
 */
export function append_log_record(paths: TimeScopePaths, event: Event): void {
    const repo = new EventRepository(paths);
    repo.appendValidated(event);
}

/**
 * Load all logs (global + workspace mirror) and return only valid LogRecord entries.
 */
export function load_all_logs(paths: TimeScopePaths): EventCollection {
    const repo = new EventRepository(paths);
    return repo.loadAllLogs();
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
    const repo = new EventRepository(paths);
    return repo.loadEventCollectionForJob(job);
}

/**
 * Load log entries including raw line text, source file, and line index. This
 * is useful for precise updates from the UI.
 */
export function load_all_log_entries(paths: TimeScopePaths): Array<{ record: Event; raw: string; source: "global" | "workspace"; lineIndex: number }> {
    const repo = new EventRepository(paths);
    return repo.loadAllLogEntries();
}

export function rename_job_in_log_file(paths: TimeScopePaths, old_name: string, new_name: string) {
    const repo = new EventRepository(paths);
    repo.renameJobInLog(old_name, new_name);
}

export function update_log_entry(paths: TimeScopePaths, old_raw_line: string, new_record: Event): { globalReplaced: boolean; workspaceReplaced: boolean; errors?: ValidationError[] } {
    const repo = new EventRepository(paths);
    return repo.updateLogEntry(old_raw_line, new_record);
}
