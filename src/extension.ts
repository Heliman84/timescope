import * as vscode from "vscode";

import { resolve_paths, TimeScopePaths } from "./core/paths";
import { load_all_jobs, add_job, rename_job, delete_job } from "./core/jobs";
import { append_log_record, load_all_logs } from "./core/logs";
import { state, ui, reset_state_after_stop } from "./core/state";
import { 
    start_timer_interval,
    stop_timer_interval,
    update_status_bar
} from "./core/timer";
import { handle_dashboard } from "./dashboard/controller/dashboard";


export function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration("timescope");

    //
    // Resolve paths (global canonical + workspace mirror)
    //
    const paths: TimeScopePaths = resolve_paths(context);

    //
    // Update settings UI to show resolved global paths
    //
    config.update("global_jobs_path", paths.global_jobs_path, vscode.ConfigurationTarget.Global);
    config.update("global_log_path", paths.global_log_path, vscode.ConfigurationTarget.Global);

    //
    // ────────────────────────────────────────────────────────────────
    // STATUS BAR SETUP
    // ────────────────────────────────────────────────────────────────
    //

    // Divider (highest priority so it appears first)
    ui.divider = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
    ui.divider.text = "TimeScope:";
    ui.divider.tooltip = "TimeScope Controls";
    ui.divider.show();

    // Start
    ui.start_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    ui.start_button.text = "$(play) Start";
    ui.start_button.command = "timescope.start";
    ui.start_button.show();

    // Pause
    ui.pause_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    ui.pause_button.text = "$(debug-pause) Pause";
    ui.pause_button.command = "timescope.pause";

    // Resume
    ui.resume_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    ui.resume_button.text = "$(debug-continue) Resume";
    ui.resume_button.command = "timescope.resume";

    // Stop
    ui.stop_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
    ui.stop_button.text = "$(primitive-square) Stop";
    ui.stop_button.command = "timescope.stop";

    // Timer
    ui.timer_item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
    ui.timer_item.text = "Idle";
    ui.timer_item.show();

    // Summary
    ui.summary_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
    ui.summary_button.text = "$(graph) Summary";
    ui.summary_button.command = "timescope.dashboard";
    ui.summary_button.show();

    context.subscriptions.push(
        ui.divider,
        ui.start_button,
        ui.pause_button,
        ui.resume_button,
        ui.stop_button,
        ui.timer_item,
        ui.summary_button
    );

    //
    // ────────────────────────────────────────────────────────────────
    // COMMAND: Start
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.start", async () => {
            if (state.is_running) {
                vscode.window.showWarningMessage("A session is already running.");
                return;
            }

            let jobs = load_all_jobs(paths);

            const items: vscode.QuickPickItem[] = [
                { label: "$(add) Add a new job…" }
            ];

            if (jobs.length > 0) {
                items.push({ label: "──────────────", kind: vscode.QuickPickItemKind.Separator });
                items.push(...jobs.map(j => ({ label: j })));
            }

            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: "Select a job to start"
            });

            if (!picked) return;

            // If user chose "Add a new job…"
            if (picked.label.includes("Add a new job")) {
                const new_job = await vscode.window.showInputBox({
                    prompt: "Enter new job name"
                });

                if (!new_job) return;

                add_job(paths, new_job);
                jobs = load_all_jobs(paths); // reload after adding

                // Now start the job
                start_job(new_job);
                return;
            }

            // Otherwise start the selected job
            start_job(picked.label);
        })
    );

    function start_job(job: string) {
        state.is_running = true;
        state.is_paused = false;
        state.current_job = job;
        state.start_time = new Date();
        state.pause_time = null;
        state.elapsed_ms_before_pause = 0;

        append_log_record(paths, {
            event: "start",
            job,
            timestamp: Date.now()
        });

        start_timer_interval();
        update_status_bar();
    }

    //
    // ────────────────────────────────────────────────────────────────
    // COMMAND: Pause
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.pause", () => {
            if (!state.is_running || state.is_paused) {
                vscode.window.showWarningMessage("Cannot pause — no active session.");
                return;
            }

            state.is_paused = true;
            state.pause_time = new Date();

            append_log_record(paths, {
                event: "pause",
                job: state.current_job,
                timestamp: Date.now()
            });

            update_status_bar();
        })
    );

    //
    // ────────────────────────────────────────────────────────────────
    // COMMAND: Resume
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.resume", () => {
            if (!state.is_paused) {
                vscode.window.showWarningMessage("Cannot resume — session is not paused.");
                return;
            }

            if (state.pause_time) {
                const paused_ms = Date.now() - state.pause_time.getTime();
                state.elapsed_ms_before_pause += paused_ms;
            }

            state.is_paused = false;
            state.pause_time = null;
            state.start_time = new Date();

            append_log_record(paths, {
                event: "resume",
                job: state.current_job,
                timestamp: Date.now()
            });

            update_status_bar();
        })
    );

    //
    // ────────────────────────────────────────────────────────────────
    // COMMAND: Stop (with task note)
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.stop", async () => {
            if (!state.is_running && !state.is_paused) {
                vscode.window.showWarningMessage("No active session to stop.");
                return;
            }

            const task_note = await vscode.window.showInputBox({
                prompt: "Task description (optional)"
            });

            append_log_record(paths, {
                event: "stop",
                job: state.current_job,
                timestamp: Date.now(),
                task: task_note || ""
            });

            stop_timer_interval();
            reset_state_after_stop();
            update_status_bar();
        })
    );

    //
    // ────────────────────────────────────────────────────────────────
    // COMMAND: Summary Dashboard
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
    vscode.commands.registerCommand("timescope.dashboard", () => {
        handle_dashboard(context);
    })
);


    //
    // ────────────────────────────────────────────────────────────────
    // JOB MANAGEMENT COMMANDS
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.addJob", async () => {
            const name = await vscode.window.showInputBox({ prompt: "Enter job name" });
            if (!name) return;
            add_job(paths, name);
            vscode.window.showInformationMessage(`Job added: ${name}`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.renameJob", async () => {
            const jobs = load_all_jobs(paths);
            const old_name = await vscode.window.showQuickPick(jobs, {
                placeHolder: "Select a job to rename"
            });
            if (!old_name) return;

            const new_name = await vscode.window.showInputBox({
                prompt: `Rename job "${old_name}" to:`
            });
            if (!new_name) return;

            rename_job(paths, old_name, new_name);
            vscode.window.showInformationMessage(`Renamed job to: ${new_name}`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.deleteJob", async () => {
            const jobs = load_all_jobs(paths);
            const job = await vscode.window.showQuickPick(jobs, {
                placeHolder: "Select a job to delete"
            });
            if (!job) return;

            delete_job(paths, job);
            vscode.window.showInformationMessage(`Deleted job: ${job}`);
        })
    );
}

export function deactivate() {
    stop_timer_interval();
}