import * as fs from "fs";
import { TimeScopePaths } from "./paths";
import { workspace_timescope_paths } from "./workspace_paths";
import { RegistryRepository } from "./registry_repository";
import {
    read_repo_config,
    write_repo_config,
    generate_repo_id,
    REPO_CONFIG_FORMAT_VERSION,
} from "./repo_config";

/** Opted-in ⟺ the workspace log path is live (its `.timescope` folder exists). */
export function is_workspace_opted_in(paths: TimeScopePaths): boolean {
    return typeof paths.workspace_log_path === "string";
}

/** Read the repo's existing config, or mint + persist a fresh one. */
function ensure_repo_config(config_path: string): string {
    const existing = read_repo_config(config_path);
    if (existing) return existing.repo_id;
    const repo_id = generate_repo_id();
    write_repo_config(config_path, { repo_id, format_version: REPO_CONFIG_FORMAT_VERSION });
    return repo_id;
}

/** Upsert this repo into the global registry (records path + last_seen for rebuild). */
export function register_repo(
    registry_repo: RegistryRepository,
    repo_id: string,
    name: string,
    ws_path: string,
    now: number
): void {
    const registry = registry_repo.load();
    registry_repo.save(registry.upsert_repo({ id: repo_id, name, path: ws_path, last_seen: now }));
}

/**
 * Turn on local logging for a workspace: create `.timescope`, ensure config.json,
 * mutate the shared paths object so the repositories (which hold it by reference)
 * begin writing the workspace log, and register the repo. Returns the repo id.
 */
export function enable_local_logging(
    paths: TimeScopePaths,
    ws_root: string,
    ws_name: string,
    registry_repo: RegistryRepository,
    now: number
): string {
    const ws = workspace_timescope_paths(ws_root);
    fs.mkdirSync(ws.dir, { recursive: true });
    const repo_id = ensure_repo_config(ws.config_path);

    // Mutate in place — EventRepository/JobRepository share this exact object.
    paths.workspace_jobs_path = ws.jobs_path;
    paths.workspace_log_path = ws.log_path;
    paths.repo_config_path = ws.config_path;

    register_repo(registry_repo, repo_id, ws_name, ws_root, now);
    return repo_id;
}

/**
 * Activation-time housekeeping: when a workspace is already opted in, make sure
 * it has a config.json and refresh its registry entry (path may have moved).
 * Returns the repo id, or null when there's nothing opted-in to register.
 */
export function register_if_opted_in(
    paths: TimeScopePaths,
    ws_root: string | undefined,
    ws_name: string,
    registry_repo: RegistryRepository,
    now: number
): string | null {
    if (!ws_root || !is_workspace_opted_in(paths)) return null;
    const ws = workspace_timescope_paths(ws_root);
    const repo_id = ensure_repo_config(ws.config_path);

    // Activation runs on every window open — only rewrite the registry when the
    // repo is new or its name/path actually changed, not to refresh last_seen.
    // Avoids a global-storage write on every startup and shrinks (does not
    // close) the concurrent read-modify-write window; robust multi-writer
    // registry safety is #47's concern.
    const registry = registry_repo.load();
    const existing = registry.find_by_id(repo_id);
    if (!existing || existing.name !== ws_name || existing.path !== ws_root) {
        registry_repo.save(registry.upsert_repo({ id: repo_id, name: ws_name, path: ws_root, last_seen: now }));
    }
    return repo_id;
}
