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

/**
 * Mint a seed-derived id, disambiguating deterministically when `is_taken` reports the
 * candidate already belongs to a *different* entity (a hash collision — `length` base36
 * chars is a small space, so distinct seeds can collide). Re-seeds with a `#<attempt>`
 * salt and retries until a free candidate is found. Deterministic: the same seed against
 * the same `is_taken` state always resolves to the same id (#15 reviewer finding A —
 * minting for a brand-new entity must not silently reuse another entity's id).
 */
export function mint_unique_id(seed: string, length: number, is_taken: (id: string) => boolean): string {
    let candidate = compute_seeded_id(seed, length);
    let attempt = 1;
    while (is_taken(candidate)) {
        candidate = compute_seeded_id(`${seed}#${attempt}`, length);
        attempt++;
    }
    return candidate;
}
