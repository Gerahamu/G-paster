import { execFileSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { FILE_OPERATION_TIMEOUT_MS } from "./image-limits";
import { withTimeout } from "./async-timeout";

const SCREENSHOT_SCAN_INTERVAL_MS = 750;
const SCREENSHOT_STABLE_MS = 600;
const SUPPORTED_SCREENSHOT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".heic", ".heif"]);
const SCREENSHOT_PREFIX = /^(?:screenshot|screen[ _-]*shot|屏幕快照|屏幕截图|截屏|スクリーンショット|스크린샷|bildschirmfoto|capture d[’']écran|captura de pantalla|schermata|captura de (?:tela|ecrã)|schermafbeelding|снимок экрана|знімок екрана|zrzut ekranu|snímek obrazovky|skärmavbild|skærmbillede|skjermbilde|kuvakaappaus|ekran resmi|képernyőkép|captură de ecran|στιγμιότυπο οθόνης|لقطة شاشة|צילום מסך|ภาพหน้าจอ|ảnh chụp màn hình|tangkapan layar)(?=[\s_\d-]|$)/i;
const CUSTOM_PREFIX_CACHE = new Map<string, RegExp>();

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

export function getMacScreenshotNamePrefix(): string {
  try {
    return execFileSync(
      "defaults",
      ["read", "com.apple.screencapture", "name"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1_500 }
    ).trim();
  } catch {
    return "";
  }
}

function customPrefixPattern(prefix: string): RegExp | null {
  const trimmed = prefix.trim();
  if (!trimmed) return null;
  const cached = CUSTOM_PREFIX_CACHE.get(trimmed);
  if (cached) return cached;
  try {
    const pattern = new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s_\\d-]|$)`, "i");
    CUSTOM_PREFIX_CACHE.set(trimmed, pattern);
    return pattern;
  } catch {
    return null;
  }
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
  private paused = false;
  private clearPauseDepth = 0;
  private importGeneration = 0;
  private ignoreThrough = 0;
  private readonly onIssue: (issue: string | null) => void;
  private readonly customPrefixPattern: RegExp | null;

  constructor(directories: string[], importScreenshot: (path: string) => Promise<void>, onIssue: (issue: string | null) => void = () => undefined, customPrefix = "") {
    this.directories = [...new Set(directories.map((directory) => resolve(directory)))];
    this.importScreenshot = importScreenshot;
    this.onIssue = onIssue;
    this.customPrefixPattern = customPrefixPattern(customPrefix);
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

  pauseForClear(): void {
    this.clearPauseDepth++;
    this.paused = true;
    this.importGeneration++;
  }

  resumeAfterClear(): void {
    if (this.clearPauseDepth === 0) return;
    this.clearPauseDepth--;
    if (this.clearPauseDepth > 0) return;
    this.ignoreThrough = Date.now();
    this.pending.clear();
    this.paused = false;
    this.importGeneration++;
  }

  async scanNow(): Promise<void> {
    if (this.scanning || this.paused) return;
    this.scanning = true;
    const importGeneration = this.importGeneration;
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
            if (!entry.isFile() || !isScreenshotImage(entry.name, this.customPrefixPattern)) continue;
            const path = join(directory, entry.name);
            try {
              const info = await withTimeout(stat(path), FILE_OPERATION_TIMEOUT_MS, "Screenshot file check timed out");
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
      if (this.paused || importGeneration !== this.importGeneration) return;

      const candidates: ScreenshotFile[] = [];
      for (const file of files.values()) {
        if (this.handled.get(file.path) === file.signature) continue;
        if (file.modifiedAt <= this.ignoreThrough) {
          this.handled.set(file.path, file.signature);
          this.pending.delete(file.path);
          continue;
        }
        const pending = this.pending.get(file.path);
        if (!pending || pending.signature !== file.signature) {
          this.pending.set(file.path, { signature: file.signature, stableSince: now });
          continue;
        }
        if (now - pending.stableSince >= SCREENSHOT_STABLE_MS && now >= (pending.retryAt ?? 0)) candidates.push(file);
      }

      let importError = false;
      for (const file of candidates.sort((left, right) => left.modifiedAt - right.modifiedAt)) {
        if (this.paused || importGeneration !== this.importGeneration) break;
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

export function isScreenshotImage(fileName: string, customPrefix: RegExp | null = null): boolean {
  return SUPPORTED_SCREENSHOT_EXTENSIONS.has(extname(fileName).toLowerCase()) &&
    (SCREENSHOT_PREFIX.test(fileName) || Boolean(customPrefix?.test(fileName)));
}
