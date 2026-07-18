import * as vscode from "vscode";

import { Runtime } from "./core/runtime";
import { JobCollection } from "./core/job_collection";
import { pickJob } from "./ui/pick_job";
import { handle_dashboard } from "./dashboard/controller/dashboard";
import { checkAndRecover } from "./core/recovery";
import { Session } from "./core/session";
// timer is now managed by Runtime
import { Job } from "./core/job";
import { format_build_info_full } from "./core/build_info";
import { compact_log_file, has_repairable_damage } from "./core/log_sanitizer";
import { is_workspace_opted_in, enable_local_logging, register_if_opted_in } from "./core/local_opt_in";
import { migrate_legacy_global_log } from "./core/migration";

let _runtime: Runtime | null = null;
let _context: vscode.ExtensionContext | null = null;
let _heartbeatInterval: NodeJS.Timeout | null = null;

const HEARTBEAT_INTERVAL_MS = 30_000;
const STATE_KEY_LAST_SEEN = "timescope.lastSeen";
const STATE_KEY_LAST_SHUTDOWN = "timescope.lastShutdown";
const STATE_KEY_OPT_IN_NEVER = "timescope.localOptIn.neverForFolder";

// Prompt about local logging at most once per window session.
let _optInPromptedThisSession = false;

/**
 * Offer to log the open workspace's time into a committed `.timescope/` folder.
 * Nothing is created unless the user says yes (#2). Asked at most once per
 * session, and never again for a folder the user declined permanently.
 */
async function maybe_prompt_local_opt_in(runtime: Runtime, context: vscode.ExtensionContext): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;                                              // no workspace → global-only
    if (is_workspace_opted_in(runtime.paths)) return;                // already opted in
    if (_optInPromptedThisSession) return;
    if (context.workspaceState.get<boolean>(STATE_KEY_OPT_IN_NEVER)) return;
    _optInPromptedThisSession = true;

    const choice = await vscode.window.showInformationMessage(
        "Track this workspace's time in a committed .timescope/ folder too? Global tracking continues either way.",
        "Track here", "Not now", "Never for this folder"
    );
    if (choice === "Track here") {
        try {
            enable_local_logging(runtime.paths, folder.uri.fsPath, folder.name, runtime.registryRepo, Date.now());
            vscode.window.showInformationMessage("TimeScope: now logging this workspace in .timescope/.");
        } catch (ex) {
            vscode.window.showErrorMessage(`TimeScope: could not enable local logging: ${String(ex)}`);
        }
    } else if (choice === "Never for this folder") {
        await context.workspaceState.update(STATE_KEY_OPT_IN_NEVER, true);
    }
    // "Not now" / dismissed: leave as-is; the once-per-session flag prevents nagging.
}

