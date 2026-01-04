import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export interface TimeScopePaths {
    global_jobs_path: string;
    global_log_path: string;
    workspace_jobs_path?: string;
    workspace_log_path?: string;
}

export function resolve_paths(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration("timescope");

    // New folder-based setting
    const customDir = config.get<string>("global_storage_dir", "").trim();

    // If user picked a folder → use it
    // Otherwise → use VS Code's global storage folder
    const globalDir = customDir || context.globalStorageUri.fsPath;

    // Ensure folder exists
    if (!fs.existsSync(globalDir)) {
        fs.mkdirSync(globalDir, { recursive: true });
    }

    // Canonical filenames inside the chosen folder
    const global_jobs_path = path.join(globalDir, "jobs.json");
    const global_log_path  = path.join(globalDir, "logs.jsonl");

    // Workspace folder logic unchanged
    const workspace_folder = vscode.workspace.workspaceFolders?.[0];
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