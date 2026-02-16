import { Event, EventCollection } from "./event";

export class Session {
    private readonly jobName: string;
    private readonly events: EventCollection;

    constructor(job: string, events?: EventCollection) {
        if (typeof job !== "string" || job.length === 0) throw new Error("Invalid job");
        this.jobName = job;
        this.events = events ? events.filterByJob(job) : new EventCollection();
    }

    static fromEvents(events: Event[]): Session {
        if (events.length === 0) {
            throw new Error("Cannot create Session from empty event list");
        }

        const job = events[0].job;

        // Optional: validate all events belong to the same job
        for (const e of events) {
            if (e.job !== job) {
                throw new Error("Events contain multiple jobs");
            }
        }

        return new Session(job, EventCollection.fromEvents(events));
    }


    static fromCollection(collection: EventCollection): Session {
        const job = collection.firstEvent()?.job;
        if (!job) {
            throw new Error("Cannot create Session from empty EventCollection");
        }

        return new Session(job, collection);
    }

    get currentJob(): string {
        return this.jobName;
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

    get isIdle(): boolean {
        const last = this.lastEvent;
        return !last || last.isStop();
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

    start(timestamp: number = Date.now()): Event {
        if (!this.isIdle) throw new Error("Cannot start; session already active");
        const event = Event.create({ event: "start", job: this.jobName, timestamp });
        this.events.appendValidated(event);
        return event;
    }

    pause(timestamp: number = Date.now()): Event {
        if (!this.isRunning) throw new Error("Cannot pause; session is not running");
        const event = Event.create({ event: "pause", job: this.jobName, timestamp });
        this.events.appendValidated(event);
        return event;
    }

    resume(timestamp: number = Date.now()): Event {
        if (!this.isPaused) throw new Error("Cannot resume; session is not paused");
        const event = Event.create({ event: "resume", job: this.jobName, timestamp });
        this.events.appendValidated(event);
        return event;
    }

    stop(task: string | undefined, timestamp: number = Date.now()): Event {
        if (!this.isRunning && !this.isPaused) throw new Error("Cannot stop; session is not active");
        const event = Event.create({ event: "stop", job: this.jobName, timestamp, task });
        this.events.appendValidated(event);
        return event;
    }

    toEventCollection(): EventCollection {
        return EventCollection.fromEvents(this.events.toEvents());
    }
}
