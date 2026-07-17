import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { resolve_storage_dir } from "./resolve_storage_dir";

export interface TimeScopePaths {
    global_jobs_path: string;
    global_log_path: string;
    workspace_jobs_path?: string;
    workspace_log_path?: string;
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

    // Ensure folder exists
    if (!fs.existsSync(global_dir)) {
        fs.mkdirSync(global_dir, { recursive: true });
    }

    // Canonical filenames inside the chosen folder
    const global_jobs_path = path.join(global_dir, "jobs.json");
    const global_log_path  = path.join(global_dir, "logs.jsonl");

    // Workspace folder logic unchanged
    let workspace_jobs_path: string | undefined = undefined;
    let workspace_log_path: string | undefined = undefined;

    if (workspace_folder) {
        const ws_root = workspace_folder.uri.fsPath;
        const ws_dir = path.join(ws_root, ".timescope");

        if (!fs.existsSync(ws_dir)) {
            fs.mkdirSync(ws_dir, { recursive: true });
        }

        workspace_jobs_path = path.join(ws_dir, "jobs.json");
        workspace_log_path  = path.join(ws_dir, "logs.jsonl");
    }

    return {
        global_jobs_path,
        global_log_path,
        workspace_jobs_path,
        workspace_log_path
    };
}