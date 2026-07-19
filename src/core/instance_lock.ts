import * as fs from "fs";
import * as path from "path";
import { write_file_atomic } from "../utils/fs_utils";

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
 * Try to acquire a repo's lock. Succeeds (writes/takes over the file) when there's no
 * existing lock, the existing lock is already ours (same instance_id), or the existing
 * lock is stale (heartbeat older than `stale_ms` — the presumed-crashed prior window's
 * lock is taken over). Fails when a live foreign lock is held; the caller gets the
 * foreign holder's info back to build a warning message.
 */
export function acquire_lock(
    locks_dir: string,
    repo_id: string,
    ctx: AcquireContext,
    stale_ms: number
): AcquireLockResult {
    const lock_path = lock_path_for(locks_dir, repo_id);
    const existing = read_lock(lock_path);

    if (existing && existing.instance_id !== ctx.instance_id && !is_stale(existing, ctx.now, stale_ms)) {
        return { acquired: false, holder: existing, live_foreign: true };
    }

    const mine: LockInfo = {
        pid: ctx.pid,
        instance_id: ctx.instance_id,
        heartbeat_iso: new Date(ctx.now).toISOString(),
    };
    write_file_atomic(lock_path, JSON.stringify(mine, null, 2) + "\n");
    return { acquired: true, holder: mine, live_foreign: false };
}

/** Refresh our own lock's heartbeat. No-op if we don't currently own the lock on disk. */
export function refresh_lock(locks_dir: string, repo_id: string, ctx: AcquireContext): void {
    const lock_path = lock_path_for(locks_dir, repo_id);
    const existing = read_lock(lock_path);
    if (existing && existing.instance_id !== ctx.instance_id) return;
    const mine: LockInfo = {
        pid: ctx.pid,
        instance_id: ctx.instance_id,
        heartbeat_iso: new Date(ctx.now).toISOString(),
    };
    write_file_atomic(lock_path, JSON.stringify(mine, null, 2) + "\n");
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
