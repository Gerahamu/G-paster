import { execFile as execFileCallback, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setPriority } from "node:os";
import { promisify } from "node:util";
import { app, type Rectangle } from "electron";
import { OperationTimeoutError } from "./async-timeout";
import type { RecognizeImage } from "./ocr-index";

const execFile = promisify(execFileCallback);
const timeout = 25_000;
type Language = "en" | "zh";

export class OcrError extends Error {
  constructor(readonly code: "ocr-language" | "ocr-access" | "ocr-failed", cause?: unknown) {
    super(code, { cause });
  }
}

const macExecutable = () => app.isPackaged ? join(process.resourcesPath, "gpaster-ocr") : join(app.getAppPath(), "work", "gpaster-ocr");
const windowsScript = () => join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "assets"), "windows", "capture-tools.ps1");

async function runWindows(args: string[], timeoutMs: number, signal?: AbortSignal, background = false): Promise<string> {
  const powershell = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  try {
    const options = { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024, signal };
    // Process-local execution policy for the app's bundled script. Domain policy still applies.
    const request = execFile(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", windowsScript(), ...args], options);
    if (background && request.child.pid) {
      try { setPriority(request.child.pid, 10); } catch { /* Scheduling is best effort. */ }
    }
    return (await request).stdout;
  } catch (error) {
    if ((error as { killed?: boolean }).killed && !signal?.aborted) throw new OperationTimeoutError("Windows capture helper timed out");
    throw error;
  }
}

function runMac(path: string, signal: AbortSignal | undefined, background: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const executable = macExecutable();
    const child = spawn(background ? "/usr/bin/nice" : executable, background ? ["-n", "10", executable] : [],
      { signal, stdio: ["pipe", "pipe", "ignore"] });
    let output = "";
    const timer = setTimeout(() => { reject(new OperationTimeoutError("Text recognition timed out")); child.kill(); }, timeout);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 1_000_000) child.kill();
    });
    child.once("error", reject);
    child.once("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new OcrError("ocr-failed"));
    });
    child.stdin.on("error", reject);
    child.stdin.end(JSON.stringify({ path }) + "\n");
  });
}

export function createRecognizer(language: () => Language): RecognizeImage | undefined {
  if (process.platform !== "win32" && (process.platform !== "darwin" || !existsSync(macExecutable()))) return;
  return async (path, signal, background = false) => {
    try {
      const stdout = process.platform === "win32"
        ? await runWindows(["-Operation", "ocr", "-ImagePath", path, "-Language", language()], timeout, signal, background)
        : await runMac(path, signal, background);
      const result = JSON.parse(stdout) as { text?: unknown; error?: unknown };
      if (result.error === "ocr-language" || result.error === "ocr-access") throw new OcrError(result.error);
      if (typeof result.text !== "string") throw new OcrError("ocr-failed");
      return result.text.slice(0, 100_000);
    } catch (error) {
      if (error instanceof OcrError || error instanceof OperationTimeoutError || signal?.aborted) throw error;
      throw new OcrError("ocr-failed", error);
    }
  };
}

export async function listCaptureWindows(): Promise<Rectangle[]> {
  try {
    const stdout = process.platform === "win32" ? await runWindows(["-Operation", "windows"], 3_500)
      : (await execFile(macExecutable(), ["--list-windows"], { timeout: 1_500, maxBuffer: 256 * 1024 })).stdout;
    const rectangles: unknown = JSON.parse(stdout);
    if (Array.isArray(rectangles)) return rectangles.filter((rect): rect is Rectangle => !!rect &&
      [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0);
  } catch { console.warn("Region capture: window geometry unavailable; manual selection remains available."); }
  return [];
}
