import * as vscode from "vscode";
import * as fs from "fs";
import { resolve_paths } from "../../core/paths";
import { load_all_log_entries, update_log_entry } from "../../core/logs";
import { Event } from "../../core/event";

export async function handle_dashboard(context: vscode.ExtensionContext) {
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
            const paths = resolve_paths(context);

            // Load entries including raw/source information
            const entries = await load_all_log_entries(paths);

            // Group entries by (event, job, timestamp, task) so UI can show a single row
            const map = new Map<string, any>();
            for (const e of entries) {
                const r = e.record;
                // If parsing failed (malformed), skip
                if (!r || typeof r.type !== "string" || typeof r.job !== "string" || typeof r.timestamp !== "number") continue;

                const key = `${r.type}|${r.job}|${r.timestamp}|${(r as any).task || ""}`;
                if (!map.has(key)) {
                    map.set(key, {
                        event: r.type,
                        job: r.job,
                        timestamp: r.timestamp,
                        task: (r as any).task || "",
                        occurrences: [{ raw: e.raw, source: e.source, lineIndex: e.lineIndex }]
                    });
                } else {
                    const existing = map.get(key);
                    existing.occurrences.push({ raw: e.raw, source: e.source, lineIndex: e.lineIndex });
                }
            }

            // Convert to array and sort by timestamp descending (latest first) for initial display
            const payload = Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);

            panel.webview.postMessage({
                type: "summary_data",
                payload
            });
        }

        if (msg.type === "edit_log_entry") {
            const paths = resolve_paths(context);
            const occurrences = msg.payload && msg.payload.occurrences ? msg.payload.occurrences : [];
            const new_record = msg.payload.new_record;

            const summary = { globalReplaced: false, workspaceReplaced: false, errors: [] as string[] };

            for (const occ of occurrences) {
                let candidate: Event;
                try {
                    candidate = Event.fromDTO(new_record);
                } catch {
                    // if payload is already an Event instance, allow it
                    candidate = new_record as Event;
                }
                const res = update_log_entry(paths, occ.raw, candidate);
                summary.globalReplaced = summary.globalReplaced || res.globalReplaced;
                summary.workspaceReplaced = summary.workspaceReplaced || res.workspaceReplaced;
                if (res.errors) {
                    // Filter errors to only those that reference the edited occurrences
                    const occRecords = occurrences.map((o: any) => Event.fromJSONL(o.raw)).filter((r: any) => !!r) as any[];
                    for (const er of res.errors) {
                        if (typeof er === 'string') {
                            summary.errors.push(er);
                            continue;
                        }
                        const rec = (er as any).record;
                        if (!rec) continue;
                        const matched = occRecords.some(r => r.type === rec.event && r.job === rec.job && r.timestamp === rec.timestamp && ((r as any).task || '') === ((rec as any).task || ''));
                        if (matched) summary.errors.push(er.message || JSON.stringify(er));
                    }
                }
            }

            // After attempting edits, send back result and updated payload
            const updated_entries = await load_all_log_entries(paths);
            const map = new Map<string, any>();
            for (const e of updated_entries) {
                const r = e.record;
                if (!r || typeof r.type !== "string" || typeof r.job !== "string" || typeof r.timestamp !== "number") continue;
                const key = `${r.type}|${r.job}|${r.timestamp}|${(r as any).task || ""}`;
                if (!map.has(key)) {
                    map.set(key, {
                        event: r.type,
                        job: r.job,
                        timestamp: r.timestamp,
                        task: (r as any).task || "",
                        occurrences: [{ raw: e.raw, source: e.source, lineIndex: e.lineIndex }]
                    });
                } else {
                    const existing = map.get(key);
                    existing.occurrences.push({ raw: e.raw, source: e.source, lineIndex: e.lineIndex });
                }
            }

            const payload = Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);

            panel.webview.postMessage({
                type: "edit_result",
                payload: { summary, payload }
            });
        }

        if (msg.type === "edit_log_entries") {
            const paths = resolve_paths(context);
            const edits = msg.payload && msg.payload.edits ? msg.payload.edits : [];

            const summary = { globalReplaced: false, workspaceReplaced: false, errors: [] as string[] };

            for (const ed of edits) {
                const occurrences = ed.occurrences || [];
                const new_record = ed.new_record;
                let candidate: Event;
                try {
                    candidate = Event.fromDTO(new_record);
                } catch {
                    candidate = new_record as Event;
                }
                for (const occ of occurrences) {
                    const res = update_log_entry(paths, occ.raw, candidate);
                    summary.globalReplaced = summary.globalReplaced || res.globalReplaced;
                    summary.workspaceReplaced = summary.workspaceReplaced || res.workspaceReplaced;
                    if (res.errors) {
                        const occRecords = occurrences.map((o: any) => Event.fromJSONL(o.raw)).filter((r: any) => !!r) as any[];
                        for (const er of res.errors) {
                            if (typeof er === 'string') {
                                summary.errors.push(er);
                                continue;
                            }
                            const rec = (er as any).record;
                            if (!rec) continue;
                            const matched = occRecords.some(r => r.type === rec.event && r.job === rec.job && r.timestamp === rec.timestamp && ((r as any).task || '') === ((rec as any).task || ''));
                            if (matched) summary.errors.push(er.message || JSON.stringify(er));
                        }
                    }
                }
            }

            // After attempting edits, send back result and updated payload
            const updated_entries = await load_all_log_entries(paths);
            const map = new Map<string, any>();
            for (const e of updated_entries) {
                const r = e.record;
                if (!r || typeof r.type !== "string" || typeof r.job !== "string" || typeof r.timestamp !== "number") continue;
                const key = `${r.type}|${r.job}|${r.timestamp}|${(r as any).task || ""}`;
                if (!map.has(key)) {
                    map.set(key, {
                        event: r.type,
                        job: r.job,
                        timestamp: r.timestamp,
                        task: (r as any).task || "",
                        occurrences: [{ raw: e.raw, source: e.source, lineIndex: e.lineIndex }]
                    });
                } else {
                    const existing = map.get(key);
                    existing.occurrences.push({ raw: e.raw, source: e.source, lineIndex: e.lineIndex });
                }
            }

            const payload = Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);

            panel.webview.postMessage({
                type: "edit_result",
                payload: { summary, payload }
            });
        }
    });
}