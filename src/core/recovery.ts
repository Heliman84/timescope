import * as vscode from "vscode";
import { LogRepository } from "./logRepository";
import { Session } from "./session";

/**
 * Detect an open session at startup and prompt the user to recover.
 */
function ensureAfter(lastTimestamp: number, requested: number): number {
    return requested <= lastTimestamp ? lastTimestamp + 1 : requested;
}

export async function checkAndRecover(repo: LogRepository): Promise<Session | null> {
    try {
        const sessions = Array.from(repo.loadSessionsByJob().values());
        const openSessions = sessions.filter(s => !s.isIdle);
        if (openSessions.length === 0) return repo.loadActiveSession();

        for (const session of openSessions) {
            const last = session.lastEvent;
            if (!last) continue;

            const lastEvent = last.type;
            const lastTimestamp = last.timestamp;
            const job = session.currentJob;
            const accumulating = lastEvent === "start" || lastEvent === "resume";

            // Build choices per user story
            let choices: string[] = [];
            if (accumulating) {
                choices = [
                    `Close session at shutdown (stop when VSCode closed)`, // default on escape
                    `Close session now (stop @ now)`,
                    `Pause session at shutdown (pause when VSCode closed)`,
                    `Pause session now (pause @ now)`,
                    `Resume timer with break (pause when VSCode closed, resume @ now)`,
                    `Resume timer with no break (resume @ last recorded time)`
                ];
            } else {
                choices = [
                    `Close session at shutdown (stop when VSCode closed)`,
                    `Close session now (stop @ now)`,
                    `Stay in paused state (no change)` // default on escape
                ];
            }

            const picked = await vscode.window.showQuickPick(choices, {
                placeHolder: `Detected open session for '${job}' (last event: ${lastEvent}). Choose recovery action:`,
                canPickMany: false
            });

            // Default behaviors when user dismisses prompt
            let selection = picked;
            if (!selection) {
                selection = accumulating ? choices[0] : choices[2];
            }

            const now = Date.now();

            // Map selection to actions
            if (selection.startsWith("Close session")) {
                const atNow = selection.includes("now");
                const ts = ensureAfter(lastTimestamp, atNow ? now : lastTimestamp + 1);
                const stopEvent = session.stop("recovered", ts);
                repo.appendValidated(stopEvent);
                vscode.window.showInformationMessage(`Recovered: stopped job '${job}'.`);
                continue;
            }

            if (selection.startsWith("Pause session")) {
            const atNow = selection.includes("now");
            const ts = atNow ? now : lastTimestamp;
                append_log_record(paths, Event.create({ event: "pause", job, timestamp: ts }));
            // set runtime state to paused
            state.is_running = true;
            state.is_paused = true;
            state.current_job = job;
            state.pause_time = new Date(ts);
            state.start_time = new Date(lastTimestamp);
            update_status_bar();
            vscode.window.showInformationMessage(`Recovered: paused job '${job}'.`);
            return;
        }

        if (selection.startsWith("Resume")) {
            const noBreak = selection.includes("no break");

            if (noBreak) {
                // No-break: do not add events if session was already accumulating.
                // If last event was 'start' or 'resume' there's nothing to append;
                // just initialize runtime to running. If it was 'pause', append
                // a resume at the last timestamp.
                if (lastEvent === "start" || lastEvent === "resume") {
                    // initialize runtime state to running without appending
                    state.is_running = true;
                    state.is_paused = false;
                    state.current_job = job;
                    state.start_time = new Date(lastTimestamp);
                    state.pause_time = null;
                    state.elapsed_ms_before_pause = 0;
                    start_timer_interval();
                    update_status_bar();
                    vscode.window.showInformationMessage(`Recovered: resumed job '${job}' (no new events).`);
                    return;
                } else {
                    // lastEvent === 'pause' -> append resume at lastTimestamp
                    append_log_record(paths, Event.create({ event: "resume", job, timestamp: lastTimestamp }));
                    state.is_running = true;
                    state.is_paused = false;
                    state.current_job = job;
                    state.start_time = new Date(lastTimestamp);
                    state.pause_time = null;
                    state.elapsed_ms_before_pause = 0;
                    start_timer_interval();
                    update_status_bar();
                    vscode.window.showInformationMessage(`Recovered: resumed job '${job}'.`);
                    return;
                }
            }

            // Break case: ensure there's a pause at shutdown (unless already paused)
            // and a resume now.
                if (lastEvent === "start" || lastEvent === "resume") {
                    // insert a pause at the last timestamp to mark the break
                    append_log_record(paths, Event.create({ event: "pause", job, timestamp: lastTimestamp }));
                }

            // resume now
            append_log_record(paths, Event.create({ event: "resume", job, timestamp: now }));
            state.is_running = true;
            state.is_paused = false;
            state.current_job = job;
            state.start_time = new Date(now);
            state.pause_time = null;
            state.elapsed_ms_before_pause = 0;
            start_timer_interval();
            update_status_bar();
            vscode.window.showInformationMessage(`Recovered: resumed job '${job}' (break inserted).`);
            return;
        }

    } catch (ex) {
        // quietly ignore recovery errors but log to console for debugging
        console.error("Recovery check failed:", ex);
    }
}

export default checkAndRecover;
