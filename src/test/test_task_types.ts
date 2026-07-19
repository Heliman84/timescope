import * as assert from "assert";
import { Registry } from "../core/registry";
import { RepoConfig, REPO_CONFIG_FORMAT_VERSION } from "../core/repo_config";
import { resolve_task_type, pickable_task_types, convert_legacy_job } from "../core/task_types";

function base_config(): RepoConfig {
    return { repo_id: "abc123456789", format_version: REPO_CONFIG_FORMAT_VERSION };
}

/**
 * Tests resolve_task_type:
 * - Target: resolve_task_type in src/core/task_types.ts
 * - What: direct id match first, then alias match; deterministic on duplicate alias.
 * - Why: events reference a task-type only via the legacy `job_id` field — resolving it
 *   back to the current global vocabulary entry is what lets the dashboard/picker treat
 *   legacy jobs and task-types uniformly.
 */
export function run_resolve_task_type_tests(): void {
    let registry = Registry.empty()
        .upsert_task_type({ id: "t1", name: "Development" })
        .upsert_task_type({ id: "t2", name: "Design" });

    // Direct id match.
    assert.strictEqual(resolve_task_type(registry, "t1")!.name, "Development", "direct id match");

    // No match at all.
    assert.strictEqual(resolve_task_type(registry, "nope"), undefined, "no match returns undefined");

    // Alias match.
    registry = registry.add_task_type_alias("t2", "legacy-design-job");
    assert.strictEqual(resolve_task_type(registry, "legacy-design-job")!.id, "t2", "alias match");

    // Direct id match wins over an alias with the same string (defensive; shouldn't
    // normally collide, but id lookup happens first).
    registry = registry.add_task_type_alias("t2", "t1");
    assert.strictEqual(resolve_task_type(registry, "t1")!.id, "t1", "direct id match takes priority over alias collision");

    // Deterministic on duplicate alias: first in registry order wins.
    registry = registry
        .upsert_task_type({ id: "t3", name: "QA" })
        .add_task_type_alias("t3", "shared-alias");
    registry = registry.add_task_type_alias("t2", "shared-alias");
    // t2 is inserted before t3 in this scenario? We built t3 after t2, so t2 comes first.
    assert.strictEqual(resolve_task_type(registry, "shared-alias")!.id, "t2", "duplicate alias resolves to the first task-type in registry order");
}

/**
 * Tests pickable_task_types:
 * - Target: pickable_task_types in src/core/task_types.ts
 * - What: pinned (config order) first, then remaining vocabulary (registry order),
 *   deduped by id.
 */
export function run_pickable_task_types_tests(): void {
    const registry = Registry.empty()
        .upsert_task_type({ id: "t1", name: "Development" })
        .upsert_task_type({ id: "t2", name: "Design" })
        .upsert_task_type({ id: "t3", name: "QA" });

    // No pinned: full registry order.
    const noPin = pickable_task_types(registry, base_config());
    assert.deepStrictEqual(noPin.map(t => t.id), ["t1", "t2", "t3"], "no pins → registry order");

    // Pinned subset, out of registry order — pinned entries lead, in config order.
    const withPin = pickable_task_types(registry, { ...base_config(), pinned_task_types: ["t3", "t1"] });
    assert.deepStrictEqual(withPin.map(t => t.id), ["t3", "t1", "t2"], "pinned first (config order), then remaining registry order");

    // Duplicate ids across pinned + registry are deduped, not repeated.
    const dedup = pickable_task_types(registry, { ...base_config(), pinned_task_types: ["t1", "t1", "t2"] });
    assert.deepStrictEqual(dedup.map(t => t.id), ["t1", "t2", "t3"], "duplicate pinned ids are deduped");

    // A pinned id that no longer exists in the registry is silently skipped.
    const stalePin = pickable_task_types(registry, { ...base_config(), pinned_task_types: ["ghost", "t2"] });
    assert.deepStrictEqual(stalePin.map(t => t.id), ["t2", "t1", "t3"], "unknown pinned id skipped");
}

/**
 * Tests convert_legacy_job:
 * - Target: convert_legacy_job in src/core/task_types.ts
 * - What: adds the legacy job_id as an alias on the target task-type (idempotent) and
 *   pins the target in config.pinned_task_types (idempotent). Returns new instances.
 */
export function run_convert_legacy_job_tests(): void {
    const registry0 = Registry.empty().upsert_task_type({ id: "t1", name: "Development" });
    const config0 = base_config();

    const { registry: registry1, config: config1 } = convert_legacy_job(registry0, config0, "16lor", "t1");
    assert.deepStrictEqual(registry1.find_task_type_by_id("t1")!.aliases, ["16lor"], "legacy job_id adopted as alias");
    assert.deepStrictEqual(config1.pinned_task_types, ["t1"], "target pinned in config");

    // Originals untouched (immutability).
    assert.strictEqual(registry0.find_task_type_by_id("t1")!.aliases, undefined, "source registry untouched");
    assert.strictEqual(config0.pinned_task_types, undefined, "source config untouched");

    // Idempotent: converting the same legacy job again does not duplicate the alias or the pin.
    const { registry: registry2, config: config2 } = convert_legacy_job(registry1, config1, "16lor", "t1");
    assert.deepStrictEqual(registry2.find_task_type_by_id("t1")!.aliases, ["16lor"], "alias idempotent");
    assert.deepStrictEqual(config2.pinned_task_types, ["t1"], "pin idempotent");

    // Converting a different legacy job onto the same target appends the alias and
    // leaves the pin list deduped.
    const { registry: registry3, config: config3 } = convert_legacy_job(registry2, config2, "other-legacy", "t1");
    assert.deepStrictEqual(registry3.find_task_type_by_id("t1")!.aliases, ["16lor", "other-legacy"], "second legacy job appends alias");
    assert.deepStrictEqual(config3.pinned_task_types, ["t1"], "pin stays deduped");
}

export function run_task_types_tests(): void {
    console.log("task_types: resolve_task_type");
    run_resolve_task_type_tests();
    console.log("task_types: pickable_task_types");
    run_pickable_task_types_tests();
    console.log("task_types: convert_legacy_job");
    run_convert_legacy_job_tests();
}
