# gotchas.md — Invariants & Traps

> *What this is: the traps that bite, the invariants that must hold, and corrected misdiagnoses kept on record.*


## Load-bearing invariants (reviewer checks these; builders must not break them)

- **One owner per event** (`record_format_spec.md:9`, `event_repository.ts:71-73`): opted-in
  workspace events live *only* in `.timescope/logs.jsonl`; everything else *only* in
  `scratch.jsonl`. No dual-write. `index.jsonl` is derived — deleting it loses nothing;
  editing it directly is silently overwritten by the next rebuild.
- **Dedup by id happens at multiple independent layers**: `appendEvent` reverse-scan
  (`event_repository.ts:84-94`), `loadSessions`/`loadLastNSessions` `seenIds`,
  `rebuild_index` `by_id` map, migration `existing` set. Bypassing any one silently
  double-counts durations.
- **`ensureAfter` monotonicity** (`recovery.ts:13`): recovery timestamps forced
  `> lastTimestamp` (+1 ms), so appended events can't violate `validateTransition`'s
  strictly-increasing rule (`event.ts:272`).
- **Session legality throws in the constructor** (`session.ts:51` `ensureSingleSession`):
  first event `start`, nothing after `stop`, no duplicate consecutive types — immediate, not
  deferred.
- **Job identity is seed-derived**: `Job.create` throws on a mismatched caller-supplied id
  (`job.ts:79`). `Job.fromEventFields` bypasses validation and marks `partial: true`
  (`job.ts:186`) — partial Jobs must never be persisted to `jobs.json` (comment-enforced
  only; the type system won't stop you).


## Traps

- **The two session reconstructions deliberately diverge on malformed streams**: Node's
  `loadSessions` *finalizes* dangling sessions (`event_repository.ts:161`); the webview's
  `build_sessions_from_events` *drops* them (`dashboard.js:147`, comment at :267). Pinned by
  `malformed_streams.spec.ts:11-12`. Don't "fix" one to match the other without a decision.
- **JSONL padding is cosmetic but conventional**: pause/resume vs start/stop pad differently
  purely so the `id` column aligns for human eyeballs (`event.ts:179-190`). Hand-edits parse
  fine but break the alignment convention.
- **`write_file_atomic` silently degrades on Windows**: on `EPERM/EACCES/EBUSY` (AV/sync
  lock) it falls back to an in-place non-atomic write (`fs_utils.ts:52-76`) — torn-write risk
  under lock contention is real on Windows.
- **Sanitizing never rewrites disk**: `sanitize_lines` heals in memory only; on-disk repair
  is only the user-triggered Compact Log (`extension.ts:342-356`). Pause/resume-count
  imbalance alone is *not* "repairable damage" (`log_sanitizer.ts:32`) and gets no offer.
- **`registry.json` malformed = hard throw** (`registry_repository.ts:13-23`) — deliberate
  (losing repo paths would defeat index rebuild), and *unlike* the tolerant-by-default
  jobs/log/config loaders. Declines are per-machine, path-normalized case-insensitively on
  Windows (`registry.ts:21`), and do not travel with the repo.
- **Concurrent windows can race on `.timescope/config.json`** — writes are debounced by
  content-equality (`repo_jobs.ts:32`), not locked; multi-writer safety is #47's concern
  (`local_opt_in.ts:111`).
- **`.timescope` must be a directory**: a stray *file* named `.timescope` is guarded with a
  dedicated error in `enable_local_logging` (`local_opt_in.ts:76-78`).
- **Undeclared settings mirrors**: `timescope.global_jobs_path`/`global_log_path` are
  runtime-written display values, not declared contributions — config UIs may flag them.
- **`Job.equals` is identity-only** (`job.ts:163`) while `Event.toJSONL` emits the job
  *title* — after a rename, the same event id can serialize different `job` text until
  `renameJobInLogByJob` rewrites the log.
- **Issue numbers are the TODO convention**: no TODO/HACK/FIXME exist under `src/` —
  deferred work is inline `#NN` references (e.g. #43 edit-other-repos, #47 multi-writer).
- **`dashboard.js`'s `load_payload` allowlists DTO fields** (#15) — it copies named fields onto
  its in-memory event objects rather than spreading the DTO; a new payload field (e.g. the #15
  `source_repo_id`/`client`/`project`/`task_type` additions) silently disappears in the webview
  until added there explicitly. Check this whenever a controller payload gains a field.
- **Entity id minting must guard against hash collisions** (#15, `id_gen.ts`): the id space
  (5 base36 chars) is small enough that distinct seeds can collide. `mint_unique_id` salts and
  retries against a caller-supplied `is_taken` check — minting a fresh client/project/task-type
  id without it can silently reuse another entity's id.
- **`convert_legacy_job` is a full no-op on an unresolvable target** (#15, `task_types.ts`): if
  `target_task_type_id` doesn't exist in the registry, both the alias adoption *and* the repo-config
  pin are skipped — pinning anyway would leave a dangling pin pointing at nothing.
- **VS Code "New Window" from an EDH doesn't test the dev build**: see `ops.md`'s
  multi-instance rig section — use two real Extension Development Hosts, not New Window.


## Corrections (wrong turns kept on record — prevents repeat misdiagnoses)

*(none yet — scribe: when a diagnosis in a dev-log turned out wrong, add the one-line
correction here with the issue ref)*
