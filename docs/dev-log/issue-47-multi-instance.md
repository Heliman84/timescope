# Issue #47 — Multi-instance VS Code: shared global store corrupts/confuses the timer

> Decision log, not a spec. Started at plan time, finalized as a retrospective at PR time.
> Keep it short — capture the *why*, not a blow-by-blow. Skip any section that doesn't apply.

**Issue:** [#47](https://github.com/Heliman84/timescope/issues/47)  ·  **PR:** [#64](https://github.com/Heliman84/timescope/pull/64)  ·  **Arc:** [local-first-storage](../arc-log/arc-local-first-storage.md) (wave 3, storage track)

## Problem

Issue #48 dissolved the root cause (one owner per event; per-window timers) by design, but nothing *verified* it, and three multi-writer surfaces survived: the `registry.json` read-modify-write race and the first-opt-in `repo_id` race (both deferred from the 48a review), and same-workspace double-open — where window B's activation "recovers" (closes) a session window A is actively running, with no awareness A exists.

## Decisions & trade-offs

- **Registry race → intent-based read-modify-write, not a lockfile.** Every `registry.json` writer goes through `RegistryRepository.update(mutate)`: reload fresh from disk, apply the intent (upsert repo / add decline / remove decline), atomic write. First cut was whole-registry merge-on-write with declines exempted; review showed union-merge can *resurrect* an undecline from any window holding a stale snapshot (removals are unrepresentable in a union), and the exempted decline writers still raced registrations — applying the *intent* to a fresh snapshot fixes both. Residual sub-ms window accepted: a lost registration self-heals at that repo's next activation. Cross-process lockfiles on Windows add stale-lock complexity for marginal gain.
- **First-opt-in race → exclusive create + adopt.** The first `config.json` write is an OS-exclusive create — full content to a temp file, then `linkSync` into place (fails on EEXIST, and content-atomic, unlike temp+rename which would clobber the winner or a bare `wx` write which a loser could read half-written); the loser re-reads and adopts the winner's `repo_id`.
- **Same-workspace double-open → detect + warn + suppress recovery.** Per-repo heartbeat lock `locks/<repo_id>.lock.json` in globalStorage — ephemeral and disposable, like the index; *not* in `registry.json`, since heartbeat-frequency writes there would aggravate the very race being fixed. A live foreign lock ⇒ warning message + skip `checkAndRecover` (the open session isn't orphaned — it belongs to the live window). No read-only mode, per the arc decision.
- **Index append-vs-rebuild lost-write → accepted, verified.** The derived `index.jsonl` is disposable and rebuilt at every activation; a convergence test proves rebuild restores the dedup'd truth. Locking a cache is not worth the complexity.
- **Verification matrix as pure-Node tests.** Two independent storage stacks (two repo dirs, one shared global dir) in one process, plus deterministic stale-snapshot race simulations — repeatable regression coverage instead of a one-off manual repro. The two-Extension-Host manual matrix remains the F5 pass.

## Rejected approaches

- Cross-process lockfile around registry writes (Windows stale-lock fragility; fresh-load `update` + activation self-heal covers it).
- Whole-registry merge-on-write (`Registry.merge` + `save_merged`) — implemented, then removed at review: union-merge resurrects removed declines and left decline writers racing registrations. Replaced by intent-based `update(mutate)`.
- Heartbeat stored in `registry.json` (machine-local, yes — but write frequency would worsen the RMW race).
- Read-only mode for the second same-workspace window (arc decided detect + warn only).

## Retrospective

Shipped as planned, all four surfaces closed:

1. **Registry write safety** — `RegistryRepository.update(mutate)`: fresh disk load → apply intent → atomic write, no-op skip; all four writers (register, register-if-opted-in, decline, undecline) route through it. Behavioral only, no `registry.json` schema change.
2. **First-opt-in `config.json` race** — exclusive create (temp + `linkSync`, content-atomic); loser re-reads and adopts the winner's `repo_id`. No schema change.
3. **Same-workspace double-open** — new `locks/<repo_id>.lock.json` file in globalStorage (`{pid, instance_id, heartbeat_iso}`), heartbeat-refreshed on the existing 30s tick, stale after 3 missed beats (90s). A live foreign lock at activation warns and suppresses this window's orphan-recovery pass; a stale one is taken over silently.
4. **Verification matrix** — `test_multi_instance.ts` exercises two independent storage stacks (two repo dirs, one shared global dir) in-process, plus deterministic stale-snapshot race simulations for the registry and lock paths.

**Plan deviation:** the planned whole-registry merge-on-write shipped first, then was replaced wholesale after adversarial review (see Decisions): `Registry.merge`/`save_merged` are gone, `update(mutate)` is the only write path. Review also hardened both exclusive creates (lock + first `config.json`) from `wx`-flag writes to temp-file + `linkSync`, which is content-atomic — a loser can never read a partially written winner (with a plain `wx`-write fallback on volumes without hardlink support, e.g. exFAT/network shares, so first opt-in never hard-fails there). `refresh_lock` now backs off (returns false) when the on-disk lock is foreign, narrowing the both-own window after a stale takeover.

**Stale threshold:** K=3 missed heartbeats (90s at the existing 30s interval) — enough slack for a slow/backgrounded window's timer tick to fire late without falsely declaring its lock stale, while still recovering promptly from a real crash.

**Verification split:** the pure-Node multi-instance matrix (`test_multi_instance.ts`, `test_instance_lock.ts`, `test_registry.ts`, `test_local_opt_in.ts`, `test_repo_config.ts`) is the regression guard, run on every `npm test`. The two-Extension-Host manual matrix (two real windows on the same repo) is the F5 pass — it's the only way to observe the actual warning UX and confirm heartbeats behave under real VS Code scheduling, but it isn't repeatable CI coverage.

**Post-PR review finding (Copilot on #64) — mid-session opt-in was lockless.** The instance lock was acquired only at activation, gated on an already-opted-in workspace. A workspace opted-in *mid-session* via Start → "Track here" (`enable_local_logging`) never acquired the lock, so that window stayed permanently lockless — invisible to detection, and a second window on the same repo would acquire cleanly, warn about nothing, and run recovery against the live session. Every fixture is pre-opted-in, so the whole verification matrix and both F5 steps only exercised the activation path and missed it. Fixed by extracting `acquire_instance_lock(...)` and calling it from both the activation path and the "Track here" branch (using the `repo_id` `enable_local_logging` returns); a core test now pins that `enable_local_logging` and `register_if_opted_in` resolve the same `repo_id` (same lock key). Lesson: a pre-opted-in-only fixture set is a blind spot for opt-in-path behavior.

**F5 rig gotcha (cost real time):** a plain *New Window* from an Extension Development Host runs the **installed** extension, not the dev build — so the second window reported the old installed version and the lock never contested. Two dev hosts are required. The reliable, UI-independent way is two CLI launches with distinct user-data dirs: `code --extensionDevelopmentPath=<repo> --user-data-dir=<distinct> --disable-extensions <repo-folder>`. The lock keys on `repo_id` (not folder path), so the same-repo double-open is staged via `repoA-dup` — a separate folder sharing repoA's `repo_id` with an open session — rather than fighting VS Code's "folder already open" focus behavior. Launch configs for `repoA`/`repoB`/`repoA-dup` are checked in.
