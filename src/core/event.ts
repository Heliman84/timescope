/**
 * Domain types and DTOs for events.
 */
export type EventType = "start" | "stop" | "pause" | "resume";

export type State = "idle" | "running" | "paused";

import { EventDTO } from "./event_dto";
import { Job } from "./job";

export interface ValidationError {
    index: number;
    code: string;
    message: string;
    record?: EventDTO;
}

/**
 * Immutable domain object representing a single Event.
 * All semantics and transitions live on this class.
 */
export class Event {
    private readonly _id: string;
    private readonly _type: EventType;
    private readonly _job: Job;
    private readonly _timestamp: number;
    private readonly _task?: string;
    private readonly _time_seed: number;

    // Private constructor enforces use of factory methods.
    private constructor(fields: {
        id: string;
        type: EventType;
        job: Job;
        timestamp: number;
        task?: string;
        time_seed: number;
    }) {
        this._id = fields.id;
        this._type = fields.type;
        this._job = fields.job;
        this._timestamp = fields.timestamp;
        this._task = fields.task;
        this._time_seed = fields.time_seed;
    }

    /**
     * Create a new Event from a Job domain object.
     * Generates a deterministic record ID from the timestamp, event type, and job identity.
     */
    static create(job: Job, type: EventType, timestamp: number, task?: string): Event {
        if (!(job instanceof Job)) throw new Error("Event.create: 'job' must be a Job instance");
        if (!["start", "stop", "pause", "resume"].includes(type)) throw new Error("Event.create: invalid 'type'");
        if (!Number.isFinite(timestamp)) throw new Error("Event.create: 'timestamp' must be finite");
        if (task !== undefined && typeof task !== "string") throw new Error("Event.create: 'task' must be a string");

        const time_seed = timestamp;
        const id = Event.generate_record_id(time_seed, type, job.id);

        return new Event({
            id,
            type,
            job,
            timestamp,
            task,
            time_seed,
        });
    }


    // Reconstruct from a validated, canonical DTO. Throws on any deviation.
    static fromDTO(dto: EventDTO): Event {
        if (typeof dto !== "object" || dto === null) throw new Error("Event.fromDTO: input must be an object");

        const required = ["id", "event", "job_title", "timestamp", "job_id", "time_seed"];
        const optional = ["task"];
        const keys = Object.keys(dto as any);

        for (const k of required) {
            if (!keys.includes(k)) throw new Error(`Event.fromDTO: missing required field '${k}'`);
        }
        for (const k of keys) {
            if (!required.includes(k) && !optional.includes(k)) throw new Error(`Event.fromDTO: unexpected field '${k}'`);
        }

        if (typeof dto.id !== "string") throw new Error("Event.fromDTO: 'id' must be a string");
        if (typeof dto.event !== "string" || !["start", "stop", "pause", "resume"].includes(dto.event)) throw new Error("Event.fromDTO: invalid 'event' value");
        if (typeof dto.job_title !== "string" || dto.job_title.length === 0) throw new Error("Event.fromDTO: 'job_title' must be a non-empty string");
        if (typeof dto.timestamp !== "number" || !Number.isFinite(dto.timestamp)) throw new Error("Event.fromDTO: 'timestamp' must be a finite number");
        if (dto.task !== undefined && typeof dto.task !== "string") throw new Error("Event.fromDTO: 'task' must be a string when present");
        if (typeof dto.job_id !== "string" || dto.job_id.length === 0) throw new Error("Event.fromDTO: 'job_id' must be a non-empty string");
        if (typeof dto.time_seed !== "number" || !Number.isFinite(dto.time_seed)) throw new Error("Event.fromDTO: 'time_seed' must be a finite number");

        return new Event({
            id: dto.id,
            type: dto.event as EventType,
            job: Job.fromEventFields(dto.job_id, dto.job_title),
            timestamp: dto.timestamp,
            task: dto.task,
            time_seed: dto.time_seed,
        });
    }

    // Non-throwing parser from a JSONL line. Returns null for headers or malformed lines.
    static fromJSONL(line: string): Event | null {
        try {
            const obj = JSON.parse(line);
            if (!obj || typeof obj !== "object") return null;
            // skip file-level headers
            if ((obj as any)._format_version !== undefined) return null;
            // Require canonical fields per spec; if missing or invalid, return null (malformed)
            if (typeof obj.id !== "string") return null;
            if (typeof obj.event !== "string") return null;
            if (typeof obj.job !== "string") return null;
            if (typeof obj.timestamp !== "number") return null;
            if (typeof obj.job_id !== "string") return null;
            if (typeof obj.time_seed !== "number") return null;

            const dto: EventDTO = {
                id: obj.id,
                event: obj.event,
                job_title: obj.job,
                timestamp: obj.timestamp,
                job_id: obj.job_id,
                time_seed: obj.time_seed
            } as EventDTO;
            if (obj.task !== undefined) dto.task = obj.task;

            return Event.fromDTO(dto);
        } catch {
            return null;
        }
    }

