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
