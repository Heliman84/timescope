import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import {
    read_lock,
    is_stale,
    acquire_lock,
    refresh_lock,
    release_lock,
    should_suppress_recovery,
} from "../core/instance_lock";

function mkdir_tmp(suffix: string): string {
    const root = path.join(__dirname, "..", "..", "test-output", `instance-lock-${suffix}-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    return root;
}

/**
 * Tests the per-repo instance lock (#47 multi-instance safety):
 * - Target: src/core/instance_lock.ts
 * - What: acquire with no lock file writes {pid, instance_id, heartbeat_iso}; a live foreign
 *   lock blocks acquisition and returns holder info; a stale foreign lock is taken over;
 *   refresh_lock updates the heartbeat; release_lock only deletes when we own it;
 *   should_suppress_recovery is true only for a live foreign lock.
 * - Why: two VS Code windows on the same repo must be detectable so timer actions/recovery
 *   don't silently race each other.
 */
export function run_instance_lock_tests(): void {
    const locks_dir = mkdir_tmp("basic");
    const repo_id = "repo-abc";
    const now = Date.parse("2026-07-19T12:00:00.000Z");
    const stale_ms = 30_000;

    // No lock file yet → acquisition succeeds and writes our info.
    const first = acquire_lock(locks_dir, repo_id, { pid: 111, instance_id: "inst-A", now }, stale_ms);
    assert.strictEqual(first.acquired, true, "acquiring with no existing lock succeeds");
    assert.strictEqual(first.live_foreign, false, "no foreign lock reported");
    assert.strictEqual(first.holder.pid, 111, "holder pid is ours");
    assert.strictEqual(first.holder.instance_id, "inst-A", "holder instance_id is ours");

    const lock_path = path.join(locks_dir, `${repo_id}.lock.json`);
    const on_disk = read_lock(lock_path);
    assert.ok(on_disk, "lock file was written");
    assert.strictEqual(on_disk!.pid, 111, "written pid matches");
    assert.strictEqual(on_disk!.instance_id, "inst-A", "written instance_id matches");
    assert.strictEqual(on_disk!.heartbeat_iso, new Date(now).toISOString(), "written heartbeat matches now");

    // A LIVE foreign lock (fresh heartbeat) blocks a second instance.
    const fresh_now = now + 5_000; // well within stale_ms
    const blocked = acquire_lock(locks_dir, repo_id, { pid: 222, instance_id: "inst-B", now: fresh_now }, stale_ms);
    assert.strictEqual(blocked.acquired, false, "live foreign lock blocks acquisition");
    assert.strictEqual(blocked.live_foreign, true, "reported as a live foreign lock");
    assert.strictEqual(blocked.holder.instance_id, "inst-A", "holder info is the foreign owner's");
    assert.strictEqual(should_suppress_recovery(blocked), true, "should_suppress_recovery is true for a live foreign lock");

    // The disk lock is untouched by the failed attempt.
    assert.strictEqual(read_lock(lock_path)!.instance_id, "inst-A", "failed acquisition does not overwrite the foreign lock");

    // Our own instance re-acquiring (same instance_id) always succeeds, even if "live".
    const reacquire = acquire_lock(locks_dir, repo_id, { pid: 111, instance_id: "inst-A", now: fresh_now }, stale_ms);
    assert.strictEqual(reacquire.acquired, true, "same instance_id re-acquires its own lock");

    // is_stale: pure helper.
    const live_lock = { pid: 111, instance_id: "inst-A", heartbeat_iso: new Date(now).toISOString() };
    assert.strictEqual(is_stale(live_lock, now + 1_000, stale_ms), false, "fresh heartbeat is not stale");
    assert.strictEqual(is_stale(live_lock, now + stale_ms + 1, stale_ms), true, "heartbeat older than stale_ms is stale");

    // A STALE foreign lock is taken over by a new instance.
    // (reacquire above refreshed inst-A's heartbeat to fresh_now — stale relative to that.)
    const stale_now = fresh_now + stale_ms + 1_000;
    const takeover = acquire_lock(locks_dir, repo_id, { pid: 333, instance_id: "inst-C", now: stale_now }, stale_ms);
    assert.strictEqual(takeover.acquired, true, "stale foreign lock is taken over");
    assert.strictEqual(takeover.live_foreign, false, "takeover is not reported as blocked by a live lock");
    assert.strictEqual(read_lock(lock_path)!.instance_id, "inst-C", "disk lock now belongs to the new owner");

    // refresh_lock updates the heartbeat for the current owner.
    const refreshed_now = stale_now + 10_000;
    refresh_lock(locks_dir, repo_id, { pid: 333, instance_id: "inst-C", now: refreshed_now });
    assert.strictEqual(read_lock(lock_path)!.heartbeat_iso, new Date(refreshed_now).toISOString(), "refresh_lock updates the heartbeat");

    // refresh_lock is a no-op when we don't currently own the lock.
    refresh_lock(locks_dir, repo_id, { pid: 999, instance_id: "inst-D", now: refreshed_now + 1_000 });
    assert.strictEqual(read_lock(lock_path)!.instance_id, "inst-C", "refresh_lock by a non-owner does not overwrite");

    // release_lock: foreign lock is untouched when the caller doesn't own it.
    release_lock(locks_dir, repo_id, "inst-D");
    assert.ok(read_lock(lock_path), "release_lock by a non-owner leaves the lock file in place");
    assert.strictEqual(read_lock(lock_path)!.instance_id, "inst-C", "foreign lock content untouched");

    // release_lock: the owner deletes it.
    release_lock(locks_dir, repo_id, "inst-C");
    assert.strictEqual(fs.existsSync(lock_path), false, "release_lock by the owner deletes the lock file");

    // should_suppress_recovery is false on a successful acquisition.
    assert.strictEqual(should_suppress_recovery(takeover), false, "should_suppress_recovery is false when acquisition succeeded");
}
