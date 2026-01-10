import * as vscode from "vscode";

//
// RUNTIME STATE
//

export interface TimeScopeState {
    is_running: boolean;
    is_paused: boolean;
    start_time: Date | null;
    pause_time: Date | null;
    elapsed_ms_before_pause: number;
    current_job: string | null;
    timer_interval: NodeJS.Timeout | null;
}

export const state: TimeScopeState = {
    is_running: false,
    is_paused: false,
    start_time: null,
    pause_time: null,
    elapsed_ms_before_pause: 0,
    current_job: null,
    timer_interval: null
};

//
// UI ELEMENTS (mutable container)
//

export const ui = {
    divider: undefined as vscode.StatusBarItem | undefined,
    start_button: undefined as vscode.StatusBarItem | undefined,
    pause_button: undefined as vscode.StatusBarItem | undefined,
    resume_button: undefined as vscode.StatusBarItem | undefined,
    stop_button: undefined as vscode.StatusBarItem | undefined,
    summary_button: undefined as vscode.StatusBarItem | undefined
};

//
// STATE RESET
//

/**
 * Reset runtime state after stopping a session.
 */
export function reset_state_after_stop(): void {
    state.is_running = false;
    state.is_paused = false;
    state.start_time = null;
    state.pause_time = null;
    state.elapsed_ms_before_pause = 0;
    state.current_job = null;
}