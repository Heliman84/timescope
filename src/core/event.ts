/**
 * Domain types and DTOs for events.
 */
export type EventType = "start" | "stop" | "pause" | "resume";

export type State = "idle" | "running" | "paused";

export interface EventDTO {
    event: EventType;
    job: string;
    timestamp: number;
    task?: string;
}

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
    private readonly _type: EventType;
    private readonly _job: string;
    private readonly _timestamp: number;
    private readonly _task?: string;

    // Private constructor enforces use of factory methods.
    private constructor(dto: EventDTO) {
        this._type = dto.event;
        this._job = dto.job;
        this._timestamp = dto.timestamp;
        this._task = dto.task;
    }

    // Create from a validated DTO. Throws on invalid DTO.
    static create(dto: EventDTO): Event {
        if (typeof dto !== "object" || dto === null) throw new Error("Invalid EventDTO");
        const { event, job, timestamp, task } = dto as EventDTO;
        if (!["start", "stop", "pause", "resume"].includes(event)) throw new Error("Invalid event type");
        if (typeof job !== "string" || job.length === 0) throw new Error("Invalid job");
        if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) throw new Error("Invalid timestamp");
        if (task !== undefined && typeof task !== "string") throw new Error("Invalid task");
        return new Event({ event, job, timestamp, task });
    }

    // Non-throwing parser from a JSONL line. Returns null for headers or malformed lines.
    static fromJSONL(line: string): Event | null {
        try {
            const obj = JSON.parse(line);
            if (!obj || typeof obj !== "object") return null;
            // skip file-level headers
            if ((obj as any)._format_version !== undefined) return null;
            const dto: EventDTO = {
                event: obj.event,
                job: obj.job,
                timestamp: obj.timestamp,
                task: obj.task
            } as EventDTO;
            // Use create to validate DTO; if invalid, let it throw and we catch below
            return Event.create(dto);
        } catch {
            return null;
        }
    }

    // Serialize via the DTO boundary.
    toDTO(): EventDTO {
        const out: EventDTO = { event: this._type, job: this._job, timestamp: this._timestamp };
        if (this._task !== undefined) out.task = this._task;
        return out;
    }

    // JSONL representation. Deterministic key ordering via explicit object construction.
    toJSONL(): string {
        const dto = this.toDTO();
        // Ensure consistent key ordering: event, job, timestamp, task
        // Preserve human-friendly column padding for readability in the JSONL logs.
        const EVENT_PAD = 8; // pad event value to this width
        const JOB_PAD = 30; // pad job value to this width

        const eventVal = JSON.stringify(dto.event); // includes quotes
        const jobVal = JSON.stringify(dto.job);
        const tsVal = String(dto.timestamp);
        const taskVal = dto.task !== undefined ? JSON.stringify(dto.task) : undefined;

        const eventInnerLen = dto.event.length;
        const jobInnerLen = dto.job.length;
        const padEvent = Math.max(1, EVENT_PAD - eventInnerLen);
        const padJob = Math.max(1, JOB_PAD - jobInnerLen);
        const padEventStr = " ".repeat(padEvent);
        const padJobStr = " ".repeat(padJob);

        if (taskVal !== undefined) {
            return `{\"event\":${eventVal}${padEventStr}, \"job\":${jobVal}${padJobStr}, \"timestamp\":${tsVal}, \"task\":${taskVal}` + "}";
        }
        return `{\"event\":${eventVal}${padEventStr}, \"job\":${jobVal}${padJobStr}, \"timestamp\":${tsVal}` + "}";
    }

    toString(): string {
        return this.toJSONL();
    }

    // Read-only accessors
    get type(): EventType { return this._type; }
    get job(): string { return this._job; }
    get timestamp(): number { return this._timestamp; }
    get task(): string | undefined { return this._task; }

    // Domain semantics helpers
    isStart(): boolean { return this._type === "start"; }
    isStop(): boolean { return this._type === "stop"; }
    isPause(): boolean { return this._type === "pause"; }
    isResume(): boolean { return this._type === "resume"; }
    isTerminal(): boolean { return this.isStop(); }

    // Determine whether a transition from this event to `next` is allowed.
    isTransitionAllowed(next: Event): boolean {
        if (this._job !== next._job) return false; // transitions only meaningful for same job
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
        if (this._job !== next._job) {
            return { index: -1, code: "mismatched_job", message: `Transition between different jobs: ${this._job} -> ${next._job}`, record: next.toDTO() };
        }
        if (next.timestamp <= this._timestamp) {
            return { index: -1, code: "timestamp_non_increasing", message: `Timestamps must increase: ${this._timestamp} >= ${next.timestamp}`, record: next.toDTO() };
        }
        if (this._type === next._type) {
            return { index: -1, code: "consecutive_duplicate", message: `Consecutive duplicate event '${this._type}'`, record: next.toDTO() };
        }
        if (!this.isTransitionAllowed(next)) {
            return { index: -1, code: "invalid_transition", message: `Invalid transition ${this._type} -> ${next._type} for job ${this._job}`, record: next.toDTO() };
        }
        return null;
    }

    // Deterministic duration between two events (may be negative if timestamps are out-of-order).
    durationUntil(next: Event): number {
        return next._timestamp - this._timestamp;
    }

    equals(other?: Event): boolean {
        if (!other) return false;
        return this._type === other._type && this._job === other._job && this._timestamp === other._timestamp && (this._task || "") === (other._task || "");
    }

    // Immutable transformations: return a new Event with a single field changed.
    withJob(newJob: string): Event {
        if (typeof newJob !== "string" || newJob.length === 0) throw new Error("Invalid job");
        const dto = this.toDTO();
        dto.job = newJob;
        return Event.create(dto);
    }

    withTimestamp(newTimestamp: number): Event {
        if (typeof newTimestamp !== "number" || !Number.isFinite(newTimestamp)) throw new Error("Invalid timestamp");
        const dto = this.toDTO();
        dto.timestamp = newTimestamp;
        return Event.create(dto);
    }

    withTask(newTask: string | undefined): Event {
        if (newTask !== undefined && typeof newTask !== "string") throw new Error("Invalid task");
        const dto = this.toDTO();
        if (newTask === undefined) delete (dto as any).task;
        else dto.task = newTask;
        return Event.create(dto);
    }
}


