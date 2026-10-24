import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function parseJson(value: string): unknown {
  try { return JSON.parse(value); }
  catch { throw new Error("Invalid local JSON data"); }
}

export interface ReadJsonArrayOptions {
  /** Preserve irrecoverably corrupt files and let the store start empty. */
  recoverCorrupt?: boolean;
}

const corruptionEvents: string[] = [];

export function consumeCorruptionEvents(): string[] {
  return corruptionEvents.splice(0);
}

function isFormatError(error: unknown): boolean {
  return error instanceof Error && (
    error.message === "Invalid local JSON data" ||
    error.message === "Invalid local data format" ||
    error.message === "Invalid backup data format"
  );
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

async function preserveCorruptFile(filePath: string, suffix: string): Promise<void> {
  const stamp = Date.now();
  const target = `${filePath}.${suffix}.corrupt-${stamp}`;
  try {
    await rename(filePath, target);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

export async function readJsonArray(filePath: string, options: ReadJsonArrayOptions = {}): Promise<unknown[]> {
  let primaryError: unknown;
  try {
    const value = parseJson(await readFile(filePath, "utf8"));
    if (!Array.isArray(value)) throw new Error("Invalid local data format");
    return value;
  } catch (error) {
    primaryError = error;
  }

  try {
    const backup = await readFile(filePath + ".bak", "utf8");
    const value = parseJson(backup);
    if (!Array.isArray(value)) throw new Error("Invalid backup data format");
    if (!isMissing(primaryError)) {
      await preserveCorruptFile(filePath, "primary");
    }
    await writeFile(filePath + ".tmp", backup, "utf8");
    await rename(filePath + ".tmp", filePath);
    return value;
  } catch (backupError) {
    if (isMissing(primaryError) && isMissing(backupError)) return [];
    if (options.recoverCorrupt &&
        (isMissing(primaryError) || isFormatError(primaryError)) &&
        (isMissing(backupError) || isFormatError(backupError))) {
      await preserveCorruptFile(filePath, "primary");
      await preserveCorruptFile(filePath + ".bak", "backup");
      corruptionEvents.push(filePath);
      console.error("Local JSON data was corrupt and preserved; starting with empty data.");
      return [];
    }
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
