import { state, ui } from "./state";

function format_duration_ms(ms: number): string {
    const total_seconds = Math.floor(ms / 1000);
    const hours = Math.floor(total_seconds / 3600);
    const minutes = Math.floor((total_seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

export function update_timer_text() {
    let total_ms = state.elapsed_ms_before_pause;

    if (state.is_running && state.start_time) {
        total_ms += Date.now() - state.start_time.getTime();
    }

    const formatted = format_duration_ms(total_ms);

    ui.divider!.text = state.is_paused
        ? `TimeScope (Paused at ${formatted}):`
        : `TimeScope (${formatted}):`;

    ui.divider!.tooltip = state.current_job
        ? `Active job: ${state.current_job}`
        : "Idle: No active job";
}

export function start_timer_interval() {
    if (state.timer_interval) clearInterval(state.timer_interval);
    state.timer_interval = setInterval(update_timer_text, 1000);
}

export function stop_timer_interval() {
    if (state.timer_interval) {
        clearInterval(state.timer_interval);
        state.timer_interval = null;
    }
}

export function update_status_bar() {
    ui.start_button!.hide();
    ui.pause_button!.hide();
    ui.resume_button!.hide();
    ui.stop_button!.hide();
    ui.divider!.show();
    ui.summary_button!.show();

    if (!state.is_running && !state.is_paused) {
        ui.start_button!.show();
        ui.divider!.text = "TimeScope:";
        ui.divider!.tooltip = "Idle: No active job";
        return;
    }

    // Update divider text (running or paused)
    update_timer_text();

    if (state.is_running && !state.is_paused) {
        ui.pause_button!.show();
        ui.stop_button!.show();
        return;
    }

    if (state.is_paused) {
        ui.resume_button!.show();
        ui.stop_button!.show();
    }
}
