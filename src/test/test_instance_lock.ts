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

    // refresh_lock updates the heartbeat for the current owner and reports success.
    const refreshed_now = stale_now + 10_000;
    const refresh_ok = refresh_lock(locks_dir, repo_id, { pid: 333, instance_id: "inst-C", now: refreshed_now });
    assert.strictEqual(refresh_ok, true, "refresh_lock reports success for the current owner");
    assert.strictEqual(read_lock(lock_path)!.heartbeat_iso, new Date(refreshed_now).toISOString(), "refresh_lock updates the heartbeat");

    // refresh_lock backs off (no write) AND reports loss (#47 F3) when we don't currently own the lock.
    const refresh_foreign = refresh_lock(locks_dir, repo_id, { pid: 999, instance_id: "inst-D", now: refreshed_now + 1_000 });
    assert.strictEqual(refresh_foreign, false, "refresh_lock reports false when the lock belongs to a foreign instance");
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

/**
 * Tests the exclusivity guarantee of the FIRST acquisition against a never-before-locked
 * repo (#47 reviewer finding F2):
 * - Target: acquire_lock in src/core/instance_lock.ts
 * - What: with no prior lock file, the first acquire_lock call wins the OS-exclusive create
 *   and acquires; a second call against the same never-before-locked repo id reports a
 *   live-foreign lock, not acquired — the exclusivity a plain read-then-atomic-write could
 *   not guarantee under two truly-simultaneous first launches.
 * - Why: two windows opening the same never-before-tracked repo at the same instant must
 *   converge on exactly one lock holder, not both observe "no lock" and both write.
 */
export function run_instance_lock_exclusive_first_acquire_tests(): void {
    const locks_dir = mkdir_tmp("exclusive-first");
    const repo_id = "repo-first";
    const now = Date.parse("2026-07-19T12:00:00.000Z");
    const stale_ms = 30_000;

    const first = acquire_lock(locks_dir, repo_id, { pid: 111, instance_id: "inst-A", now }, stale_ms);
    assert.strictEqual(first.acquired, true, "the first acquisition against a never-before-locked repo succeeds");

    const second = acquire_lock(locks_dir, repo_id, { pid: 222, instance_id: "inst-B", now: now + 1 }, stale_ms);
    assert.strictEqual(second.acquired, false, "a second, distinct instance cannot also win the first-acquisition race");
    assert.strictEqual(second.live_foreign, true, "the second call sees the first's lock as live foreign");
    assert.strictEqual(second.holder.instance_id, "inst-A", "holder info reflects whoever actually won the exclusive create");

    // The lock file on disk unambiguously belongs to exactly one instance.
    const lock_path = path.join(locks_dir, `${repo_id}.lock.json`);
    assert.strictEqual(read_lock(lock_path)!.instance_id, "inst-A", "exactly one instance holds the lock after the race");
}
