import { Event, EventCollection } from "./event";

export interface SessionValidationError {
    index: number;
    code: string;
    message: string;
    record?: Event;
}

export class Session {
    private readonly jobName: string;
    private readonly events: EventCollection;

    constructor(job: string, events?: EventCollection) {
        if (typeof job !== "string" || job.length === 0) throw new Error("Invalid job");
        this.jobName = job;
        const incoming = events ? events.toEvents() : [];
        if (incoming.length > 0) {
            const errors = this.ensureSingleSession(incoming, job);
            if (errors.length > 0) throw new Error(errors[0].message);
            this.events = EventCollection.fromEvents(incoming);
        } else {
            this.events = new EventCollection();
        }
    }

    static fromEvents(events: Event[]): Session {
        if (events.length === 0) throw new Error("Cannot create Session from empty event list");
        const job = events[0].job;
        return new Session(job, EventCollection.fromEvents(events));
    }


    static fromCollection(collection: EventCollection): Session {
        const job = collection.firstEvent()?.job;
        if (!job) {
            throw new Error("Cannot create Session from empty EventCollection");
        }

        return new Session(job, collection);
    }

    static validateEvents(events: Event[], job?: string): SessionValidationError[] {
        if (events.length === 0) {
            return [{ index: -1, code: "empty", message: "Session requires at least one event" }];
        }
        const targetJob = job || events[0].job;
        const session = new Session(targetJob);
        return session.ensureSingleSession(events, targetJob);
    }

    static start(job: string, timestamp: number = Date.now()): Session {
        const session = new Session(job);
        session.start(timestamp);
        return session;
    }

    private ensureSingleSession(events: Event[], job: string): SessionValidationError[] {
        const errors: SessionValidationError[] = [];
        let stopped = false;

        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (ev.job !== job) {
                errors.push({ index: i, code: "mismatched_job", message: "Events contain multiple jobs", record: ev });
                continue;
            }
            if (i === 0 && !ev.isStart()) {
                errors.push({ index: i, code: "must_start", message: "Session must begin with start event", record: ev });
                continue;
            }
            if (i > 0 && ev.isStart()) {
                errors.push({ index: i, code: "multiple_start", message: "Session cannot contain multiple start events", record: ev });
                continue;
            }
            if (stopped) {
                errors.push({ index: i, code: "after_stop", message: "Session cannot contain events after stop", record: ev });
                continue;
            }
            if (i > 0) {
                const prev = events[i - 1];
                const err = prev.validateTransition(ev);
                if (err) {
                    errors.push({ index: i, code: err.code, message: err.message, record: ev });
                    continue;
                }
            }
            if (ev.isStop()) stopped = true;
        }

        return errors;
    }

    get currentJob(): string {
        return this.jobName;
    }

    get startEvent(): Event | null {
        const first = this.events.firstEvent();
        return first && first.isStart() ? first : null;
    }

    get stopEvent(): Event | null {
        const last = this.events.lastEvent();
        return last && last.isStop() ? last : null;
    }

    get lastEvent(): Event | null {
        return this.events.lastEvent();
    }

    get isRunning(): boolean {
        const last = this.lastEvent;
        return !!last && (last.isStart() || last.isResume());
    }

    get isPaused(): boolean {
        const last = this.lastEvent;
        return !!last && last.isPause();
    }

    get isStopped(): boolean {
        const last = this.lastEvent;
        return !!last && last.isStop();
    }

    get isOpen(): boolean {
        return !this.isStopped;
    }

    elapsed(now: number = Date.now()): number {
        const sorted = this.events.sorted();
        let total = 0;
        let runningStart: number | null = null;

        for (const ev of sorted) {
            if (ev.isStart() || ev.isResume()) {
                runningStart = ev.timestamp;
                continue;
            }
            if (ev.isPause() || ev.isStop()) {
                if (runningStart !== null) {
                    total += ev.timestamp - runningStart;
                    runningStart = null;
                }
            }
        }

        if (runningStart !== null) {
            total += now - runningStart;
        }

        return total;
    }

    /**
     * Compute the total elapsed running time for the session, excluding paused intervals.
     *
     * - If the session is closed (stopped) this returns the duration between start/stop
     *   events minus any paused intervals.
     * - If the session is not closed then the `openUseNow` flag controls how the
     *   ongoing segment is treated:
     *     - `openUseNow === true` (default): include the time from the last start/resume to `now`.
     *     - `openUseNow === false`: exclude any currently-running segment and only count
     *       completed running segments (i.e. up to the last pause event).
     *
     * The `now` parameter is used when including the ongoing segment; it defaults to Date.now().
     */
    totalElapsed(now: number = Date.now(), openUseNow: boolean = true): number {
        const sorted = this.events.sorted();
        let total = 0;
        let runningStart: number | null = null;

        for (const ev of sorted) {
            if (ev.isStart() || ev.isResume()) {
                runningStart = ev.timestamp;
                continue;
            }
            if (ev.isPause() || ev.isStop()) {
                if (runningStart !== null) {
                    total += ev.timestamp - runningStart;
                    runningStart = null;
                }
            }
        }

        // If there is an ongoing running segment and the caller asked to include it,
        // add the time from the last start/resume to `now`. If the session is open and
        // openUseNow is false, we deliberately do not include the ongoing segment.
        if (runningStart !== null && openUseNow) {
            total += now - runningStart;
        }

        return total;
    }

    appendEvent(event: Event): void {
        if (event.job !== this.jobName) throw new Error("Event job does not match session job");
        const last = this.lastEvent;
        if (!last) {
            if (!event.isStart()) throw new Error("Session must begin with start event");
            this.events.add(event);
            return;
        }
        if (event.isStart()) throw new Error("Session already started");
        if (this.isStopped) throw new Error("Cannot append events after stop");

        const err = last.validateTransition(event);
        if (err) throw new Error(err.message);
        this.events.add(event);
    }

    start(timestamp: number = Date.now()): Event {
        if (this.lastEvent) throw new Error("Session already started");
        const event = Event.create({ event: "start", job: this.jobName, timestamp });
        this.appendEvent(event);
        return event;
    }

    pause(timestamp: number = Date.now()): Event {
        if (!this.isRunning) throw new Error("Cannot pause; session is not running");
        const event = Event.create({ event: "pause", job: this.jobName, timestamp });
        this.appendEvent(event);
        return event;
    }

    resume(timestamp: number = Date.now()): Event {
        if (!this.isPaused) throw new Error("Cannot resume; session is not paused");
        const event = Event.create({ event: "resume", job: this.jobName, timestamp });
        this.appendEvent(event);
        return event;
    }

    stop(task: string | undefined, timestamp: number = Date.now()): Event {
        if (!this.isOpen) throw new Error("Cannot stop; session already stopped");
        const event = Event.create({ event: "stop", job: this.jobName, timestamp, task });
        this.appendEvent(event);
        return event;
    }

    equals(other: Session): boolean {
        if (this.jobName !== other.jobName) return false;
        const startA = this.startEvent?.timestamp ?? null;
        const startB = other.startEvent?.timestamp ?? null;
        if (startA !== startB) return false;

        const stopA = this.stopEvent?.timestamp ?? null;
        const stopB = other.stopEvent?.timestamp ?? null;
        if (stopA !== stopB) return false;

        const a = this.events.toEvents();
        const b = other.events.toEvents();
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!a[i].equals(b[i])) return false;
        }
        return true;
    }

    toEventCollection(): EventCollection {
        return EventCollection.fromEvents(this.events.toEvents());
    }
}