export async function activate(context: vscode.ExtensionContext) {
    _context = context;
    const config = vscode.workspace.getConfiguration("timescope");

    // Initialize runtime and load jobs
    const runtime = new Runtime(context);
    _runtime = runtime;
    await runtime.loadJobs();

    // Update settings UI to show resolved global paths. The global-owned event
    // store is now `scratch.jsonl` (#48 48c); the legacy `logs.jsonl` is retired.
    config.update("global_jobs_path", runtime.paths.global_jobs_path, vscode.ConfigurationTarget.Global);
    config.update("global_log_path", runtime.paths.scratch_path ?? runtime.paths.global_log_path, vscode.ConfigurationTarget.Global);

    // If this workspace is already opted in (a `.timescope` folder exists), make
    // sure it has a config.json and refresh its registry entry. Never blocks activation.
    try {
        const folder0 = vscode.workspace.workspaceFolders?.[0];
        register_if_opted_in(runtime.paths, folder0?.uri.fsPath, folder0?.name ?? "", runtime.registryRepo, Date.now());
    } catch (ex) {
        console.error("TimeScope: registry update on activation failed", ex);
    }

    // #48 48c: one-time migration of the legacy global `logs.jsonl` into the owned
    // `scratch.jsonl`, then (re)build the derived index so the dashboard sees every
    // owned source. The index is disposable, so rebuilding at activation is safe.
    try {
        if (runtime.paths.global_log_path && runtime.paths.scratch_path) {
            const mig = migrate_legacy_global_log(runtime.paths.global_log_path, runtime.paths.scratch_path);
            if (mig.migrated > 0) {
                vscode.window.showInformationMessage(
                    `TimeScope: migrated ${mig.migrated} legacy event(s) into local-first storage (backup: ${mig.backup_path}).`
                );
            }
        }
        runtime.rebuildIndex();
    } catch (ex) {
        console.error("TimeScope: local-first migration / index rebuild failed", ex);
    }

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
            // First Start in an un-opted-in workspace offers local logging (#2/#48).
            await maybe_prompt_local_opt_in(runtime, context);

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
    // COMMAND: Show Build Info
    // ────────────────────────────────────────────────────────────────
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.showBuildInfo", () => {
            vscode.window.showInformationMessage(`TimeScope build: ${format_build_info_full(runtime.buildInfo)}`);
        })
    );


    //
    // ────────────────────────────────────────────────────────────────
    // COMMAND: Compact Log
    // ────────────────────────────────────────────────────────────────
    //
    const run_compaction = () => {
        const results = [runtime.paths.scratch_path, runtime.paths.workspace_log_path]
            .filter((p): p is string => !!p)
            .map(p => ({ path: p, result: compact_log_file(p) }));
        const changed = results.filter(r => r.result.changed);
        if (changed.length === 0) {
            vscode.window.showInformationMessage("TimeScope: logs are already clean — nothing to compact.");
        } else {
            const detail = changed.map(r => `${r.path} (backup: ${r.result.backup_path})`).join("; ");
            vscode.window.showInformationMessage(`TimeScope: compacted ${changed.length} log file(s). ${detail}`);
        }
    };

    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.compactLog", run_compaction)
    );

    //
    // ────────────────────────────────────────────────────────────────
    // COMMAND: Rebuild Global Index (#48 48b)
    // ────────────────────────────────────────────────────────────────
    //
    // Rebuilds the derived global index.jsonl from the owned sources — every
    // registered repo's committed log plus the global scratch log. The index is
    // disposable/rebuildable, so this is always safe to run.
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.rebuildGlobalIndex", () => {
            if (!runtime.paths.global_index_path) {
                vscode.window.showErrorMessage("TimeScope: no global index path resolved.");
                return;
            }
            try {
                const result = runtime.rebuildIndex();
                runtime.refreshEventCollection();
                vscode.window.showInformationMessage(
                    `TimeScope: rebuilt global index — ${result.event_count} event(s) from ${result.source_count} source log(s) + scratch.`
                );
            } catch (ex) {
                vscode.window.showErrorMessage(`TimeScope: could not rebuild global index: ${String(ex)}`);
            }
        })
    );

    // Load-time health check: heal-in-memory always happens on read; when
    // repairable damage exists on disk, offer compaction once per session —
    // never rewrite synced storage unprompted.
    const damaged = runtime.logRepo.checkLogHealth().filter(h => has_repairable_damage(h.report));
    if (damaged.length > 0) {
        const total_splits = damaged.reduce((n, h) => n + h.report.concatenated_lines_split, 0);
        const parts: string[] = [];
        if (total_splits > 0) parts.push(`${total_splits} concatenated record line(s)`);
        if (damaged.some(h => h.report.missing_header)) parts.push("missing format header");
        const imbalance = damaged.find(h => h.report.pause_events !== h.report.resume_events);
        if (imbalance) parts.push(`unbalanced pause/resume (${imbalance.report.pause_events}/${imbalance.report.resume_events})`);
        vscode.window.showQuickPick(["Compact log now", "Ignore for now"], {
            placeHolder: `TimeScope found log damage: ${parts.join(", ")}. Compacting writes a .bak first.`,
            canPickMany: false,
        }).then(picked => {
            if (picked === "Compact log now") run_compaction();
        });
    }

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