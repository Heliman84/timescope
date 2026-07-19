import * as vscode from "vscode";
import * as fs from "fs";
import { Runtime } from "../../core/runtime";
import { Event, ValidationError } from "../../core/event";
import { buildPayload, filterRelevantErrors } from "./dashboard_utils";
import { build_attributed_payload } from "./attribution";
import { format_build_info_full } from "../../core/build_info";

export { buildPayload, filterRelevantErrors };

/**
 * Build the #15 attributed dashboard payload for the current runtime state —
 * reads owned sources only (registered repo logs + scratch), never the derived
 * `index.jsonl`. Used for the `request_data` reply; edit flows still round-trip
 * through the plain `buildPayload` (see `edit_log_entry`/`edit_log_entries`).
 */
function build_dashboard_payload(runtime: Runtime) {
    const registry = runtime.registryRepo.load();
    return build_attributed_payload({
        registry,
        scratch_path: runtime.paths.scratch_path,
        current_workspace_repo_id: runtime.repoConfig?.repo_id,
    });
}

export async function handle_dashboard(runtime: Runtime, context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        "timescopeSummary",
        "TimeScope Summary Dashboard",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, "out", "dashboard")
            ]
        }
    );

    const html_path = vscode.Uri.joinPath(
        context.extensionUri, "out", "dashboard", "webview", "index.html"
    );

    let html = await fs.promises.readFile(html_path.fsPath, "utf8");
    const nonce = String(Date.now());

    const js_uri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "out", "dashboard", "webview", "dashboard.js")
    );
    const filter_state_uri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "out", "dashboard", "webview", "filter_state.js")
    );
    const css_uri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "out", "dashboard", "webview", "dashboard.css")
    );

    html = html
        .replace(/\${nonce}/g, nonce)
        .replace(/\${jsUri}/g, js_uri.toString())
        .replace(/\${filterStateUri}/g, filter_state_uri.toString())
        .replace(/\${cssUri}/g, css_uri.toString())
        .replace(/\${cspSource}/g, panel.webview.cspSource);

    panel.webview.html = html;

    panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.type === "request_data") {
            panel.webview.postMessage({
                type: "summary_data",
                payload: build_dashboard_payload(runtime),
                build_info: format_build_info_full(runtime.buildInfo)
            });
        }

        if (msg.type === "edit_log_entry") {
            // Edits target the owning log (workspace or scratch), so resolve the event
            // against the owned collection — not the derived index the dashboard displays.
            const collection = runtime.loadOwnedCollection();
            const targetId: string | undefined = msg.payload?.id;
            const new_record = msg.payload.new_record;

            const summary = { globalReplaced: false, workspaceReplaced: false, errors: [] as string[], warnings: [] as string[] };

            if (!targetId) {
                summary.errors.push("Edit failed: no event ID provided. The log file may contain orphaned or corrupted entries.");
            } else {
                let candidate: Event;
                try { candidate = Event.fromDTO(new_record); }
                catch (err) {
                    summary.errors.push(`Edit failed: could not construct event from record — ${err instanceof Error ? err.message : String(err)}`);
                    const updated = runtime.refreshEventCollection();
                    panel.webview.postMessage({
                        type: "edit_result",
                        payload: { summary, payload: buildPayload(updated.toEvents()) }
                    });
                    return;
                }

                const oldEvent = collection.find(e => e.id === targetId);

                if (!oldEvent) {
                    summary.errors.push(`Edit failed: event '${targetId}' not found in the current collection. The log file may contain orphaned or corrupted entries — try running the repair script.`);
                } else {
                    // Pre-save validation: same-job errors block; cross-job warnings are informational
                    const preResults = collection.validateReplacement(oldEvent, candidate);
                    const preErrors = preResults.filter(e => e.severity !== "warning");
                    const preWarnings = preResults.filter(e => e.severity === "warning");

                    summary.warnings.push(...preWarnings.map(w => w.message));

                    if (preErrors.length > 0) {
                        // Same-job sequence violation — block the save
                        summary.errors.push(...preErrors.map(e => `Edit rejected: ${e.message}`));
                    } else {
                        const result = runtime.logRepo.replaceEvent(oldEvent, candidate);
                        summary.globalReplaced = result.globalReplaced;
                        summary.workspaceReplaced = result.workspaceReplaced;

                        if (!result.globalReplaced && !result.workspaceReplaced) {
                            summary.errors.push("Edit failed: the event was found in the collection but could not be matched in the log file on disk. The log file may have been modified externally or contain formatting inconsistencies.");
                        } else {
                            // Owned log changed — rebuild the derived index before redisplay.
                            runtime.rebuildIndex();
                            const updatedCollection = runtime.refreshEventCollection();
                            const errors = updatedCollection.validate();
                            summary.errors.push(...filterRelevantErrors(errors, [oldEvent]));
                        }
                    }
                }
            }

            const updated = runtime.refreshEventCollection();
            panel.webview.postMessage({
                type: "edit_result",
                payload: { summary, payload: buildPayload(updated.toEvents()) }
            });
        }

        if (msg.type === "edit_log_entries") {
            const collection = runtime.loadOwnedCollection();
            const edits = msg.payload?.edits ?? [];

            const summary = { globalReplaced: false, workspaceReplaced: false, errors: [] as string[], warnings: [] as string[] };
            const editedEvents: Event[] = [];
            let anyReplaced = false;

            for (const ed of edits) {
                const targetId: string | undefined = ed.id;

                if (!targetId) {
                    summary.errors.push("Edit skipped: no event ID provided. The log file may contain orphaned or corrupted entries.");
                    continue;
                }

                let candidate: Event;
                try { candidate = Event.fromDTO(ed.new_record); }
                catch (err) {
                    summary.errors.push(`Edit skipped for '${targetId}': could not construct event — ${err instanceof Error ? err.message : String(err)}`);
                    continue;
                }

                const oldEvent = collection.find(e => e.id === targetId);

                if (!oldEvent) {
                    summary.errors.push(`Edit skipped: event '${targetId}' not found in the current collection. The log file may contain orphaned or corrupted entries — try running the repair script.`);
                    continue;
                }

                // Pre-save validation: same-job errors block; cross-job warnings are informational
                const preResults = collection.validateReplacement(oldEvent, candidate);
                const preErrors = preResults.filter(e => e.severity !== "warning");
                const preWarnings = preResults.filter(e => e.severity === "warning");

                summary.warnings.push(...preWarnings.map(w => w.message));

                if (preErrors.length > 0) {
                    // Same-job sequence violation — block this individual edit
                    summary.errors.push(...preErrors.map(e => `Edit rejected for '${targetId}': ${e.message}`));
                    continue;
                }

                const result = runtime.logRepo.replaceEvent(oldEvent, candidate);
                if (!result.globalReplaced && !result.workspaceReplaced) {
                    summary.errors.push(`Edit failed for '${targetId}': the event was found in the collection but could not be matched in the log file on disk. The log may have been modified externally or contain formatting inconsistencies.`);
                } else {
                    summary.globalReplaced = summary.globalReplaced || result.globalReplaced;
                    summary.workspaceReplaced = summary.workspaceReplaced || result.workspaceReplaced;
                    editedEvents.push(oldEvent);
                    anyReplaced = true;
                }
            }

            if (anyReplaced) {
                // Owned log(s) changed — rebuild the derived index before redisplay.
                runtime.rebuildIndex();
                const updatedCollection = runtime.refreshEventCollection();
                const errors = updatedCollection.validate();
                summary.errors.push(...filterRelevantErrors(errors, editedEvents));
            }

            const finalCollection = runtime.refreshEventCollection();
            panel.webview.postMessage({
                type: "edit_result",
                payload: { summary, payload: buildPayload(finalCollection.toEvents()) }
            });
        }
    });
}