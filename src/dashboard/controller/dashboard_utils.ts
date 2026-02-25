import { Event, ValidationError } from "../../core/event";

/**
 * Build the timestamp-descending payload the webview expects.
 * Events are already de-duplicated at load time (loadAllEntries merges
 * global/workspace line indices onto one Event), so no grouping needed.
 */
export function buildPayload(events: Event[]): any[] {
    return events
        .map(ev => ({
            event: ev.type,
            job: ev.job_title,
            timestamp: ev.timestamp,
            task: ev.task || "",
            id: ev.id,
            job_id: ev.job_id,
            time_seed: ev.time_seed,
            global_line_index: ev.global_line_index,
            workspace_line_index: ev.workspace_line_index,
        }))
        .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Filter validation errors to only those referencing events that were part
 * of the edit (identified by the original Event objects).
 */
export function filterRelevantErrors(
    errors: ValidationError[],
    editedEvents: Event[]
): string[] {
    const result: string[] = [];
    for (const err of errors) {
        const rec = err.record;
        if (!rec) continue;
        const matched = editedEvents.some(e =>
            e.type === rec.event &&
            e.job_title === rec.job_title &&
            e.timestamp === rec.timestamp &&
            (e.task || "") === (rec.task || "")
        );
        if (matched) result.push(err.message);
    }
    return result;
}
