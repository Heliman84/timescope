# TimeScope — Orphan Session Repair Report

| Field | Value |
|-------|-------|
| Date | 2026-02-20 16:22:08 -05:00 |
| Input | `R:\vscode_customizations\timescope\test-workspace\.timescope\logs.jsonl` |
| Format | v2 |

## Summary

| Metric | Count |
|--------|------:|
| Original events | 44 |
| Synthetic events inserted | 5 |
| Total events (output) | 49 |
| Sessions (output) | 17 |
| Repairs performed | 5 |
| Jobs affected | 5 of 11 |

## Repairs

### #1  bad_job3  `fsai1`

| | |
|---|---|
| **Problem** | stop event with no open session (state: idle) |
| **Trigger** | line 11 (`stop` at 1969-12-31 19:00:00 -05:00) |
| **State** | idle (last event: N/A) |

| Inserted | Timestamp |
|----------|-----------|
| `start` | 2026-02-01 21:18:51 -05:00 (1769998731862) |

### #2  bad_job1  `f8ban`

| | |
|---|---|
| **Problem** | Open session at end of file (state: running) |
| **Trigger** | EOF |
| **State** | running (last event: 2026-01-08 16:04:52 -05:00) |

| Inserted | Timestamp |
|----------|-----------|
| `stop` | 2026-01-08 16:04:53 -05:00 (1767906293338) |

### #3  bad_job4  `duda6`

| | |
|---|---|
| **Problem** | Open session at end of file (state: running) |
| **Trigger** | EOF |
| **State** | running (last event: 2026-02-02 09:03:08 -05:00) |

| Inserted | Timestamp |
|----------|-----------|
| `stop` | 2026-02-02 09:03:09 -05:00 (1770040989301) |

### #4  bad_job5  `e4cvv`

| | |
|---|---|
| **Problem** | Open session at end of file (state: running) |
| **Trigger** | EOF |
| **State** | running (last event: 2026-02-02 18:42:41 -05:00) |

| Inserted | Timestamp |
|----------|-----------|
| `stop` | 2026-02-02 18:42:42 -05:00 (1770075762282) |

### #5  bad_job6  `eechk`

| | |
|---|---|
| **Problem** | Open session at end of file (state: running) |
| **Trigger** | EOF |
| **State** | running (last event: 2026-02-02 18:42:41 -05:00) |

| Inserted | Timestamp |
|----------|-----------|
| `stop` | 2026-02-02 18:42:42 -05:00 (1770075762282) |

