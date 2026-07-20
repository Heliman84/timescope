import * as vscode from "vscode";
import * as fs from "fs";
import * as crypto from "crypto";

import { Runtime } from "./core/runtime";
import { JobCollection } from "./core/job_collection";
import { pickJob } from "./ui/pick_job";
import { ensure_repo_binding } from "./ui/pick_binding";
import { pick_task_type } from "./ui/pick_task_type";
import { handle_dashboard } from "./dashboard/controller/dashboard";
import { checkAndRecover } from "./core/recovery";
import { Session } from "./core/session";
// timer is now managed by Runtime
import { Job } from "./core/job";
import { format_build_info_full } from "./core/build_info";
import { compact_log_file, has_repairable_damage } from "./core/log_sanitizer";
import { is_workspace_opted_in, enable_local_logging, register_if_opted_in, is_folder_declined, decline_folder } from "./core/local_opt_in";
import { migrate_legacy_global_log } from "./core/migration";
import { acquire_lock, refresh_lock, release_lock, should_suppress_recovery } from "./core/instance_lock";

let _runtime: Runtime | null = null;
let _context: vscode.ExtensionContext | null = null;
let _heartbeatInterval: NodeJS.Timeout | null = null;

// Per-activation instance-lock identity (#47). `_lockRepoId` is set only while this
// window currently holds the lock; `_lockTargetRepoId` is set once at activation (for
// the opted-in repo this window activated in) and never cleared, so a lock lost via
// refresh back-off (F3) can be silently re-attempted on later heartbeat ticks (N3)
// instead of leaving this window permanently invisible to the registry of lock holders.
let _lockRepoId: string | null = null;
let _lockTargetRepoId: string | null = null;
let _instanceId: string | null = null;

const HEARTBEAT_INTERVAL_MS = 30_000;
// A lock is considered stale (its prior holder presumed crashed/closed without a clean
// release) after this many missed heartbeats. K=3 gives real slack for a slow/backgrounded
// window's timer tick to fire late without falsely declaring the lock stale.
const LOCK_STALE_MS = HEARTBEAT_INTERVAL_MS * 3;
const STATE_KEY_LAST_SEEN = "timescope.lastSeen";
const STATE_KEY_LAST_SHUTDOWN = "timescope.lastShutdown";

// Prompt about local logging at most once per window session.
let _optInPromptedThisSession = false;

/**
 * Acquire this repo's instance lock (#47). Sets `_instanceId` (minting one if this
 * window doesn't have one yet — the mid-session opt-in path activates without ever
 * having acquired a lock before), `_lockTargetRepoId` (so the heartbeat's lockless
 * retry, #47 N3, knows what to keep trying for), and on success `_lockRepoId`.
 *
 * On a live foreign lock, always warns (a second window either at activation or via a
 * mid-session opt-in both need the user to know the repo is already tracked elsewhere).
 * Returns whether crash-recovery should be suppressed — only true when the caller opts
 * in via `allow_suppress_recovery` (activation, where recovery hasn't run yet; NOT the
 * mid-session opt-in path, where recovery already ran before the workspace was tracked).
 */
function acquire_instance_lock(
    runtime: Runtime,
    repo_id: string,
    options: { allow_suppress_recovery: boolean }
): boolean {
    if (!runtime.paths.locks_dir) return false;
    try {
        if (!_instanceId) _instanceId = crypto.randomUUID();
        _lockTargetRepoId = repo_id;
        const lock_result = acquire_lock(
            runtime.paths.locks_dir,
            repo_id,
            { pid: process.pid, instance_id: _instanceId, now: Date.now() },
            LOCK_STALE_MS
        );
        if (lock_result.acquired) {
            _lockRepoId = repo_id;
        } else {
            vscode.window.showWarningMessage(
                `TimeScope: this workspace is already being tracked in another VS Code window (pid ${lock_result.holder.pid}). Timer actions here may conflict with it.`
            );
            if (options.allow_suppress_recovery && should_suppress_recovery(lock_result)) {
                return true;
            }
        }
    } catch (ex) {
        console.error("TimeScope: instance lock acquisition failed", ex);
    }
    return false;
}

/**
 * Offer to log the open workspace's time into a committed `.timescope/` folder.
 * Nothing is created unless the user says yes (#2). Asked at most once per
 * session, and never again for a folder the user declined permanently.
 */
