import * as assert from "assert";
import { compute_seeded_id, mint_unique_id } from "../core/id_gen";

/**
 * Tests mint_unique_id:
 * - Target: mint_unique_id in src/core/id_gen.ts
 * - What: deterministic seed-derived id, re-seeded with a salt/counter when the
 *   caller reports the first candidate already taken (a hash collision with a
 *   different, unrelated entity — see reviewer finding A on #15).
 * - Why: compute_seeded_id truncates a 32-bit hash to 5 base36 chars, so distinct
 *   seeds can collide; minting for a brand-new entity must not silently reuse
 *   another entity's id.
 */
export function run_mint_unique_id_tests(): void {
    // No collision: same as compute_seeded_id.
    const plain = mint_unique_id("Acme", 5, () => false);
    assert.strictEqual(plain, compute_seeded_id("Acme", 5), "no collision → plain seeded id");

    // Collision on the first candidate → re-seeds deterministically to a different id.
    const first_candidate = compute_seeded_id("Acme", 5);
    const taken = new Set([first_candidate]);
    const resolved = mint_unique_id("Acme", 5, id => taken.has(id));
    assert.notStrictEqual(resolved, first_candidate, "colliding candidate is not reused");
    assert.ok(resolved.length === 5, "disambiguated id keeps the requested length");

    // Deterministic: the same collision state always resolves to the same id.
    const resolved_again = mint_unique_id("Acme", 5, id => taken.has(id));
    assert.strictEqual(resolved, resolved_again, "disambiguation is deterministic given the same is_taken");

    // Multiple collisions in a row are each tried and skipped.
    let calls = 0;
    const always_taken_twice = mint_unique_id("Acme", 5, () => (calls++ < 2));
    assert.ok(always_taken_twice.length === 5, "resolves after multiple collisions");
    assert.ok(calls >= 2, "is_taken consulted for each attempt");
}
