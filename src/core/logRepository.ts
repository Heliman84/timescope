import * as fs from "fs";
import * as path from "path";
import { TimeScopePaths } from "./paths";
import { Event, EventCollection, ValidationError } from "./event";
import { Session } from "./session";

const HEADER_KEY = "_format_version";
const HEADER_LINE = JSON.stringify({ _format_version: 1 });

export type LogEntry = { record: Event; raw: string; source: "global" | "workspace"; lineIndex: number };

export class LogRepository {
    private readonly paths: TimeScopePaths;

    constructor(paths: TimeScopePaths) {
        this.paths = paths;
    }

    private ensureDirExists(filePath: string) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    private safeReadLines(filePath: string | undefined | null): string[] {
        if (!filePath || !fs.existsSync(filePath)) return [];
        const raw = fs.readFileSync(filePath, "utf8");
        return raw
            .split("\n")
            .map(l => l.trim())
            .filter(l => l.length > 0);
    }

    private readLinesForLocation(location: "workspace" | "global" | "both" = "global"): string[] {
        const all: string[] = [];
        if (location === "global" || location === "both") {
            all.push(...this.safeReadLines(this.paths.global_log_path));
        }
        if (location === "workspace" || location === "both") {
            all.push(...this.safeReadLines(this.paths.workspace_log_path));
        }
        return all;
    }

    appendEvent(event: Event): void {
        const line = event.toJSONL() + "\n";

        this.ensureDirExists(this.paths.global_log_path);
        if (this.paths.workspace_log_path) this.ensureDirExists(this.paths.workspace_log_path);

        try {
            const existing = this.safeReadLines(this.paths.global_log_path);
            for (let i = existing.length - 1; i >= 0; i--) {
                const parsedEvent = Event.fromJSONL(existing[i]);
                if (!parsedEvent) continue;
                if (event.equals(parsedEvent)) return;
                break;
            }
        } catch {
            // ignore and proceed to append
        }

        if (!fs.existsSync(this.paths.global_log_path)) {
            fs.writeFileSync(this.paths.global_log_path, HEADER_LINE + "\n" + line, "utf8");
        } else {
            fs.appendFileSync(this.paths.global_log_path, line, "utf8");
        }

        if (this.paths.workspace_log_path) {
            if (!fs.existsSync(this.paths.workspace_log_path)) {
                fs.writeFileSync(this.paths.workspace_log_path, HEADER_LINE + "\n" + line, "utf8");
            } else {
                fs.appendFileSync(this.paths.workspace_log_path, line, "utf8");
            }
        }
    }

