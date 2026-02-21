import * as assert from "assert";
import { Job } from "../core/job";

// ═══════════════════════════════════════════════════════════════════════════
// Job.create
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests Job.create factory:
 * - Target: Job.create in src/core/job.ts
 * - What: validates happy path and all rejection cases.
 * - Does: creates jobs with valid/invalid inputs, checks identity, defaults.
 * - Why: Job is the foundation for events and sessions; creation must be robust.
 */
export function run_job_create_tests(): void {
    // Happy path
    const j = Job.create({ title: "my project" });
    assert.strictEqual(j.title, "my project");
    assert.ok(j.id.length > 0, "id is non-empty");
    assert.strictEqual(j.archived, false, "default not archived");
    assert.ok(j.createdAt > 0, "createdAt is set");
    assert.ok(j.lastModifiedAt >= j.createdAt, "lastModified >= created");
    assert.strictEqual(j.partial, false, "not partial");

    // Deterministic ID from same seed
    const j2 = Job.create({ title: "my project" });
    assert.strictEqual(j.id, j2.id, "same title → same id");

    // Different title → different id
    const j3 = Job.create({ title: "other project" });
    assert.notStrictEqual(j.id, j3.id, "different title → different id");

    // Explicit timestamps
    const j4 = Job.create({ title: "x", created: 100, lastModified: 200 });
    assert.strictEqual(j4.createdAt, 100);
    assert.strictEqual(j4.lastModifiedAt, 200);

    // seedTitle differs from title (rename scenario)
    const j5 = Job.create({ title: "renamed", seedTitle: "original" });
    const j6 = Job.create({ title: "original" });
    assert.strictEqual(j5.id, j6.id, "seedTitle drives id, not title");
    assert.strictEqual(j5.title, "renamed");

    // Validation: empty title
    assert.throws(() => Job.create({ title: "" }), /non-empty/);
    assert.throws(() => Job.create({ title: "   " }), /non-empty/);

    // Validation: lastModified < created
    assert.throws(() => Job.create({ title: "x", created: 200, lastModified: 100 }), /cannot be earlier/);

    // Validation: negative created
    assert.throws(() => Job.create({ title: "x", created: -1 }), /must be >= 0/);

    // Validation: mismatched explicit jobId
    assert.throws(() => Job.create({ title: "x", jobId: "wrong" }), /does not match/);

    console.log("  ✓ Job.create tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Job.rename / archive / unarchive
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests Job domain mutations (immutable):
 * - Target: Job.rename/archive/unarchive in src/core/job.ts
 * - What: each returns a new Job with the change; original is untouched.
 * - Does: renames, archives, unarchives, checks identity preservation.
 * - Why: these are used by the job collection and repository.
 */
export function run_job_mutation_tests(): void {
    const j = Job.create({ title: "alpha", created: 100, lastModified: 100 });

    // Rename
    const renamed = j.rename("beta");
    assert.strictEqual(renamed.title, "beta");
    assert.strictEqual(renamed.id, j.id, "id preserved after rename");
    assert.strictEqual(j.title, "alpha", "original unchanged");
    assert.ok(renamed.lastModifiedAt >= j.lastModifiedAt, "lastModified updated");

    // Rename to same title returns same instance
    const same = j.rename("alpha");
    assert.strictEqual(same, j, "no-op rename returns same object");

    // Rename to empty throws
    assert.throws(() => j.rename(""), /non-empty/);
    assert.throws(() => j.rename("   "), /non-empty/);

    // Archive
    const archived = j.archive();
    assert.strictEqual(archived.archived, true);
    assert.strictEqual(archived.id, j.id, "id preserved");
    assert.strictEqual(j.archived, false, "original unchanged");

    // Archive when already archived returns same instance
    const same2 = archived.archive();
    assert.strictEqual(same2, archived, "no-op archive");

    // Unarchive
    const unarchived = archived.unarchive();
    assert.strictEqual(unarchived.archived, false);
    assert.strictEqual(unarchived.id, j.id, "id preserved");

    // Unarchive when already unarchived returns same instance
    const same3 = j.unarchive();
    assert.strictEqual(same3, j, "no-op unarchive");

    console.log("  ✓ Job mutation tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Job.fromEventFields
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests Job.fromEventFields:
 * - Target: Job.fromEventFields in src/core/job.ts
 * - What: constructs a partial Job from (id, title) — used when loading from logs.
 * - Does: creates, checks partial flag, validates bad inputs.
 * - Why: events carry only id+title; the reconstructed Job must work for session logic.
 */
export function run_job_fromEventFields_tests(): void {
    const j = Job.fromEventFields("abc123", "my project");
    assert.strictEqual(j.id, "abc123");
    assert.strictEqual(j.title, "my project");
    assert.strictEqual(j.partial, true, "partial flag set");

    // Validation
    assert.throws(() => Job.fromEventFields("", "title"), /non-empty/);
    assert.throws(() => Job.fromEventFields("id", ""), /non-empty/);

    console.log("  ✓ Job.fromEventFields tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Job.toRecord round-trip
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests Job.toRecord:
 * - Target: Job.toRecord in src/core/job.ts
 * - What: produces the canonical JobRecord shape for persistence.
 * - Does: creates a job, converts to record, checks all fields.
 * - Why: JobRepository.save serializes via toRecord; fields must be correct.
 */
export function run_job_toRecord_tests(): void {
    const j = Job.create({ title: "alpha", created: 100, lastModified: 200, isArchived: true });
    const rec = j.toRecord();

    assert.strictEqual(rec.job_id, j.id);
    assert.strictEqual(rec.job_title, "alpha");
    assert.strictEqual(rec.is_archived, true);
    assert.strictEqual(rec.created, 100);
    assert.strictEqual(rec.last_modified, 200);
    assert.strictEqual(rec.job_seed, j.seed);

    console.log("  ✓ Job.toRecord tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Job.equals
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests Job.equals:
 * - Target: Job.equals in src/core/job.ts
 * - What: equality is by id (identity), not by title.
 * - Does: compares same-id jobs (after rename) and different-id jobs.
 * - Why: sessions and events depend on job identity for grouping.
 */
export function run_job_equals_tests(): void {
    const j1 = Job.create({ title: "alpha" });
    const j2 = Job.create({ title: "alpha" });
    assert.ok(j1.equals(j2), "same title → same id → equal");

    const j3 = j1.rename("beta");
    assert.ok(j1.equals(j3), "renamed job still equals (same id)");

    const j4 = Job.create({ title: "gamma" });
    assert.ok(!j1.equals(j4), "different title/id → not equal");

    assert.ok(!j1.equals(null as any), "null → not equal");

    console.log("  ✓ Job.equals tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Exported runner
// ═══════════════════════════════════════════════════════════════════════════

export function run_job_domain_tests(): void {
    console.log("job: create");
    run_job_create_tests();
    console.log("job: mutations");
    run_job_mutation_tests();
    console.log("job: fromEventFields");
    run_job_fromEventFields_tests();
    console.log("job: toRecord");
    run_job_toRecord_tests();
    console.log("job: equals");
    run_job_equals_tests();
}
