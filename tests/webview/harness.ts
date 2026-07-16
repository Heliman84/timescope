/**
 * Test harness for the dashboard webview.
 *
 * Serves the REAL src/dashboard/webview files (index.html transformed the
 * same way dashboard.ts does: asset placeholders resolved, CSP stripped)
 * through Playwright route interception — no web server, no network.
 * Chart.js and its datalabels plugin are served from tests/webview/vendor
 * instead of the CDN so tests run offline and deterministically.
 *
 * acquireVsCodeApi() is stubbed before any page script runs:
 * - every outbound postMessage is recorded in window.__posted
 * - a "request_data" message is auto-answered with the fixture payload
 *   (mimicking the controller's summary_data response)
 * - tests inject further controller responses via window.__reply(msg)
 */

import * as fs from "fs";
import * as path from "path";
import { Page } from "@playwright/test";

import { FixtureEvent } from "./fixtures";

const WEBVIEW_DIR = path.resolve(__dirname, "../../src/dashboard/webview");
const VENDOR_DIR = path.resolve(__dirname, "vendor");

const DASHBOARD_URL = "https://timescope.test/index.html";

/** A message the webview posted to the (stubbed) extension host. */
export interface PostedMessage {
    type: string;
    payload?: unknown;
}

function harness_html(): string {
    let html = fs.readFileSync(path.join(WEBVIEW_DIR, "index.html"), "utf8");
    // Meta tags contain no ">" inside attribute values, so match to the tag end
    html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "");
    html = html.replace(/\$\{cssUri\}/g, "dashboard.css");
    html = html.replace(/\$\{jsUri\}/g, "dashboard.js");
    html = html.replace(/ nonce="\$\{nonce\}"/g, "");
    return html;
}

export async function open_dashboard(page: Page, payload: FixtureEvent[]): Promise<void> {
    await page.route("https://timescope.test/**", (route) => {
        const url = route.request().url();
        if (url.endsWith("index.html")) {
            return route.fulfill({ contentType: "text/html", body: harness_html() });
        }
        if (url.endsWith("dashboard.js")) {
            return route.fulfill({
                contentType: "text/javascript",
                body: fs.readFileSync(path.join(WEBVIEW_DIR, "dashboard.js"), "utf8"),
            });
        }
        if (url.endsWith("dashboard.css")) {
            return route.fulfill({
                contentType: "text/css",
                body: fs.readFileSync(path.join(WEBVIEW_DIR, "dashboard.css"), "utf8"),
            });
        }
        return route.fulfill({ status: 404, body: "not found" });
    });

    await page.route("https://cdn.jsdelivr.net/npm/chart.js", (route) =>
        route.fulfill({
            contentType: "text/javascript",
            body: fs.readFileSync(path.join(VENDOR_DIR, "chart.umd.js"), "utf8"),
        })
    );
    await page.route("https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels", (route) =>
        route.fulfill({
            contentType: "text/javascript",
            body: fs.readFileSync(path.join(VENDOR_DIR, "chartjs-plugin-datalabels.min.js"), "utf8"),
        })
    );

    await page.addInitScript((fixturePayload: FixtureEvent[]) => {
        const w = window as any;
        w.__posted = [];
        w.__reply = (msg: unknown) => window.postMessage(msg, "*");
        w.acquireVsCodeApi = () => ({
            postMessage: (msg: { type?: string }) => {
                w.__posted.push(msg);
                if (msg && msg.type === "request_data") {
                    setTimeout(() => window.postMessage({ type: "summary_data", payload: fixturePayload }, "*"), 0);
                }
            },
            getState: () => undefined,
            setState: () => undefined,
        });
    }, payload);

    await page.goto(DASHBOARD_URL);
    // Dashboard is ready once the job filter has rendered
    await page.waitForSelector("#job_all_checkbox");
}

/** Messages the webview posted to the (stubbed) extension host. */
export function posted_messages(page: Page): Promise<PostedMessage[]> {
    return page.evaluate(() => (window as any).__posted);
}

/** Inject a controller → webview message (e.g. an edit_result). */
export function reply(page: Page, msg: unknown): Promise<void> {
    return page.evaluate((m) => (window as any).__reply(m), msg);
}

/**
 * Format a timestamp for filling a datetime-local input, minute precision —
 * the modal's inputs have no step attribute, so seconds are rejected (#32).
 */
export function to_datetime_input_value(timestamp: number): string {
    const d = new Date(timestamp);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
