import { ui } from "./state";
import { Session } from "./session";

let timerInterval: NodeJS.Timeout | null = null;
let sessionProvider: (() => Session | null) | null = null;

function format_duration_ms(ms: number): string {
    const total_seconds = Math.floor(ms / 1000);
    const hours = Math.floor(total_seconds / 3600);
    const minutes = Math.floor((total_seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

/**
 * Update the status bar text to reflect the current timer value and job.
 */
export function update_timer_text(): void {
    const session = sessionProvider ? sessionProvider() : null;
    if (!session) {
        ui.divider!.text = "TimeScope:";
        ui.divider!.tooltip = "Idle: No active job";
        return;
    }

    const formatted = format_duration_ms(session.elapsed());

    ui.divider!.text = session.isPaused
        ? `TimeScope (Paused at ${formatted}):`
        : `TimeScope (${formatted}):`;

    ui.divider!.tooltip = `Active job: ${session.currentJob}`;
}

/**
 * Start or restart a periodic interval to update the timer text.
 */
export function start_timer_interval(): void {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(update_timer_text, 1000);
}

/**
 * Stop and clear the running interval used to update the timer.
 */
export function stop_timer_interval(): void {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

/**
 * Update which status bar controls are visible depending on runtime state.
 */
export function update_status_bar(): void {
    const session = sessionProvider ? sessionProvider() : null;
    ui.start_button!.hide();
    ui.pause_button!.hide();
    ui.resume_button!.hide();
    ui.stop_button!.hide();
    ui.divider!.show();
    ui.summary_button!.show();

    if (!session || session.isIdle) {
        ui.start_button!.show();
        ui.divider!.text = "TimeScope:";
        ui.divider!.tooltip = "Idle: No active job";
        return;
    }

    // Update divider text (running or paused)
    update_timer_text();

    if (session.isRunning) {
        ui.pause_button!.show();
        ui.stop_button!.show();
        return;
    }

    if (session.isPaused) {
        ui.resume_button!.show();
        ui.stop_button!.show();
    }
}

export function set_session_provider(provider: () => Session | null): void {
    sessionProvider = provider;
}
