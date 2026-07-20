import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { TimeScopePaths } from "../core/paths";
import { workspace_timescope_paths } from "../core/workspace_paths";
import { RegistryRepository } from "../core/registry_repository";
import { read_repo_config, write_repo_config, REPO_CONFIG_FORMAT_VERSION } from "../core/repo_config";
import {
    is_workspace_opted_in,
    enable_local_logging,
    register_if_opted_in,
    is_folder_declined,
    decline_folder,
    undecline_folder,
    register_repo,
} from "../core/local_opt_in";
import { acquire_lock } from "../core/instance_lock";

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

    // Activation is idempotent: an unchanged repo does NOT rewrite the registry
    // (no per-startup global write, and a narrower concurrent-write window).
    const mtime_before = fs.statSync(b.paths.registry_path).mtimeMs;
    register_if_opted_in(b.paths, b.ws_root, "workspace", b.registry_repo, 700);
    const mtime_after = fs.statSync(b.paths.registry_path).mtimeMs;
    assert.strictEqual(mtime_after, mtime_before, "unchanged repo must not rewrite registry.json");
    assert.strictEqual(b.registry_repo.load().find_by_id(healed_id!)!.last_seen, 600, "last_seen not churned on unchanged activation");

    // Stray FILE named `.timescope` (US-12 edge) → a clear, actionable error, not a raw fs throw.
    const s = fixture("strayfile");
    fs.writeFileSync(workspace_timescope_paths(s.ws_root).dir, "not a directory", "utf8");
    assert.throws(
        () => enable_local_logging(s.paths, s.ws_root, "workspace", s.registry_repo, 1),
        /is not a directory/,
        "a stray .timescope file yields a clear error instead of a low-signal mkdir throw"
    );
}

/**
 * Tests the registry-backed per-folder opt-out ("Never for this folder"):
 * - Target: decline_folder / is_folder_declined / undecline_folder in src/core/local_opt_in.ts
 * - What: a decline persists to registry.json (not VS Code state), is idempotent (no write
 *   churn), and can be reversed by the underlying function (UI is #6).
 * - Why: opt-out storage moves into TimeScope's own inspectable per-machine store now, so it's
 *   testable ahead of the #6 Settings tab.
 */
export function run_local_opt_in_decline_tests(): void {
    const a = fixture("decline");
    assert.strictEqual(is_folder_declined(a.registry_repo, a.ws_root), false, "not declined initially");

    decline_folder(a.registry_repo, a.ws_root);
    assert.ok(is_folder_declined(a.registry_repo, a.ws_root), "folder declined after decline_folder");
    assert.ok(a.registry_repo.load().is_declined(a.ws_root), "decline persisted to registry.json on disk");

    // Idempotent: re-declining does not rewrite the file.
    const mtime_before = fs.statSync(a.paths.registry_path).mtimeMs;
    decline_folder(a.registry_repo, a.ws_root);
    assert.strictEqual(fs.statSync(a.paths.registry_path).mtimeMs, mtime_before, "re-decline must not rewrite registry.json");

    // Underlying reversal (the #6 Settings tab will call this).
    undecline_folder(a.registry_repo, a.ws_root);
    assert.strictEqual(is_folder_declined(a.registry_repo, a.ws_root), false, "undecline clears the decline");

    // A declined folder coexists with registered repos.
    enable_local_logging(a.paths, a.ws_root, "workspace", a.registry_repo, 1000);
    decline_folder(a.registry_repo, path.join(a.root, "other-folder"));
    const reg = a.registry_repo.load();
    assert.strictEqual(reg.repos.length, 1, "repo still registered");
    assert.ok(reg.is_declined(path.join(a.root, "other-folder")), "decline recorded alongside the repo");
}

/**
 * Tests the first-opt-in repo_id race (#47):
 * - Target: enable_local_logging / ensure_repo_config in src/core/local_opt_in.ts
 * - What: when a config.json already exists on disk (another window won the race), a fresh
 *   call to enable_local_logging adopts the winner's id instead of minting a second identity.
 * - Why: two windows opting in a never-before-seen folder at the same instant must converge
 *   on one repo id, not each write their own config over the other.
 */
export function run_local_opt_in_first_opt_in_race_tests(): void {
    const a = fixture("race");
    const ws = workspace_timescope_paths(a.ws_root);

    // Simulate another window winning the race: it already created .timescope + config.json
    // with its own repo_id before this window calls enable_local_logging.
    fs.mkdirSync(ws.dir, { recursive: true });
    const winner_id = "winnerwin01";
    write_repo_config(ws.config_path, { repo_id: winner_id, format_version: REPO_CONFIG_FORMAT_VERSION });

    const adopted_id = enable_local_logging(a.paths, a.ws_root, "workspace", a.registry_repo, 1000);
    assert.strictEqual(adopted_id, winner_id, "enable_local_logging adopts the pre-existing winner's repo_id");
    assert.strictEqual(read_repo_config(ws.config_path)!.repo_id, winner_id, "config.json is untouched — no second identity minted");
    assert.strictEqual(a.registry_repo.load().repos.length, 1, "only the winner's single identity is registered");
    assert.strictEqual(a.registry_repo.load().find_by_id(winner_id)!.path, a.ws_root, "registered under the winner's id");
}