    appendValidated(event: Event): void {
        const sessions = this.loadSessions("global").filter(s => s.currentJob === event.job);
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

    loadAllLogs(): EventCollection {
        const allLines = this.readLinesForLocation("both");
        return EventCollection.parse_lines(allLines);
    }

    loadEventCollectionForJob(job?: string): EventCollection {
        const lines = this.safeReadLines(this.paths.global_log_path);
        const col = EventCollection.parse_lines(lines);
        if (job) return col.filterByJob(job);
        return col;
    }

    loadAllLogEntries(): LogEntry[] {
        const entries: LogEntry[] = [];

        const pushLine = (line: string, src: "global" | "workspace", idx: number) => {
            try {
                const obj = JSON.parse(line);
                if (obj && (obj as any)[HEADER_KEY] !== undefined) return;
            } catch {
                // fall through to parse attempt
            }
            const parsed = Event.fromJSONL(line);
            if (parsed) entries.push({ record: parsed, raw: line, source: src, lineIndex: idx });
            else entries.push({ record: Event.create({ event: "stop", job: "__MALFORMED__", timestamp: 0, task: line }), raw: line, source: src, lineIndex: idx });
        };

        const globalLines = this.safeReadLines(this.paths.global_log_path);
        for (let i = 0; i < globalLines.length; i++) pushLine(globalLines[i], "global", i);

        if (this.paths.workspace_log_path) {
            const wsLines = this.safeReadLines(this.paths.workspace_log_path);
            for (let i = 0; i < wsLines.length; i++) pushLine(wsLines[i], "workspace", i);
        }

        return entries;
    }

    loadSessions(location: "workspace" | "global" | "both" = "global"): Session[] {
        const lines = this.readLinesForLocation(location);
        const col = EventCollection.parse_lines(lines);
        const events = col.sorted();

        const openByJob = new Map<string, Event[]>();
        const sessions: Session[] = [];

        const finalize = (job: string, evs: Event[]) => {
            if (evs.length === 0) return;
            try {
                sessions.push(Session.fromEvents(evs));
            } catch {
                // ignore invalid sessions
            }
        };

        for (const ev of events) {
            const job = ev.job;
            if (ev.isStart()) {
                const existing = openByJob.get(job);
                if (existing && existing.length > 0) {
                    finalize(job, existing);
                }
                openByJob.set(job, [ev]);
                continue;
            }

            const current = openByJob.get(job);
            if (!current || current.length === 0) continue;
            current.push(ev);

            if (ev.isStop()) {
                finalize(job, current);
                openByJob.delete(job);
            }
        }

        for (const [job, evs] of openByJob.entries()) {
            finalize(job, evs);
            openByJob.delete(job);
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

    loadLastNSessions(location: "workspace" | "global" | "both" = "global", n: number): Session[] {
        if (!Number.isInteger(n) || n <= 0) return [];

        const finalized: Session[] = [];

        const tryFinalize = (map: Map<string, Event[]>) => {
            // When finalizing multiple sessions we should pick the most-recent
            // job tail available in `map` and create a Session from it.
            let candidateJob: string | null = null;
            let candidateArr: Event[] | null = null;
            let maxTs = -Infinity;
            for (const [job, arr] of map.entries()) {
                if (arr.length === 0) continue;
                const ts = arr[0].timestamp;
                if (ts > maxTs) {
                    maxTs = ts;
                    candidateJob = job;
                    candidateArr = arr;
                }
            }
            if (!candidateArr) return false;
            const chronological = candidateArr.slice().reverse();
            try {
                const s = Session.fromEvents(chronological);
                finalized.push(s);
                map.delete(candidateJob!);
                return true;
            } catch {
                map.delete(candidateJob!);
                return false;
            }
        };

        // Single-file backward scan collecting up to n sessions
        const scanSingleN = (lines: string[] | null | undefined) => {
            if (!lines || lines.length === 0) return;
            const byJob = new Map<string, Event[]>();
            for (let i = lines.length - 1; i >= 0; i--) {
                const ev = Event.fromJSONL(lines[i]);
                if (!ev) continue;
                const job = ev.job;
                let arr = byJob.get(job);
                if (!arr) {
                    arr = [];
                    byJob.set(job, arr);
                }
                arr.push(ev);
                if (ev.isStart()) {
                    // finalize this job's session
                    const chronological = arr.slice().reverse();
                    try {
                        const s = Session.fromEvents(chronological);
                        finalized.push(s);
                        byJob.delete(job);
                        if (finalized.length >= n) return;
                    } catch {
                        byJob.delete(job);
                    }
                }
            }
            // If we still need more, finalize remaining tails by most-recent timestamp
            while (finalized.length < n && tryFinalize(byJob)) {
                /* continue finalizing */
            }
        };

        // Merged backward scan for both logs
        const scanBothN = (gLines: string[] | null | undefined, wLines: string[] | null | undefined) => {
            const byJob = new Map<string, Event[]>();

            let gi = gLines ? gLines.length - 1 : -1;
            let wi = wLines ? wLines.length - 1 : -1;

            const getPrev = (lines: string[] | null | undefined, startIdx: number): { ev: Event | null; nextIdx: number } => {
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

            while ((gCurr.ev !== null) || (wCurr.ev !== null)) {
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

                const job = nextEv.job;
                let arr = byJob.get(job);
                if (!arr) {
                    arr = [];
                    byJob.set(job, arr);
                }
                arr.push(nextEv);
                if (nextEv.isStart()) {
                    const chronological = arr.slice().reverse();
                    try {
                        const s = Session.fromEvents(chronological);
                        finalized.push(s);
                        byJob.delete(job);
                        if (finalized.length >= n) return;
                    } catch {
                        byJob.delete(job);
                    }
                }
            }

            while (finalized.length < n && tryFinalize(byJob)) {
                /* finalize more tails */
            }
        };

        if (location === "global") {
            scanSingleN(this.safeReadLines(this.paths.global_log_path));
        } else if (location === "workspace") {
            scanSingleN(this.safeReadLines(this.paths.workspace_log_path));
        } else {
            scanBothN(this.safeReadLines(this.paths.global_log_path), this.safeReadLines(this.paths.workspace_log_path));
        }

        // Return chronological order (oldest first)
        return finalized.slice().reverse();
    }

    renameJobInLog(oldName: string, newName: string): void {
        const rewriteFile = (filePath: string | null | undefined) => {
            if (!filePath || !fs.existsSync(filePath)) return;
            const lines = this.safeReadLines(filePath);
            const col = EventCollection.parse_lines(lines);
            const renamed = col.renameJob(oldName, newName);
            const outLines = renamed.toLines();
            const toWrite = outLines.length === 0 ? [HEADER_LINE] : [HEADER_LINE, ...outLines];
            this.ensureDirExists(filePath);
            fs.writeFileSync(filePath, toWrite.join("\n") + "\n", "utf8");
        };

        rewriteFile(this.paths.global_log_path);
        if (this.paths.workspace_log_path) rewriteFile(this.paths.workspace_log_path);
    }

    updateLogEntry(oldRawLine: string, newRecord: Event): { globalReplaced: boolean; workspaceReplaced: boolean; errors?: ValidationError[] } {
        const result = { globalReplaced: false, workspaceReplaced: false, errors: undefined as ValidationError[] | undefined };

        const replaceInFile = (filePath: string | undefined | null): boolean => {
            if (!filePath || !fs.existsSync(filePath)) return false;
            const lines = this.safeReadLines(filePath);
            const col = EventCollection.parse_lines(lines);

            const parsedOld = Event.fromJSONL(oldRawLine);
            let newCol: EventCollection | null = null;
            if (parsedOld) {
                newCol = col.replaceEvent(parsedOld, newRecord);
            } else {
                const match = col.toEvents().find(e => newRecord.equals(e));
                if (match) newCol = col.replaceEvent(match, newRecord);
                else return false;
            }

            const origLines = col.toLines();
            const newLines = newCol.toLines();
            const changed = origLines.length !== newLines.length || origLines.some((v, i) => v !== newLines[i]);
            if (!changed) return false;

            const toWrite = newLines.length === 0 ? [HEADER_LINE] : [HEADER_LINE, ...newLines];
            this.ensureDirExists(filePath);
            fs.writeFileSync(filePath, toWrite.join("\n") + "\n", "utf8");

            return true;
        };

        result.globalReplaced = replaceInFile(this.paths.global_log_path);
        result.workspaceReplaced = replaceInFile(this.paths.workspace_log_path);

        try {
            const validationErrors = this.loadEventCollectionForJob(newRecord.job).validate({ startFromLatest: true });
            if (validationErrors.length > 0) result.errors = validationErrors;
        } catch (ex) {
            result.errors = [{ index: -1, code: "exception", message: String(ex) }];
        }

        return result;
    }

    loadSession(job: string): Session {
        const sessions = this.loadSessions("global").filter(s => s.currentJob === job);
        const last = sessions.length > 0 ? sessions[sessions.length - 1] : null;
        if (!last) throw new Error("No sessions found for job");
        return last;
    }
}
