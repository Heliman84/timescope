import * as vscode from "vscode";

import { Runtime } from "./core/runtime";
import { pickJob } from "./ui/pick_job";
import { handle_dashboard } from "./dashboard/controller/dashboard";
import { checkAndRecover } from "./core/recovery";
import { Session } from "./core/session";
// timer is now managed by Runtime
import { Job } from "./core/job";

let _runtime: Runtime | null = null;


export async function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration("timescope");

    // Initialize runtime and load jobs
    const runtime = new Runtime(context);
    _runtime = runtime;
    await runtime.loadJobs();

    // Update settings UI to show resolved global paths
    config.update("global_jobs_path", runtime.paths.global_jobs_path, vscode.ConfigurationTarget.Global);
    config.update("global_log_path", runtime.paths.global_log_path, vscode.ConfigurationTarget.Global);

    // Initialize and register UI items
    runtime.initializeUI();
    context.subscriptions.push(
        runtime.ui!.divider,
        runtime.ui!.start_button,
        runtime.ui!.pause_button,
        runtime.ui!.resume_button,
        runtime.ui!.stop_button,
        runtime.ui!.summary_button
    );

    // Check for orphaned session from previous VSCode shutdown and offer recovery
    const recoveredSession = await checkAndRecover(runtime.logRepo);
    runtime.setActiveSession(recoveredSession && recoveredSession.isOpen ? recoveredSession : null);

    //
    // ────────────────────────────────────────────────────────────────
    // COMMAND: Start
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.start", async () => {
            // If no jobs exist, prompt to create and start
            if (runtime.jobs.isEmpty()) {
                const name = await vscode.window.showInputBox({ prompt: "Enter job name" });
                if (!name) return;
                const created = Job.create({ title: name });
                await runtime.jobRepo.save(created);
                runtime.jobs = runtime.jobs.add(created);

                const session = Session.start(created);
                const startEvent = session.startEvent;
                if (!startEvent) throw new Error("Failed to create start event");
                runtime.logRepo.appendValidated(startEvent);
                runtime.setActiveSession(session);
                // job complete exit without running job picker since we just created a job to start
                return;
            }

            // Otherwise, show job picker
            const job = await pickJob(runtime.jobs, { placeHolder: "Select a job to start" });
            if (!job) return;

            const session = Session.start(job);
            const startEvent = session.startEvent;
            if (!startEvent) throw new Error("Failed to create start event");
            runtime.logRepo.appendValidated(startEvent);
            runtime.setActiveSession(session);
        })
    );

    // session orchestration handled by runtime.setActiveSession

    //
    // ────────────────────────────────────────────────────────────────
    // COMMAND: Pause
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.pause", async () => {
            const session = runtime.activeSession;
            if (!session || !session.isOpen || !session.isRunning) {
                vscode.window.showWarningMessage("Cannot pause — no running sessions.");
                return;
            }

            const event = session.pause();
            runtime.logRepo.appendValidated(event);
            runtime.setActiveSession(session);
        })
    );

    //
    // ────────────────────────────────────────────────────────────────
    // COMMAND: Resume
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.resume", async () => {
            const session = runtime.activeSession;
            if (!session || !session.isOpen || !session.isPaused) {
                vscode.window.showWarningMessage("Cannot resume — no paused sessions.");
                return;
            }

            const event = session.resume();
            runtime.logRepo.appendValidated(event);
            runtime.setActiveSession(session);
        })
    );

    //
    // ────────────────────────────────────────────────────────────────
    // COMMAND: Stop (with task note)
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.stop", async () => {
            const session = runtime.activeSession;
            if (!session || !session.isOpen) {
                vscode.window.showWarningMessage("No active session to stop.");
                return;
            }

            const task_note = await vscode.window.showInputBox({ prompt: "Task description (optional)" });

            const event = session.stop(task_note || undefined);
            runtime.logRepo.appendValidated(event);
            runtime.setActiveSession(null);
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

            const created = Job.create({ title: name });
            await runtime.jobRepo.save(created);
            runtime.jobs = runtime.jobs.add(created);

            vscode.window.showInformationMessage(`Job added: ${name}`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.renameJob", async () => {
            const job = await pickJob(runtime.jobs, { placeHolder: "Select a job to rename" });
            if (!job) return vscode.window.showInformationMessage("No job selected");

            const new_name = await vscode.window.showInputBox({ prompt: `Rename job "${job.title}" to:` });
            if (!new_name) return;

            try {
                await runtime.renameJob(job, new_name);
                vscode.window.showInformationMessage(`Renamed job to: ${new_name}`);
            } catch (ex) {
                vscode.window.showErrorMessage(`Failed to rename job: ${String(ex)}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.deleteJob", async () => {
            const job = await pickJob(runtime.jobs, { placeHolder: "Select a job to delete" });
            if (!job) return vscode.window.showInformationMessage("No job selected");

            await runtime.jobRepo.delete(job.id);
            runtime.jobs = runtime.jobs.remove(job.id);

            vscode.window.showInformationMessage(`Deleted job: ${job.title}`);
        })
    );
}

export function deactivate() {
    // Ensure any running interval is stopped and session cleared
    _runtime?.setActiveSession(null);
}