/**
 * Tests decline/registration concurrency via RegistryRepository.update (#47 F1):
 * - Target: decline_folder / undecline_folder / register_repo in src/core/local_opt_in.ts
 * - What: a decline and a concurrent registration both survive (neither clobbers the
 *   other); an undecline followed by a concurrent registration keeps the decline removed
 *   — a whole-registry merge would have unioned the stale decline back in, since a union
 *   can't represent a removal, but intent-based `update` (fresh disk read right before
 *   each write) can.
 * - Why: pins reviewer finding F1 against a regression back to whole-snapshot merge/save.
 */
export function run_local_opt_in_concurrent_writer_tests(): void {
    const a = fixture("concurrent-writer");
    const declined_path = path.join(a.root, "declined-folder");

    // A decline and a "concurrent" registration (interleaved calls, both routed through
    // RegistryRepository.update — each reloads fresh from disk right before writing).
    decline_folder(a.registry_repo, declined_path);
    register_repo(a.registry_repo, "repo-x", "X", a.ws_root, 1000);
    let reg = a.registry_repo.load();
    assert.ok(reg.is_declined(declined_path), "decline survives a concurrent registration");
    assert.ok(reg.find_by_id("repo-x"), "registration survives a concurrent decline");

    // Undecline, then another window registers — the decline must stay removed.
    undecline_folder(a.registry_repo, declined_path);
    register_repo(a.registry_repo, "repo-y", "Y", path.join(a.root, "y-root"), 2000);
    reg = a.registry_repo.load();
    assert.ok(!reg.is_declined(declined_path), "undecline stays removed after a concurrent registration");
    assert.ok(reg.find_by_id("repo-y"), "the concurrent registration also lands");
}

/**
 * Tests that a mid-session opt-in and a later activation resolve to the SAME lock key
 * (#47 PR #64 code-review finding — the mid-session opt-in gap):
 * - Target: enable_local_logging / register_if_opted_in in src/core/local_opt_in.ts
 * - What: a window that opts in mid-session (`enable_local_logging`, the Start → "Track
 *   here" path) and a later window that activates against the now-already-opted-in
 *   workspace (`register_if_opted_in`, the activation path) both resolve the identical
 *   repo_id — the same key `acquire_lock` would be called against. A second `acquire_lock`
 *   call on that shared key is blocked live-foreign, closing the blind spot where a
 *   mid-session opt-in window never advertised a lock and a later window opened on the
 *   same repo would acquire silently, with no warning, racing the first window's session.
 * - Why: the extension.ts wiring that actually calls `acquire_instance_lock` from the
 *   "Track here" branch is vscode-layer and stays F5-only (per the existing coverage-gap
 *   convention); this test pins the identity guarantee the fix depends on.
 */
export function run_local_opt_in_mid_session_lock_key_tests(): void {
    const root = path.join(__dirname, "..", "..", "test-output", `opt-in-lock-key-${Date.now()}`);
    const global_dir = path.join(root, "global");
    const ws_root = path.join(root, "workspace");
    fs.mkdirSync(global_dir, { recursive: true });
    fs.mkdirSync(ws_root, { recursive: true });
    const registry_path = path.join(global_dir, "registry.json");
    const registry_repo = new RegistryRepository(registry_path);
    const locks_dir = path.join(global_dir, "locks");

    // Window A opts in mid-session (Start → "Track here").
    const paths_a: TimeScopePaths = {
        global_jobs_path: path.join(global_dir, "jobs.json"),
        global_log_path: path.join(global_dir, "logs.jsonl"),
        registry_path,
    };
    const mid_session_repo_id = enable_local_logging(paths_a, ws_root, "workspace", registry_repo, 1000);

    // Window B activates later, against the now-already-opted-in workspace — resolve_paths
    // would have set workspace_log_path/repo_config_path since `.timescope` now exists.
    const ws = workspace_timescope_paths(ws_root);
    const paths_b: TimeScopePaths = {
        global_jobs_path: path.join(global_dir, "jobs.json"),
        global_log_path: path.join(global_dir, "logs.jsonl"),
        registry_path,
        workspace_log_path: ws.log_path,
        repo_config_path: ws.config_path,
    };
    const activation_repo_id = register_if_opted_in(paths_b, ws_root, "workspace", registry_repo, 2000);

    assert.strictEqual(
        activation_repo_id,
        mid_session_repo_id,
        "mid-session opt-in and a later activation resolve to the SAME repo_id — they contest the same lock key"
    );

    // Both windows would acquire_lock against that shared key — pin that the second contests it.
    const now = Date.parse("2026-07-19T12:00:00.000Z");
    const stale_ms = 30_000;
    const first = acquire_lock(locks_dir, mid_session_repo_id, { pid: 111, instance_id: "inst-A", now }, stale_ms);
    assert.strictEqual(first.acquired, true, "window A (mid-session opt-in) acquires the lock for the shared key");

    const second = acquire_lock(locks_dir, activation_repo_id!, { pid: 222, instance_id: "inst-B", now: now + 1 }, stale_ms);
    assert.strictEqual(second.acquired, false, "window B (later activation) contests the same key and is blocked live-foreign");
    assert.strictEqual(second.live_foreign, true, "window B sees a live foreign lock — the mid-session opt-in blind spot is closed");
}
