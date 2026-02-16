import * as vscode from "vscode";
import { TimeScopePaths } from "./paths";
import { load_event_collection_for_job, append_log_record } from "./logs";
import { Event } from "./event";
import { state, reset_state_after_stop } from "./state";
import { start_timer_interval, stop_timer_interval, update_status_bar } from "./timer";

/**
 * Detect an open session at startup and prompt the user to recover.
 */
export async function checkAndRecover(paths: TimeScopePaths): Promise<void> {
    try {
        const col = load_event_collection_for_job(paths);
        const sorted = col.sorted();
        if (sorted.length === 0) return;

        const last = sorted[sorted.length - 1];
        if (last.type === "stop") return; // cleanly stopped

        const lastEvent = last.type; // start | pause | resume
        const lastTimestamp = last.timestamp;
        const job = last.job;

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
            const ts = atNow ? now : lastTimestamp;
                append_log_record(paths, Event.create({ event: "stop", job, timestamp: ts, task: "recovered" }));
            stop_timer_interval();
            reset_state_after_stop();
            update_status_bar();
            vscode.window.showInformationMessage(`Recovered: stopped job '${job}'.`);
            return;
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
