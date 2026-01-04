import * as vscode from "vscode";
import * as fs from "fs";
import { resolve_paths } from "../../core/paths";
import { load_all_logs } from "../../core/logs";

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
            const include_global = !!msg.include_global;

            const sessions = await load_all_logs(paths);

            panel.webview.postMessage({
                type: "summary_data",
                payload: sessions
            });
        }
    });
}