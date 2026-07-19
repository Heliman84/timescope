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
 * Tests RegistryRepository.update (#47 F1 — intent-based read-modify-write):
 * - Target: RegistryRepository.update in src/core/registry_repository.ts
 * - What: writer A registers repo-A via update; writer B (whose mutate intent was formed
 *   before A wrote) registers repo-B via update → reload shows BOTH repos, since update()
 *   always reloads fresh from disk immediately before applying + saving the mutation.
 *   Also: a no-op mutate (same instance returned) skips the write entirely.
 * - Why: replaces whole-registry merge-on-write, which couldn't represent removals (a
 *   union always resurrects a concurrently-cleared decline). Intent-based update can.
 */
export function run_registry_repository_update_tests(): void {
    const root = mkdir_tmp("update");
    const registry_path = path.join(root, "registry.json");
    const repo = new RegistryRepository(registry_path);

    // Writer A registers repo-A.
    repo.update(r => r.upsert_repo({ id: "repo-a", name: "Alpha", path: "/work/alpha", last_seen: 100 }));

    // Writer B's mutate intent doesn't reference writer A's repo at all — update() reloads
    // fresh from disk right before applying it, so repo-A's registration is never clobbered.
    const result = repo.update(r => r.upsert_repo({ id: "repo-b", name: "Beta", path: "/work/beta", last_seen: 200 }));
    assert.strictEqual(result.repos.length, 2, "update()'s return value reflects both repos");

    const reloaded = repo.load();
    assert.strictEqual(reloaded.repos.length, 2, "both concurrent registrations survive on disk");
    assert.strictEqual(reloaded.find_by_id("repo-a")!.name, "Alpha", "writer A's repo survives");
    assert.strictEqual(reloaded.find_by_id("repo-b")!.name, "Beta", "writer B's repo is saved");

    // A no-op mutate (domain no-op idiom: returns the same instance) skips the write.
    const mtime_before = fs.statSync(registry_path).mtimeMs;
    repo.update(r => r);
    assert.strictEqual(fs.statSync(registry_path).mtimeMs, mtime_before, "update() does not rewrite registry.json for a no-op mutate");
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
 * Tests Registry.remove_declined's no-op idiom (#47 F1):
 * - Target: Registry.remove_declined in src/core/registry.ts
 * - What: returns the *same instance* when the path wasn't declined (mirrors add_declined's
 *   existing no-op idiom), so RegistryRepository.update() can skip a redundant write.
 */
export function run_registry_remove_declined_noop_tests(): void {
    const r = Registry.empty().add_declined("/work/foo");
    assert.strictEqual(r.remove_declined("/work/bar"), r, "remove_declined of an undeclined path returns the same instance");
    const r2 = r.remove_declined("/work/foo");
    assert.notStrictEqual(r2, r, "remove_declined of a declined path returns a new instance");
    assert.ok(!r2.is_declined("/work/foo"), "the decline is actually removed");
}
