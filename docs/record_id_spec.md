# TimeScope Record ID Specification


## 1. Event Record ID Specification

Each TimeScope event record receives a deterministic, compact, human‑readable identifier of 9 characters (11 total):

<time5>-<bucket1>-<jobHash3>

This identifier is:

- Deterministic — identical inputs always produce identical IDs
- Stable — unaffected by job renames or timestamp edits
- Chronologically sortable — lexicographic sort = chronological order
- Compact — 11 characters including separators
- Human‑scannable — left = time, middle = sub‑second ordering, right = job grouping

---

### 2. Components

#### 2.1 time5 — Base‑36 Timestamp
- Derived from timestamp_original, the timestamp assigned when the record was first created.
- Even if the visible timestamp is edited later, timestamp_original remains unchanged.
- Convert timestamp_original_seconds to base‑36.
- Represent using exactly 5 characters, left‑padded with 0 if needed.

Example:
1739582342 seconds → base36 → k3t2a

This provides ~19 years of unique seconds before rollover.

---

#### 2.2 bucket1 — Monotonic Sub‑Second + Event Type Discriminator
Inputs:
- timestamp_original_ms (0–999)
- event_type (mapped to 0–3)

Event Type Mapping:
start  = 0
pause  = 1
resume = 2
stop   = 3

Bucket Calculation:
bucket = floor(timestamp_original_ms / 111)   // 0–8
** edge case: 999ms is in bucket 8, not bucket 9 ***

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

#### 2.3 jobHash3 — Stable Job Hash
Job Identity:
Each job has a permanent, immutable job_id stored in jobs.json:

{
  "job_id": "k3f9g",
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
hash("k3f9g") → 0xA93F12C4 → base36 → a9f12c4 → a9f

Properties:
- Stable across renames
- Stable across machines
- Stable across merges
- Not reversible
- Very compact

---

### 3. Final Record ID Format

<time5>-<bucket1>-<jobHash3>

Example:
k3t2a-4-a9f

Where:
- k3t2a → timestamp_original_seconds
- 4 → bucket (ms) + event type -- 4 means bucket 1 (111–221ms) + event type 0 (start)
- a9f → job hash

---

### 4. Session ID

A session is defined by its start event:

session_id = record_id_of_start_event

This value is stable forever.

---

### 5. Collision Behavior

A collision requires all of the following:

- same job
- same second (within any 19‑year bucket)
- same 111ms bucket
- same event type

This is effectively impossible for human‑generated logs and extremely unlikely for machine‑generated logs.

No additional collision handling is required.

---

### 6. Example IDs

Same job, same second, different ms:
k3t2a-4-a9f
k3t2a-5-a9f
k3t2a-6-a9f

Same second, different jobs:
k3t2a-4-a9f
k3t2a-4-b2k
k3t2a-4-c7x

Chronological progression:
k3t29-x-a9f
k3t2a-0-a9f
k3t2b-1-a9f
k3t2c-2-a9f

---


### 7. Summary of Guarantees

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


## 8. Job ID Specification

Each job in TimeScope receives a permanent, immutable identifier:

job_id = <job5>

This identifier is:

- Deterministic — identical seed titles always produce identical IDs  
- Stable — unaffected by renames or edits  
- Compact — 5 characters, base‑36 lowercase  
- Human‑readable — short, scannable, visually distinct  
- Machine‑friendly — safe for filenames, URLs, and sorting  

The job_id is created once and never changes.

---

### 8.1 Identity Input

A job’s identity is defined solely by its original title:

seed_title — the title at the moment the job is created

This value is stored permanently and never modified.  
The visible `title` field may change freely without affecting job_id.

---

### 8.2 Hashing

Compute a stable 32‑bit hash of:

hash_input = seed_title

Use FNV‑1a 32‑bit (or any deterministic, platform‑independent hash).

Convert the hash to base‑36 **lowercase**.

Take the first 5 characters:

job5 = base36_lower(hash) [0..4]

Example:

hash("Lantern - Speaker") → 0xA93F12C4  
base36_lower → a9f12c4  
job_id = a9f12

---

### 8.3 Properties

- Stable across renames  
- Stable across machines  
- Stable across merges  
- Not reversible  
- Collision‑resistant for all practical purposes  
- Minimal identity semantics (title‑only)  
- Future‑proof — additional identity inputs may be added later without breaking existing IDs

---

## Related Documentation

| Document | Description |
| :--- | :--- |
| [Record Format Specification](record_format_spec.md) | On-disk format for `jobs.json` and `logs.jsonl` |
| [Architecture & Processes](processes.md) | Runtime processes, state machine, and data flow |
| [DEVELOPMENT.md](../DEVELOPMENT.md) | Build, test, feature & release workflow |
| [README.md](../README.md) | User-facing overview, commands, settings |
