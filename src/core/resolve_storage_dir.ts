import * as path from "path";

/**
 * Resolve the effective global storage directory from the raw `timescope.global_storage_dir`
 * setting value. Kept vscode-free so it can be unit-tested by the pure-Node suite.
 *
 * - "" / whitespace         → null (caller uses VS Code's default global storage)
 * - absolute path           → returned as-is (normalized)
 * - relative + ws root       → joined against the workspace root
 * - relative + no ws root    → null (unresolvable → caller falls back to the default)
 */
export function resolve_storage_dir(
    raw_setting: string,
    workspace_root: string | undefined
): string | null {
    const trimmed = raw_setting.trim();
    if (!trimmed) { return null; }
    if (path.isAbsolute(trimmed)) { return path.normalize(trimmed); }
    if (!workspace_root) { return null; }
    return path.resolve(workspace_root, trimmed);
}