/**
 * Collection of `Event` domain objects. Uses domain semantics for validation
 * and serialization boundaries.
 */
export class EventCollection {
    private events: Event[];

    constructor(events?: Event[]) {
        this.events = events ? events.slice() : [];
    }

    static fromArray(events: Event[]): EventCollection {
        return new EventCollection(events);
    }

    // Parse JSONL lines into domain `Event` objects; malformed lines and headers are ignored.
    static fromLines(lines: Iterable<string>): EventCollection {
        const parsed: Event[] = [];
        for (const l of lines) {
            const ev = Event.fromJSONL(l);
            if (ev) parsed.push(ev);
        }
        return new EventCollection(parsed);
    }

    // Backwards-compatible alias
    static parse(lines: Iterable<string>): EventCollection {
        return EventCollection.fromLines(lines);
    }

    // Return JSONL lines for the collection in ascending timestamp order.
    toLines(): string[] {
        return this.sorted().map(e => e.toJSONL());
    }

    serialize(): string[] { return this.toLines(); }

    filterByJob(job: string): EventCollection {
        return new EventCollection(this.events.filter(e => e.job === job));
    }

    sorted(): Event[] {
        return this.events.slice().sort((a, b) => a.timestamp - b.timestamp);
    }

    add(ev: Event): void {
        this.events.push(ev);
    }

    firstEvent(): Event | null {
        return this.events.length > 0 ? this.events[0] : null;
    }

    lastEvent(): Event | null {
        return this.events.length > 0 ? this.events[this.events.length - 1] : null;
    }

    get(index: number): Event {
        if (!Number.isInteger(index) || index < 0 || index >= this.events.length) {
            throw new Error(`Event index out of bounds: ${index}`);
        }
        return this.events[index];
    }

    find(predicate: (e: Event) => boolean): Event | undefined {
        return this.events.find(predicate);
    }

    appendValidated(ev: Event): void {
        const last = this.lastEvent();
        if (!last) {
            if (!ev.isStart()) throw new Error("First event must be start");
            this.events.push(ev);
            return;
        }
        const err = last.validateTransition(ev);
        if (err) throw new Error(err.message);
        this.events.push(ev);
    }

    toEvents(): Event[] { return this.events.slice(); }

    // Compare two events for equality
    static eventsEqual(a: Event, b: Event): boolean { return a.equals(b); }

    // Convenience snake_case alias
    static parse_lines(lines: Iterable<string>): EventCollection { return EventCollection.parse(lines); }
    to_lines(): string[] { return this.serialize(); }

    // Immutable operations
    replaceEvent(oldEvent: Event, newEvent: Event): EventCollection {
        const idx = this.events.findIndex(e => e.equals(oldEvent));
        if (idx === -1) return new EventCollection(this.events);
        const next = this.events.slice();
        next[idx] = newEvent;
        return new EventCollection(next);
    }

    mapEvents(fn: (e: Event) => Event): EventCollection {
        const mapped = this.events.map(e => fn(e));
        return new EventCollection(mapped);
    }

    renameJob(oldName: string, newName: string): EventCollection {
        return this.mapEvents(e => (e.job === oldName ? e.withJob(newName) : e));
    }

    retimeEvent(target: Event, newTimestamp: number): EventCollection {
        return this.updateEvent(target, e => e.withTimestamp(newTimestamp));
    }

    updateEvent(target: Event, updater: (e: Event) => Event): EventCollection {
        const idx = this.events.findIndex(e => e.equals(target));
        if (idx === -1) return new EventCollection(this.events);
        const copy = this.events.slice();
        const updated = updater(copy[idx]);
        copy[idx] = updated;
        return new EventCollection(copy);
    }

    // Rewrite allows mapping to a replacement Event or returning null to remove the event.
    rewrite(fn: (e: Event) => Event | null): EventCollection {
        const out: Event[] = [];
        for (const e of this.events) {
            const r = fn(e);
            if (r) out.push(r);
        }
        return new EventCollection(out);
    }

    // Validate the collection using domain semantics.
    validate(opts?: { startFromLatest?: boolean }): ValidationError[] {
        const errors: ValidationError[] = [];
        const sorted = this.sorted();
        if (sorted.length === 0) return errors;

        // Ensure sequence begins with start for the first event
        const first = sorted[0];
        if (!first.isStart()) {
            errors.push({ index: 0, code: "must_start", message: `Sequence for job ${first.job} must begin with start (found ${first.type} at ${first.timestamp})`, record: first.toDTO() });
        }

        for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1];
            const cur = sorted[i];
            const vt = prev.validateTransition(cur);
            if (vt) {
                vt.index = i;
                errors.push(vt);
            }
        }

        // Sort errors per request
        if (opts && opts.startFromLatest) errors.sort((a, b) => b.index - a.index);
        else errors.sort((a, b) => a.index - b.index);

        return errors;
    }

    currentState(): State {
        let state: State = "idle";
        for (const r of this.sorted()) {
            if (r.isStart()) state = "running";
            else if (r.isPause()) state = "paused";
            else if (r.isResume()) state = "running";
            else if (r.isStop()) state = "idle";
        }
        return state;
    }
}

// No default export; validation lives on EventCollection and Event
