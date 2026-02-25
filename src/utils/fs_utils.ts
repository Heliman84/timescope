import * as fs from "fs";
import * as path from "path";

export async function ensure_directory_for_file(file_path: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(file_path), { recursive: true });
}


export async function ensureDirExists(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
    }
}

export function readJSONLSafe(filePath: string | undefined | null): string[] {
    if (!filePath || !fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    return raw
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 0);
}


export async function readJSONSafe(filePath: string | undefined | null): Promise<string | null> {
    if (!filePath) return null;
    try {
        if (!fs.existsSync(filePath)) return null;
        return await fs.promises.readFile(filePath, "utf8");
    } catch (ex) {
        throw new Error(`Failed to read JSON file at '${filePath}': ${String(ex)}`);
    }
}