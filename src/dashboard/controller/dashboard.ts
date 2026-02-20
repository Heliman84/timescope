import * as vscode from "vscode";
import * as fs from "fs";
import { Runtime } from "../../core/runtime";
import { Event, ValidationError } from "../../core/event";

/**
 * Build the timestamp-descending payload the webview expects.
 * Events are already de-duplicated at load time (loadAllEntries merges
 * global/workspace line indices onto one Event), so no grouping needed.
 */
function buildPayload(events: Event[]): any[] {
    return events
        .map(ev => ({
            event: ev.type,
            job: ev.job_title,
            timestamp: ev.timestamp,
            task: ev.task || "",
            id: ev.id,
            global_line_index: ev.global_line_index,
            workspace_line_index: ev.workspace_line_index,
        }))
        .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Filter validation errors to only those referencing events that were part
 * of the edit (identified by the original Event objects).
 */
function filterRelevantErrors(
    errors: ValidationError[],
    editedEvents: Event[]
): string[] {
    const result: string[] = [];
    for (const err of errors) {
        const rec = err.record;
        if (!rec) continue;
        const matched = editedEvents.some(e =>
            e.type === rec.event &&
            e.job_title === rec.job_title &&
            e.timestamp === rec.timestamp &&
            (e.task || "") === (rec.task || "")
        );
        if (matched) result.push(err.message);
    }
    return result;
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
    const css_uri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "out", "dashboard", "webview", "dashboard.css")
    );

    html = html
        .replace(/\${nonce}/g, nonce)
        .replace(/\${jsUri}/g, js_uri.toString())
        .replace(/\${cssUri}/g, css_uri.toString())
        .replace(/\${cspSource}/g, panel.webview.cspSource);

    panel.webview.html = html;

    panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.type === "request_data") {
            const collection = runtime.refreshEventCollection();
            panel.webview.postMessage({
                type: "summary_data",
                payload: buildPayload(collection.toEvents())
            });
        }

        if (msg.type === "edit_log_entry") {
            const collection = runtime.loadEventCollection();
            const targetId: string | undefined = msg.payload?.id;
            const new_record = msg.payload.new_record;

            const summary = { globalReplaced: false, workspaceReplaced: false, errors: [] as string[] };

            let candidate: Event;
            try { candidate = Event.fromDTO(new_record); }
            catch { candidate = new_record as Event; }

            const oldEvent = targetId
                ? collection.find(e => e.id === targetId)
                : undefined;

            if (oldEvent) {
                const result = runtime.logRepo.replaceEvent(oldEvent, candidate);
                summary.globalReplaced = result.globalReplaced;
                summary.workspaceReplaced = result.workspaceReplaced;

                const updatedCollection = runtime.refreshEventCollection();
                const errors = updatedCollection.validate();
                summary.errors.push(...filterRelevantErrors(errors, [oldEvent]));
            }

            const updated = runtime.loadEventCollection();
            panel.webview.postMessage({
                type: "edit_result",
                payload: { summary, payload: buildPayload(updated.toEvents()) }
            });
        }

        if (msg.type === "edit_log_entries") {
            const collection = runtime.loadEventCollection();
            const edits = msg.payload?.edits ?? [];

            const summary = { globalReplaced: false, workspaceReplaced: false, errors: [] as string[] };
            const editedEvents: Event[] = [];

            for (const ed of edits) {
                const targetId: string | undefined = ed.id;
                let candidate: Event;
                try { candidate = Event.fromDTO(ed.new_record); }
                catch { candidate = ed.new_record as Event; }

                const oldEvent = targetId
                    ? collection.find(e => e.id === targetId)
                    : undefined;

                if (oldEvent) {
                    const result = runtime.logRepo.replaceEvent(oldEvent, candidate);
                    summary.globalReplaced = summary.globalReplaced || result.globalReplaced;
                    summary.workspaceReplaced = summary.workspaceReplaced || result.workspaceReplaced;
                    editedEvents.push(oldEvent);
                }
            }

            const updatedCollection = runtime.refreshEventCollection();
            const errors = updatedCollection.validate();
            summary.errors.push(...filterRelevantErrors(errors, editedEvents));

            panel.webview.postMessage({
                type: "edit_result",
                payload: { summary, payload: buildPayload(updatedCollection.toEvents()) }
            });
        }
    });
}