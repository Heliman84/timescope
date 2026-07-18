import * as fs from "fs";
import * as path from "path";
import { TimeScopePaths } from "./paths";
import { Event, ValidationError } from "./event";
import { EventCollection } from "./event_collection";
import { Session } from "./session";
import { EventDTO } from "./event_dto";
import { Job } from "./job";
import { ensure_dir_sync, readJSONLSafe, append_line_safe, write_file_atomic } from "../utils/fs_utils";
import { HEADER_KEY, HEADER_LINE, sanitize_lines, SanitizeReport } from "./log_sanitizer";

export class EventRepository {
    private readonly paths: TimeScopePaths;

    constructor(paths: TimeScopePaths) {
        this.paths = paths;
    }

    /**
     * Single choke point for log reads: physical lines are healed in memory
     * (concatenated records split) so every consumer — analytics, dedupe,
     * line indices, rewrites — sees the same logical view. Disk is untouched.
     */
    private read_log_lines(file_path: string | null | undefined): string[] {
        if (!file_path) return [];
        // Hot path: heal concatenated records but skip per-line event parsing;
        // the damage report is only needed by checkLogHealth (full read).
        const { lines } = sanitize_lines(readJSONLSafe(file_path), { count_events: false });
        return lines;
    }

    /** Full sanitize reports for both logs (used for the load-time damage prompt). */
    checkLogHealth(): { file_path: string; report: SanitizeReport }[] {
        const results: { file_path: string; report: SanitizeReport }[] = [];
        for (const p of [this.paths.global_log_path, this.paths.workspace_log_path]) {
            if (!p) continue;
            const { report } = sanitize_lines(readJSONLSafe(p));
            results.push({ file_path: p, report });
        }
        return results;
    }

    private readLinesForLocation(location: "workspace" | "global" | "both" = "global"): string[] {
        const all: string[] = [];
        if (location === "global" || location === "both") {
            all.push(...this.read_log_lines(this.paths.global_log_path));
        }
        if (location === "workspace" || location === "both") {
            all.push(...this.read_log_lines(this.paths.workspace_log_path));
        }
        return all;
    }

    appendEvent(event: Event): void {
        const line = event.toJSONL() + "\n";

        ensure_dir_sync(this.paths.global_log_path);
        if (this.paths.workspace_log_path) ensure_dir_sync(this.paths.workspace_log_path);

        // Read global file once — used for both dedupe check and line count.
        let globalLines: string[] = [];
        try {
            globalLines = this.read_log_lines(this.paths.global_log_path);
            for (let i = globalLines.length - 1; i >= 0; i--) {
                const parsedEvent = Event.fromJSONL(globalLines[i]);
                if (!parsedEvent) continue;
                if (event.equals(parsedEvent)) {
                    // Already in the global log — set the index so the caller
                    // knows it's persisted, then return without double-writing.
                    event.setGlobalLineIndex(i);
                    return;
                }
                break;
            }
        } catch {
            // ignore and proceed to append
        }

        if (globalLines.length === 0) {
            // New file: header on line 0, event on line 1
            fs.writeFileSync(this.paths.global_log_path, HEADER_LINE + "\n" + line, "utf8");
            event.setGlobalLineIndex(1);
        } else {
            // Appending: newline-safe so a torn earlier write can never glue records
            append_line_safe(this.paths.global_log_path, event.toJSONL());
            event.setGlobalLineIndex(globalLines.length);
        }

        if (this.paths.workspace_log_path) {
            // Read workspace file once for line count.
            const wsLines = this.read_log_lines(this.paths.workspace_log_path);
            if (wsLines.length === 0) {
                fs.writeFileSync(this.paths.workspace_log_path, HEADER_LINE + "\n" + line, "utf8");
                event.setWorkspaceLineIndex(1);
            } else {
                append_line_safe(this.paths.workspace_log_path, event.toJSONL());
                event.setWorkspaceLineIndex(wsLines.length);
            }
        }
    }

