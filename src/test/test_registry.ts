import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { Registry, mint_client_id, mint_project_id, mint_task_type_id } from "../core/registry";
import { RegistryRepository } from "../core/registry_repository";
import { compute_seeded_id } from "../core/id_gen";

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
 * Tests the #15 hierarchical entity vocabulary (clients/projects/task-types) on Registry:
 * - Target: Registry.upsert_client/upsert_project/upsert_task_type/add_task_type_alias,
 *   from_dto/to_dto in src/core/registry.ts
 * - Why: clients, projects, and task-types are global entities that must round-trip
 *   through registry.json additively (format_version stays 1) and tolerate malformed rows.
 */
export function run_registry_entity_tests(): void {
    const empty = Registry.empty();
    assert.strictEqual(empty.clients.length, 0, "empty registry has no clients");
    assert.strictEqual(empty.projects.length, 0, "empty registry has no projects");
    assert.strictEqual(empty.task_types.length, 0, "empty registry has no task-types");

    // upsert_client is immutable and dedups by id.
    const r1 = empty.upsert_client({ id: "c1", name: "Acme" });
    assert.strictEqual(empty.clients.length, 0, "upsert_client must not mutate the source");
    assert.strictEqual(r1.clients.length, 1, "upsert_client adds a client");
    const r2 = r1.upsert_client({ id: "c1", name: "Acme Corp" });
    assert.strictEqual(r2.clients.length, 1, "same-id upsert_client does not duplicate");
    assert.strictEqual(r2.clients[0].name, "Acme Corp", "same-id upsert_client updates fields");

    // upsert_project is immutable and dedups by id.
    const r3 = r2.upsert_project({ id: "p1", name: "Website", client_id: "c1" });
    assert.strictEqual(r3.projects.length, 1, "upsert_project adds a project");
    const r4 = r3.upsert_project({ id: "p1", name: "Website Redesign", client_id: "c1" });
    assert.strictEqual(r4.projects.length, 1, "same-id upsert_project does not duplicate");
    assert.strictEqual(r4.projects[0].name, "Website Redesign", "same-id upsert_project updates fields");

    // upsert_task_type is immutable and dedups by id.
    const r5 = r4.upsert_task_type({ id: "t1", name: "Development" });
    assert.strictEqual(r5.task_types.length, 1, "upsert_task_type adds a task-type");
    const r6 = r5.upsert_task_type({ id: "t1", name: "Dev" });
    assert.strictEqual(r6.task_types.length, 1, "same-id upsert_task_type does not duplicate");
    assert.strictEqual(r6.task_types[0].name, "Dev", "same-id upsert_task_type updates fields");

    // add_task_type_alias is immutable, additive, and idempotent.
    const r7 = r6.add_task_type_alias("t1", "legacy-job-a");
    assert.deepStrictEqual(r7.task_types[0].aliases, ["legacy-job-a"], "alias added");
    assert.strictEqual(r6.task_types[0].aliases, undefined, "add_task_type_alias must not mutate the source");
    const r8 = r7.add_task_type_alias("t1", "legacy-job-a");
    assert.strictEqual(r8.task_types[0].aliases!.length, 1, "duplicate alias does not duplicate");
    const r9 = r8.add_task_type_alias("t1", "legacy-job-b");
    assert.deepStrictEqual(r9.task_types[0].aliases, ["legacy-job-a", "legacy-job-b"], "second alias appends");

    // Unknown task-type id: no-op (tolerant, doesn't throw).
    const r10 = r9.add_task_type_alias("does-not-exist", "whatever");
    assert.strictEqual(r10, r9, "alias on unknown task-type id is a no-op");

    // DTO round-trip: format_version stays 1, entities all survive.
    const dto = r9.to_dto();
    assert.strictEqual(dto.format_version, 1, "format_version stays 1");
    const back = Registry.from_dto(dto);
    assert.strictEqual(back.clients.length, 1, "clients survive round-trip");
    assert.strictEqual(back.projects.length, 1, "projects survive round-trip");
    assert.strictEqual(back.task_types.length, 1, "task_types survive round-trip");
    assert.deepStrictEqual(back.task_types[0].aliases, ["legacy-job-a", "legacy-job-b"], "aliases survive round-trip");
    assert.strictEqual(back.projects[0].client_id, "c1", "project client_id survives round-trip");

    // Registries without the arrays load as empty (additive: older registry.json files).
    const legacy = Registry.from_dto({ format_version: 1, repos: [], declined: [] });
    assert.strictEqual(legacy.clients.length, 0, "no clients array → empty");
    assert.strictEqual(legacy.projects.length, 0, "no projects array → empty");
    assert.strictEqual(legacy.task_types.length, 0, "no task_types array → empty");

    // Malformed entity rows are dropped, same tolerance style as repos.
    const malformed = Registry.from_dto({
        clients: [{ id: "c1", name: "Ok" }, { id: "" }, { name: "no id" }, null],
        projects: [{ id: "p1", name: "Ok", client_id: "c1" }, { id: "p2", name: "no client_id" }, { id: "p3", client_id: "c1" }],
        task_types: [{ id: "t1", name: "Ok" }, { id: "t2" }, { name: "no id" }],
    });
    assert.strictEqual(malformed.clients.length, 1, "malformed client rows dropped");
    assert.strictEqual(malformed.projects.length, 1, "malformed project rows dropped");
    assert.strictEqual(malformed.task_types.length, 1, "malformed task_type rows dropped");

    // Unknown extra fields on a task_type row must not cause rejection.
    const extra = Registry.from_dto({
        task_types: [{ id: "t1", name: "Development", aliases: ["a"], owner_project: "future-field", extra_junk: 42 }],
    });
    assert.strictEqual(extra.task_types.length, 1, "task_type with unknown extra fields is kept");
    assert.strictEqual(extra.task_types[0].name, "Development", "known fields still read correctly");
    assert.deepStrictEqual(extra.task_types[0].aliases, ["a"], "aliases still read correctly alongside unknown fields");

    // Non-array / malformed aliases on a task_type are tolerated (dropped to undefined).
    const badAliases = Registry.from_dto({ task_types: [{ id: "t1", name: "Dev", aliases: "nope" }] });
    assert.strictEqual(badAliases.task_types[0].aliases, undefined, "non-array aliases dropped");
}