    // Serialize via the DTO boundary.
    toDTO(): EventDTO {
        return {
            id: this._id,
            event: this._type,
            job_title: this._job.title,
            timestamp: this._timestamp,
            ...(this._task !== undefined ? { task: this._task } : {}),
            job_id: this._job.id,
            time_seed: this._time_seed
        };
    }

    // JSONL representation. Deterministic key ordering via explicit object construction.
    toJSONL(): string {
        const dto = this.toDTO();
        // Ensure consistent key ordering: id, event, job, timestamp, task, job_id, time_seed
        // Preserve human-friendly column padding for readability in the JSONL logs.
        const EVENT_PAD = 8; // pad event value to this width
        const JOB_PAD = 30; // pad job value to this width
        const idVal = JSON.stringify(dto.id);
        const eventVal = JSON.stringify(dto.event); // includes quotes
        const jobVal = JSON.stringify(dto.job_title);
        const tsVal = String(dto.timestamp);
        const taskVal = dto.task !== undefined ? JSON.stringify(dto.task) : undefined;
        const jobIdVal = JSON.stringify(dto.job_id);
        const timeSeedVal = String(dto.time_seed);

        const eventInnerLen = dto.event.length;
        const jobInnerLen = dto.job_title.length;
        const padEvent = Math.max(1, EVENT_PAD - eventInnerLen);
        const padJob = Math.max(1, JOB_PAD - jobInnerLen);
        const padEventStr = " ".repeat(padEvent);
        const padJobStr = " ".repeat(padJob);

        // Column alignment: the ID value starts at the same position for all event types.
        // start/stop:   {"id":  "value"  — 2 spaces after the colon (before value)
        // pause/resume: {  "id":"value"  — 2 spaces after { (before key)
        const isPauseResume = dto.event === "pause" || dto.event === "resume";
        const idPrefix = isPauseResume ? "{  \"id\":" : "{\"id\":  ";
        const eventGap = "  ";

        if (taskVal !== undefined) {
            return `${idPrefix}${idVal},${eventGap}\"event\":${eventVal}${padEventStr}, \"job\":${jobVal}${padJobStr}, \"timestamp\":${tsVal}, \"task\":${taskVal}, \"job_id\":${jobIdVal}, \"time_seed\":${timeSeedVal}` + "}";
        }
        const TASK_PLACEHOLDER = " ".repeat(12); // visual alignment when task is absent
        return `${idPrefix}${idVal},${eventGap}\"event\":${eventVal}${padEventStr}, \"job\":${jobVal}${padJobStr}, \"timestamp\":${tsVal},${TASK_PLACEHOLDER} \"job_id\":${jobIdVal}, \"time_seed\":${timeSeedVal}` + "}";
    }

    toString(): string {
        return this.toJSONL();
    }

    // Read-only accessors
    get type(): EventType { return this._type; }
    get job(): Job { return this._job; }
    get job_title(): string { return this._job.title; }
    get timestamp(): number { return this._timestamp; }
    get task(): string | undefined { return this._task; }
    get id(): string { return this._id; }
    get job_id(): string { return this._job.id; }
    get time_seed(): number { return this._time_seed; }
    /** The full Job domain object associated with this event. */
    get jobObject(): Job { return this._job; }

    // Domain semantics helpers
    isStart(): boolean { return this._type === "start"; }
    isStop(): boolean { return this._type === "stop"; }
    isPause(): boolean { return this._type === "pause"; }
    isResume(): boolean { return this._type === "resume"; }
    isTerminal(): boolean { return this.isStop(); }

    // Determine whether a transition from this event to `next` is allowed.
    isTransitionAllowed(next: Event): boolean {
        if (!this._job.equals(next._job)) return false; // transitions only meaningful for same job
        if (this._type === next._type) return false; // disallow consecutive duplicates

        switch (this._type) {
            case "start":
                return next.isPause() || next.isStop();
            case "pause":
                return next.isResume() || next.isStop();
            case "resume":
                return next.isPause() || next.isStop();
            case "stop":
                return next.isStart(); // new run may start after stop
            default:
                return false;
        }
    }

