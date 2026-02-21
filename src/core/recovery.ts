import * as vscode from "vscode";
import { EventRepository } from "./event_repository";
import { Session } from "./session";

/**
 * Detect an open session at startup and prompt the user to recover.
 */
function ensureAfter(lastTimestamp: number, requested: number): number {
    return requested <= lastTimestamp ? lastTimestamp + 1 : requested;
}

export async function checkAndRecover(repo: EventRepository): Promise<Session | null> {
    try {
        const session = repo.loadLastSession("global");
        if (!session || !session.isOpen) return null;

        const last = session.lastEvent;
        if (!last) return null;
        const lastEvent = last.type;
        const lastTimestamp = last.timestamp;
        const job_title = session.currentJobTitle;
        const accumulating = lastEvent === "start" || lastEvent === "resume";

        let choices: string[] = [];
        if (accumulating) {
            choices = [
                "Close session at shutdown (stop when VSCode closed)",
                "Close session now (stop @ now)",
                "Pause session at shutdown (pause when VSCode closed)",
                "Pause session now (pause @ now)",
                "Resume timer with break (pause when VSCode closed, resume @ now)",
                "Resume timer with no break (resume @ last recorded time)"
            ];
        } else {
            choices = [
                "Close session at shutdown (stop when VSCode closed)",
                "Close session now (stop @ now)",
                "Stay in paused state (no change)"
            ];
        }

        const picked = await vscode.window.showQuickPick(choices, {
            placeHolder: `Detected open session for '${job_title}' (last event: ${lastEvent}). Choose recovery action:`,
            canPickMany: false
        });

        let selection = picked;
        if (!selection) {
            selection = accumulating ? choices[0] : choices[2];
        }

        const now = Date.now();

        if (selection.startsWith("Close session")) {
            const atNow = selection.includes("now");
            const ts = ensureAfter(lastTimestamp, atNow ? now : lastTimestamp + 1);
                const stopEvent = session.stop("recovered", ts);
            repo.appendValidated(stopEvent);
                vscode.window.showInformationMessage(`Recovered: stopped job '${job_title}'.`);
            return null;
        }

        if (selection.startsWith("Pause session")) {
            const atNow = selection.includes("now");
            const ts = ensureAfter(lastTimestamp, atNow ? now : lastTimestamp + 1);
            const pauseEvent = session.pause(ts);
            repo.appendValidated(pauseEvent);
            vscode.window.showInformationMessage(`Recovered: paused job '${job_title}'.`);
            return repo.loadLastSession("global");
        }

        if (selection.startsWith("Resume timer with break")) {
            if (session.isRunning) {
                const pauseTs = ensureAfter(lastTimestamp, lastTimestamp + 1);
                const pauseEvent = session.pause(pauseTs);
                repo.appendValidated(pauseEvent);
                const resumeTs = ensureAfter(pauseTs, now);
                const resumeEvent = session.resume(resumeTs);
                repo.appendValidated(resumeEvent);
            } else if (session.isPaused) {
                const resumeTs = ensureAfter(lastTimestamp, now);
                const resumeEvent = session.resume(resumeTs);
                repo.appendValidated(resumeEvent);
            }
            vscode.window.showInformationMessage(`Recovered: resumed job '${job_title}' (break inserted).`);
            return repo.loadLastSession("global");
        }

        if (selection.startsWith("Resume timer with no break")) {
            if (session.isPaused) {
                const resumeTs = ensureAfter(lastTimestamp, lastTimestamp);
                const resumeEvent = session.resume(resumeTs);
                repo.appendValidated(resumeEvent);
            }
            vscode.window.showInformationMessage(`Recovered: resumed job '${job_title}'.`);
            return repo.loadLastSession("global");
        }

        return repo.loadLastSession("global");
    } catch (ex) {
        console.error("Recovery check failed:", ex);
        return null;
    }
}

export default checkAndRecover;
