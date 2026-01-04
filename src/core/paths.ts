import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export interface TimeScopePaths {
    global_jobs_path: string;
    global_log_path: string;
    workspace_jobs_path?: string;
    workspace_log_path?: string;
}

export function resolve_paths(context: vscode.ExtensionContext): TimeScopePaths {
    const config = vscode.workspace.getConfiguration("timescope");

    //
    // GLOBAL PATHS (canonical)
    //
    const custom_global_jobs = config.get<string>("global_jobs_path", "").trim();
    const custom_global_logs = config.get<string>("global_log_path", "").trim();

    const default_global_dir = context.globalStorageUri.fsPath;
    const default_global_jobs = path.join(default_global_dir, "jobs.json");
    const default_global_logs = path.join(default_global_dir, "logs.jsonl");

    if (!fs.existsSync(default_global_dir)) {
        fs.mkdirSync(default_global_dir, { recursive: true });
    }

    const global_jobs_path = custom_global_jobs || default_global_jobs;
    const global_log_path = custom_global_logs || default_global_logs;

    //
    // WORKSPACE PATHS (mirror)
    //
    const workspace_folder = vscode.workspace.workspaceFolders?.[0];
    if (!workspace_folder) {
        return {
            global_jobs_path,
            global_log_path
        };
    }

    const ws_root = workspace_folder.uri.fsPath;
    const ws_dir = path.join(ws_root, ".timescope");

    if (!fs.existsSync(ws_dir)) {
        fs.mkdirSync(ws_dir, { recursive: true });
    }

    const workspace_jobs_path = path.join(ws_dir, "jobs.json");
    const workspace_log_path = path.join(ws_dir, "logs.jsonl");

    return {
        global_jobs_path,
        global_log_path,
        workspace_jobs_path,
        workspace_log_path
    };
}