    appendValidated(event: Event): void {
        const sessions = this.loadSessions("global").filter(s => s.job.equals(event.job));
        const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;

        if (event.isStart()) {
            if (lastSession && lastSession.isOpen) {
                throw new Error("Cannot start a new session while another is open");
            }
            if (lastSession) {
                const lastEvent = lastSession.lastEvent;
                if (!lastEvent) throw new Error("Cannot append start without prior event context");
                const err = lastEvent.validateTransition(event);
                if (err) throw new Error(err.message);
            }
            this.appendEvent(event);
            return;
        }

        if (!lastSession || !lastSession.isOpen) {
            throw new Error("Cannot append event without an open session");
        }

        lastSession.appendEvent(event);
        this.appendEvent(event);
    }

    loadEventCollectionForJob(job?: Job): EventCollection {
        const lines = this.read_log_lines(this.paths.global_log_path);
        const col = EventCollection.parse_lines(lines);
        if (job) return col.filterByJob(job);
        return col;
    }

    loadSessions(location: "workspace" | "global" | "both" = "global"): Session[] {
        const lines = this.readLinesForLocation(location);
        const col = EventCollection.parse_lines(lines);
        const events = col.sorted();

        // Map job_id → Event[]
        const openByJob = new Map<string, Event[]>();
        const sessions: Session[] = [];

        const finalize = (job_id: string, evs: Event[]) => {
            if (evs.length === 0) return;
            try {
                sessions.push(Session.fromEvents(evs));
            } catch {
                // ignore invalid sessions
            }
        };

        for (const ev of events) {
            const job_id = ev.job.id;

            if (ev.isStart()) {
                const existing = openByJob.get(job_id);
                if (existing && existing.length > 0) {
                    finalize(job_id, existing);
                }
                openByJob.set(job_id, [ev]);
                continue;
            }

            const current = openByJob.get(job_id);
            if (!current || current.length === 0) continue;
            current.push(ev);

            if (ev.isStop()) {
                finalize(job_id, current);
                openByJob.delete(job_id);
            }
        }

        // finalize any dangling sessions
        for (const [job_id, evs] of openByJob.entries()) {
            finalize(job_id, evs);
            openByJob.delete(job_id);
        }

        return sessions.sort((a, b) => {
            const aTs = a.startEvent ? a.startEvent.timestamp : 0;
            const bTs = b.startEvent ? b.startEvent.timestamp : 0;
            return aTs - bTs;
        });
    }

    loadLastSession(location: "workspace" | "global" | "both" = "global"): Session | null {
        const arr = this.loadLastNSessions(location, 1);
        return arr.length === 0 ? null : arr[0];
    }

