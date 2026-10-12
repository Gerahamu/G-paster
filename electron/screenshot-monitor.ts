import { execFileSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";

const SCREENSHOT_SCAN_INTERVAL_MS = 750;
const SCREENSHOT_STABLE_MS = 600;
const SUPPORTED_SCREENSHOT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"]);
const SCREENSHOT_PREFIX = /^(?:screenshot|screen[ _-]*shot|屏幕快照|屏幕截图|截屏|スクリーンショット|스크린샷)(?:[\s_-]|$)/i;

interface ScreenshotFile {
  path: string;
  signature: string;
  modifiedAt: number;
}

interface PendingScreenshot {
  signature: string;
  stableSince: number;
}

export function getMacScreenshotDirectories(desktopDirectory: string): string[] {
  const directories = new Set<string>();
  try {
    const configuredLocation = execFileSync(
      "defaults",
      ["read", "com.apple.screencapture", "location"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1_500 }
    ).trim();
    if (configuredLocation) {
      const expanded = configuredLocation.replace(/^~(?=\/|$)/, homedir());
      directories.add(resolve(expanded));
    }
  } catch {
    // macOS uses the Desktop when no custom screenshot location is configured.
  }
  directories.add(resolve(desktopDirectory));
  return [...directories];
}

export class ScreenshotMonitor {
  private readonly directories: string[];
  private readonly importScreenshot: (path: string) => Promise<void>;
  private readonly handled = new Map<string, string>();
  private readonly pending = new Map<string, PendingScreenshot>();
  private readonly startedAt = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private initialized = false;
  private scanning = false;
  private warnedAboutAccess = false;

  constructor(directories: string[], importScreenshot: (path: string) => Promise<void>) {
    this.directories = [...new Set(directories.map((directory) => resolve(directory)))];
    this.importScreenshot = importScreenshot;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.scan(), SCREENSHOT_SCAN_INTERVAL_MS);
    void this.scan();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const files = new Map<string, ScreenshotFile>();
      let accessError = false;

      for (const directory of this.directories) {
        try {
          const entries = await readdir(directory, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isFile() || !isScreenshotImage(entry.name)) continue;
            const path = join(directory, entry.name);
            try {
              const info = await stat(path);
              files.set(path, {
                path,
                modifiedAt: info.mtimeMs,
                signature: `${info.size}:${info.mtimeMs}:${info.ctimeMs}`
              });
            } catch {
              // A screenshot may be renamed or removed while the directory is scanned.
            }
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") accessError = true;
        }
      }

      if (accessError) {
        if (!this.warnedAboutAccess) {
          console.warn("G-paster cannot access a screenshot folder yet; it will retry.");
          this.warnedAboutAccess = true;
        }
        return;
      }
      this.warnedAboutAccess = false;

      const now = Date.now();
      if (!this.initialized) {
        for (const file of files.values()) {
          if (file.modifiedAt >= this.startedAt) {
            this.pending.set(file.path, { signature: file.signature, stableSince: now });
          } else {
            this.handled.set(file.path, file.signature);
          }
        }
        this.initialized = true;
        return;
      }

      const candidates: ScreenshotFile[] = [];
      for (const file of files.values()) {
        if (this.handled.get(file.path) === file.signature) continue;
        const pending = this.pending.get(file.path);
        if (!pending || pending.signature !== file.signature) {
          this.pending.set(file.path, { signature: file.signature, stableSince: now });
          continue;
        }
        if (now - pending.stableSince >= SCREENSHOT_STABLE_MS) candidates.push(file);
      }

      for (const file of candidates.sort((left, right) => left.modifiedAt - right.modifiedAt)) {
        try {
          await this.importScreenshot(file.path);
        } catch {
          console.error("G-paster could not import a screenshot file.");
        }
        this.handled.set(file.path, file.signature);
        this.pending.delete(file.path);
      }

      const currentPaths = new Set(files.keys());
      for (const path of this.handled.keys()) if (!currentPaths.has(path)) this.handled.delete(path);
      for (const path of this.pending.keys()) if (!currentPaths.has(path)) this.pending.delete(path);
    } finally {
      this.scanning = false;
    }
  }
}

function isScreenshotImage(fileName: string): boolean {
  return SCREENSHOT_PREFIX.test(fileName) && SUPPORTED_SCREENSHOT_EXTENSIONS.has(extname(fileName).toLowerCase());
}
