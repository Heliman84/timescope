import { Registry, TaskTypeEntity } from "./registry";
import { RepoConfig } from "./repo_config";

/**
 * Resolve a `job_id` (the field events carry) to its current global task-type entity.
 * Direct id match first, then alias match (adopted legacy job_ids). When two task-types
 * both carry the same alias — shouldn't normally happen, but tolerated — the first one
 * in registry order wins, so resolution is deterministic.
 */
export function resolve_task_type(registry: Registry, job_id: string): TaskTypeEntity | undefined {
    const task_types = registry.task_types;
    const by_id = task_types.find(t => t.id === job_id);
    if (by_id) return by_id;
    return task_types.find(t => t.aliases?.includes(job_id));
}

/**
 * The ordered list of task-types to offer in the Start picker: this repo's pinned
 * task-types first (in the config's own order), then the rest of the global vocabulary
 * (in registry order), deduped by id. A pinned id that no longer resolves in the
 * registry (deleted/never existed) is silently skipped.
 */
export function pickable_task_types(registry: Registry, config: RepoConfig): TaskTypeEntity[] {
    const task_types = registry.task_types;
    const by_id = new Map(task_types.map(t => [t.id, t]));
    const seen = new Set<string>();
    const ordered: TaskTypeEntity[] = [];

    for (const id of config.pinned_task_types ?? []) {
        if (seen.has(id)) continue;
        const entity = by_id.get(id);
        if (!entity) continue;
        ordered.push(entity);
        seen.add(id);
    }
    for (const t of task_types) {
        if (seen.has(t.id)) continue;
        ordered.push(t);
        seen.add(t.id);
    }
    return ordered;
}

/**
 * Convert a legacy flat job into a task-type: adopts `legacy_job_id` as an alias on
 * `target_task_type_id` (idempotent — no duplicate alias) and pins the target in the
 * repo's `pinned_task_types` (idempotent — no duplicate pin). Pure: returns new
 * `registry`/`config` instances; the caller persists them.
 *
 * When `target_task_type_id` doesn't resolve in the registry, this is a full no-op
 * (both `registry` and `config` returned unchanged) — `add_task_type_alias` already
 * no-ops on an unknown target, and pinning it anyway would otherwise leave a dangling
 * pin in the config pointing at an id that doesn't exist.
 */
export function convert_legacy_job(
    registry: Registry,
    config: RepoConfig,
    legacy_job_id: string,
    target_task_type_id: string,
): { registry: Registry; config: RepoConfig } {
    if (!registry.find_task_type_by_id(target_task_type_id)) {
        return { registry, config };
    }

    const next_registry = registry.add_task_type_alias(target_task_type_id, legacy_job_id);

    const pinned = config.pinned_task_types ?? [];
    const next_pinned = pinned.includes(target_task_type_id) ? pinned : [...pinned, target_task_type_id];
    const next_config: RepoConfig = { ...config, pinned_task_types: next_pinned };

    return { registry: next_registry, config: next_config };
}
