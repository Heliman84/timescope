import * as vscode from "vscode";
import { Session } from "./session";

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
// RUNTIME STATE (mutable container)
//

export const runtimeState = {
    // Active in-memory session for UI/timer usage (may be null if idle).
    activeSession: null as Session | null,
    // Provider for the current session (used by timer/status bar).
    sessionProvider: null as (() => Session | null) | null,
    // Interval handle used to update the timer text.
    timerInterval: null as NodeJS.Timeout | null
};
