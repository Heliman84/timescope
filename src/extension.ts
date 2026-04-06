import * as vscode from "vscode";

import { Runtime } from "./core/runtime";
import { JobCollection } from "./core/job_collection";
import { pickJob } from "./ui/pick_job";
import { handle_dashboard } from "./dashboard/controller/dashboard";
import { checkAndRecover } from "./core/recovery";
import { Session } from "./core/session";
// timer is now managed by Runtime
import { Job } from "./core/job";

let _runtime: Runtime | null = null;
let _context: vscode.ExtensionContext | null = null;
let _heartbeatInterval: NodeJS.Timeout | null = null;

const HEARTBEAT_INTERVAL_MS = 30_000;
const STATE_KEY_LAST_SEEN = "timescope.lastSeen";
const STATE_KEY_LAST_SHUTDOWN = "timescope.lastShutdown";

export async function activate(context: vscode.ExtensionContext) {
    _context = context;
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

    // Resolve approximate shutdown timestamp from heartbeat / deactivate records
    const lastSeen = context.globalState.get<number>(STATE_KEY_LAST_SEEN) ?? 0;
    const lastShutdown = context.globalState.get<number>(STATE_KEY_LAST_SHUTDOWN) ?? 0;
    const shutdownTimestamp = Math.max(lastSeen, lastShutdown) || undefined;

    // Check for orphaned session from previous VSCode shutdown and offer recovery
    const recoveredSession = await checkAndRecover(runtime.logRepo, shutdownTimestamp);
    runtime.setActiveSession(recoveredSession && recoveredSession.isOpen ? recoveredSession : null);

    // Start heartbeat: periodically persist a "last seen" timestamp so that
    // crash-recovery can approximate when VSCode was last alive.
    _heartbeatInterval = setInterval(() => {
        context.globalState.update(STATE_KEY_LAST_SEEN, Date.now());
    }, HEARTBEAT_INTERVAL_MS);
    // Write an initial heartbeat immediately so the value is current from activation.
    context.globalState.update(STATE_KEY_LAST_SEEN, Date.now());

    //
    // ────────────────────────────────────────────────────────────────
    // COMMAND: Start
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.start", async () => {
            const job = await pickJob(runtime.jobs, { placeHolder: "Select a job to start", includeNewJob: true, jobRepo: runtime.jobRepo });
            if (!job) return;

            if (!runtime.jobs.findById(job.id)) {
                runtime.jobs = runtime.jobs.add(job);
            }

            const session = Session.start(job);
            const startEvent = session.startEvent;
            if (!startEvent) throw new Error("Failed to create start event");
            runtime.logRepo.appendValidated(startEvent);
            runtime.appendToCache(startEvent);
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
            runtime.appendToCache(event);
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
            runtime.appendToCache(event);
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
            runtime.appendToCache(event);
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
            handle_dashboard(runtime, context);
        })
    );


    //
    // ────────────────────────────────────────────────────────────────
    // JOB MANAGEMENT COMMANDS
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.addJob", async () => {
            const job = await pickJob(JobCollection.fromArray([]), { includeNewJob: true, jobRepo: runtime.jobRepo, placeHolder: "Create a new job" });
            if (!job) return;

            if (!runtime.jobs.findById(job.id)) {
                runtime.jobs = runtime.jobs.add(job);
            }

            vscode.window.showInformationMessage(`Job added: ${job.title}`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.rename_job", async () => {
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
    // Persist exact shutdown timestamp for graceful-shutdown recovery.
    if (_context) {
        _context.globalState.update(STATE_KEY_LAST_SHUTDOWN, Date.now());
    }

    // Stop heartbeat interval
    if (_heartbeatInterval) {
        clearInterval(_heartbeatInterval);
        _heartbeatInterval = null;
    }

    // Ensure any running interval is stopped and session cleared
    _runtime?.setActiveSession(null);
}