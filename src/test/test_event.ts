import * as assert from "assert";
import { Event } from "../core/event";
import { Job } from "../core/job";

function job(title = "alpha"): Job { return Job.create({ title }); }
function ev(j: Job, type: "start" | "stop" | "pause" | "resume", ts: number, task?: string): Event {
    return Event.create(j, type, ts, task);
}

// ═══════════════════════════════════════════════════════════════════════════
// Event.create validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests Event.create factory validation:
 * - Target: Event.create in src/core/event.ts
 * - What: rejects invalid inputs (bad job, bad type, non-finite timestamp, bad task).
 * - Does: calls create with various invalid args and asserts throws.
 * - Why: constructor guards protect domain invariants.
 */
export function run_event_create_validation_tests(): void {
    const j = job();

    // Valid creation
    const e = ev(j, "start", 1000);
    assert.strictEqual(e.type, "start");
    assert.strictEqual(e.timestamp, 1000);
    assert.strictEqual(e.job_title, "alpha");
    assert.strictEqual(e.task, undefined);

    // With task
    const e2 = ev(j, "stop", 2000, "my task");
    assert.strictEqual(e2.task, "my task");

    // Invalid type
    assert.throws(() => Event.create(j, "invalid" as any, 1000), /invalid 'type'/);

    // Non-finite timestamp
    assert.throws(() => Event.create(j, "start", NaN), /must be finite/);
    assert.throws(() => Event.create(j, "start", Infinity), /must be finite/);

    // Bad task type
    assert.throws(() => Event.create(j, "start", 1000, 123 as any), /must be a string/);

    // Null/non-Job
    assert.throws(() => Event.create(null as any, "start", 1000), /must be a Job/);
    assert.throws(() => Event.create({} as any, "start", 1000), /must be a Job/);

    console.log("  ✓ Event.create validation tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Event.fromDTO / toDTO round-trip
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests Event DTO round-trip:
 * - Target: Event.toDTO / Event.fromDTO in src/core/event.ts
 * - What: an Event round-tripped through toDTO → fromDTO preserves all fields.
 * - Does: creates events, round-trips, asserts equality.
 * - Why: the dashboard edit path depends on DTO fidelity.
 */
export function run_event_dto_roundtrip_tests(): void {
    const j = job("my project");

    // Without task
    const e1 = ev(j, "start", 5000);
    const dto1 = e1.toDTO();
    const rt1 = Event.fromDTO(dto1);
    assert.strictEqual(rt1.id, e1.id);
    assert.strictEqual(rt1.type, e1.type);
    assert.strictEqual(rt1.job_title, e1.job_title);
    assert.strictEqual(rt1.timestamp, e1.timestamp);
    assert.strictEqual(rt1.task, undefined);
    assert.strictEqual(rt1.job_id, e1.job_id);
    assert.strictEqual(rt1.time_seed, e1.time_seed);

    // With task
    const e2 = ev(j, "stop", 9000, "done");
    const dto2 = e2.toDTO();
    const rt2 = Event.fromDTO(dto2);
    assert.strictEqual(rt2.task, "done");

    console.log("  ✓ Event DTO round-trip tests passed");
}

/**
 * Tests Event.fromDTO validation:
 * - Target: Event.fromDTO in src/core/event.ts
 * - What: rejects malformed DTOs with clear errors.
 * - Does: passes objects with missing/invalid fields and asserts each throws.
 * - Why: catches bad data before it enters the domain.
 */
export function run_event_fromDTO_validation_tests(): void {
    const j = job();
    const base = ev(j, "start", 1000).toDTO();

    // Missing required field
    const no_id = { ...base } as any;
    delete no_id.id;
    assert.throws(() => Event.fromDTO(no_id), /missing required field 'id'/);

    // Unexpected extra field
    const extra = { ...base, extra_field: "x" } as any;
    assert.throws(() => Event.fromDTO(extra), /unexpected field/);

    // Invalid event value
    const bad_event = { ...base, event: "fly" } as any;
    assert.throws(() => Event.fromDTO(bad_event), /invalid 'event'/);

    // Empty job_title
    const empty_job = { ...base, job_title: "" } as any;
    assert.throws(() => Event.fromDTO(empty_job), /non-empty string/);

    // Non-object input
    assert.throws(() => Event.fromDTO(null as any), /must be an object/);
    assert.throws(() => Event.fromDTO("string" as any), /must be an object/);

    console.log("  ✓ Event.fromDTO validation tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Event.fromJSONL / toJSONL round-trip
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests Event JSONL round-trip:
 * - Target: Event.toJSONL / Event.fromJSONL in src/core/event.ts
 * - What: an Event survives serialization to JSONL and parsing back.
 * - Does: creates all four event types, round-trips each, checks fields.
 * - Why: JSONL is the persistence format; fidelity is critical.
 */
export function run_event_jsonl_roundtrip_tests(): void {
    const j = job("roundtrip test");
    const types: Array<"start" | "stop" | "pause" | "resume"> = ["start", "stop", "pause", "resume"];

    for (const t of types) {
        const task = t === "stop" ? "finished" : undefined;
        const e = ev(j, t, 123456, task);
        const line = e.toJSONL();
        const parsed = Event.fromJSONL(line);
        assert.ok(parsed, `fromJSONL should parse a ${t} event`);
        assert.strictEqual(parsed!.id, e.id, `${t} id matches`);
        assert.strictEqual(parsed!.type, e.type, `${t} type matches`);
        assert.strictEqual(parsed!.job_title, e.job_title, `${t} job matches`);
        assert.strictEqual(parsed!.timestamp, e.timestamp, `${t} timestamp matches`);
        assert.strictEqual(parsed!.task, e.task, `${t} task matches`);
        assert.strictEqual(parsed!.job_id, e.job_id, `${t} job_id matches`);
        assert.strictEqual(parsed!.time_seed, e.time_seed, `${t} time_seed matches`);
    }

    console.log("  ✓ Event JSONL round-trip tests passed");
}

/**
 * Tests Event.fromJSONL with invalid/edge-case inputs:
 * - Target: Event.fromJSONL in src/core/event.ts
 * - What: returns null for headers, malformed JSON, incomplete objects.
 * - Does: passes various bad lines and asserts null.
 * - Why: fromJSONL must be non-throwing since it processes untrusted file data.
 */
export function run_event_fromJSONL_edge_tests(): void {
    assert.strictEqual(Event.fromJSONL(""), null, "empty string");
    assert.strictEqual(Event.fromJSONL("not json"), null, "not JSON");
    assert.strictEqual(Event.fromJSONL("null"), null, "null literal");
    assert.strictEqual(Event.fromJSONL("42"), null, "number literal");
    assert.strictEqual(Event.fromJSONL("{}"), null, "empty object");
    assert.strictEqual(Event.fromJSONL('{"_format_version":2}'), null, "header line");
    assert.strictEqual(Event.fromJSONL('{"id":"x","event":"start"}'), null, "missing fields");

    console.log("  ✓ Event.fromJSONL edge-case tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Immutable transforms (withTimestamp, withJob, withTask)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests Event immutable transforms:
 * - Target: Event.withTimestamp/withJob/withTask in src/core/event.ts
 * - What: each returns a new Event with the changed field; original is untouched.
 * - Does: creates event, transforms, checks new values and old values.
 * - Why: these are used by the dashboard edit flow and collection operations.
 */
export function run_event_immutable_transforms_tests(): void {
    const j = job("alpha");
    const e = ev(j, "start", 1000);
    e.setGlobalLineIndex(5);
    e.setWorkspaceLineIndex(3);

    // withTimestamp
    const e2 = e.withTimestamp(2000);
    assert.strictEqual(e2.timestamp, 2000, "new timestamp");
    assert.strictEqual(e.timestamp, 1000, "original unchanged");
    assert.strictEqual(e2.id, e.id, "id preserved");
    assert.strictEqual(e2.type, e.type, "type preserved");
    assert.strictEqual(e2.global_line_index, 5, "location copied");
    assert.strictEqual(e2.workspace_line_index, 3, "location copied");

    // withJob
    const j2 = Job.create({ title: "beta" });
    const e3 = e.withJob(j2);
    assert.strictEqual(e3.job_title, "beta", "new job");
    assert.strictEqual(e.job_title, "alpha", "original unchanged");
    assert.strictEqual(e3.timestamp, 1000, "timestamp preserved");

    // withTask
    const e4 = e.withTask("my task");
    assert.strictEqual(e4.task, "my task", "new task");
    assert.strictEqual(e.task, undefined, "original unchanged");

    // withTask(undefined) clears task
    const e5 = e4.withTask(undefined);
    assert.strictEqual(e5.task, undefined, "task cleared");

    // Validation
    assert.throws(() => e.withTimestamp(NaN), /Invalid timestamp/);
    assert.throws(() => e.withJob({} as any), /Invalid job/);
    assert.throws(() => e.withTask(123 as any), /Invalid task/);

    console.log("  ✓ Event immutable transforms tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Record ID generation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests Event record ID generation:
 * - Target: Event.generate_record_id / compute_time5 / compute_bucket1 / compute_job_hash3
 * - What: IDs are deterministic and follow the format <time5>-<bucket1>-<jobHash3>.
 * - Does: generates IDs for known inputs and checks format, length, and determinism.
 * - Why: record IDs are the primary key for event identity.
 */
export function run_event_record_id_tests(): void {
    const j = job("alpha");

    // Determinism: same inputs → same ID
    const id1 = Event.generate_record_id(1000, "start", j.id);
    const id2 = Event.generate_record_id(1000, "start", j.id);
    assert.strictEqual(id1, id2, "deterministic");

    // Format: 5-1-3 (separated by dashes)
    const parts = id1.split("-");
    assert.strictEqual(parts.length, 3, "three parts");
    assert.strictEqual(parts[0].length, 5, "time5 is 5 chars");
    assert.strictEqual(parts[1].length, 1, "bucket1 is 1 char");
    assert.strictEqual(parts[2].length, 3, "jobHash3 is 3 chars");

    // Different event types produce different bucket values
    const idStart = Event.generate_record_id(1000, "start", j.id);
    const idStop = Event.generate_record_id(1000, "stop", j.id);
    assert.notStrictEqual(idStart, idStop, "different types → different IDs");

    // Different timestamps produce different time5
    const idTs1 = Event.generate_record_id(1000, "start", j.id);
    const idTs2 = Event.generate_record_id(999000, "start", j.id);
    assert.notStrictEqual(idTs1.split("-")[0], idTs2.split("-")[0], "different timestamps → different time5");

    // compute_time5 specific
    const t5 = Event.compute_time5(1000000); // 1000 seconds
    assert.strictEqual(t5.length, 5);
    assert.strictEqual(typeof t5, "string");

    // compute_bucket1 varies with event type
    const b_start = Event.compute_bucket1(1000, "start");
    const b_pause = Event.compute_bucket1(1000, "pause");
    assert.notStrictEqual(b_start, b_pause, "different types → different buckets");

    // compute_job_hash3 is 3 chars
    const h = Event.compute_job_hash3(j.id);
    assert.strictEqual(h.length, 3);

    console.log("  ✓ Event record ID tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Event.equals
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests Event.equals:
 * - Target: Event.equals in src/core/event.ts
 * - What: equality checks type, job, timestamp, task (not id or time_seed).
 * - Does: creates equal and unequal pairs and checks results.
 * - Why: equals is used by EventCollection.replaceEvent and dedupe logic.
 */
export function run_event_equals_tests(): void {
    const j = job("alpha");
    const e1 = ev(j, "start", 1000);
    const e2 = ev(j, "start", 1000);
    assert.ok(e1.equals(e2), "same type/job/ts → equal");

    const e3 = ev(j, "start", 2000);
    assert.ok(!e1.equals(e3), "different timestamp → not equal");

    const e4 = ev(j, "stop", 1000);
    assert.ok(!e1.equals(e4), "different type → not equal");

    const j2 = Job.create({ title: "beta" });
    const e5 = ev(j2, "start", 1000);
    assert.ok(!e1.equals(e5), "different job → not equal");

    // Task comparison
    const e6 = ev(j, "stop", 1000, "task a");
    const e7 = ev(j, "stop", 1000, "task a");
    const e8 = ev(j, "stop", 1000, "task b");
    assert.ok(e6.equals(e7), "same task → equal");
    assert.ok(!e6.equals(e8), "different task → not equal");

    // Null/undefined
    assert.ok(!e1.equals(undefined as any), "undefined → not equal");

    console.log("  ✓ Event.equals tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Exported runners
// ═══════════════════════════════════════════════════════════════════════════

export function run_event_tests(): void {
    console.log("event: create validation");
    run_event_create_validation_tests();
    console.log("event: DTO round-trip");
    run_event_dto_roundtrip_tests();
    run_event_fromDTO_validation_tests();
    console.log("event: JSONL round-trip");
    run_event_jsonl_roundtrip_tests();
    run_event_fromJSONL_edge_tests();
    console.log("event: immutable transforms");
    run_event_immutable_transforms_tests();
    console.log("event: record ID generation");
    run_event_record_id_tests();
    console.log("event: equals");
    run_event_equals_tests();
}
