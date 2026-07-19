import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { write_file_atomic, ensure_dir_sync } from "../utils/fs_utils";

/**
 * Per-repo instance lock (#47): a heartbeat file in the global `locks/` folder that lets a
 * second VS Code window opened on the same repo detect that another window is already
 * tracking it, so it can warn instead of silently racing timer actions and crash-recovery.
 * Pure Node (no `vscode` import) so it can run in the pure-Node test suite; the thin
 * `vscode`-aware wiring (activation, heartbeat interval, deactivate) lives in `extension.ts`.
 */
export interface LockInfo {
    pid: number;
    instance_id: string;
    heartbeat_iso: string;
}

export interface AcquireContext {
    pid: number;
    instance_id: string;
    now: number;
}

export interface AcquireLockResult {
    acquired: boolean;
    /** Our own info when acquired; the foreign holder's info when not. */
    holder: LockInfo;
    /** True only when acquisition failed because a LIVE foreign lock is held. */
    live_foreign: boolean;
}

function lock_path_for(locks_dir: string, repo_id: string): string {
    return path.join(locks_dir, `${repo_id}.lock.json`);
}

/** Read a repo's lock file. Returns null when absent or malformed (never throws). */
export function read_lock(lock_path: string): LockInfo | null {
    if (!fs.existsSync(lock_path)) return null;
    try {
        const raw = fs.readFileSync(lock_path, "utf8");
        const obj = JSON.parse(raw) as Record<string, unknown>;
        if (
            typeof obj.pid !== "number" ||
            typeof obj.instance_id !== "string" ||
            typeof obj.heartbeat_iso !== "string"
        ) {
            return null;
        }
        return { pid: obj.pid, instance_id: obj.instance_id, heartbeat_iso: obj.heartbeat_iso };
    } catch {
        return null;
    }
}

/** True when a lock's last heartbeat is older than `stale_ms` relative to `now`. */
export function is_stale(lock: LockInfo, now: number, stale_ms: number): boolean {
    const heartbeat_ms = Date.parse(lock.heartbeat_iso);
    if (Number.isNaN(heartbeat_ms)) return true;
    return now - heartbeat_ms > stale_ms;
}

/**
 * Attempt to write a lock file via OS-exclusive link (temp-file + `fs.linkSync`): the
 * temp file is written in full first, then linked into place — `linkSync` fails with
 * `EEXIST` if the destination already exists, and the link only succeeds once the temp
 * file's content is complete, so a reader can never observe a partial lock file (#47 F2).
 * Returns true iff this call created the lock file (i.e. none existed a moment ago).
 */
function try_create_lock_exclusive(lock_path: string, lock: LockInfo): boolean {
    ensure_dir_sync(lock_path);
    const dir = path.dirname(lock_path);
    const tmp = path.join(dir, `.${path.basename(lock_path)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(lock, null, 2) + "\n", "utf8");
    try {
        fs.linkSync(tmp, lock_path);
        return true;
    } catch (ex) {
        if ((ex as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw ex;
    } finally {
        try { fs.unlinkSync(tmp); } catch { /* best effort cleanup */ }
    }
}

/**
 * Try to acquire a repo's lock. The *first* acquisition (no lock file yet) goes through
 * an OS-exclusive create (`try_create_lock_exclusive`) so two windows launching at the
 * same instant against a never-before-locked repo can't both succeed under a plain
 * read-then-write race — exactly one wins the exclusive create (#47 F2). Once a lock file
 * exists, re-acquiring our own lock or taking over a stale foreign one is a read-then-
 * atomic-write (a residual race there is accepted — #47 F3, detect+warn not a mutex).
 * Fails when a live foreign lock is held; the caller gets the foreign holder's info back
 * to build a warning message.
 */
export function acquire_lock(
    locks_dir: string,
    repo_id: string,
    ctx: AcquireContext,
    stale_ms: number
): AcquireLockResult {
    const lock_path = lock_path_for(locks_dir, repo_id);
    const mine: LockInfo = {
        pid: ctx.pid,
        instance_id: ctx.instance_id,
        heartbeat_iso: new Date(ctx.now).toISOString(),
    };

    if (try_create_lock_exclusive(lock_path, mine)) {
        return { acquired: true, holder: mine, live_foreign: false };
    }

    // A lock file already existed at the exclusive-create attempt — read it and decide:
    // ours already, a stale foreign lock (takeover), or a live foreign lock (blocked).
    const existing = read_lock(lock_path);
    if (existing && existing.instance_id !== ctx.instance_id && !is_stale(existing, ctx.now, stale_ms)) {
        return { acquired: false, holder: existing, live_foreign: true };
    }

    write_file_atomic(lock_path, JSON.stringify(mine, null, 2) + "\n");
    return { acquired: true, holder: mine, live_foreign: false };
}

/**
 * Refresh our own lock's heartbeat. Returns false (and does NOT write) when the lock file
 * currently belongs to a foreign instance_id — backing off rather than overwriting a
 * foreign owner's lock narrows (does not close — #47 F3) the window where two instances
 * could both believe they hold the lock. The caller should treat `false` as having lost
 * the lock (e.g. stop suppressing recovery / re-attempt acquisition on next tick).
 */
export function refresh_lock(locks_dir: string, repo_id: string, ctx: AcquireContext): boolean {
    const lock_path = lock_path_for(locks_dir, repo_id);
    const existing = read_lock(lock_path);
    if (existing && existing.instance_id !== ctx.instance_id) return false;
    const mine: LockInfo = {
        pid: ctx.pid,
        instance_id: ctx.instance_id,
        heartbeat_iso: new Date(ctx.now).toISOString(),
    };
    write_file_atomic(lock_path, JSON.stringify(mine, null, 2) + "\n");
    return true;
}

/** Release our own lock. No-op (foreign lock untouched) if we're not the current owner. */
export function release_lock(locks_dir: string, repo_id: string, instance_id: string): void {
    const lock_path = lock_path_for(locks_dir, repo_id);
    const existing = read_lock(lock_path);
    if (!existing || existing.instance_id !== instance_id) return;
    try {
        fs.unlinkSync(lock_path);
    } catch {
        /* best effort */
    }
}

/** Pure helper: true only when acquisition failed against a live foreign lock. */
export function should_suppress_recovery(result: AcquireLockResult): boolean {
    return !result.acquired && result.live_foreign;
}
