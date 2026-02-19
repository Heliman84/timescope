import type { Runtime } from "./runtime";

function formatDurationMiliseconds(ms: number): string {
    const total_seconds = Math.floor(ms / 1000);
    const hours = Math.floor(total_seconds / 3600);
    const minutes = Math.floor((total_seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

/**
 * Update the status bar text to reflect the current timer value and job.
 * Pure helper: operates only on the provided `runtime` instance.
 */
export function updateTimerText(runtime: Runtime): void {
    const session = runtime.activeSession;
    const divider = runtime.ui?.divider;
    if (!session || !session.isOpen) {
        if (divider) {
            divider.text = "TimeScope:";
            divider.tooltip = "Idle: No active job";
        }
        return;
    }

    const formatted = formatDurationMiliseconds(session.elapsed());
    if (divider) {
        divider.text = session.isPaused
            ? `TimeScope (Paused at ${formatted}):`
            : `TimeScope (${formatted}):`;
        divider.tooltip = `Active job: ${session.currentJobTitle}`;
    }
}

/**
 * Start or restart a periodic interval to update the timer text.
 * The interval handle is stored on the `runtime` instance.
 */
export function startTimerInterval(runtime: Runtime): void {
    if (runtime.timerInterval) clearInterval(runtime.timerInterval as any);
    runtime.timerInterval = setInterval(() => updateTimerText(runtime), 1000) as any;
}

/**
 * Stop and clear the running interval used to update the timer.
 */
export function stopTimerInterval(runtime: Runtime): void {
    if (runtime.timerInterval) {
        clearInterval(runtime.timerInterval as any);
        runtime.timerInterval = null;
    }
}

/**
 * Update which status bar controls are visible depending on runtime state.
 * Pure helper: operates only on the provided `runtime` instance.
 */
export function updateStatusBar(runtime: Runtime): void {
    const session = runtime.activeSession;
    const ui = runtime.ui;
    if (!ui) return;

    ui.start_button && ui.start_button.hide();
    ui.pause_button && ui.pause_button.hide();
    ui.resume_button && ui.resume_button.hide();
    ui.stop_button && ui.stop_button.hide();
    ui.divider && ui.divider.show();
    ui.summary_button && ui.summary_button.show();

    if (!session || !session.isOpen) {
        ui.start_button && ui.start_button.show();
        if (ui.divider) {
            ui.divider.text = "TimeScope:";
            ui.divider.tooltip = "Idle: No active job";
        }
        return;
    }

    // Update divider text (running or paused)
    updateTimerText(runtime);

    if (session.isRunning) {
        ui.pause_button && ui.pause_button.show();
        ui.stop_button && ui.stop_button.show();
        return;
    }

    if (session.isPaused) {
        ui.resume_button && ui.resume_button.show();
        ui.stop_button && ui.stop_button.show();
    }
}
