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
        const col = this.loadEventCollectionForJob(event.job);
        col.appendValidated(event);
        this.appendEvent(event);
    }

    loadAllLogs(): EventCollection {
        const allLines: string[] = [];
        allLines.push(...this.safeReadLines(this.paths.global_log_path));
        if (this.paths.workspace_log_path) allLines.push(...this.safeReadLines(this.paths.workspace_log_path));
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
        const col = this.loadEventCollectionForJob(job);
        return Session.fromCollection(col);
    }

    loadSessionsByJob(): Map<string, Session> {
        const lines = this.safeReadLines(this.paths.global_log_path);
        const col = EventCollection.parse_lines(lines);
        const events = col.toEvents();
        const byJob = new Map<string, Event[]>();
        for (const ev of events) {
            const list = byJob.get(ev.job) || [];
            list.push(ev);
            byJob.set(ev.job, list);
        }
        const sessions = new Map<string, Session>();
        for (const [job, evs] of byJob) {
            sessions.set(job, Session.fromEvents(evs));
        }
        return sessions;
    }

    loadLatestSession(): Session | null {
        const lines = this.safeReadLines(this.paths.global_log_path);
        const col = EventCollection.parse_lines(lines);
        const events = col.toEvents();
        if (events.length === 0) return null;

        let latest = events[0];
        for (const ev of events) {
            if (ev.timestamp > latest.timestamp) latest = ev;
        }
        return this.loadSession(latest.job);
    }

    loadActiveSession(): Session | null {
        const sessions = Array.from(this.loadSessionsByJob().values());
        const active = sessions.filter(s => !s.isIdle);
        if (active.length === 0) return this.loadLatestSession();

        let latestSession = active[0];
        let latestEvent = latestSession.lastEvent;
        for (const session of active) {
            const last = session.lastEvent;
            if (!last) continue;
            if (!latestEvent || last.timestamp > latestEvent.timestamp) {
                latestSession = session;
                latestEvent = last;
            }
        }
        return latestSession;
    }
}
