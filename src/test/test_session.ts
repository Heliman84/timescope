import * as assert from "assert";
import { Job } from "../core/job";
import { Session } from "../core/session";
import { Event } from "../core/event";

function ev(job: Job, type: "start" | "stop" | "pause" | "resume", ts: number, task?: string): Event {
    return Event.create(job, type, ts, task);
}

/** Happy path: start → pause → resume → stop, elapsed accounting */
export function run_session_happy_path_tests(): void {
    const job = Job.create({ title: "sess" });
    const s = Session.start(job, 1000);
    s.pause(1500);
    s.resume(2000);
    s.stop("work", 3000);

    assert.ok(s.startEvent && s.stopEvent, "session should have start and stop");
    assert.strictEqual(s.lastEvent?.type, "stop");

    // elapsed: running 1000-1500 (500) + 2000-3000 (1000) = 1500
    assert.strictEqual(s.totalElapsed(3000, true), 1500);
    assert.strictEqual(s.elapsed(3000), 1500);
}

/** Invalid transitions and guards (job mismatch, duplicates, illegal order). */
export function run_session_invalid_transition_tests(): void {
    const job = Job.create({ title: "sess" });
    const other = Job.create({ title: "other" });

    // Start twice
    const s1 = Session.start(job, 10);
    assert.throws(() => s1.start(20), /already started/i);

    // Resume without pause
    const s2 = Session.start(job, 10);
    assert.throws(() => s2.appendEvent(ev(job, "resume", 15)), /Invalid transition|resume/i);

    // Pause without running
    const s3 = new Session(job);
    assert.throws(() => s3.pause(5), /not running/i);

    // Pause twice
    const s4 = Session.start(job, 10);
    s4.pause(20);
    assert.throws(() => s4.pause(25), /Cannot pause|invalid transition|duplicate/i);

    // Resume twice
    const s5 = Session.start(job, 10);
    s5.pause(20);
    s5.resume(30);
    assert.throws(() => s5.resume(40), /Cannot resume|invalid transition|duplicate/i);

    // Stop twice
    const s6 = Session.start(job, 10);
    s6.stop(undefined, 20);
    assert.throws(() => s6.stop(undefined, 30), /already stopped|Cannot stop/i);

    // Append after stop
    assert.throws(() => s6.appendEvent(ev(job, "pause", 40)), /after stop|already stopped/i);

    // Job mismatch
    const s7 = Session.start(job, 10);
    assert.throws(() => s7.appendEvent(ev(other, "pause", 15)), /does not match session job/);

    // Exhaustive invalid pairs (start -> resume, pause -> start, resume -> resume, stop -> anything)
    const pairs: Array<[Event, Event, RegExp]> = [
        [ev(job, "start", 1), ev(job, "resume", 2), /invalid transition|resume/],
        [ev(job, "start", 1), ev(job, "pause", 2), /ok/], // allowed, control separately
        [ev(job, "pause", 1), ev(job, "start", 2), /must begin|start/],
        [ev(job, "resume", 1), ev(job, "resume", 2), /duplicate|invalid transition/],
        [ev(job, "stop", 1), ev(job, "start", 2), /Cannot append|already stopped/],
    ];

    // For allowed pair (start->pause) ensure no throw
    const allowed = Session.fromEvents([ev(job, "start", 1), ev(job, "pause", 2)]);
    assert.ok(allowed.isPaused);

    for (const [a, b, re] of pairs) {
        try {
            const sess = Session.fromEvents([a]);
            if (a.isStop()) {
                assert.throws(() => sess.appendEvent(b), re);
            } else {
                assert.throws(() => sess.appendEvent(b), re);
            }
        } catch (err) {
            // If construction fails (e.g., starting with pause/resume/stop), that's expected invalid
            if (re.source === "ok") continue;
            assert.ok(re.test(String(err)), `expected ${re} but got ${String(err)}`);
        }
    }
}

/** Elapsed behavior for open sessions with openUseNow flag. */
export function run_session_elapsed_open_segment_tests(): void {
    const job = Job.create({ title: "elapsed" });
    const s = Session.start(job, 0);
    s.pause(1000);
    s.resume(2000);
    // leave session open at now=2500
    assert.strictEqual(s.totalElapsed(2500, true), 1500, "include ongoing segment");
    assert.strictEqual(s.totalElapsed(2500, false), 1000, "exclude ongoing segment");
}

/** Equality and collection round-trip. */
export function run_session_equality_tests(): void {
    const job = Job.create({ title: "eq" });
    const events = [ev(job, "start", 1), ev(job, "stop", 2)];
    const s1 = Session.fromEvents(events);
    const s2 = Session.fromCollection(s1.toEventCollection());
    assert.ok(s1.equals(s2), "sessions reconstructed should be equal");
}