/**
 * Tests the id-minting guard for NEW entities (reviewer finding A on #15):
 * - Target: mint_client_id/mint_project_id/mint_task_type_id in src/core/registry.ts
 * - What: minting for a brand-new entity must not silently reuse an id that already
 *   belongs to a DIFFERENT existing entity (a hash collision, since compute_seeded_id
 *   truncates to 5 base36 chars) — it disambiguates deterministically instead.
 * - Why: the legitimate same-id-new-name path is a rename via upsert_* directly (see
 *   run_registry_entity_tests); this guard belongs at the minting layer, not inside
 *   upsert, so upsert-as-rename keeps working unguarded.
 */
export function run_registry_mint_id_tests(): void {
    // No collision: mint_* returns the plain seeded id.
    const empty = Registry.empty();
    assert.strictEqual(mint_client_id(empty, "Acme"), compute_seeded_id("Acme"), "client: no collision → plain seeded id");
    assert.strictEqual(mint_project_id(empty, "c1", "Website"), compute_seeded_id("c1::Website"), "project: no collision → plain seeded id");
    assert.strictEqual(mint_task_type_id(empty, "Development"), compute_seeded_id("Development"), "task_type: no collision → plain seeded id");

    // Force a collision: manufacture a registry where a DIFFERENT client already
    // owns the id that "Acme" would naturally hash to.
    const colliding_id = compute_seeded_id("Acme");
    const with_collision = empty.upsert_client({ id: colliding_id, name: "Totally Different Co" });
    const minted = mint_client_id(with_collision, "Acme");
    assert.notStrictEqual(minted, colliding_id, "client mint disambiguates away from a colliding different-named entity");
    assert.strictEqual(mint_client_id(with_collision, "Acme"), minted, "client mint disambiguation is deterministic");

    // Same guard for projects (keyed by client_id::name in this test's seed convention).
    const proj_id = compute_seeded_id("c1::Website");
    const proj_collision = empty.upsert_project({ id: proj_id, name: "Unrelated Project", client_id: "c9" });
    const mintedProj = mint_project_id(proj_collision, "c1", "Website");
    assert.notStrictEqual(mintedProj, proj_id, "project mint disambiguates away from a colliding different entity");

    // Same guard for task-types.
    const tt_id = compute_seeded_id("Development");
    const tt_collision = empty.upsert_task_type({ id: tt_id, name: "Totally Unrelated" });
    const mintedTt = mint_task_type_id(tt_collision, "Development");
    assert.notStrictEqual(mintedTt, tt_id, "task_type mint disambiguates away from a colliding different entity");

    // A repeat mint for the SAME name still resolves to the SAME already-disambiguated
    // id (idempotent — a caller re-minting "Acme" a second time, e.g. after the first
    // disambiguated id is now itself in the registry, must not chase it further).
    const with_disambiguated = with_collision.upsert_client({ id: minted, name: "Acme" });
    assert.strictEqual(mint_client_id(with_disambiguated, "Acme"), minted, "re-minting the same seed lands back on its own disambiguated id");
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
