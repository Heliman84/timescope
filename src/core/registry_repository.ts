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
}
