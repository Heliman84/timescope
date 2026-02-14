import { LogRecord } from "./types";

/**
 * Validate a sequence of `LogRecord` events for a single job.
 * Returns an array of validation error messages (empty if valid).
 *
 * Rules enforced:
 * - Sequence must begin with `start`.
 * - `start` -> (`pause` | `stop`) allowed.
 * - `pause` -> (`resume` | `stop`) allowed.
 * - `resume` -> (`pause` | `stop`) allowed.
 * - `stop` transitions to `idle`; a subsequent `start` is allowed to begin a new run.
 * - A `stop` without a prior `start` is invalid.
 * - `resume` without prior `pause` is invalid.
 * - consecutive `pause` or `resume` without appropriate state is invalid.
 */
export function validate_event_sequence(records: LogRecord[]): string[] {
    const errors: string[] = [];
    const sorted = records.slice().sort((a, b) => a.timestamp - b.timestamp);

    type State = "idle" | "running" | "paused";
    let state: State = "idle";

    // If there are no records, nothing to validate
    if (sorted.length === 0) return errors;

    // Ensure sequence begins with a start event for this job
    const first = sorted[0];
    if (first.event !== "start") {
        errors.push(`Sequence for job ${first.job} must begin with start (found ${first.event} at ${first.timestamp})`);
        // continue to collect further errors
    }

    for (const r of sorted) {
        const e = r.event;

        if (e === "start") {
            if (state !== "idle") {
                errors.push(`Unexpected start at ${r.timestamp} for job ${r.job}`);
            }
            state = "running";
            continue;
        }

        if (e === "pause") {
            if (state !== "running") {
                errors.push(`Unexpected pause at ${r.timestamp} for job ${r.job}`);
            }
            state = "paused";
            continue;
        }

        if (e === "resume") {
            if (state !== "paused") {
                errors.push(`Unexpected resume at ${r.timestamp} for job ${r.job}`);
            }
            state = "running";
            continue;
        }

        if (e === "stop") {
            if (state === "idle") {
                errors.push(`Unexpected stop at ${r.timestamp} for job ${r.job}`);
            }
            state = "idle";
            continue;
        }

        // Unknown event type
        errors.push(`Unknown event '${e}' at ${r.timestamp} for job ${r.job}`);
    }

    return errors;
}

export default validate_event_sequence;
