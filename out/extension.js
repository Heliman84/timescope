"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const os = require("os");
let state = {
    is_running: false,
    is_paused: false,
    start_time: null,
    pause_time: null,
    elapsed_ms_before_pause: 0,
    current_job: null,
    timer_interval: null,
    workspace_root: null,
    log_file_path: null
};
let start_button;
let pause_button;
let resume_button;
let stop_button;
let timer_item;
let summary_button;
function activate(context) {
    state.workspace_root = get_workspace_root();
    state.log_file_path = get_log_file_path(state.workspace_root);
    start_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    pause_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    resume_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    stop_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
    timer_item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
    summary_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
    start_button.command = "timescope.start";
    start_button.text = "$(debug-start) Start";
    pause_button.command = "timescope.pause";
    pause_button.text = "$(debug-pause) Pause";
    resume_button.command = "timescope.resume";
    resume_button.text = "$(debug-continue) Resume";
    stop_button.command = "timescope.stop";
    stop_button.text = "$(debug-stop) Stop";
    timer_item.text = "Idle";
    summary_button.command = "timescope.dashboard";
    summary_button.text = "$(graph) Summary";
    update_status_bar();
    context.subscriptions.push(start_button, pause_button, resume_button, stop_button, timer_item, summary_button);
    context.subscriptions.push(vscode.commands.registerCommand("timescope.start", handle_start), vscode.commands.registerCommand("timescope.pause", handle_pause), vscode.commands.registerCommand("timescope.resume", handle_resume), vscode.commands.registerCommand("timescope.stop", handle_stop), vscode.commands.registerCommand("timescope.dashboard", () => handle_dashboard(context)), vscode.commands.registerCommand("timescope.rename_job", handle_rename_job));
}
function deactivate() {
    if (state.timer_interval) {
        clearInterval(state.timer_interval);
        state.timer_interval = null;
    }
}
//
// PATH HELPERS
//
function get_workspace_root() {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
}
function get_global_data_dir() {
    const appdata_env = process.env.APPDATA;
    if (appdata_env && appdata_env.length > 0) {
        return path.join(appdata_env, "timescope");
    }
    return path.join(os.homedir(), ".timescope");
}
function get_log_file_path(workspace_root) {
    if (workspace_root) {
        return path.join(workspace_root, "logs", "work_log.jsonl");
    }
    return path.join(get_global_data_dir(), "logs", "work_log.jsonl");
}
function get_global_jobs_path() {
    return path.join(get_global_data_dir(), "jobs.json");
}
function get_workspace_jobs_path() {
    if (!state.workspace_root)
        return null;
    return path.join(state.workspace_root, ".timescope", "jobs.json");
}
//
// JOB FILE HELPERS
//
async function ensure_directory_for_file(file_path) {
    await fs.promises.mkdir(path.dirname(file_path), { recursive: true });
}
async function load_jobs(file_path) {
    try {
        const raw = await fs.promises.readFile(file_path, "utf8");
        const parsed = JSON.parse(raw);
        // If file is already an array: ["Job A", "Job B"]
        if (Array.isArray(parsed)) {
            return parsed;
        }
        // If file is an object: { jobs: ["Job A", "Job B"] }
        if (parsed && Array.isArray(parsed.jobs)) {
            return parsed.jobs;
        }
        return [];
    }
    catch {
        return [];
    }
}
async function save_jobs(file_path, jobs) {
    await fs.promises.mkdir(path.dirname(file_path), { recursive: true });
    const content = JSON.stringify({ jobs }, null, 2);
    await fs.promises.writeFile(file_path, content, "utf8");
}
async function load_all_jobs() {
    const global_jobs = await load_jobs(get_global_jobs_path());
    const workspace_path = get_workspace_jobs_path();
    const workspace_jobs = workspace_path ? await load_jobs(workspace_path) : [];
    return Array.from(new Set([...global_jobs, ...workspace_jobs]));
}
async function rename_job_in_job_lists(old_name, new_name) {
    const global_path = get_global_jobs_path();
    const workspace_path = get_workspace_jobs_path();
    const global_jobs = await load_jobs(global_path);
    if (global_jobs.includes(old_name)) {
        const updated = global_jobs.map(j => j === old_name ? new_name : j);
        await save_jobs(global_path, updated);
    }
    if (workspace_path) {
        const workspace_jobs = await load_jobs(workspace_path);
        if (workspace_jobs.includes(old_name)) {
            const updated = workspace_jobs.map(j => j === old_name ? new_name : j);
            await save_jobs(workspace_path, updated);
        }
    }
}
async function rename_job_in_log_file(old_name, new_name) {
    if (!state.log_file_path)
        return;
    const raw = await fs.promises.readFile(state.log_file_path, "utf8");
    const lines = raw.split("\n").filter(l => l.trim().length > 0);
    const updated = lines.map(line => {
        const e = JSON.parse(line);
        if (e.job === old_name)
            e.job = new_name;
        return JSON.stringify(e);
    });
    await fs.promises.writeFile(state.log_file_path, updated.join("\n") + "\n");
}
//
// JOB SELECTION
//
async function add_job(job_name, save_as_global) {
    if (save_as_global) {
        const global_path = get_global_jobs_path();
        const existing = await load_jobs(global_path);
        if (!existing.includes(job_name)) {
            existing.push(job_name);
            existing.sort();
            await save_jobs(global_path, existing);
        }
    }
    else {
        const workspace_path = get_workspace_jobs_path();
        if (!workspace_path) {
            vscode.window.showWarningMessage("No workspace open. Saving as global instead.");
            return add_job(job_name, true);
        }
        const existing = await load_jobs(workspace_path);
        if (!existing.includes(job_name)) {
            existing.push(job_name);
            existing.sort();
            await save_jobs(workspace_path, existing);
        }
    }
}
async function select_job() {
    const jobs = await load_all_jobs();
    const items = jobs.map(j => ({
        label: j
    }));
    items.push({ label: "──────────────", kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: "➕ Add New Job…" });
    const selection = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a job"
    });
    if (!selection)
        return null;
    if (selection.label === "➕ Add New Job…") {
        const name = await vscode.window.showInputBox({
            prompt: "Enter new job name"
        });
        if (!name)
            return null;
        const scope = await vscode.window.showQuickPick([
            { label: "Global", description: "Available in all workspaces" },
            { label: "Workspace", description: "Only in this workspace" }
        ], {
            placeHolder: "Save job as… (default: Global)"
        });
        // Default to Global if user presses ESC or clicks away
        const save_as_global = !scope || scope.label === "Global";
        await add_job(name.trim(), save_as_global);
        return name.trim();
    }
    return selection.label;
}
//
// LOGGING
//
async function append_log_entry(entry) {
    if (!state.log_file_path) {
        state.log_file_path = get_log_file_path(state.workspace_root);
    }
    await ensure_directory_for_file(state.log_file_path);
    await fs.promises.appendFile(state.log_file_path, JSON.stringify(entry) + "\n", "utf8");
}
//
// TIMER + STATUS BAR
//
function format_duration_ms(ms) {
    const total_seconds = Math.floor(ms / 1000);
    const hours = Math.floor(total_seconds / 3600);
    const minutes = Math.floor((total_seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}
function update_timer_text() {
    if (!state.is_running && !state.is_paused) {
        timer_item.text = "Idle";
        return;
    }
    let total_ms = state.elapsed_ms_before_pause;
    if (state.is_running && state.start_time) {
        total_ms += Date.now() - state.start_time.getTime();
    }
    const formatted = format_duration_ms(total_ms);
    timer_item.text = state.is_paused ? `Paused: ${formatted}` : `Working: ${formatted}`;
}
function start_timer_interval() {
    if (state.timer_interval)
        clearInterval(state.timer_interval);
    state.timer_interval = setInterval(update_timer_text, 1000);
}
function stop_timer_interval() {
    if (state.timer_interval) {
        clearInterval(state.timer_interval);
        state.timer_interval = null;
    }
}
function reset_state_after_stop() {
    state.is_running = false;
    state.is_paused = false;
    state.start_time = null;
    state.pause_time = null;
    state.elapsed_ms_before_pause = 0;
    state.current_job = null;
    stop_timer_interval();
    update_status_bar();
}
function update_status_bar() {
    start_button.hide();
    pause_button.hide();
    resume_button.hide();
    stop_button.hide();
    timer_item.show();
    summary_button.show();
    if (!state.is_running && !state.is_paused) {
        start_button.show();
        timer_item.text = "Idle";
        return;
    }
    update_timer_text();
    if (state.is_running && !state.is_paused) {
        pause_button.show();
        stop_button.show();
        return;
    }
    if (state.is_paused) {
        resume_button.show();
        stop_button.show();
    }
}
//
// COMMAND HANDLERS
//
async function handle_start() {
    if (state.is_running) {
        vscode.window.showInformationMessage("Already running.");
        return;
    }
    const job = await select_job();
    if (!job)
        return;
    state.current_job = job;
    state.is_running = true;
    state.is_paused = false;
    state.start_time = new Date();
    state.elapsed_ms_before_pause = 0;
    start_timer_interval();
    update_status_bar();
    await append_log_entry({
        type: "start",
        timestamp: state.start_time.toISOString(),
        job
    });
}
async function handle_pause() {
    if (!state.is_running || state.is_paused)
        return;
    const now = new Date();
    if (state.start_time) {
        state.elapsed_ms_before_pause += now.getTime() - state.start_time.getTime();
    }
    state.pause_time = now;
    state.is_paused = true;
    state.start_time = null;
    stop_timer_interval();
    update_status_bar();
    await append_log_entry({
        type: "pause",
        timestamp: now.toISOString(),
        job: state.current_job
    });
}
async function handle_resume() {
    if (!state.is_paused || !state.current_job)
        return;
    const now = new Date();
    state.start_time = now;
    state.is_paused = false;
    start_timer_interval();
    update_status_bar();
    await append_log_entry({
        type: "resume",
        timestamp: now.toISOString(),
        job: state.current_job
    });
}
async function handle_stop() {
    if (!state.is_running && !state.is_paused)
        return;
    const stop_time = state.is_paused && state.pause_time ? state.pause_time : new Date();
    let total_ms = state.elapsed_ms_before_pause;
    if (state.is_running && !state.is_paused && state.start_time) {
        total_ms += stop_time.getTime() - state.start_time.getTime();
    }
    const task = await vscode.window.showInputBox({
        prompt: "Enter task description (optional)"
    });
    await append_log_entry({
        type: "stop",
        timestamp: stop_time.toISOString(),
        job: state.current_job,
        task: task?.trim() || null,
        duration_ms: total_ms
    });
    reset_state_after_stop();
}
//
// RENAME JOB
//
async function handle_rename_job() {
    const jobs = await load_all_jobs();
    const old_name = await vscode.window.showQuickPick(jobs, {
        placeHolder: "Select a job to rename"
    });
    if (!old_name)
        return;
    const new_name = await vscode.window.showInputBox({
        prompt: `Rename "${old_name}" to:`,
        value: old_name
    });
    if (!new_name || new_name.trim() === "" || new_name === old_name)
        return;
    await rename_job_in_job_lists(old_name, new_name);
    await rename_job_in_log_file(old_name, new_name);
    vscode.window.showInformationMessage(`Renamed job "${old_name}" → "${new_name}".`);
}
//
// SUMMARY DASHBOARD
//
async function parse_log_file(log_path) {
    try {
        const raw = await fs.promises.readFile(log_path, "utf8");
        const lines = raw.split("\n").filter(l => l.trim().length > 0);
        const events = lines.map(l => JSON.parse(l));
        const sessions = [];
        let current = null;
        for (const e of events) {
            if (e.type === "start") {
                current = {
                    job: e.job,
                    start: e.timestamp,
                    stop: null,
                    duration_ms: 0,
                    task: null
                };
            }
            if (e.type === "stop" && current) {
                current.stop = e.timestamp;
                current.duration_ms = e.duration_ms || 0;
                current.task = e.task || null;
                sessions.push(current);
                current = null;
            }
        }
        return sessions;
    }
    catch {
        return [];
    }
}
async function handle_dashboard(context) {
    const panel = vscode.window.createWebviewPanel("timeTrackerSummary", "Time Tracker Summary Dashboard", vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "src", "dashboard")
        ]
    });
    // Load index.html from disk
    const htmlPath = vscode.Uri.joinPath(context.extensionUri, "src", "dashboard", "index.html");
    let html = await fs.promises.readFile(htmlPath.fsPath, "utf8");
    // Create a nonce
    const nonce = String(Date.now());
    // Build URIs for JS and CSS
    const jsUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "src", "dashboard", "dashboard.js"));
    const cssUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "src", "dashboard", "dashboard.css"));
    // Replace placeholders in index.html
    html = html
        .replace(/\${nonce}/g, nonce)
        .replace(/\${jsUri}/g, jsUri.toString())
        .replace(/\${cssUri}/g, cssUri.toString())
        .replace(/\${cspSource}/g, panel.webview.cspSource);
    // Set final HTML
    panel.webview.html = html;
    //
    // Handle messages FROM the webview
    //
    panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.type === "request_data") {
            const log_path = state.log_file_path || get_log_file_path(state.workspace_root);
            const sessions = await parse_log_file(log_path);
            panel.webview.postMessage({
                type: "summary_data",
                payload: sessions
            });
        }
    });
}
//# sourceMappingURL=extension.js.map