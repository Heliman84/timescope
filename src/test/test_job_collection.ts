import * as assert from "assert";
import { Job } from "../core/job";
import { JobCollection } from "../core/job_collection";

function mkJob(title: string, created = Date.now()): Job {
    return Job.create({ title, created });
}

// ═══════════════════════════════════════════════════════════════════════════
// JobCollection.fromArray
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests JobCollection.fromArray factory:
 * - Target: JobCollection.fromArray in src/core/job_collection.ts
 * - What: validates construction, ordering, duplicate rejection, and type checks.
 * - Does: creates collections from valid/invalid arrays and checks invariants.
 * - Why: the collection is the in-memory aggregate for all Job operations.
 */
export function run_job_collection_create_tests(): void {
    const a = mkJob("alpha", 100);
    const b = mkJob("beta", 200);

    // Basic creation
    const col = JobCollection.fromArray([b, a]); // out of order
    assert.strictEqual(col.size(), 2);
    const arr = col.toArray();
    assert.strictEqual(arr[0].title, "alpha", "sorted by createdAt ascending");
    assert.strictEqual(arr[1].title, "beta");

    // Empty
    const empty = JobCollection.fromArray([]);
    assert.strictEqual(empty.size(), 0);
    assert.ok(empty.isEmpty());

    // Duplicate id rejection
    const dup = mkJob("alpha", 300); // same title → same id
    assert.throws(() => JobCollection.fromArray([a, dup]), /duplicate job id/);

    // Non-Job item rejection
    assert.throws(() => JobCollection.fromArray([{} as any]), /must be Job instances/);

    // Non-array rejection
    assert.throws(() => JobCollection.fromArray("nope" as any), /expects an array/);

    console.log("  ✓ JobCollection.fromArray tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// add / remove / update / rename
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests JobCollection mutating operations (immutable — return new collections):
 * - Target: add/remove/update/rename in src/core/job_collection.ts
 * - What: each returns a new collection with the mutation; originals untouched.
 * - Does: exercises add, remove, update, rename, and their error paths.
 * - Why: these are the domain operations the runtime uses to manage jobs.
 */
export function run_job_collection_mutation_tests(): void {
    const a = mkJob("alpha", 100);
    const b = mkJob("beta", 200);
    const col = JobCollection.fromArray([a]);

    // Add
    const col2 = col.add(b);
    assert.strictEqual(col2.size(), 2);
    assert.strictEqual(col.size(), 1, "original unchanged");
    assert.ok(col2.hasId(b.id));

    // Add duplicate throws
    assert.throws(() => col2.add(mkJob("alpha")), /already exists/);

    // Add non-Job throws
    assert.throws(() => col.add({} as any), /must be instance/);

    // Remove
    const col3 = col2.remove(a.id);
    assert.strictEqual(col3.size(), 1);
    assert.ok(!col3.hasId(a.id));
    assert.ok(col3.hasId(b.id));

    // Remove non-existent is no-op
    const col4 = col3.remove("nonexistent");
    assert.strictEqual(col4.size(), 1);

    // Update
    const renamedA = a.rename("alpha-v2");
    const col5 = col2.update(renamedA);
    assert.strictEqual(col5.findById(a.id)!.title, "alpha-v2");
    assert.strictEqual(col2.findById(a.id)!.title, "alpha", "original unchanged");

    // Update non-existent throws
    const c = mkJob("gamma", 300);
    assert.throws(() => col2.update(c), /not found/);

    // Update non-Job throws
    assert.throws(() => col2.update({} as any), /must be instance/);

    // Rename
    const col6 = col2.rename(a.id, "alpha-v3");
    assert.strictEqual(col6.findById(a.id)!.title, "alpha-v3");

    // Rename non-existent throws
    assert.throws(() => col2.rename("nonexistent", "x"), /not found/);

    console.log("  ✓ JobCollection mutation tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Lookup: findById / hasId
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests JobCollection lookup methods:
 * - Target: findById/hasId in src/core/job_collection.ts
 * - What: lookups return correct results for present and absent ids.
 * - Does: checks findById returns Job or undefined, hasId returns boolean.
 * - Why: lookups are used throughout the extension for job resolution.
 */
export function run_job_collection_lookup_tests(): void {
    const a = mkJob("alpha", 100);
    const col = JobCollection.fromArray([a]);

    assert.ok(col.findById(a.id), "found existing");
    assert.strictEqual(col.findById(a.id)!.title, "alpha");
    assert.strictEqual(col.findById("nope"), undefined, "missing → undefined");
    assert.ok(col.hasId(a.id));
    assert.ok(!col.hasId("nope"));

    console.log("  ✓ JobCollection lookup tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Filters: filterArchived / filterActive
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests JobCollection filter methods:
 * - Target: filterArchived/filterActive in src/core/job_collection.ts
 * - What: partition jobs by archived status.
 * - Does: creates mix of archived/active, filters each direction.
 * - Why: the UI shows active vs archived jobs in different sections.
 */
export function run_job_collection_filter_tests(): void {
    const a = mkJob("alpha", 100);
    const b = mkJob("beta", 200).archive();
    const c = mkJob("gamma", 300);

    const col = JobCollection.fromArray([a, b, c]);

    const active = col.filterActive();
    assert.strictEqual(active.size(), 2);
    assert.ok(active.hasId(a.id));
    assert.ok(!active.hasId(b.id));
    assert.ok(active.hasId(c.id));

    const archived = col.filterArchived();
    assert.strictEqual(archived.size(), 1);
    assert.ok(archived.hasId(b.id));

    console.log("  ✓ JobCollection filter tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Sorting: sortByCreated / sortByLastModified
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests JobCollection sort methods:
 * - Target: sortByCreated/sortByLastModified in src/core/job_collection.ts
 * - What: returns a new collection sorted by the requested field.
 * - Does: creates jobs with different timestamps, sorts, checks order.
 * - Why: dashboard and UI list jobs in specific orderings.
 */
export function run_job_collection_sort_tests(): void {
    // lastModified must be >= created per domain rules
    const a = Job.create({ title: "alpha", created: 300, lastModified: 300 });
    const b = Job.create({ title: "beta", created: 100, lastModified: 400 });
    const c = Job.create({ title: "gamma", created: 200, lastModified: 350 });

    const col = JobCollection.fromArray([a, b, c]);

    // sortByCreated: ascending by created timestamp
    const byCreated = col.sortByCreated();
    const ca = byCreated.toArray();
    assert.strictEqual(ca[0].title, "beta", "lowest createdAt first (100)");
    assert.strictEqual(ca[1].title, "gamma", "middle createdAt (200)");
    assert.strictEqual(ca[2].title, "alpha", "highest createdAt last (300)");

    // sortByLastModified: ascending by lastModified timestamp
    const byMod = col.sortByLastModified();
    const ma = byMod.toArray();
    assert.strictEqual(ma[0].title, "alpha", "lowest lastModified first (300)");
    assert.strictEqual(ma[1].title, "gamma", "middle lastModified (350)");
    assert.strictEqual(ma[2].title, "beta", "highest lastModified last (400)");

    console.log("  ✓ JobCollection sort tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Exported runner
// ═══════════════════════════════════════════════════════════════════════════

export function run_job_collection_tests(): void {
    console.log("job collection: fromArray");
    run_job_collection_create_tests();
    console.log("job collection: mutations");
    run_job_collection_mutation_tests();
    console.log("job collection: lookups");
    run_job_collection_lookup_tests();
    console.log("job collection: filters");
    run_job_collection_filter_tests();
    console.log("job collection: sorting");
    run_job_collection_sort_tests();
}
