import * as fs from "fs";
import * as path from "path";

export async function ensure_directory_for_file(file_path: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(file_path), { recursive: true });
}