async function maybe_prompt_local_opt_in(runtime: Runtime): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;                                              // no workspace → global-only
    if (is_workspace_opted_in(runtime.paths)) return;                // already opted in
    if (_optInPromptedThisSession) return;
    // "Never for this folder" is recorded in the global registry (per-machine), not
    // VS Code workspace state — so it's in TimeScope's own inspectable store (#48/#6).
    if (is_folder_declined(runtime.registryRepo, folder.uri.fsPath)) return;
    _optInPromptedThisSession = true;

    const choice = await vscode.window.showInformationMessage(
        "Track this workspace's time in a committed .timescope/ folder too? Global tracking continues either way.",
        "Track here", "Not now", "Never for this folder"
    );
    if (choice === "Track here") {
        try {
            const repo_id = enable_local_logging(runtime.paths, folder.uri.fsPath, folder.name, runtime.registryRepo, Date.now());
            vscode.window.showInformationMessage("TimeScope: now logging this workspace in .timescope/.");
            // Opting in mid-session (#47): this window never went through activation's
            // lock acquisition (it wasn't opted-in yet then), so it would otherwise stay
            // permanently lockless/invisible to a later window opened on this same repo.
            // Recovery already ran at activation — before this repo was even tracked — so
            // suppression is moot here; this just makes the window advertise its lock.
            if (!_lockRepoId) {
                acquire_instance_lock(runtime, repo_id, { allow_suppress_recovery: false });
            }
        } catch (ex) {
            vscode.window.showErrorMessage(`TimeScope: could not enable local logging: ${String(ex)}`);
        }
    } else if (choice === "Never for this folder") {
        try {
            decline_folder(runtime.registryRepo, folder.uri.fsPath);
        } catch (ex) {
            vscode.window.showErrorMessage(`TimeScope: could not record opt-out: ${String(ex)}`);
        }
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
    let activation_repo_id: string | null = null;
    try {
        const folder0 = vscode.workspace.workspaceFolders?.[0];
        activation_repo_id = register_if_opted_in(runtime.paths, folder0?.uri.fsPath, folder0?.name ?? "", runtime.registryRepo, Date.now());
    } catch (ex) {
        console.error("TimeScope: registry update on activation failed", ex);
    }

    // Per-repo instance lock (#47): detect another VS Code window already tracking this
    // opted-in repo, so we can warn instead of silently racing timer actions with it, and
    // suppress our own crash-recovery prompt (which would otherwise fight the live window).
    const suppress_recovery = activation_repo_id
        ? acquire_instance_lock(runtime, activation_repo_id, { allow_suppress_recovery: true })
        : false;

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

    // #48 US-06: cache this repo's jobs in .timescope/config.json (auto-upgrading an
    // older-style repo whose log predates the cache) so the Start picker has them even
    // on a machine that's never seen the repo. Only touches an opted-in workspace.
    try {
        runtime.refreshRepoJobs();
    } catch (ex) {
        console.error("TimeScope: repo job-cache refresh failed", ex);
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

    // Check for orphaned session from previous VSCode shutdown and offer recovery — unless
    // another live window already holds this repo's instance lock (#47): recovering here
    // too would offer to resurrect/mutate a session the other window may already own.
    if (!suppress_recovery) {
        const recoveredSession = await checkAndRecover(runtime.logRepo, shutdownTimestamp);
        runtime.setActiveSession(recoveredSession && recoveredSession.isOpen ? recoveredSession : null);
    } else {
        runtime.setActiveSession(null);
    }

    // Start heartbeat: periodically persist a "last seen" timestamp so that
    // crash-recovery can approximate when VSCode was last alive. Also refreshes our
    // instance lock's heartbeat (#47), so a live window's lock never looks stale — and
    // if we've lost it, silently retries acquisition (#47 N3) rather than leaving this
    // window permanently lockless/invisible once the foreign holder releases or goes stale.
    _heartbeatInterval = setInterval(() => {
        context.globalState.update(STATE_KEY_LAST_SEEN, Date.now());
        if (_lockRepoId && _instanceId && runtime.paths.locks_dir) {
            try {
                const refreshed = refresh_lock(runtime.paths.locks_dir, _lockRepoId, { pid: process.pid, instance_id: _instanceId, now: Date.now() });
                if (!refreshed) {
                    // Another instance took over the lock (it looked stale to them) — we no
                    // longer hold it (#47 F3). Stop treating ourselves as the owner so a
                    // later deactivate doesn't release a lock that isn't ours.
                    console.warn("TimeScope: lost this repo's instance lock to another window.");
                    _lockRepoId = null;
                }
            } catch (ex) {
                console.error("TimeScope: instance lock refresh failed", ex);
            }
        } else if (_lockTargetRepoId && _instanceId && runtime.paths.locks_dir) {
            // Lockless (lost it, or never got it at activation) — retry silently. No new
            // warning here: the original "already tracked elsewhere" warning already fired
            // at activation, and we don't want to re-nag every heartbeat tick.
            try {
                const retry = acquire_lock(
                    runtime.paths.locks_dir,
                    _lockTargetRepoId,
                    { pid: process.pid, instance_id: _instanceId, now: Date.now() },
                    LOCK_STALE_MS
                );
                if (retry.acquired) {
                    _lockRepoId = _lockTargetRepoId;
                }
            } catch (ex) {
                console.error("TimeScope: instance lock re-acquisition failed", ex);
            }
        }
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
            await maybe_prompt_local_opt_in(runtime);
            // Pick up a just-established opt-in (config.json + binding may be new).
            runtime.refreshRepoJobs();

            // #15: an opted-in repo belongs implicitly to a Client/Project — ensure
            // that binding before offering the task-type picker. A non-workspace/scratch
            // context (or a workspace that declined local logging) skips binding
            // entirely; the task-type picker still offers the full global vocabulary.
            if (runtime.paths.workspace_log_path) {
                const bound = await ensure_repo_binding(runtime);
                if (!bound) return; // user cancelled the binding flow
            }

            const task_type = await pick_task_type(runtime);
            if (!task_type) return;

            // Task-types are never persisted to jobs.json — construct a partial Job
            // (id + title only) purely for session/event creation, the same seam
            // `fromEventFields` uses when reconstructing jobs from logged events.
            const job = Job.fromEventFields(task_type.id, task_type.name);

            const session = Session.start(job);
            const startEvent = session.startEvent;
            if (!startEvent) throw new Error("Failed to create start event");
            runtime.logRepo.appendValidated(startEvent);
            runtime.appendToCache(startEvent);
            runtime.setActiveSession(session);
            // Keep the repo's config.json job cache current (adds a newly-used job).
            runtime.refreshRepoJobs();
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
    // COMMAND: Show Storage Status (#48 — observability)
    // ────────────────────────────────────────────────────────────────
    //
    // On-demand, reliable view of local-first storage state — migration doesn't rely
    // on a fleeting activation toast anymore. Also verifies the derived index, scratch,
    // registry (repos + declines), and this repo's cached jobs.
    //
    context.subscriptions.push(
        vscode.commands.registerCommand("timescope.showStorageStatus", () => {
            const p = runtime.paths;
            const count_events = (fp?: string): number => {
                if (!fp || !fs.existsSync(fp)) return 0;
                return fs.readFileSync(fp, "utf8").split(/\r?\n/).filter(l => l.trim().length > 0)
                    .map(l => { try { return JSON.parse(l); } catch { return null; } })
                    .filter(o => o && (o as { _format_version?: unknown })._format_version === undefined).length;
            };
            let repos = 0, declined = 0;
            try { const r = runtime.registryRepo.load(); repos = r.repos.length; declined = r.declined_paths.length; } catch { /* report zeros */ }
            const legacy_present = !!p.global_log_path && fs.existsSync(p.global_log_path);
            const backup_present = !!p.global_log_path && fs.existsSync(p.global_log_path + ".migrated.bak");
            const detail = [
                `Global index:      ${count_events(p.global_index_path)} event(s)   ← dashboard reads this`,
                `Scratch (owned):   ${count_events(p.scratch_path)} event(s)`,
                `Legacy global log: ${legacy_present ? "present (NOT yet migrated)" : "none"}${backup_present ? "   ·   migration backup: yes" : ""}`,
                `Registry:          ${repos} repo(s), ${declined} declined folder(s)`,
                `This workspace:    ${is_workspace_opted_in(p) ? "opted-in" : "not opted-in"}   ·   ${runtime.repoJobs.length} cached job(s)`,
            ].join("\n");
            vscode.window.showInformationMessage("TimeScope — Storage Status", { modal: true, detail });
        })
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

    // Release our instance lock (#47) so the folder is immediately re-acquirable — by a
    // relaunch of this same window or a fresh one — without waiting out the stale window.
    if (_lockRepoId && _instanceId && _runtime?.paths.locks_dir) {
        try {
            release_lock(_runtime.paths.locks_dir, _lockRepoId, _instanceId);
        } catch (ex) {
            console.error("TimeScope: instance lock release failed", ex);
        }
    }
    _lockRepoId = null;
    _lockTargetRepoId = null;
    _instanceId = null;

    // Ensure any running interval is stopped and session cleared
    _runtime?.setActiveSession(null);
}