    loadLastNSessions(
        location: "workspace" | "global" | "both" = "global",
        n: number
    ): Session[] {
        if (!Number.isInteger(n) || n <= 0) return [];

        const finalized: Session[] = [];

        // Pick the most recent incomplete session across jobs
        const tryFinalize = (map: Map<string, Event[]>) => {
            let candidateJobId: string | null = null;
            let candidateArr: Event[] | null = null;
            let maxTs = -Infinity;

            for (const [jobId, arr] of map.entries()) {
                if (arr.length === 0) continue;
                const ts = arr[0].timestamp; // newest event (reverse scan)
                if (ts > maxTs) {
                    maxTs = ts;
                    candidateJobId = jobId;
                    candidateArr = arr;
                }
            }

            if (!candidateArr) return false;

            const chronological = candidateArr.slice().reverse();
            try {
                const s = Session.fromEvents(chronological);
                finalized.push(s);
                map.delete(candidateJobId!);
                return true;
            } catch {
                map.delete(candidateJobId!);
                return false;
            }
        };

        // Scan a single log (global OR workspace)
        const scanSingleN = (lines: string[] | null | undefined) => {
            if (!lines || lines.length === 0) return;

            const byJob = new Map<string, Event[]>(); // job_id → events

            for (let i = lines.length - 1; i >= 0; i--) {
                const ev = Event.fromJSONL(lines[i]);
                if (!ev) continue;

                const jobId = ev.job.id;
                let arr = byJob.get(jobId);
                if (!arr) {
                    arr = [];
                    byJob.set(jobId, arr);
                }

                arr.push(ev);

                if (ev.isStart()) {
                    const chronological = arr.slice().reverse();
                    try {
                        const s = Session.fromEvents(chronological);
                        finalized.push(s);
                        byJob.delete(jobId);
                        if (finalized.length >= n) return;
                    } catch {
                        byJob.delete(jobId);
                    }
                }
            }

            while (finalized.length < n && tryFinalize(byJob)) {}
        };

        // Scan both logs merged by timestamp
        const scanBothN = (
            gLines: string[] | null | undefined,
            wLines: string[] | null | undefined
        ) => {
            const byJob = new Map<string, Event[]>();

            let gi = gLines ? gLines.length - 1 : -1;
            let wi = wLines ? wLines.length - 1 : -1;

            const getPrev = (
                lines: string[] | null | undefined,
                startIdx: number
            ): { ev: Event | null; nextIdx: number } => {
                if (!lines) return { ev: null, nextIdx: -1 };
                let i = startIdx;
                while (i >= 0) {
                    const ev = Event.fromJSONL(lines[i]);
                    i--;
                    if (ev) return { ev, nextIdx: i };
                }
                return { ev: null, nextIdx: -1 };
            };

            let gCurr = getPrev(gLines, gi);
            let wCurr = getPrev(wLines, wi);

            while (gCurr.ev !== null || wCurr.ev !== null) {
                let nextEv: Event | null = null;

                if (gCurr.ev && wCurr.ev) {
                    if (gCurr.ev.timestamp >= wCurr.ev.timestamp) {
                        nextEv = gCurr.ev;
                        gCurr = getPrev(gLines, gCurr.nextIdx);
                    } else {
                        nextEv = wCurr.ev;
                        wCurr = getPrev(wLines, wCurr.nextIdx);
                    }
                } else if (gCurr.ev) {
                    nextEv = gCurr.ev;
                    gCurr = getPrev(gLines, gCurr.nextIdx);
                } else if (wCurr.ev) {
                    nextEv = wCurr.ev;
                    wCurr = getPrev(wLines, wCurr.nextIdx);
                }

                if (!nextEv) break;

                const jobId = nextEv.job.id;
                let arr = byJob.get(jobId);
                if (!arr) {
                    arr = [];
                    byJob.set(jobId, arr);
                }

                arr.push(nextEv);

                if (nextEv.isStart()) {
                    const chronological = arr.slice().reverse();
                    try {
                        const s = Session.fromEvents(chronological);
                        finalized.push(s);
                        byJob.delete(jobId);
                        if (finalized.length >= n) return;
                    } catch {
                        byJob.delete(jobId);
                    }
                }
            }

            while (finalized.length < n && tryFinalize(byJob)) {}
        };

        if (location === "global") {
            scanSingleN(this.read_log_lines(this.paths.global_log_path));
        } else if (location === "workspace") {
            scanSingleN(this.read_log_lines(this.paths.workspace_log_path));
        } else {
            scanBothN(
                this.read_log_lines(this.paths.global_log_path),
                this.read_log_lines(this.paths.workspace_log_path)
            );
        }

        return finalized.slice().reverse();
    }

