import { LogRecord } from "./types";

/**
 * Parse a single JSONL log line into a `LogRecord` or `null` if malformed.
 * This is the canonical parser for log lines and belongs with event semantics.
 */
export function parseLogLine(line: string): LogRecord | null {
    try {
        const obj = JSON.parse(line);
        if (!obj || typeof obj.event !== "string" || typeof obj.job !== "string" || typeof obj.timestamp !== "number") return null;
        // Optional formatVersion support: accept either absent (legacy) or 1 (current)
        if (obj.formatVersion !== undefined && obj.formatVersion !== 1) return null;
        if (obj.event === "stop") {
            if (obj.task !== undefined && typeof obj.task !== "string") return null;
            return { event: "stop", job: obj.job, timestamp: obj.timestamp, task: obj.task } as LogRecord;
        }
        if (obj.event === "start" || obj.event === "pause" || obj.event === "resume") {
            return { event: obj.event, job: obj.job, timestamp: obj.timestamp } as LogRecord;
        }
        return null;
    } catch {
        return null;
    }
}


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



/**
 * Lightweight wrapper for a single event record.
 */
export class Event {
    constructor(public readonly record: LogRecord) {}

    get event(): string {
        return this.record.event;
    }

    get job(): string {
        return this.record.job;
    }

    get timestamp(): number {
        return this.record.timestamp;
    }

    get task(): string | undefined {
        return (this.record as any).task;
    }

    toRecord(): LogRecord {
        return this.record;
    }
}

export type State = "idle" | "running" | "paused";

export interface ValidationError {
    index: number;
    code: string;
    message: string;
    record?: LogRecord;
}

/**
 * Collection of events for a job (or arbitrary set). Provides helpers
 * for validation, state inspection, and simple mutations.
 */
export class EventCollection {
    private records: LogRecord[];

    constructor(records?: LogRecord[]) {
        this.records = records ? records.slice() : [];
    }

    static fromRecords(records: LogRecord[]): EventCollection {
        return new EventCollection(records);
    }

    /** Build an EventCollection from raw JSONL lines. Malformed lines are ignored. */
    static fromLines(lines: string[]): EventCollection {
        const parsed: LogRecord[] = [];
        for (const l of lines) {
            const p = parseLogLine(l);
            if (p) parsed.push(p);
        }
        return new EventCollection(parsed);
    }

    /** Return a new EventCollection filtered to records for `job`. */
    filterByJob(job: string): EventCollection {
        return new EventCollection(this.records.filter(r => r.job === job));
    }

    sorted(): LogRecord[] {
        return this.records.slice().sort((a, b) => a.timestamp - b.timestamp);
    }

    add(record: LogRecord): void {
        this.records.push(record);
    }

    toRecords(): LogRecord[] {
        return this.records.slice();
    }

    /**
     * Serialize a single LogRecord to a compact JSON line. Keeps property order predictable.
     */
    static formatRecord(record: LogRecord): string {
        // Include a formatVersion field to allow future format migrations.
        // Keep property order stable by constructing the object in the desired sequence.
        if (record.event === "stop") {
            return JSON.stringify({ formatVersion: 1, event: record.event, job: record.job, timestamp: record.timestamp, task: record.task || "" });
        }
        return JSON.stringify({ formatVersion: 1, event: record.event, job: record.job, timestamp: record.timestamp });
    }

    /** Compare two records for equality (used to avoid duplicate appends). */
    static recordsEqual(a: LogRecord, b: LogRecord): boolean {
        if (a.event !== b.event) return false;
        if (a.job !== b.job) return false;
        if (a.timestamp !== b.timestamp) return false;
        const at = (a as any).task || "";
        const bt = (b as any).task || "";
        return at === bt;
    }

    /**
     * Return JSONL formatted lines for the collection in ascending timestamp order.
     */
    toLines(): string[] {
        return this.sorted().map(r => EventCollection.formatRecord(r));
    }

    validate(opts?: { startFromLatest?: boolean }): ValidationError[] {
        const errors: ValidationError[] = [];
        const sorted = this.records.slice().sort((a, b) => a.timestamp - b.timestamp);

        // If there are no records, nothing to validate
        if (sorted.length === 0) return errors;

        // Enforce strictly increasing timestamps
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].timestamp <= sorted[i - 1].timestamp) {
                errors.push({
                    index: i,
                    code: "timestamp_non_increasing",
                    message: `Timestamps must increase: ${sorted[i - 1].timestamp} >= ${sorted[i].timestamp} at index ${i}`,
                    record: sorted[i]
                });
            }
        }

        // Disallow consecutive duplicate events (same event type back-to-back)
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].event === sorted[i - 1].event) {
                errors.push({
                    index: i,
                    code: "consecutive_duplicate",
                    message: `Consecutive duplicate event '${sorted[i].event}' at index ${i}`,
                    record: sorted[i]
                });
            }
        }

        // Ensure sequence begins with a start event for this job
        const first = sorted[0];
        if (first.event !== "start") {
            errors.push({ index: 0, code: "must_start", message: `Sequence for job ${first.job} must begin with start (found ${first.event} at ${first.timestamp})`, record: first });
        }

        // State-machine validation (forward in time)
        let state: State = "idle";
        for (let i = 0; i < sorted.length; i++) {
            const r = sorted[i];
            const e = r.event;

            if (e === "start") {
                if (state !== "idle") {
                    errors.push({ index: i, code: "unexpected_start", message: `Unexpected start at ${r.timestamp} for job ${r.job}`, record: r });
                }
                state = "running";
                continue;
            }

            if (e === "pause") {
                if (state !== "running") {
                    errors.push({ index: i, code: "unexpected_pause", message: `Unexpected pause at ${r.timestamp} for job ${r.job}`, record: r });
                }
                state = "paused";
                continue;
            }

            if (e === "resume") {
                if (state !== "paused") {
                    errors.push({ index: i, code: "unexpected_resume", message: `Unexpected resume at ${r.timestamp} for job ${r.job}`, record: r });
                }
                state = "running";
                continue;
            }

            if (e === "stop") {
                if (state === "idle") {
                    errors.push({ index: i, code: "unexpected_stop", message: `Unexpected stop at ${r.timestamp} for job ${r.job}`, record: r });
                }
                state = "idle";
                continue;
            }

            // Unknown event type
            errors.push({ index: i, code: "unknown_event", message: `Unknown event '${e}' at ${r.timestamp} for job ${r.job}`, record: r });
        }

        // If requested, order errors starting from latest-first to facilitate fixing recent records first
        if (opts && opts.startFromLatest) {
            errors.sort((a, b) => b.index - a.index);
        } else {
            errors.sort((a, b) => a.index - b.index);
        }

        return errors;
    }

    currentState(): State {
        let state: State = "idle";
        const sorted = this.sorted();
        for (const r of sorted) {
            if (r.event === "start") state = "running";
            else if (r.event === "pause") state = "paused";
            else if (r.event === "resume") state = "running";
            else if (r.event === "stop") state = "idle";
        }
        return state;
    }
}

// no default export; validation lives on EventCollection
