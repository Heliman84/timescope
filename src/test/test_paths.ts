import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { resolve_storage_dir } from "../core/resolve_storage_dir";
import { workspace_timescope_paths, timescope_dir_opted_in } from "../core/workspace_paths";

// ═══════════════════════════════════════════════════════════════════════════
// resolve_storage_dir
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests resolve_storage_dir absolute-path passthrough:
 * - Target: resolve_storage_dir in src/core/resolve_storage_dir.ts
 * - What: an absolute global_storage_dir is returned as-is (normalized),
 *   independent of the workspace root — preserving today's behavior.
 * - Does: passes an absolute path with and without a workspace root.
 * - Why: existing users pin an absolute folder; that must keep working.
 */
export function run_resolve_storage_dir_absolute_tests(): void {
    const abs = path.resolve(path.sep === "\\" ? "C:\\data\\ts" : "/data/ts");

    assert.strictEqual(resolve_storage_dir(abs, "/some/workspace"), path.normalize(abs),
        "absolute value returned normalized, workspace ignored");
    assert.strictEqual(resolve_storage_dir(abs, undefined), path.normalize(abs),
        "absolute value works with no workspace root");

    console.log("  ✓ resolve_storage_dir absolute tests passed");
}

/**
 * Tests resolve_storage_dir relative resolution against the workspace root:
 * - Target: resolve_storage_dir in src/core/resolve_storage_dir.ts
 * - What: a relative value is joined onto the first workspace folder's root.
 * - Does: resolves "global-storage" against a workspace root.
 * - Why: this is the fix — it lets test-workspace commit a portable value
 *   that resolves correctly on every clone.
 */
export function run_resolve_storage_dir_relative_tests(): void {
    const wsRoot = path.resolve(path.sep === "\\" ? "C:\\clone\\ts\\test-workspace" : "/clone/ts/test-workspace");

    assert.strictEqual(resolve_storage_dir("global-storage", wsRoot),
        path.resolve(wsRoot, "global-storage"),
        "relative value joined against workspace root");
    assert.strictEqual(resolve_storage_dir("./nested/dir", wsRoot),
        path.resolve(wsRoot, "./nested/dir"),
        "relative value with ./ resolves against workspace root");

    console.log("  ✓ resolve_storage_dir relative tests passed");
}

/**
 * Tests resolve_storage_dir null fallback cases:
 * - Target: resolve_storage_dir in src/core/resolve_storage_dir.ts
 * - What: returns null when there's nothing to resolve — so the caller falls
 *   back to VS Code's default global storage dir.
 * - Does: empty/whitespace values, and a relative value with no workspace root.
 * - Why: an unresolvable relative path must never silently land data in cwd;
 *   null signals the caller to use the safe default.
 */
export function run_resolve_storage_dir_fallback_tests(): void {
    assert.strictEqual(resolve_storage_dir("", "/some/workspace"), null,
        "empty value → null");
    assert.strictEqual(resolve_storage_dir("   ", "/some/workspace"), null,
        "whitespace-only value → null");
    assert.strictEqual(resolve_storage_dir("global-storage", undefined), null,
        "relative value with no workspace root → null");

    console.log("  ✓ resolve_storage_dir fallback tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Exported runner
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests workspace_timescope_paths:
 * - Target: workspace_timescope_paths in src/core/paths.ts
 * - What: derives the `.timescope` dir + jobs/log/config paths under a repo root.
 * - Why: the opt-in flow (#48) needs these candidate paths without touching disk.
 */
export function run_workspace_timescope_paths_tests(): void {
    const wsRoot = path.resolve(path.sep === "\\" ? "C:\\work\\lantern" : "/work/lantern");
    const ws = workspace_timescope_paths(wsRoot);

    assert.strictEqual(ws.dir, path.join(wsRoot, ".timescope"), "dir is <root>/.timescope");
    assert.strictEqual(ws.jobs_path, path.join(wsRoot, ".timescope", "jobs.json"), "jobs.json under .timescope");
    assert.strictEqual(ws.log_path, path.join(wsRoot, ".timescope", "logs.jsonl"), "logs.jsonl under .timescope");
    assert.strictEqual(ws.config_path, path.join(wsRoot, ".timescope", "config.json"), "config.json under .timescope");

    console.log("  ✓ workspace_timescope_paths tests passed");
}

/**
 * Tests timescope_dir_opted_in:
 * - Target: timescope_dir_opted_in in src/core/workspace_paths.ts
 * - What: opt-in requires a `.timescope` *directory*; absent or a stray file → not opted in.
 * - Why: treating a file named `.timescope` as opt-in would make later writes fail.
 */
export function run_timescope_dir_opted_in_tests(): void {
    const root = path.join(__dirname, "..", "..", "test-output", `optin-dir-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });

    const missing = path.join(root, "missing", ".timescope");
    assert.strictEqual(timescope_dir_opted_in(missing), false, "absent .timescope → not opted in");

    const as_dir = path.join(root, "as_dir");
    fs.mkdirSync(as_dir, { recursive: true });
    assert.strictEqual(timescope_dir_opted_in(as_dir), true, ".timescope directory → opted in");

    const as_file = path.join(root, "as_file");
    fs.writeFileSync(as_file, "not a dir", "utf8");
    assert.strictEqual(timescope_dir_opted_in(as_file), false, "stray .timescope file → NOT opted in");

    console.log("  ✓ timescope_dir_opted_in tests passed");
}

export function run_resolve_storage_dir_tests(): void {
    console.log("paths: resolve_storage_dir");
    run_resolve_storage_dir_absolute_tests();
    run_resolve_storage_dir_relative_tests();
    run_resolve_storage_dir_fallback_tests();
    run_workspace_timescope_paths_tests();
    run_timescope_dir_opted_in_tests();
}
