import * as fs from "fs";
import * as path from "path";

/** The `.timescope` file paths for a workspace root. Kept vscode-free for unit tests. */
export interface WorkspaceTimeScopePaths {
    dir: string;
    jobs_path: string;
    log_path: string;
    config_path: string;
}

/** Derive the `.timescope` dir + jobs/log/config paths under a repo root. No filesystem access. */
export function workspace_timescope_paths(ws_root: string): WorkspaceTimeScopePaths {
    const dir = path.join(ws_root, ".timescope");
    return {
        dir,
        jobs_path: path.join(dir, "jobs.json"),
        log_path: path.join(dir, "logs.jsonl"),
        config_path: path.join(dir, "config.json"),
    };
}

/**
 * A workspace is opted-in when its `.timescope` exists AND is a directory — a
 * stray file named `.timescope` must not be mistaken for opt-in (it would make
 * later writes fail).
 */
export function timescope_dir_opted_in(dir: string): boolean {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}
