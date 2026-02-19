import * as vscode from "vscode";
import { resolve_paths, TimeScopePaths } from "./paths";
import { JobRepository } from "./job_repository";
import { EventRepository } from "./event_repository";
import { JobCollection } from "./job_collection";
import { Session } from "./session";
import { Job } from "./job";
import { updateTimerText, updateStatusBar, startTimerInterval, stopTimerInterval } from "./timer";

export class Runtime {
  public readonly paths: TimeScopePaths;
  public jobs: JobCollection;
  public readonly jobRepo: JobRepository;
  public readonly logRepo: EventRepository;

  public activeSession: Session | null = null;
  public timerInterval: NodeJS.Timeout | null = null;

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
    this.jobs = JobCollection.fromArray([]);
    // UI is created when `initializeUI()` is called by the extension activation flow.
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

    // Rewrite logs to reference updated job fields (by id)
    this.logRepo.renameJobInLogByJob(renamed);
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
