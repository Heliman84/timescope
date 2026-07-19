import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { Registry } from "../core/registry";
import { RegistryRepository } from "../core/registry_repository";

function mkdir_tmp(suffix: string): string {
    const root = path.join(__dirname, "..", "..", "test-output", `registry-${suffix}-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    return root;
}

/**
 * Tests the Registry domain object:
 * - Target: Registry in src/core/registry.ts
 * - What: immutable upsert-by-id, lookups, DTO round-trip.
 * - Why: registry.json is the global cache of known repos for #48 rebuild + dedup.
 */
export function run_registry_domain_tests(): void {
    const empty = Registry.empty();
    assert.strictEqual(empty.repos.length, 0, "empty registry has no repos");

    const r1 = empty.upsert_repo({ id: "abc123", name: "Lantern", path: "/work/lantern", last_seen: 100 });
    // Immutability: the original is untouched.
    assert.strictEqual(empty.repos.length, 0, "upsert must not mutate the source registry");
    assert.strictEqual(r1.repos.length, 1, "upsert adds a repo");
    assert.strictEqual(r1.find_by_id("abc123")!.name, "Lantern", "find_by_id returns the repo");

    // Upsert with the same id updates in place (no duplicate).
    const r2 = r1.upsert_repo({ id: "abc123", name: "Lantern-FW", path: "/work/lantern-fw", last_seen: 200 });
    assert.strictEqual(r2.repos.length, 1, "same-id upsert does not duplicate");
    assert.strictEqual(r2.find_by_id("abc123")!.name, "Lantern-FW", "same-id upsert updates fields");
    assert.strictEqual(r2.find_by_id("abc123")!.last_seen, 200, "last_seen updated");

    // A different id appends.
    const r3 = r2.upsert_repo({ id: "def456", name: "Altium", path: "/work/altium", last_seen: 300 });
    assert.strictEqual(r3.repos.length, 2, "different id appends");

    // Path lookup is normalized (trailing slash / separators).
    assert.ok(r3.find_by_path("/work/altium"), "find_by_path matches");
    assert.ok(r3.find_by_path("/work/altium/"), "find_by_path tolerates a trailing separator");

    // DTO round-trip preserves entries.
    const dto = r3.to_dto();
    const back = Registry.from_dto(dto);
    assert.strictEqual(back.repos.length, 2, "from_dto restores repo count");
    assert.strictEqual(back.find_by_id("def456")!.path, "/work/altium", "from_dto restores fields");

    // from_dto tolerates a missing/empty repos array.
    assert.strictEqual(Registry.from_dto({}).repos.length, 0, "from_dto of {} is empty");
}

/**
 * Tests RegistryRepository disk round-trip:
 * - Target: RegistryRepository in src/core/registry_repository.ts
 * - Why: registry.json must persist atomically and load back; missing file = empty.
 */
export function run_registry_repository_tests(): void {
    const root = mkdir_tmp("repo");
    const registry_path = path.join(root, "registry.json");
    const repo = new RegistryRepository(registry_path);

    // Missing file loads as an empty registry.
    assert.strictEqual(repo.load().repos.length, 0, "missing registry loads empty");

    const reg = Registry.empty()
        .upsert_repo({ id: "abc123", name: "Lantern", path: "/work/lantern", last_seen: 100 });
    repo.save(reg);

    const reloaded = repo.load();
    assert.strictEqual(reloaded.repos.length, 1, "saved registry reloads");
    assert.strictEqual(reloaded.find_by_id("abc123")!.name, "Lantern", "fields survive the round-trip");

    // Malformed registry throws rather than silently dropping known repos.
    fs.writeFileSync(registry_path, "{ not json", "utf8");
    assert.throws(() => repo.load(), /Malformed registry/, "malformed registry throws");
}

/**
 * Tests RegistryRepository.save_merged (#47 multi-instance write safety):
 * - Target: RegistryRepository.save_merged in src/core/registry_repository.ts
 * - What: writer A saves repo-A; writer B (holding a pre-A snapshot) calls save_merged
 *   with only repo-B → reload shows BOTH repos, not just B's.
 * - Why: two windows opting in concurrently must not race-clobber each other's registration.
 */
export function run_registry_repository_merge_tests(): void {
    const root = mkdir_tmp("merge");
    const registry_path = path.join(root, "registry.json");
    const repo = new RegistryRepository(registry_path);

    // Writer B loads before writer A has written anything (both start from empty).
    const writer_b_snapshot = repo.load();

    // Writer A saves repo-A directly.
    const writer_a_registry = Registry.empty()
        .upsert_repo({ id: "repo-a", name: "Alpha", path: "/work/alpha", last_seen: 100 });
    repo.save(writer_a_registry);

    // Writer B, unaware of repo-A, saves only repo-B via save_merged.
    const writer_b_registry = writer_b_snapshot
        .upsert_repo({ id: "repo-b", name: "Beta", path: "/work/beta", last_seen: 200 });
    repo.save_merged(writer_b_registry);

    // Reload shows BOTH repos — writer B's merge-on-write did not clobber writer A.
    const reloaded = repo.load();
    assert.strictEqual(reloaded.repos.length, 2, "save_merged preserves the other writer's concurrent registration");
    assert.strictEqual(reloaded.find_by_id("repo-a")!.name, "Alpha", "writer A's repo survives");
    assert.strictEqual(reloaded.find_by_id("repo-b")!.name, "Beta", "writer B's repo is saved");
}

/**
 * Tests the per-folder opt-out ("Never for this folder") stored in the registry (#48/#6):
 * - Target: Registry.is_declined/add_declined/remove_declined in src/core/registry.ts
 * - Why: the opt-out decision moves out of VS Code workspace state into TimeScope's own
 *   per-machine store; the reversal function must exist independently of the (later, #6) UI.
 */
export function run_registry_declined_tests(): void {
    const empty = Registry.empty();
    assert.strictEqual(empty.declined_paths.length, 0, "empty registry has no declines");
    assert.strictEqual(empty.is_declined("/work/foo"), false, "nothing declined initially");

    const r1 = empty.add_declined("/work/foo");
    assert.strictEqual(empty.declined_paths.length, 0, "add_declined must not mutate the source");
    assert.ok(r1.is_declined("/work/foo"), "path is declined after add");
    assert.ok(r1.is_declined("/work/foo/"), "decline check tolerates a trailing separator");

    // Idempotent: the same path (normalized) does not duplicate.
    const r2 = r1.add_declined("/work/foo/");
    assert.strictEqual(r2.declined_paths.length, 1, "duplicate decline collapses");

    // A different path appends.
    const r3 = r2.add_declined("/work/bar");
    assert.strictEqual(r3.declined_paths.length, 2, "distinct decline appends");

    // Remove — the underlying reversal (the #6 Settings tab drives this).
    const r4 = r3.remove_declined("/work/foo");
    assert.ok(!r4.is_declined("/work/foo"), "removed decline is gone");
    assert.ok(r4.is_declined("/work/bar"), "other declines remain");

    // DTO round-trip preserves declines alongside repos.
    const withRepo = r3.upsert_repo({ id: "abc123", name: "Foo", path: "/work/foo", last_seen: 1 });
    const back = Registry.from_dto(withRepo.to_dto());
    assert.strictEqual(back.declined_paths.length, 2, "declines survive the DTO round-trip");
    assert.strictEqual(back.repos.length, 1, "repos survive alongside declines");
    assert.ok(back.is_declined("/work/bar"), "a decline is preserved through the DTO");

    // from_dto tolerates missing / malformed declined (older registries).
    assert.strictEqual(Registry.from_dto({ repos: [] }).declined_paths.length, 0, "missing declined → empty");
    assert.strictEqual(Registry.from_dto({ declined: "nope" }).declined_paths.length, 0, "non-array declined ignored");
}

/**
 * Tests Registry.merge (#47 multi-instance write safety):
 * - Target: Registry.merge in src/core/registry.ts
 * - What: merging two registries unions repos (incoming wins by id) and unions declined
 *   folders, leaving disk-only foreign repos intact; returns a new instance.
 * - Why: two windows can each hold a stale in-memory snapshot; merge-on-write must not let
 *   the second writer clobber the first writer's repo/decline that it never saw.
 */
export function run_registry_merge_tests(): void {
    const base = Registry.empty()
        .upsert_repo({ id: "aaa", name: "Alpha", path: "/work/alpha", last_seen: 100 })
        .add_declined("/work/declined-a");

    // Merging in a disk-only foreign repo (never seen by `base`) keeps it intact.
    const disk = base.upsert_repo({ id: "bbb", name: "Beta", path: "/work/beta", last_seen: 50 });
    const merged = base.merge(disk);
    assert.strictEqual(merged.repos.length, 2, "merge unions repos by id");
    assert.strictEqual(merged.find_by_id("aaa")!.name, "Alpha", "base's own repo survives the merge");
    assert.strictEqual(merged.find_by_id("bbb")!.name, "Beta", "disk-only foreign repo is preserved");

    // Incoming (the `this` receiver) wins on a shared id.
    const mine = Registry.empty().upsert_repo({ id: "aaa", name: "Alpha-mine", path: "/work/alpha", last_seen: 999 });
    const other = Registry.empty().upsert_repo({ id: "aaa", name: "Alpha-theirs", path: "/work/alpha-old", last_seen: 1 });
    const winner = mine.merge(other);
    assert.strictEqual(winner.find_by_id("aaa")!.name, "Alpha-mine", "incoming (receiver) wins on a shared id");
    assert.strictEqual(winner.find_by_id("aaa")!.last_seen, 999, "incoming fields win wholesale, not field-merged");

    // Declined folders union too.
    const mine_declined = Registry.empty().add_declined("/work/x");
    const other_declined = Registry.empty().add_declined("/work/y");
    const merged_declined = mine_declined.merge(other_declined);
    assert.ok(merged_declined.is_declined("/work/x"), "receiver's decline survives merge");
    assert.ok(merged_declined.is_declined("/work/y"), "foreign decline is unioned in");

    // Immutability: merge does not mutate either input.
    assert.strictEqual(base.repos.length, 1, "merge must not mutate the receiver");
    assert.strictEqual(disk.repos.length, 2, "merge must not mutate the argument");
}
