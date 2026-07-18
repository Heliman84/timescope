import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { TimeScopePaths } from "../core/paths";
import { workspace_timescope_paths } from "../core/workspace_paths";
import { RegistryRepository } from "../core/registry_repository";
import { read_repo_config } from "../core/repo_config";
import {
    is_workspace_opted_in,
    enable_local_logging,
    register_if_opted_in,
} from "../core/local_opt_in";

function fixture(suffix: string): { root: string; ws_root: string; paths: TimeScopePaths; registry_repo: RegistryRepository } {
    const root = path.join(__dirname, "..", "..", "test-output", `opt-in-${suffix}-${Date.now()}`);
    const global_dir = path.join(root, "global");
    const ws_root = path.join(root, "workspace");
    fs.mkdirSync(global_dir, { recursive: true });
    fs.mkdirSync(ws_root, { recursive: true });
    const paths: TimeScopePaths = {
        global_jobs_path: path.join(global_dir, "jobs.json"),
        global_log_path: path.join(global_dir, "logs.jsonl"),
        registry_path: path.join(global_dir, "registry.json"),
        repo_config_path: workspace_timescope_paths(ws_root).config_path,
    };
    return { root, ws_root, paths, registry_repo: new RegistryRepository(paths.registry_path) };
}

/**
 * Tests the local opt-in flow:
 * - Target: enable_local_logging / register_if_opted_in / is_workspace_opted_in in src/core/local_opt_in.ts
 * - What: no speculative .timescope; opting in creates it + config, mutates paths, registers the repo;
 *   activation re-registers an already-opted-in repo without minting a new id.
 * - Why: #48 foundation + the #2 fix (no folder until the user opts in).
 */
export function run_local_opt_in_tests(): void {
    // A fresh workspace with no .timescope is NOT opted in, and nothing is created.
    const a = fixture("fresh");
    assert.strictEqual(is_workspace_opted_in(a.paths), false, "no workspace_log_path → not opted in");
    assert.strictEqual(fs.existsSync(workspace_timescope_paths(a.ws_root).dir), false, ".timescope not created speculatively");

    // Opting in creates .timescope + config, mutates paths, and registers the repo.
    const repo_id = enable_local_logging(a.paths, a.ws_root, "workspace", a.registry_repo, 1000);
    const ws = workspace_timescope_paths(a.ws_root);
    assert.ok(fs.existsSync(ws.dir), ".timescope created on opt-in");
    assert.strictEqual(read_repo_config(ws.config_path)!.repo_id, repo_id, "config.json holds the repo id");
    assert.strictEqual(a.paths.workspace_log_path, ws.log_path, "paths mutated to the workspace log");
    assert.strictEqual(is_workspace_opted_in(a.paths), true, "opted in after enable");
    const reg = a.registry_repo.load();
    assert.strictEqual(reg.find_by_id(repo_id)!.path, a.ws_root, "repo registered with its path");
    assert.strictEqual(reg.find_by_id(repo_id)!.last_seen, 1000, "last_seen recorded");

    // Re-enabling reuses the existing repo id (never mints a second identity).
    const repo_id_again = enable_local_logging(a.paths, a.ws_root, "workspace", a.registry_repo, 2000);
    assert.strictEqual(repo_id_again, repo_id, "existing repo_id reused");
    assert.strictEqual(a.registry_repo.load().repos.length, 1, "no duplicate registry entry");
    assert.strictEqual(a.registry_repo.load().find_by_id(repo_id)!.last_seen, 2000, "last_seen refreshed");

    // register_if_opted_in: no-op when not opted in.
    const b = fixture("activation");
    assert.strictEqual(register_if_opted_in(b.paths, b.ws_root, "workspace", b.registry_repo, 500), null, "not opted in → null");
    assert.strictEqual(b.registry_repo.load().repos.length, 0, "nothing registered when not opted in");

    // Simulate an already-opted-in repo (folder exists) at activation → registers, config self-heals.
    const bws = workspace_timescope_paths(b.ws_root);
    fs.mkdirSync(bws.dir, { recursive: true });
    b.paths.workspace_log_path = bws.log_path; // resolve_paths would set this when the folder exists
    const healed_id = register_if_opted_in(b.paths, b.ws_root, "workspace", b.registry_repo, 600);
    assert.ok(healed_id, "opted-in activation returns a repo id");
    assert.ok(fs.existsSync(bws.config_path), "missing config.json is self-healed at activation");
    assert.strictEqual(b.registry_repo.load().find_by_id(healed_id!)!.last_seen, 600, "registered at activation");
}
