import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { resolve_storage_dir } from "./resolve_storage_dir";
import { workspace_timescope_paths, timescope_dir_opted_in } from "./workspace_paths";

export { workspace_timescope_paths } from "./workspace_paths";
export type { WorkspaceTimeScopePaths } from "./workspace_paths";

export interface TimeScopePaths {
    global_jobs_path: string;
    global_log_path: string;
    /** Global registry of known repos (#48). Always set; file created on first write. */
    registry_path: string;
    /**
     * Workspace log/jobs paths — set only when the workspace is *opted in*
     * (a `.timescope` folder exists). Left undefined otherwise so no write
     * ever creates `.timescope` speculatively (#2).
     */
    workspace_jobs_path?: string;
    workspace_log_path?: string;
    /**
     * Candidate `.timescope/config.json` path for the open workspace, set
     * whenever a folder is open (even before opt-in) so the opt-in flow knows
     * where to write. Presence here does NOT imply opted-in.
     */
    repo_config_path?: string;
}

export function resolve_paths(context: vscode.ExtensionContext): TimeScopePaths {
    const config = vscode.workspace.getConfiguration("timescope");

    // Folder-based setting. A relative value resolves against the first workspace
    // folder; an absolute value is used as-is. If it can't be resolved (empty, or
    // relative with no workspace open) → fall back to VS Code's global storage folder.
    const custom_dir = config.get<string>("global_storage_dir", "");
    const workspace_folder = vscode.workspace.workspaceFolders?.[0];
    const resolved_dir = resolve_storage_dir(custom_dir, workspace_folder?.uri.fsPath);
    const global_dir = resolved_dir ?? context.globalStorageUri.fsPath;

    // The global storage folder is ours to create — it is not the repo's `.timescope`.
    if (!fs.existsSync(global_dir)) {
        fs.mkdirSync(global_dir, { recursive: true });
    }

    const paths: TimeScopePaths = {
        global_jobs_path: path.join(global_dir, "jobs.json"),
        global_log_path: path.join(global_dir, "logs.jsonl"),
        registry_path: path.join(global_dir, "registry.json"),
    };

    if (workspace_folder) {
        const ws = workspace_timescope_paths(workspace_folder.uri.fsPath);
        // Candidate config path is always exposed so the opt-in flow can write it.
        paths.repo_config_path = ws.config_path;
        // Opt-in is signalled by an existing `.timescope` *directory* (#2 edge
        // case: an existing folder means "log here"). We never create it here.
        if (timescope_dir_opted_in(ws.dir)) {
            paths.workspace_jobs_path = ws.jobs_path;
            paths.workspace_log_path = ws.log_path;
        }
    }

    return paths;
}
