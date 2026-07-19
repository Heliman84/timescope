import * as fs from "fs";
import { Event } from "../../core/event";
import { Registry } from "../../core/registry";
import { RepoConfig, read_repo_config } from "../../core/repo_config";
import { resolve_task_type } from "../../core/task_types";
import { workspace_timescope_paths } from "../../core/workspace_paths";
import { sanitize_lines } from "../../core/log_sanitizer";
import { readJSONLSafe } from "../../utils/fs_utils";

/**
 * The dashboard payload shape, additive over the pre-#15 `buildPayload` DTO
 * (`event, job, timestamp, task, id, job_id, time_seed`) plus the existing
 * `global_line_index`/`workspace_line_index` source-badge fields. New optional
 * fields (`source_repo_id`, `client`, `project`, `task_type`) carry the #15
 * Client → Project → Task-type hierarchy; a session with none of them falls
 * back to the flat `job` title in the webview ("Unassigned"-style grouping).
 */
export interface AttributedEventDTO {
    event: string;
    job: string;
    timestamp: number;
    task: string;
    id: string;
    job_id: string;
    time_seed: number;
    global_line_index: number;
    workspace_line_index: number;
    /** Present when the event was sourced from a registered repo's log; absent for scratch. */
    source_repo_id?: string;
    client?: { id: string; name: string };
    project?: { id: string; name: string };
    task_type?: { id: string; name: string };
}

export interface AttributionContext {
    registry: Registry;
    /** Global scratch log path — owned non-workspace/off-project events. */
    scratch_path?: string;
    /**
     * The repo id of the workspace the dashboard is currently open in, if any.
     * Drives the `global_line_index`/`workspace_line_index` source-badge fields:
     * events sourced from this repo count as "workspace", everything else "global".
     */
    current_workspace_repo_id?: string;
}

/** Read + parse one owned JSONL log's events. Missing files yield no events (tolerant). */
function read_owned_events(file_path: string | undefined): Event[] {
    if (!file_path || !fs.existsSync(file_path)) return [];
    const { lines } = sanitize_lines(readJSONLSafe(file_path), { count_events: false });
    const events: Event[] = [];
    for (const line of lines) {
        const parsed = Event.fromJSONL(line);
        if (parsed) events.push(parsed);
    }
    return events;
}

/**
 * Build the attributed dashboard payload directly from owned sources — every
 * registered repo's committed `.timescope/logs.jsonl` plus the global scratch
 * log. Deliberately never reads the derived `index.jsonl`: that file is
 * disposable/rebuildable and reading it here would double the source of truth.
 *
 * Per event, resolves:
 * - `client`/`project`: from the source repo's `.timescope/config.json` binding
 *   (via the registry's client/project entities) — absent for an unbound repo
 *   or a scratch-sourced (non-workspace) event.
 * - `task_type`: from `job_id` via `resolve_task_type` (direct id, then alias) —
 *   present regardless of binding, so an unbound repo's job can still surface
 *   its task-type alone.
 *
 * Events are deduped by id across sources (the same event should have exactly
 * one owner, but tolerate a stray duplicate rather than double-count it).
 */
export function build_attributed_payload(ctx: AttributionContext): AttributedEventDTO[] {
    const { registry, scratch_path, current_workspace_repo_id } = ctx;

    const by_id = new Map<string, { event: Event; source_repo_id?: string }>();

    for (const repo of registry.repos) {
        const log_path = workspace_timescope_paths(repo.path).log_path;
        for (const event of read_owned_events(log_path)) {
            if (!by_id.has(event.id)) by_id.set(event.id, { event, source_repo_id: repo.id });
        }
    }

    for (const event of read_owned_events(scratch_path)) {
        if (!by_id.has(event.id)) by_id.set(event.id, { event });
    }

    const repo_config_cache = new Map<string, RepoConfig | null>();
    const config_for_repo = (repo_id: string): RepoConfig | null => {
        const cached = repo_config_cache.get(repo_id);
        if (cached !== undefined) return cached;
        const repo = registry.find_by_id(repo_id);
        let config: RepoConfig | null = null;
        if (repo) {
            const config_path = workspace_timescope_paths(repo.path).config_path;
            try {
                config = read_repo_config(config_path);
            } catch {
                config = null; // malformed config — tolerate, same as an unbound repo
            }
        }
        repo_config_cache.set(repo_id, config);
        return config;
    };

    const result: AttributedEventDTO[] = [];

    for (const { event, source_repo_id } of by_id.values()) {
        const is_workspace_source = source_repo_id !== undefined && source_repo_id === current_workspace_repo_id;

        const dto: AttributedEventDTO = {
            event: event.type,
            job: event.job_title,
            timestamp: event.timestamp,
            task: event.task || "",
            id: event.id,
            job_id: event.job_id,
            time_seed: event.time_seed,
            global_line_index: is_workspace_source ? -1 : 0,
            workspace_line_index: is_workspace_source ? 0 : -1,
        };

        if (source_repo_id) dto.source_repo_id = source_repo_id;

        const task_type = resolve_task_type(registry, event.job_id);
        if (task_type) dto.task_type = { id: task_type.id, name: task_type.name };

        if (source_repo_id) {
            const config = config_for_repo(source_repo_id);
            const binding = config?.binding;
            if (binding) {
                const client = registry.find_client_by_id(binding.client_id);
                const project = registry.find_project_by_id(binding.project_id);
                if (client) dto.client = { id: client.id, name: client.name };
                if (project) dto.project = { id: project.id, name: project.name };
            }
        }

        result.push(dto);
    }

    return result.sort((a, b) => b.timestamp - a.timestamp);
}
