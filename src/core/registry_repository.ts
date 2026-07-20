import * as fs from "fs";
import { write_file_atomic } from "../utils/fs_utils";
import { Registry } from "./registry";

/**
 * Loads/saves the global `registry.json`. The registry is a rebuildable cache,
 * but a malformed file throws rather than silently dropping known repos —
 * losing repo paths would defeat an index rebuild.
 */
export class RegistryRepository {
    constructor(private readonly registry_path: string) {}

    load(): Registry {
        if (!fs.existsSync(this.registry_path)) return Registry.empty();
        const raw = fs.readFileSync(this.registry_path, "utf8");
        let obj: unknown;
        try {
            obj = JSON.parse(raw);
        } catch (ex) {
            throw new Error(`Malformed registry at '${this.registry_path}': ${String(ex)}`);
        }
        return Registry.from_dto(obj);
    }

    save(registry: Registry): void {
        write_file_atomic(this.registry_path, JSON.stringify(registry.to_dto(), null, 2) + "\n");
    }

    /**
     * Intent-based read-modify-write: reload the registry fresh from disk, apply `mutate`
     * (an add/remove intent, not a whole-snapshot replace), then write the result — and
     * return it. Replaces whole-registry merge-on-write (#47 reviewer finding F1): a
     * union-of-snapshots approach can't represent *removals* (an undecline done by another
     * window would get unioned back in by a stale decline). Every registry writer should
     * route through this so each write only ever expresses its own intent against the
     * freshest disk state, never a stale snapshot of everything else.
     */
    update(mutate: (registry: Registry) => Registry): Registry {
        const current = this.load();
        const next = mutate(current);
        // Domain no-op idioms (e.g. Registry.add_declined already-declined) return the
        // same instance — skip the write so a no-op call never churns registry.json.
        if (next !== current) this.save(next);
        return next;
    }
}
