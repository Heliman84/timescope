import { Event, ValidationError, State } from "./event";
import { Job } from "./job";

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

    /**
     * Update all events that reference the given Job (matching by id) to use the
     * provided Job domain object. Returns a new EventCollection.
     */
    withUpdatedJob(job: Job): EventCollection {
        if (!(job instanceof Job)) throw new Error('withUpdatedJob: job must be a Job');
        const mapped = this.events.map(e => (e.job_id === job.id ? e.withJob(job) : e));
        return new EventCollection(mapped);
    }

    /**
     * Convenience: rename all events referencing `oldName` to use `newName`.
     * Preserves the underlying Job.id by calling `Job.rename` on each event's Job.
     */
    renameJob(oldName: string, newName: string): EventCollection {
        if (typeof oldName !== 'string' || typeof newName !== 'string') throw new Error('renameJob: names must be strings');
        if (oldName === newName) return new EventCollection(this.events);
        const mapped = this.events.map(e => {
            if (e.job_title === oldName) {
                const newJob = e.job.rename(newName);
                return e.withJob(newJob);
            }
            return e;
        });
        return new EventCollection(mapped);
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
            errors.push({ index: 0, code: "must_start", message: `Sequence for job ${first.job_title} must begin with start (found ${first.type} at ${first.timestamp})`, record: first.toDTO() });
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
