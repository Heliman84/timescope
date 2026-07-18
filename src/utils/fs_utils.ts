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

/** Synchronous parent-directory ensure, for the sync write paths. */
export function ensure_dir_sync(file_path: string): void {
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
}

/**
 * Append one line to a JSONL file, guaranteeing it lands on its own line:
 * if the file's last byte is not "\n" (torn earlier write), a newline is
 * injected first. Closes the concatenated-records bug class permanently.
 */
export function append_line_safe(file_path: string, line: string): void {
    ensure_dir_sync(file_path);
    if (!fs.existsSync(file_path)) {
        fs.writeFileSync(file_path, line + "\n", "utf8");
        return;
    }
    let needs_newline = false;
    const stat = fs.statSync(file_path);
    if (stat.size > 0) {
        const fd = fs.openSync(file_path, "r");
        try {
            const buf = Buffer.alloc(1);
            fs.readSync(fd, buf, 0, 1, stat.size - 1);
            needs_newline = buf.toString("utf8") !== "\n";
        } finally {
            fs.closeSync(fd);
        }
    }
    fs.appendFileSync(file_path, (needs_newline ? "\n" : "") + line + "\n", "utf8");
}

/**
 * Replace a file's contents via temp-file + atomic rename so a crash
 * mid-write can never tear the target. The temp file lives in the same
 * directory (same volume) so the rename is atomic.
 */
export function write_file_atomic(file_path: string, content: string): void {
    ensure_dir_sync(file_path);
    const dir = path.dirname(file_path);
    const tmp = path.join(dir, `.${path.basename(file_path)}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, content, "utf8");
    try {
        fs.renameSync(tmp, file_path);
    } catch (ex) {
        // Windows: renaming over a file another process holds open (sync
        // client, AV, indexer) throws a lock-style error. Fall back to an
        // in-place write for those, so we succeed where the old code did.
        // Any other error (bad path, out of space, real permission problem)
        // is a genuine failure — clean up the temp file and rethrow.
        const code = (ex as NodeJS.ErrnoException).code;
        if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") {
            try { fs.unlinkSync(tmp); } catch { /* best effort cleanup */ }
            throw ex;
        }
        try {
            fs.writeFileSync(file_path, content, "utf8");
        } finally {
            try { fs.unlinkSync(tmp); } catch { /* best effort cleanup */ }
        }
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