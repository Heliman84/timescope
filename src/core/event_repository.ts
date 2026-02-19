import * as fs from "fs";
import * as path from "path";
import { TimeScopePaths } from "./paths";
import { Event, EventCollection, ValidationError } from "./event";
import { Session } from "./session";
import { EventDTO } from "./event_dto";
import { Job } from "./job";

const HEADER_KEY = "_format_version";
const HEADER_LINE = JSON.stringify({ _format_version: 1 });

export type EventEntry = { record: Event; raw: string; source: "global" | "workspace"; lineIndex: number };

export class EventRepository {
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
        const sessions = this.loadSessions("global").filter(s => s.currentJob.equals(event.job));
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

    // Read all persisted records as canonical EventDTOs (skips malformed/header lines)
    readAll(): import("./event_dto").EventDTO[] {
        const out: import("./event_dto").EventDTO[] = [];
        const lines = this.readLinesForLocation("both");
        for (const l of lines) {
            try {
                const obj = JSON.parse(l);
                if (obj && (obj as any)[HEADER_KEY] !== undefined) continue;

                    // Strict: Event.fromJSONL will only return an Event for canonical lines.
                    const ev = Event.fromJSONL(l);
                    if (!ev) throw new Error("EventRepository.readAll: malformed or non-canonical record encountered");
                    const dto = ev.toDTO();
                    out.push(dto);
            } catch (ex) {
                // Per Step 4.3: do not normalize or skip — propagate the error.
                throw ex;
            }
        }
        return out;
    }

    // Append a canonical EventDTO directly (strict validation applied)
    appendDTO(dto: EventDTO): void {
        // Validate strictly via Event.fromDTO (requires canonical DTO)
        const ev = Event.fromDTO(dto);
        const line = ev.toJSONL() + "\n";

        this.ensureDirExists(this.paths.global_log_path);
        if (this.paths.workspace_log_path) this.ensureDirExists(this.paths.workspace_log_path);

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

    loadEventCollectionForJob(job?: string): EventCollection {
        const lines = this.safeReadLines(this.paths.global_log_path);
        const col = EventCollection.parse_lines(lines);
        if (job) return col.filterByJob(job);
        return col;
    }

    loadAllLogEntries(): EventEntry[] {
        const entries: EventEntry[] = [];

        const pushLine = (line: string, src: "global" | "workspace", idx: number) => {
            try {
                const obj = JSON.parse(line);
                if (obj && (obj as any)[HEADER_KEY] !== undefined) return;
            } catch {
                // fall through to parse attempt
            }
            const parsed = Event.fromJSONL(line);
            if (parsed) entries.push({ record: parsed, raw: line, source: src, lineIndex: idx });
            else entries.push({ record: Event.fromDTO({ id: "", event: "stop", job_title: "__MALFORMED__", timestamp: 0, task: line, job_id: "00000", time_seed: 0 }), raw: line, source: src, lineIndex: idx });
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
            scanSingleN(this.safeReadLines(this.paths.global_log_path));
        } else if (location === "workspace") {
            scanSingleN(this.safeReadLines(this.paths.workspace_log_path));
        } else {
            scanBothN(
                this.safeReadLines(this.paths.global_log_path),
                this.safeReadLines(this.paths.workspace_log_path)
            );
        }

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

    /**
     * Rewrite both global and workspace logs, replacing any event that references
     * the provided Job.id with an updated Event using the supplied Job domain
     * object. This preserves canonical formatting by using Event.toJSONL().
     */
    renameJobInLogByJob(job: Job): void {
        if (!job) return;
        const rewriteFile = (filePath: string | null | undefined) => {
            if (!filePath || !fs.existsSync(filePath)) return;
            const lines = this.safeReadLines(filePath);
            const parsed: string[] = [];
            for (const l of lines) {
                const ev = Event.fromJSONL(l);
                if (!ev) {
                    // preserve malformed/header lines as-is
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
            const toWrite = parsed.length === 0 ? [HEADER_LINE] : [HEADER_LINE, ...parsed];
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
}
