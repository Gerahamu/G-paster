import { execFileSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";

const SCREENSHOT_SCAN_INTERVAL_MS = 750;
const SCREENSHOT_STABLE_MS = 600;
const SUPPORTED_SCREENSHOT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".heic", ".heif"]);
const SCREENSHOT_PREFIX = /^(?:screenshot|screen[ _-]*shot|屏幕快照|屏幕截图|截屏|スクリーンショット|스크린샷)(?=[\s_\d-]|$)/i;

interface ScreenshotFile {
  path: string;
  signature: string;
  modifiedAt: number;
}

interface PendingScreenshot {
  signature: string;
  stableSince: number;
  retryAt?: number;
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
  private readonly initializedDirectories = new Set<string>();
  private scanning = false;
  private readonly onIssue: (issue: string | null) => void;

  constructor(directories: string[], importScreenshot: (path: string) => Promise<void>, onIssue: (issue: string | null) => void = () => undefined) {
    this.directories = [...new Set(directories.map((directory) => resolve(directory)))];
    this.importScreenshot = importScreenshot;
    this.onIssue = onIssue;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.scanNow(), SCREENSHOT_SCAN_INTERVAL_MS);
    void this.scanNow();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async scanNow(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const files = new Map<string, ScreenshotFile>();
      const scannedDirectories = new Set<string>();
      let accessError = false;

      for (const directory of this.directories) {
        try {
          const entries = await readdir(directory, { withFileTypes: true });
          scannedDirectories.add(directory);
          const firstScan = !this.initializedDirectories.has(directory);
          for (const entry of entries) {
            if (!entry.isFile() || !isScreenshotImage(entry.name)) continue;
            const path = join(directory, entry.name);
            try {
              const info = await stat(path);
              const file = {
                path,
                modifiedAt: info.mtimeMs,
                signature: `${info.size}:${info.mtimeMs}:${info.ctimeMs}`
              };
              files.set(path, file);
              if (firstScan && file.modifiedAt < this.startedAt) this.handled.set(path, file.signature);
            } catch {
              // A screenshot may be renamed or removed while the directory is scanned.
            }
          }
          this.initializedDirectories.add(directory);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") accessError = true;
        }
      }

      const now = Date.now();

      const candidates: ScreenshotFile[] = [];
      for (const file of files.values()) {
        if (this.handled.get(file.path) === file.signature) continue;
        const pending = this.pending.get(file.path);
        if (!pending || pending.signature !== file.signature) {
          this.pending.set(file.path, { signature: file.signature, stableSince: now });
          continue;
        }
        if (now - pending.stableSince >= SCREENSHOT_STABLE_MS && now >= (pending.retryAt ?? 0)) candidates.push(file);
      }

      let importError = false;
      for (const file of candidates.sort((left, right) => left.modifiedAt - right.modifiedAt)) {
        try {
          await this.importScreenshot(file.path);
          this.handled.set(file.path, file.signature);
          this.pending.delete(file.path);
        } catch {
          importError = true;
          const pending = this.pending.get(file.path);
          if (pending) pending.retryAt = now + 5_000;
        }
      }
      const waitingRetry = [...this.pending.values()].some((pending) => pending.retryAt !== undefined);
      this.onIssue(accessError
        ? "无法访问部分截图目录。请在系统设置 → 隐私与安全性 → 文件与文件夹中允许 G-paster 访问截图所在目录。"
        : importError || waitingRetry ? "部分截图导入失败，正在重试。请检查图片格式及本地存储权限。" : null);

      const currentPaths = new Set(files.keys());
      for (const path of this.handled.keys()) if (scannedDirectories.has(dirname(path)) && !currentPaths.has(path)) this.handled.delete(path);
      for (const path of this.pending.keys()) if (scannedDirectories.has(dirname(path)) && !currentPaths.has(path)) this.pending.delete(path);
    } finally {
      this.scanning = false;
    }
  }
}

export function isScreenshotImage(fileName: string): boolean {
  return SCREENSHOT_PREFIX.test(fileName) && SUPPORTED_SCREENSHOT_EXTENSIONS.has(extname(fileName).toLowerCase());
}
