/**
 * Canonical on-disk Job record shape (DTO).
 * This interface follows `record_format_spec.md` exactly.
 */
export interface JobDTO {
  job_id: string;        // stable, immutable id (short base36 lowercase)
  job_title: string;     // human-friendly title (mutable)
  is_archived?: boolean; // optional; default false
  created: number;       // Unix time in milliseconds since epoch (creation time)
  last_modified?: number;// Unix ms; last time title/metadata changed
  job_seed: string;      // the original `job_title` used to create `job_id`
}
