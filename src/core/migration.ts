import * as fs from "fs";
import { Event } from "./event";
import { sanitize_lines } from "./log_sanitizer";
import { readJSONLSafe, write_file_atomic } from "../utils/fs_utils";
import { append_owned_event } from "./global_index";

export interface MigrationResult {
    migrated: number;
    backup_path?: string;
}

/**
 * One-shot migration of the legacy global `logs.jsonl` into the owned `scratch.jsonl`
 * (#48 48c). The legacy store had no owning repo — its events become global-owned
 * scratch/legacy history. Non-destructive: the legacy file is backed up before removal,
 * and events already present in scratch (by id) are not duplicated.
 *
 * After a successful migration the legacy file is removed, so this is a no-op on every
 * subsequent activation (a missing legacy file ⇒ nothing to migrate).
 */
export function migrate_legacy_global_log(legacy_path: string, scratch_path: string): MigrationResult {
    if (!fs.existsSync(legacy_path)) return { migrated: 0 };

    const { lines } = sanitize_lines(readJSONLSafe(legacy_path), { count_events: false });
    const events: Event[] = [];
    for (const line of lines) {
        const ev = Event.fromJSONL(line);
        if (ev) events.push(ev);
    }

    // Back up the legacy file (verbatim bytes) before touching anything.
    let backup_path = legacy_path + ".migrated.bak";
    if (fs.existsSync(backup_path)) backup_path = `${legacy_path}.migrated.${Date.now()}.bak`;
    write_file_atomic(backup_path, fs.readFileSync(legacy_path, "utf8"));

    // De-dupe against events already in scratch (by id), then append the rest.
    const existing = new Set<string>();
    const { lines: scratch_lines } = sanitize_lines(readJSONLSafe(scratch_path), { count_events: false });
    for (const l of scratch_lines) {
        const ev = Event.fromJSONL(l);
        if (ev) existing.add(ev.id);
    }

    let migrated = 0;
    for (const ev of events) {
        if (existing.has(ev.id)) continue;
        append_owned_event(scratch_path, ev);
        existing.add(ev.id);
        migrated++;
    }

    // Retire the legacy file so migration runs exactly once.
    try { fs.unlinkSync(legacy_path); } catch { /* best effort */ }

    return { migrated, backup_path };
}
