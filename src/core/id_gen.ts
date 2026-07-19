// FNV-1a 32-bit, deterministic and platform-independent over UTF-16 code units.
// Shared by Job identity (job.ts) and registry entity identity (registry.ts) —
// #15 mints client/project/task-type ids with the same scheme as job ids.
function fnv1a32(str: string): number {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/** Deterministic, seed-derived id: FNV-1a 32-bit of `seed`, base36, padded/truncated to `length`. */
export function compute_seeded_id(seed: string, length = 5): string {
    const hash32 = fnv1a32(seed);
    const base36 = (hash32 >>> 0).toString(36).toLowerCase();
    return base36.padStart(length, "0").slice(0, length);
}
