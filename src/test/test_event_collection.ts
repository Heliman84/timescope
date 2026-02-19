import * as assert from "assert";
import { Event } from "../core/event";
import { EventCollection } from "../core/event_collection";
import { Job } from "../core/job";

function r(e: "start"|"pause"|"resume"|"stop", t: number, jobTitle = "job1", task?: string): Event {
    const job = Job.create({ title: jobTitle });
    return Event.create(job, e, t, task);
}

/**
 * test_event_collection_validation
 * Target: `src/core/event.ts::EventCollection`
 * Purpose: Validate common and edge-case event sequences (start/pause/resume/stop),
 * ensuring the validator emits appropriate structured errors for invalid sequences.
 */
export function run_event_collection_tests(): void {
    // Valid: start -> pause -> resume -> stop
    const seq1 = new EventCollection([r("start", 100), r("pause", 200), r("resume", 300), r("stop", 400)]);
    const errs1 = seq1.validate();
    assert.strictEqual(errs1.length, 0, `expected no errors, got ${errs1.map(e => e.message).join(';')}`);

    // Invalid: start -> resume (no pause)
    const seq2 = new EventCollection([r("start", 100), r("resume", 200)]);
    const errs2 = seq2.validate();
    assert.strictEqual(errs2.length > 0, true, "expected error for resume without pause");
    assert.ok(errs2.some(m => m.code === "invalid_transition"), `expected invalid_transition, got ${errs2.map(e => e.message).join(';')}`);

    // Invalid: stop as first event
    const seq3 = new EventCollection([r("stop", 100, "job2", "x")]);
    const errs3 = seq3.validate();
    assert.strictEqual(errs3.length > 0, true, "expected error for stop-first");
    assert.ok(errs3.some(m => m.code === "must_start"), `expected must_start, got ${errs3.map(e => e.message).join(';')}`);

    // Valid: multiple runs start/stop/start/stop
    const seq4 = new EventCollection([r("start", 10), r("stop", 20), r("start", 30), r("stop", 40)]);
    const errs4 = seq4.validate();
    assert.strictEqual(errs4.length, 0, `expected no errors for multi-run, got ${errs4.map(e => e.message).join(';')}`);

    // Invalid: consecutive duplicate events (pause then pause)
    const seq5 = new EventCollection([r("start", 100), r("pause", 200), r("pause", 300), r("stop", 400)]);
    const errs5 = seq5.validate();
    assert.strictEqual(errs5.length > 0, true, "expected error for consecutive duplicate events");
    assert.ok(errs5.some(e => e.code === "consecutive_duplicate"), `expected consecutive_duplicate, got ${errs5.map(e => e.message).join(';')}`);

    // Invalid: non-increasing timestamps (duplicate timestamp)
    const seq6 = new EventCollection([r("start", 100), r("pause", 200), r("resume", 200), r("stop", 300)]);
    const errs6 = seq6.validate();
    assert.strictEqual(errs6.length > 0, true, "expected error for non-increasing timestamps");
    assert.ok(errs6.some(e => e.code === "timestamp_non_increasing"), `expected timestamp_non_increasing, got ${errs6.map(e => e.message).join(';')}`);

    // Invalid: unexpected start while running (start, start, stop)
    const seq7 = new EventCollection([r("start", 100), r("start", 150), r("stop", 200)]);
    const errs7 = seq7.validate();
    assert.strictEqual(errs7.length > 0, true, "expected error for unexpected start");
    assert.ok(errs7.some(e => e.code === "consecutive_duplicate"), `expected consecutive_duplicate, got ${errs7.map(e => e.message).join(';')}`);

    // Invalid: pause without prior start (pause first)
    const seq8 = new EventCollection([r("pause", 50), r("start", 100), r("stop", 200)]);
    const errs8 = seq8.validate();
    assert.strictEqual(errs8.length > 0, true, "expected error for pause without start");
    assert.ok(errs8.some(e => e.code === "must_start"), `expected must_start, got ${errs8.map(e => e.message).join(';')}`);

    // Note: invalid/unknown event types are rejected at construction in the
    // Event domain (Event.create throws). We omit the old unknown_event test.

    // Duplicate start detection
    const seq10 = new EventCollection([r("start", 1), r("start", 2)]);
    const errs10 = seq10.validate();
    assert.strictEqual(errs10.length > 0, true, "expected error for duplicate start");
    assert.ok(errs10.some(e => e.code === "consecutive_duplicate"), `expected consecutive_duplicate, got ${errs10.map(e => e.message).join(';')}`);

    // Ordering: validate returns errors ordered latest-first when requested
    const seq11 = new EventCollection([r("start", 100), r("resume", 200), r("pause", 300), r("resume", 300)]);
    const errs11 = seq11.validate({ startFromLatest: true });
    if (errs11.length >= 2) {
        assert.ok(errs11[0].index >= errs11[1].index, `expected latest-first ordering, got indices ${errs11[0].index}, ${errs11[1].index}`);
    }

    console.log("✅ event collection tests passed");
}