    // Validate a transition; returns a ValidationError describing the violation or null when allowed.
    validateTransition(next: Event): ValidationError | null {
        if (!this._job.equals(next._job)) {
            return { index: -1, code: "mismatched_job", message: `Transition between different jobs: ${this._job.title} -> ${next._job.title}`, record: next.toDTO() };
        }
        if (next.timestamp <= this._timestamp) {
            return { index: -1, code: "timestamp_non_increasing", message: `Timestamps must increase: ${this._timestamp} >= ${next.timestamp}`, record: next.toDTO() };
        }
        if (this._type === next._type) {
            return { index: -1, code: "consecutive_duplicate", message: `Consecutive duplicate event '${this._type}'`, record: next.toDTO() };
        }
        if (!this.isTransitionAllowed(next)) {
            return { index: -1, code: "invalid_transition", message: `Invalid transition ${this._type} -> ${next._type} for job ${this._job.title}`, record: next.toDTO() };
        }
        return null;
    }

    // Deterministic duration between two events (may be negative if timestamps are out-of-order).
    durationUntil(next: Event): number {
        return next._timestamp - this._timestamp;
    }

    equals(other?: Event): boolean {
        if (!other) return false;
        return this._type === other._type && this._job.equals(other._job) && this._timestamp === other._timestamp && (this._task || "") === (other._task || "");
    }

    // Immutable transformations: return a new Event with a single field changed.
    // These bypass the DTO boundary to preserve the full Job domain object.
    withJob(newJob: Job): Event {
        if (!(newJob instanceof Job)) throw new Error("Invalid job");
        return new Event({
            id: this._id,
            type: this._type,
            job: newJob,
            timestamp: this._timestamp,
            task: this._task,
            time_seed: this._time_seed,
        });
    }

    withTimestamp(newTimestamp: number): Event {
        if (typeof newTimestamp !== "number" || !Number.isFinite(newTimestamp)) throw new Error("Invalid timestamp");
        return new Event({
            id: this._id,
            type: this._type,
            job: this._job,
            timestamp: newTimestamp,
            task: this._task,
            time_seed: this._time_seed,
        });
    }

    withTask(newTask: string | undefined): Event {
        if (newTask !== undefined && typeof newTask !== "string") throw new Error("Invalid task");
        return new Event({
            id: this._id,
            type: this._type,
            job: this._job,
            timestamp: this._timestamp,
            task: newTask,
            time_seed: this._time_seed,
        });
    }

    // ------------------------------------------------------------------
    // Record ID generation (per record_id_spec.md)
    // ------------------------------------------------------------------

    /**
     * Generate a deterministic event record ID: `<time5>-<bucket1>-<jobHash3>`.
     * @param time_seed  Original Unix ms timestamp (immutable identity input).
     * @param event_type The event type (start | stop | pause | resume).
     * @param job_id     The stable, immutable job identifier.
     */
    static generate_record_id(time_seed: number, event_type: EventType, job_id: string): string {
        const time5 = Event.compute_time5(time_seed);
        const bucket1 = Event.compute_bucket1(time_seed, event_type);
        const job_hash3 = Event.compute_job_hash3(job_id);
        return `${time5}-${bucket1}-${job_hash3}`;
    }

    /**
     * Base-36 encode the seconds portion of a Unix ms timestamp, left-padded to 5 chars.
     */
    static compute_time5(timestamp_ms: number): string {
        const seconds = Math.floor(timestamp_ms / 1000);
        return (seconds >>> 0).toString(36).padStart(5, '0').slice(-5);
    }

    /**
     * Compute the single base-36 bucket character from ms-within-second and event type.
     *
     * bucket   = floor(ms_part / 111)          → 0–8  (999ms maps to 8)
     * type_ord = start:0 | pause:1 | resume:2 | stop:3
     * value    = bucket * 4 + type_ord          → 0–35
     */
    static compute_bucket1(timestamp_ms: number, event_type: EventType): string {
        const ms_part = Math.floor(timestamp_ms) % 1000;
        const bucket = Math.min(Math.floor(ms_part / 111), 8); // 0-8 (edge: 999ms → 8, not 9)
        const type_map: Record<EventType, number> = { start: 0, pause: 1, resume: 2, stop: 3 };
        const type_ord = type_map[event_type];
        const value = bucket * 4 + type_ord;              // 0-35
        return value.toString(36);
    }

    /**
     * Stable 3-character hash of a job_id using FNV-1a 32-bit, base-36 encoded.
     */
    static compute_job_hash3(job_id: string): string {
        const hash32 = Event.fnv1a32(job_id);
        return (hash32 >>> 0).toString(36).toLowerCase().padStart(3, '0').slice(0, 3);
    }

    /** FNV-1a 32-bit hash — deterministic and platform-independent over UTF-16 code units. */
    private static fnv1a32(str: string): number {
        let h = 0x811c9dc5 >>> 0;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h >>> 0;
    }
}