    /**
     * Rewrite both global and workspace logs, replacing any event that references
     * the provided Job.id with an updated Event using the supplied Job domain
     * object. This preserves canonical formatting by using Event.toJSONL().
     */
    renameJobInLogByJob(job: Job): void {
        if (!job) return;
        const rewriteFile = (filePath: string | null | undefined) => {
            if (!filePath || !fs.existsSync(filePath)) return;
            const lines = this.read_log_lines(filePath);
            const parsed: string[] = [];
            for (const l of lines) {
                // Skip header lines — we prepend a fresh header at the end
                try {
                    const obj = JSON.parse(l);
                    if (obj && typeof obj === "object" && (obj as any)._format_version !== undefined) continue;
                } catch { /* not JSON — fall through to preserve as malformed */ }

                const ev = Event.fromJSONL(l);
                if (!ev) {
                    // preserve malformed lines as-is
                    parsed.push(l);
                    continue;
                }
                if (ev.job_id === job.id) {
                    const replaced = ev.withJob(job);
                    parsed.push(replaced.toJSONL());
                } else {
                    parsed.push(ev.toJSONL());
                }
            }
            const toWrite = [HEADER_LINE, ...parsed];
            // write_file_atomic ensures the parent directory itself.
            write_file_atomic(filePath, toWrite.join("\n") + "\n");
        };

        rewriteFile(this.paths.global_log_path);
        if (this.paths.workspace_log_path) rewriteFile(this.paths.workspace_log_path);
    }

    /**
     * Load every parseable event from both global and workspace logs,
     * de-duplicated by Event identity. Each Event carries its own
     * global_line_index and workspace_line_index (-1 if absent from a file).
     */
    loadAllEntries(): EventCollection {
        // id → Event (de-duped; line indices merged onto one object)
        const byId = new Map<string, Event>();
        const ordered: string[] = []; // preserve insertion order for the collection

        const scan = (
            filePath: string | null | undefined,
            setIndex: (ev: Event, line: number) => void
        ) => {
            if (!filePath || !fs.existsSync(filePath)) return;
            const lines = this.read_log_lines(filePath);
            for (let i = 0; i < lines.length; i++) {
                const ev = Event.fromJSONL(lines[i]);
                if (!ev) continue;
                const existing = byId.get(ev.id);
                if (existing) {
                    // Same event already seen in the other file — merge index
                    setIndex(existing, i);
                } else {
                    setIndex(ev, i);
                    byId.set(ev.id, ev);
                    ordered.push(ev.id);
                }
            }
        };

        scan(this.paths.global_log_path, (ev, i) => ev.setGlobalLineIndex(i));
        scan(this.paths.workspace_log_path, (ev, i) => ev.setWorkspaceLineIndex(i));

        const events = ordered.map(id => byId.get(id)!);
        return EventCollection.fromArray(events);
    }

    /**
     * Replace a specific Event in the log files it appears in.
     * Uses the Event's own global_line_index / workspace_line_index to know
     * which files to target, and matches by raw JSONL content for safety.
     */
    replaceEvent(
        oldEvent: Event,
        newEvent: Event
    ): { globalReplaced: boolean; workspaceReplaced: boolean } {
        const result = { globalReplaced: false, workspaceReplaced: false };
        const oldLine = oldEvent.toJSONL();
        const newLine = newEvent.toJSONL();

        const rewrite = (filePath: string | null | undefined, key: "globalReplaced" | "workspaceReplaced") => {
            if (!filePath || !fs.existsSync(filePath)) return;
            const lines = this.read_log_lines(filePath);
            let replaced = false;
            const output: string[] = [];

            for (const l of lines) {
                // Skip header lines — we prepend a fresh header at the end
                try {
                    const obj = JSON.parse(l);
                    if (obj && typeof obj === "object" && (obj as any)[HEADER_KEY] !== undefined) continue;
                } catch { /* not JSON — fall through */ }

                if (!replaced && l === oldLine) {
                    output.push(newLine);
                    replaced = true;
                } else {
                    output.push(l);
                }
            }

            if (replaced) {
                const toWrite = [HEADER_LINE, ...output];
                // write_file_atomic ensures the parent directory itself.
                write_file_atomic(filePath, toWrite.join("\n") + "\n");
                result[key] = true;
            }
        };

        if (oldEvent.isInGlobal) {
            rewrite(this.paths.global_log_path, "globalReplaced");
        }
        if (oldEvent.isInWorkspace) {
            rewrite(this.paths.workspace_log_path, "workspaceReplaced");
        }

        return result;
    }
}
