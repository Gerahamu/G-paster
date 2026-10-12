import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function readJsonArray(filePath: string): Promise<unknown[]> {
  let primaryError: unknown;
  try {
    const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (!Array.isArray(value)) throw new Error("Invalid local data format");
    return value;
  } catch (error) {
    primaryError = error;
  }

  try {
    const backup = await readFile(filePath + ".bak", "utf8");
    const value: unknown = JSON.parse(backup);
    if (!Array.isArray(value)) throw new Error("Invalid backup data format");
    if ((primaryError as NodeJS.ErrnoException).code !== "ENOENT") {
      await rename(filePath, filePath + `.corrupt-${Date.now()}`);
    }
    await writeFile(filePath + ".tmp", backup, "utf8");
    await rename(filePath + ".tmp", filePath);
    return value;
  } catch (backupError) {
    if ((primaryError as NodeJS.ErrnoException).code === "ENOENT" &&
        (backupError as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw primaryError;
  }
}

export async function writeJsonArray(filePath: string, value: unknown[]): Promise<void> {
  const snapshot = JSON.stringify(value);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath + ".bak.tmp", snapshot, "utf8");
  await rename(filePath + ".bak.tmp", filePath + ".bak");
  await writeFile(filePath + ".tmp", snapshot, "utf8");
  await rename(filePath + ".tmp", filePath);
}
