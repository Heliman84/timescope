import * as fs from "fs";
import { Event } from "./event";
import { readJSONLSafe, write_file_atomic } from "../utils/fs_utils";

export const FORMAT_VERSION = 2;
export const HEADER_KEY = "_format_version";
export const HEADER_LINE = JSON.stringify({ [HEADER_KEY]: FORMAT_VERSION });

export function is_header_line(line: string): boolean {
    try {
        const obj = JSON.parse(line);
        return !!obj && typeof obj === "object" && (obj as Record<string, unknown>)[HEADER_KEY] !== undefined;
    } catch {
        return false;
    }
}

/**
 * Damage report produced by sanitize_lines for a single log file.
 * pause/resume counts are informational (imbalance is data-level and
 * cannot be repaired by compaction); the rest describe disk damage.
 */
export interface SanitizeReport {
    concatenated_lines_split: number;
    malformed_lines: number;
    missing_header: boolean;
    pause_events: number;
    resume_events: number;
}

/** True when compaction would actually fix something on disk. */
export function has_repairable_damage(report: SanitizeReport): boolean {
    return report.concatenated_lines_split > 0 || report.missing_header;
}

/**
 * Split a physical line containing multiple concatenated top-level JSON
 * objects — the signature of an append made while the file lacked its
 * trailing newline. String-aware (braces inside values never split) and
 * conservative: unless the line divides into 2+ objects that each parse,
 * it is returned whole. No partial salvage.
 */
export function split_concatenated_jsonl(line: string): string[] {
    // Fast path: concatenation always leaves a "}...{" seam. A line without
    // one can never split — return it untouched with zero parsing cost.
    // (A "}{" inside a string value falls through to the string-aware
    // scanner, which correctly refuses to split it.)
    if (!/\}\s*\{/.test(line)) return [line];

    const parts: string[] = [];
    let depth = 0;
    let in_string = false;
    let escaped = false;
    let seg_start = -1;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (in_string) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') in_string = false;
            continue;
        }
        if (ch === '"') {
            if (depth === 0) return [line]; // stray string outside any object
            in_string = true;
        } else if (ch === "{") {
            if (depth === 0) seg_start = i;
            depth++;
        } else if (ch === "}") {
            if (depth === 0) return [line]; // unbalanced close
            depth--;
            if (depth === 0) {
                parts.push(line.slice(seg_start, i + 1));
                seg_start = -1;
            }
        } else if (depth === 0 && !/\s/.test(ch)) {
            return [line]; // non-whitespace residue between objects
        }
    }

    if (depth !== 0 || in_string) return [line]; // unterminated object/string
    if (parts.length < 2) return [line];
    for (const part of parts) {
        try {
            JSON.parse(part);
        } catch {
            return [line];
        }
    }
    return parts;
}

/**
 * Heal raw physical lines into logical lines (in memory only — disk is
 * never touched here) and report what was found. All repository reads
 * route through this so every consumer sees the same healed view.
 */
export function sanitize_lines(
    raw_lines: string[],
    opts?: { count_events?: boolean }
): { lines: string[]; report: SanitizeReport } {
    const count_events = opts?.count_events !== false;
    const report: SanitizeReport = {
        concatenated_lines_split: 0,
        malformed_lines: 0,
        missing_header: false,
        pause_events: 0,
        resume_events: 0,
    };

    const lines: string[] = [];
    for (const raw of raw_lines) {
        const parts = split_concatenated_jsonl(raw);
        if (parts.length > 1) report.concatenated_lines_split++;
        lines.push(...parts);
    }

    // An empty/absent file is not damaged — there is nothing to repair.
    report.missing_header = lines.length > 0 && !is_header_line(lines[0]);

    // Per-line event parsing is only needed for the full health report
    // (malformed/pause/resume counts) — hot-path reads skip it.
    if (count_events) {
        for (const line of lines) {
            if (is_header_line(line)) continue;
            const event = Event.fromJSONL(line);
            if (!event) {
                report.malformed_lines++;
                continue;
            }
            if (event.isPause()) report.pause_events++;
            else if (event.isResume()) report.resume_events++;
        }
    }

    return { lines, report };
}

export interface CompactionResult {
    changed: boolean;
    backup_path: string | null;
    report: SanitizeReport | null;
}

/**
 * Rewrite a log file clean at the current format version: split concatenated
 * records, restore canonical serialization and the header line, preserve
 * truly-unparseable lines verbatim. Writes `<file>.bak` first, lands via
 * temp-file + atomic rename. Idempotent: a clean file is left untouched
 * (and its .bak is not refreshed).
 */
export function compact_log_file(file_path: string | null | undefined): CompactionResult {
    if (!file_path || !fs.existsSync(file_path)) {
        return { changed: false, backup_path: null, report: null };
    }

    const original = fs.readFileSync(file_path, "utf8");
    const { lines, report } = sanitize_lines(readJSONLSafe(file_path));

    const out: string[] = [HEADER_LINE];
    for (const line of lines) {
        if (is_header_line(line)) continue; // fresh header already emitted
        const event = Event.fromJSONL(line);
        out.push(event ? event.toJSONL() : line);
    }
    const content = out.join("\n") + "\n";

    if (content === original) {
        return { changed: false, backup_path: null, report };
    }

    // Never clobber an earlier backup — it may be the last-known-good bytes.
    let backup_path = file_path + ".bak";
    if (fs.existsSync(backup_path)) {
        backup_path = `${file_path}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
    }
    fs.copyFileSync(file_path, backup_path);
    write_file_atomic(file_path, content);
    return { changed: true, backup_path, report };
}
