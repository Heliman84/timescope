import * as fs from "fs";
import * as path from "path";

export interface BuildInfo {
    version: string;
    commit: string;
    branch: string;
    build_date: string;
}

/**
 * Reads out/buildinfo.json relative to the extension root (written by
 * scripts/write_buildinfo.js as part of `npm run vscode:prepublish`, so it's
 * regenerated on every compile — F5, `npm test`'s compile step, and
 * `npm run package` all get a current file). Never throws — a missing or
 * malformed file is expected for a fresh clone that hasn't compiled yet, so
 * callers get null and fall back gracefully.
 */
export function load_build_info(extensionRoot: string): BuildInfo | null {
    const filePath = path.join(extensionRoot, "out", "buildinfo.json");

    try {
        if (!fs.existsSync(filePath)) return null;

        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (
            typeof parsed?.version !== "string" ||
            typeof parsed?.commit !== "string" ||
            typeof parsed?.branch !== "string" ||
            typeof parsed?.build_date !== "string"
        ) {
            return null;
        }

        return { version: parsed.version, commit: parsed.commit, branch: parsed.branch, build_date: parsed.build_date };
    } catch {
        return null;
    }
}

function short_sha(commit: string): string {
    return commit.slice(0, 7);
}

/** Compact form for the status-bar tooltip, e.g. "v0.3.0 @ a1b2c3d". */
export function format_status_bar_suffix(info: BuildInfo | null): string {
    if (!info) return "no build info";
    return `v${info.version} @ ${short_sha(info.commit)}`;
}

/** Fuller form for the dashboard footer and the Show Build Info command, e.g. "v0.3.0 @ a1b2c3d (2026-07-16T00:00:00.000Z)". */
export function format_build_info_full(info: BuildInfo | null): string {
    if (!info) return "no build info";
    return `${format_status_bar_suffix(info)} (${info.build_date})`;
}
