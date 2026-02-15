# TimeScope Record ID Specification


## 1. Overview

Each TimeScope record receives a deterministic, compact, human‑readable identifier:

<time5>-<bucket1>-<jobHash3>

This identifier is:

- Deterministic — identical inputs always produce identical IDs
- Stable — unaffected by job renames or timestamp edits
- Chronologically sortable — lexicographic sort = chronological order
- Compact — 10 characters including separators
- Human‑scannable — left = time, middle = sub‑second ordering, right = job grouping

---


## 2. Components

### 2.1 time5 — Base‑36 Timestamp
- Derived from timestamp_original, the timestamp assigned when the record was first created.
- Even if the visible timestamp is edited later, timestamp_original remains unchanged.
- Convert timestamp_original_seconds to base‑36.
- Represent using exactly 5 characters, left‑padded with 0 if needed.

Example:
1739582342 seconds → base36 → K3T2A

This provides ~25 years of unique seconds before rollover.

---

### 2.2 bucket1 — Monotonic Sub‑Second + Event Type Discriminator
Inputs:
- timestamp_original_ms (0–999)
- event_type (mapped to 0–3)

Event Type Mapping:
start  = 0
stop   = 1
pause  = 2
resume = 3

Bucket Calculation:
bucket = floor(timestamp_original_ms / 111)   // 0–8

Combine bucket + event type:
bucket1_value = bucket * 4 + event_type       // 0–35

Encode in base‑36:
bucket1 = base36(bucket1_value)               // 1 character

Properties:
- Monotonic with respect to time
- Event type is a secondary ordering key
- Fits in exactly one base‑36 character
- No hashing required
- Collisions only possible if user generates physically impossible events

---

### 2.3 jobHash3 — Stable Job Hash
Job Identity:
Each job has a permanent, immutable job_id stored in jobs.json:

{
  "job_id": "k3f9",
  "title": "Lantern - Speaker"
}

- job_id never changes
- title may change freely
- Records store both job_id and title, but only job_id affects the ID

Hashing:
- Compute a stable, deterministic hash of job_id (e.g., FNV‑1a 32‑bit).
- Convert hash to base‑36.
- Take the first 3 characters.

Example:
hash("k3f9") → 0xA93F12C4 → base36 → A9F12C4 → A9F

Properties:
- Stable across renames
- Stable across machines
- Stable across merges
- Not reversible
- Very compact

---


## 3. Final Record ID Format

<time5>-<bucket1>-<jobHash3>

Example:
K3T2A-4-A9F

Where:
- K3T2A → timestamp_original_seconds
- 4 → bucket (ms) + event type
- A9F → job hash

---


## 4. Session ID

A session is defined by its start event:

session_id = record_id_of_start_event

This value is stable forever.

---


## 5. Collision Behavior

A collision requires all of the following:

- same job
- same second
- same 111ms bucket
- same event type

This is effectively impossible for human‑generated logs and extremely unlikely for machine‑generated logs.

No additional collision handling is required.

---


## 6. Example IDs

Same job, same second, different ms:
K3T2A-4-A9F
K3T2A-5-A9F
K3T2A-6-A9F

Same second, different jobs:
K3T2A-4-A9F
K3T2A-4-B2K
K3T2A-4-C7X

Chronological progression:
K3T29-X-A9F
K3T2A-0-A9F
K3T2B-1-A9F
K3T2C-2-A9F

---


## 7. Summary of Guarantees

This Record ID scheme is:

- Deterministic
- Stable under edits
- Stable under job renames
- Compact (10 chars)
- Chronologically sortable
- Human‑readable
- Collision‑resistant
- Hash‑light (only jobHash3 uses hashing)
- Domain‑specific and ergonomic

It is designed for clarity, stability, and long‑term maintainability.
