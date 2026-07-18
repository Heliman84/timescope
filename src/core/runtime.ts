import * as vscode from "vscode";
import { resolve_paths, TimeScopePaths } from "./paths";
import { JobRepository } from "./job_repository";
import { EventRepository } from "./event_repository";
import { RegistryRepository } from "./registry_repository";
import { Event } from "./event";
import { EventCollection } from "./event_collection";
import { JobCollection } from "./job_collection";
import { Session } from "./session";
import { Job } from "./job";
import { updateTimerText, updateStatusBar, startTimerInterval, stopTimerInterval } from "./timer";
import { load_build_info, BuildInfo } from "./build_info";
import { rebuild_index, registry_log_paths } from "./global_index";

export class Runtime {
  public readonly paths: TimeScopePaths;
  public jobs: JobCollection;
  public readonly jobRepo: JobRepository;
  public readonly logRepo: EventRepository;
  public readonly registryRepo: RegistryRepository;
  public readonly buildInfo: BuildInfo | null;

  public activeSession: Session | null = null;
  public timerInterval: NodeJS.Timeout | null = null;

  private _cachedCollection: EventCollection | null = null;

  public ui!: {
    divider: vscode.StatusBarItem;
    start_button: vscode.StatusBarItem;
    pause_button: vscode.StatusBarItem;
    resume_button: vscode.StatusBarItem;
    stop_button: vscode.StatusBarItem;
    summary_button: vscode.StatusBarItem;
  };

  constructor(context: vscode.ExtensionContext) {
    this.paths = resolve_paths(context);
    this.jobRepo = new JobRepository(this.paths);
    this.logRepo = new EventRepository(this.paths);
    this.registryRepo = new RegistryRepository(this.paths.registry_path);
    this.jobs = JobCollection.fromArray([]);
    this.buildInfo = load_build_info(context.extensionUri.fsPath);
    // UI is created when `initializeUI()` is called by the extension activation flow.
  }

  /**
   * Return the cached dashboard view — the derived global index (#48 48c) — loading
   * from disk only if the cache is empty. The index is the de-duplicated union of
   * every repo's owned log plus scratch.
   */
  public loadEventCollection(): EventCollection {
    if (!this._cachedCollection) {
      this._cachedCollection = this.logRepo.loadIndexEntries();
    }
    return this._cachedCollection;
  }

  /**
   * Force-reload the dashboard view (the derived index) from disk and update the cache.
   */
  public refreshEventCollection(): EventCollection {
    this._cachedCollection = this.logRepo.loadIndexEntries();
    return this._cachedCollection;
  }

  /**
   * Load this window's *owned* events (workspace + global-owned scratch), fresh from
   * disk. This is the editable surface — the dashboard displays the derived index but
   * edits must target the owning log (#48 48c; cross-repo editing arrives with #43).
   */
  public loadOwnedCollection(): EventCollection {
    return this.logRepo.loadAllEntries();
  }

  /**
   * Rebuild the derived global index from the owned sources — every registered repo's
   * committed log, the current workspace log, and scratch. Safe to call anytime; the
   * index is disposable.
   */
  public rebuildIndex(): { event_count: number; source_count: number } {
    const index_path = this.paths.global_index_path;
    if (!index_path) return { event_count: 0, source_count: 0 };
    const registry = this.registryRepo.load();
    const sources = registry_log_paths(registry);
    if (this.paths.workspace_log_path) sources.push(this.paths.workspace_log_path);
    const seen = new Set<string>();
    const unique = sources.filter(p => {
      const key = process.platform === "win32" ? p.toLowerCase() : p;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return rebuild_index(index_path, unique, this.paths.scratch_path);
  }

  /**
   * Clear the cached EventCollection so the next access reloads from disk.
   * Use only after bulk mutations (e.g. renameJob) that rewrite the files.
   */
  public invalidateEventCollection(): void {
    this._cachedCollection = null;
  }

  /**
   * Push a newly-written event into the cached collection in-place.
   * If no cache exists yet, initializes it from disk first.
   * This avoids a full file re-parse after every append.
   */
  public appendToCache(event: Event): void {
    if (!this._cachedCollection) {
      // Seed from the index, which already contains the just-replicated event —
      // so don't add it again (that would double it in the view).
      this._cachedCollection = this.logRepo.loadIndexEntries();
      return;
    }
    this._cachedCollection.add(event);
  }

  /**
   * Rename a job across the domain and persisted logs.
   * - Renames the Job in the JobCollection and persists via JobRepository.
   * - Rewrites both global and workspace logs to use the updated Job object.
   */
  public async renameJob(job: Job, newTitle: string): Promise<void> {
    if (!job) throw new Error('renameJob: job must be provided');
    const existing = this.jobs.findById(job.id);
    if (!existing) throw new Error(`renameJob: job id '${job.id}' not found`);

    const renamed = existing.rename(newTitle);

    // Persist updated job record
    await this.jobRepo.update(renamed);

    // Update in-memory collection
    this.jobs = this.jobs.update(renamed);

    // Rewrite the owned logs to reference updated job fields (by id), then rebuild
    // the derived index so the dashboard view reflects the rename.
    this.logRepo.renameJobInLogByJob(renamed);
    this.rebuildIndex();
    this.invalidateEventCollection();
    // If an active session references the renamed job, update it in-memory so UI
    // and timers reflect the new title without requiring a full reload.
    if (this.activeSession && this.activeSession.job.equals(job)) {
      try {
        const updatedCollection = this.activeSession.toEventCollection().withUpdatedJob(renamed);
        const newSession = Session.fromCollection(updatedCollection);
        this.setActiveSession(newSession);
      } catch (ex) {
        // If rebuilding the session fails validation, clear the active session
        // to avoid inconsistent in-memory state.
        this.setActiveSession(null);
      }
    }
  }

  public initializeUI(): void {
    // Create UI items and wire command ids (command handlers remain registered by extension)
    const divider = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 300);
    divider.text = "TimeScope:";
    divider.tooltip = "Idle: No active job";
    divider.show();

    const start_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 299);
    start_button.text = "$(play) Start";
    start_button.command = "timescope.start";
    start_button.show();

    const pause_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 298);
    pause_button.text = "$(debug-pause) Pause";
    pause_button.command = "timescope.pause";

    const resume_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 297);
    resume_button.text = "$(debug-continue) Resume";
    resume_button.command = "timescope.resume";

    const stop_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 296);
    stop_button.text = "$(primitive-square) Stop";
    stop_button.command = "timescope.stop";

    const summary_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 295);
    summary_button.text = "$(graph) Summary";
    summary_button.command = "timescope.dashboard";
    summary_button.show();

    this.ui = {
      divider,
      start_button,
      pause_button,
      resume_button,
      stop_button,
      summary_button,
    };

    // Ensure status reflects current session state
    updateStatusBar(this);
  }

  public async loadJobs(): Promise<void> {
    this.jobs = await this.jobRepo.loadAll();
  }

  public setActiveSession(session: Session | null) {
    this.activeSession = session;
    updateStatusBar(this);
    if (this.activeSession && this.activeSession.isOpen) startTimerInterval(this);
    else stopTimerInterval(this);
  }
}
