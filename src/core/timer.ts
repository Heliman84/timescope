import { state, ui } from "./state";

function format_duration_ms(ms: number): string {
    const total_seconds = Math.floor(ms / 1000);
    const hours = Math.floor(total_seconds / 3600);
    const minutes = Math.floor((total_seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

export function update_timer_text() {
    if (!state.is_running && !state.is_paused) {
        ui.timer_item!.text = "Idle";
        return;
    }

    let total_ms = state.elapsed_ms_before_pause;
    if (state.is_running && state.start_time) {
        total_ms += Date.now() - state.start_time.getTime();
    }

    const formatted = format_duration_ms(total_ms);
    ui.timer_item!.text = state.is_paused
        ? `Paused: ${formatted}`
        : `Working: ${formatted}`;
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
    ui.timer_item!.show();
    ui.summary_button!.show();

    if (!state.is_running && !state.is_paused) {
        ui.start_button!.show();
        ui.timer_item!.text = "Idle";
        return;
    }

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