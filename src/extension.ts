import * as vscode from "vscode";

import { resolve_paths, TimeScopePaths } from "./core/paths";
import { load_all_jobs, add_job, rename_job, delete_job } from "./core/jobs";
import { ui } from "./core/state";
import { 
    start_timer_interval,
    stop_timer_interval,
    update_status_bar,
    set_session_provider
} from "./core/timer";
import { handle_dashboard } from "./dashboard/controller/dashboard";
import { checkAndRecover } from "./core/recovery";
import { LogRepository } from "./core/logRepository";
import { Session } from "./core/session";


export async function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration("timescope");

    //
    // Resolve paths (global canonical + workspace mirror)
    //
    const paths: TimeScopePaths = resolve_paths(context);
    const repo = new LogRepository(paths);
    let activeSession: Session | null = null;

    const setActiveSession = (session: Session | null) => {
        activeSession = session;
        update_status_bar();
        if (activeSession && !activeSession.isIdle) start_timer_interval();
        else stop_timer_interval();
    };

    set_session_provider(() => activeSession);

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

    // NOTE: Status bar priorities control item ordering. We intentionally use a high base
    // priority (300) so TimeScope's status items appear to the left of workspace task buttons
    // (popular task-button extensions typically start at priority ~100 and count down). If you
    // need to change ordering, adjust the numeric priorities for the items below (divider: 300;
    // start: 299; pause: 298; ...).
    // Divider (highest priority so it appears first)
    ui.divider = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 300);
    ui.divider.text = "TimeScope:";
    ui.divider.tooltip = "Idle: No active job";
    ui.divider.show();

    // Start
    ui.start_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 299);
    ui.start_button.text = "$(play) Start";
    ui.start_button.command = "timescope.start";
    ui.start_button.show();

    // Pause
    ui.pause_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 298);
    ui.pause_button.text = "$(debug-pause) Pause";
    ui.pause_button.command = "timescope.pause";

    // Resume
    ui.resume_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 297);
    ui.resume_button.text = "$(debug-continue) Resume";
    ui.resume_button.command = "timescope.resume";

    // Stop
    ui.stop_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 296);
    ui.stop_button.text = "$(primitive-square) Stop";
    ui.stop_button.command = "timescope.stop";

    // Summary
    ui.summary_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 295);
    ui.summary_button.text = "$(graph) Summary";
    ui.summary_button.command = "timescope.dashboard";
    ui.summary_button.show();

    context.subscriptions.push(
        ui.divider,
        ui.start_button,
        ui.pause_button,
        ui.resume_button,
        ui.stop_button,
        ui.summary_button
    );

    // Check for orphaned session from previous VSCode shutdown and offer recovery
    const recoveredSession = await checkAndRecover(repo);
    setActiveSession(recoveredSession);

    //
    // ────────────────────────────────────────────────────────────────
    // COMMAND: Start
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.start", async () => {
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

    function ensureAfter(lastTimestamp: number, requested: number): number {
        return requested <= lastTimestamp ? lastTimestamp + 1 : requested;
    }

    function start_job(job: string) {
        const session = repo.loadSession(job);
        if (!session.isIdle) {
            vscode.window.showWarningMessage(`Session already active for job '${job}'.`);
            return;
        }

        const last = session.lastEvent;
        const ts = last ? ensureAfter(last.timestamp, Date.now()) : Date.now();
        const event = session.start(ts);
        repo.appendValidated(event);

        setActiveSession(repo.loadActiveSession());
    }

    //
    // ────────────────────────────────────────────────────────────────
    // COMMAND: Pause
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.pause", async () => {
            const sessions = Array.from(repo.loadSessionsByJob().values()).filter(s => s.isRunning);
            if (sessions.length === 0) {
                vscode.window.showWarningMessage("Cannot pause — no running sessions.");
                return;
            }

            let target: Session | null = sessions[0];
            if (sessions.length > 1) {
                const picked = await vscode.window.showQuickPick(
                    sessions.map(s => ({ label: s.currentJob })),
                    { placeHolder: "Select a job to pause" }
                );
                if (!picked) return;
                target = sessions.find(s => s.currentJob === picked.label) || null;
            }

            if (!target) return;
            const last = target.lastEvent;
            const ts = last ? ensureAfter(last.timestamp, Date.now()) : Date.now();
            const event = target.pause(ts);
            repo.appendValidated(event);
            setActiveSession(repo.loadActiveSession());
        })
    );

    //
    // ────────────────────────────────────────────────────────────────
    // COMMAND: Resume
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.resume", async () => {
            const sessions = Array.from(repo.loadSessionsByJob().values()).filter(s => s.isPaused);
            if (sessions.length === 0) {
                vscode.window.showWarningMessage("Cannot resume — no paused sessions.");
                return;
            }

            let target: Session | null = sessions[0];
            if (sessions.length > 1) {
                const picked = await vscode.window.showQuickPick(
                    sessions.map(s => ({ label: s.currentJob })),
                    { placeHolder: "Select a job to resume" }
                );
                if (!picked) return;
                target = sessions.find(s => s.currentJob === picked.label) || null;
            }

            if (!target) return;
            const last = target.lastEvent;
            const ts = last ? ensureAfter(last.timestamp, Date.now()) : Date.now();
            const event = target.resume(ts);
            repo.appendValidated(event);
            setActiveSession(repo.loadActiveSession());
        })
    );

    //
    // ────────────────────────────────────────────────────────────────
    // COMMAND: Stop (with task note)
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.stop", async () => {
            const sessions = Array.from(repo.loadSessionsByJob().values()).filter(s => !s.isIdle);
            if (sessions.length === 0) {
                vscode.window.showWarningMessage("No active session to stop.");
                return;
            }

            let target: Session | null = sessions[0];
            if (sessions.length > 1) {
                const picked = await vscode.window.showQuickPick(
                    sessions.map(s => ({ label: s.currentJob })),
                    { placeHolder: "Select a job to stop" }
                );
                if (!picked) return;
                target = sessions.find(s => s.currentJob === picked.label) || null;
            }

            if (!target) return;

            const task_note = await vscode.window.showInputBox({
                prompt: "Task description (optional)"
            });

            const last = target.lastEvent;
            const ts = last ? ensureAfter(last.timestamp, Date.now()) : Date.now();
            const event = target.stop(task_note || undefined, ts);
            repo.appendValidated(event);
            setActiveSession(repo.loadActiveSession());
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