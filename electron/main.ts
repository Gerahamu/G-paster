import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from "electron";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppPreferences, CaptureIssue, ClipboardHistoryItem, ClipboardImageEntry, QuickPhraseDraft, QuickPhraseUpdate, SystemSettings } from "../src/shared/contracts";
import { HistoryStore } from "./history-store";
import { ImageStore, type StoredImage } from "./image-store";
import { Preferences } from "./preferences";
import { PhraseStore } from "./phrase-store";
import { getMacScreenshotDirectories, getMacScreenshotNamePrefix, ScreenshotMonitor } from "./screenshot-monitor";
import { getDevServerOrigin, isTrustedPageUrl, type TrustedOriginPolicy } from "./trusted-origin";
import { decodeImageBuffer } from "./image-codec";
import { hasClipboardImagePayload, isClipboardImageFilePath, readClipboardItems, readImageItems } from "./clipboard-images";
import { ClipboardFormatRead, ClipboardPollingTimer } from "./clipboard-monitor";
import { fileReferenceKey, fileUriList, imageFileReferenceKey, isFileClipboardType, isNativeFileUrlType, NATIVE_FILE_URL, readFileItems } from "./clipboard-files";
import { FileStore, type StoredFileEntry } from "./file-store";
import { FileImages } from "./file-images";
import { readImageFile } from "./image-limits";
import { readSystemSettings } from "./system-settings";
import { consumeCorruptionEvents } from "./atomic-json";
import { translate, type TranslationKey } from "../src/shared/i18n";

const APP_NAME = "G-paster";
const GLOBAL_SHORTCUT = process.platform === "darwin" ? "Control+C" : "Control+Shift+G";
const CLIPBOARD_POLL_MS = 180;
const IMAGE_PAYLOAD_PROBE_MS = 750;
const MAX_CLIPBOARD_TEXT_LENGTH = 2_000_000;
const CLIPBOARD_READ_TIMEOUT_MS = 1_500;
const CLIPBOARD_IMAGE_FILE_RETRY_MS = 3_000;
const BROKEN_IMAGE_PREVIEW = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' fill='%23f0f2f5'/%3E%3Cpath d='M24 30l48 36M72 30L24 66' stroke='%23a5a7b1' stroke-width='4'/%3E%3C/svg%3E";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let historyStore: HistoryStore;
let imageStore: ImageStore;
let phraseStore: PhraseStore;
let fileStore: FileStore;
let fileImages: FileImages;
let screenshotMonitor: ScreenshotMonitor | null = null;
let lastClipboardText = "";
let nextTextPollAt = 0;
let nextImagePollAt = 0;
let lastClipboardImageHash = "";
let lastClipboardFileKey = "";
let lastClipboardImageFileKey = "";
let nextClipboardImageFileRetryAt = 0;
let lastClipboardFormatSignature = "";
let nextImagePayloadProbeAt = 0;
let historyLimitQueue: Promise<void> = Promise.resolve();
let isQuitting = false;
let isNativeDialogOpen = false;
let isPolling = false;
let isPollingImage = false;
let imageCaptureGeneration = 0;
let clipboardWriteGeneration = 0;
let imageCapturePauseDepth = 0;
let historyPublishGeneration = 0;
const imagePreviewCache = new Map<string, { hash: string; dataUrl: string }>();
const captureIssues = new Map<CaptureIssue["source"], CaptureIssue>();
let currentSystemSettings: SystemSettings | null = null;
let rendererFailureDialogOpen = false;

async function readClipboardCaptureSnapshot(
  items: Awaited<ReturnType<typeof readClipboardItems>>,
  previousImageHash: string,
  previousImageFileKey: string,
  previousImageFileRetryAt: number
): Promise<{
  image: Awaited<ReturnType<typeof readImageItems>>;
  files: Awaited<ReturnType<typeof readFileItems>>;
  imageFileKey: string;
  imageFileRetryAt: number;
}> {
  const hasNativeFileUrl = items.some(item => item.types.some(isNativeFileUrlType));
  if (hasClipboardImagePayload(items)) {
    try {
      const image = await readImageItems(items, previousImageHash, decodeImageBuffer, false);
      if (image) return { image, files: null, imageFileKey: "", imageFileRetryAt: 0 };
    } catch (error) {
      const files = await readFileItems(items);
      if (files) {
        if (hasNativeFileUrl) return { image: null, files, imageFileKey: "", imageFileRetryAt: 0 };
        if (files.paths.length === 1 && isClipboardImageFilePath(files.paths[0])) {
          const imageFileKey = await imageFileReferenceKey(files.paths[0], files.key);
          if (imageFileKey === previousImageFileKey) {
            if (previousImageHash) return { image: { hash: previousImageHash }, files: null, imageFileKey, imageFileRetryAt: 0 };
            if (Date.now() < previousImageFileRetryAt) return { image: null, files, imageFileKey, imageFileRetryAt: previousImageFileRetryAt };
          }
          try {
            const image = await readImageItems(items, previousImageHash, decodeImageBuffer);
            if (image) return { image, files: null, imageFileKey, imageFileRetryAt: 0 };
          } catch { /* Keep the file reference if neither bitmap nor source path is readable. */ }
          return { image: null, files, imageFileKey, imageFileRetryAt: Date.now() + CLIPBOARD_IMAGE_FILE_RETRY_MS };
        }
        return { image: null, files, imageFileKey: "", imageFileRetryAt: 0 };
      }
      throw error;
    }
  }

  const files = await readFileItems(items);
  if (!files) return { image: null, files: null, imageFileKey: "", imageFileRetryAt: 0 };
  if (hasNativeFileUrl) return { image: null, files, imageFileKey: "", imageFileRetryAt: 0 };
  if (files.paths.length !== 1 || !isClipboardImageFilePath(files.paths[0])) {
    return { image: null, files, imageFileKey: "", imageFileRetryAt: 0 };
  }

  // Path identity alone misses a replacement at the same location. A stat-based
  // fingerprint detects edits without reopening image bytes on every poll.
  const imageFileKey = await imageFileReferenceKey(files.paths[0], files.key);
  if (imageFileKey === previousImageFileKey) {
    if (previousImageHash) return { image: { hash: previousImageHash }, files: null, imageFileKey, imageFileRetryAt: 0 };
    if (Date.now() < previousImageFileRetryAt) return { image: null, files, imageFileKey, imageFileRetryAt: previousImageFileRetryAt };
  }
  try {
    const image = await readImageItems(items, previousImageHash, decodeImageBuffer);
    if (image) return { image, files: null, imageFileKey, imageFileRetryAt: 0 };
  } catch {
    // If the source path has already disappeared, retain the file reference.
  }
  return { image: null, files, imageFileKey, imageFileRetryAt: Date.now() + CLIPBOARD_IMAGE_FILE_RETRY_MS };
}
let preferences: Preferences;
let isShortcutRecording = false;
const clipboardPollingTimer = new ClipboardPollingTimer(CLIPBOARD_POLL_MS, () => { void pollClipboard(); });

function loginItemOptions(): Electron.LoginItemSettingsOptions {
  return process.platform === "win32" ? { path: process.execPath, args: ["--gpaster-background"] } : {};
}

function setShortcutRecording(recording: boolean): void {
  isShortcutRecording = recording;
  globalShortcut.setSuspended(recording);
}

function readPreferences(): AppPreferences {
  const loginSupported = app.isPackaged && (process.platform === "darwin" || process.platform === "win32");
  let loginStatus: AppPreferences["loginStatus"] = loginSupported ? "disabled" : "unavailable";
  let openAtLogin = false;
  if (loginSupported) {
    try {
      const login = app.getLoginItemSettings(loginItemOptions());
      openAtLogin = login.openAtLogin;
      loginStatus = login.status === "requires-approval" ? "requires-approval" : openAtLogin ? "enabled" : "disabled";
    } catch { loginStatus = "unavailable"; }
  }
  return { shortcut: preferences.shortcut, defaultShortcut: preferences.defaultShortcut, shortcutRegistered: preferences.registered,
    loginSupported, openAtLogin, loginStatus,
    version: app.getVersion(), ...preferences.options };
}

function refreshSystemSettings(): SystemSettings {
  const next = readSystemSettings(preferences?.options.language);
  const changed = next.language !== currentSystemSettings?.language || next.locale !== currentSystemSettings?.locale;
  currentSystemSettings = next;
  if (changed) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("system:settings-changed", next);
    updateTrayMenu();
  }
  return next;
}

function nativeText(key: TranslationKey): string {
  return translate((currentSystemSettings ?? readSystemSettings(preferences?.options.language)).language, key);
}

function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? "#171a1f" : "#e6ebf2";
}

function reportCaptureIssue(source: CaptureIssue["source"], message: string | null): void {
  if ((captureIssues.get(source)?.message ?? null) === message) return;
  if (message) captureIssues.set(source, { source, message });
  else captureIssues.delete(source);
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isCrashed()) {
    mainWindow.webContents.send("capture:issues-changed", [...captureIssues.values()]);
  }
}

function rememberClipboardText(value: string): void {
  lastClipboardText = value.length <= MAX_CLIPBOARD_TEXT_LENGTH ? value : "";
  nextTextPollAt = value.length <= MAX_CLIPBOARD_TEXT_LENGTH ? 0 : Date.now() + 1_000;
}

function isWebUrl(value: string): boolean {
  try {
    const protocol = new URL(value.trim()).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch { return false; }
}

async function withClipboardReadTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Clipboard read timed out")), CLIPBOARD_READ_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

app.setName(APP_NAME);
if (!app.isPackaged && process.env.GPASTER_DEV_USER_DATA) {
  app.setPath("userData", process.env.GPASTER_DEV_USER_DATA);
}
app.setAppUserModelId("com.gpaster.desktop");
nativeTheme.themeSource = "system";
nativeTheme.on("updated", () => {
  if (!app.isReady()) return;
  refreshSystemSettings();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(windowBackground());
});

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  refreshSystemSettings();
  const wasVisible = mainWindow.isVisible();
  if (!wasVisible) {
    const bounds = mainWindow.getBounds();
    const onScreen = screen.getAllDisplays().some(({ workArea }) =>
      bounds.x < workArea.x + workArea.width && bounds.x + bounds.width > workArea.x &&
      bounds.y < workArea.y + workArea.height && bounds.y + bounds.height > workArea.y
    );
    if (!onScreen) {
      const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      mainWindow.setPosition(
        Math.round(workArea.x + (workArea.width - bounds.width) / 2),
        Math.round(workArea.y + Math.min(90, Math.max(0, workArea.height - bounds.height)))
      );
    }
  }
  mainWindow.show();
  mainWindow.focus();
  if (!wasVisible) mainWindow.webContents.send("window:shown");
}

function hideWindow(): void {
  setShortcutRecording(false);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
}

function toggleWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed() || isNativeDialogOpen || isShortcutRecording) return;
  if (mainWindow.isVisible()) hideWindow(); else showWindow();
}

function openSettings(): void {
  showWindow();
  mainWindow?.webContents.send("settings:open");
}

function registerPreferencesIpc(): void {
  const publishPreferences = () => {
    const next = readPreferences();
    mainWindow?.webContents.send("preferences:changed", next);
    return next;
  };
  ipcMain.handle("preferences:get", event => { assertTrustedWindow(event); return readPreferences(); });
  ipcMain.handle("preferences:update", async (event, patch: unknown) => {
    assertTrustedWindow(event);
    const error = await preferences.update(patch);
    if (!error) {
      historyStore.configureLimit(preferences.options.textLimit);
      imageStore.configureLimit(preferences.options.imageLimit);
      nativeTheme.themeSource = preferences.options.appearance;
      refreshSystemSettings();
      mainWindow?.setBackgroundColor(windowBackground());
    }
    return { settings: publishPreferences(), error };
  });
  ipcMain.handle("preferences:shortcut", async (event, shortcut: unknown) => {
    assertTrustedWindow(event);
    setShortcutRecording(false);
    const error = await preferences.setShortcut(shortcut);
    return { settings: publishPreferences(), error };
  });
  ipcMain.handle("preferences:recording", (event, recording: unknown) => {
    assertTrustedWindow(event);
    if (typeof recording !== "boolean" || (recording && !mainWindow?.isVisible())) throw new Error("Invalid recording state");
    setShortcutRecording(recording);
  });
  ipcMain.handle("preferences:login", (event, enabled: unknown) => {
    assertTrustedWindow(event);
    if (typeof enabled !== "boolean" || !readPreferences().loginSupported) return { settings: readPreferences(), error: "login-unavailable" };
    if (readPreferences().loginStatus === "unavailable") return { settings: readPreferences(), error: "login-failed" };
    try {
      app.setLoginItemSettings({ openAtLogin: enabled, ...loginItemOptions() });
      const settings = readPreferences();
      return { settings, error: settings.openAtLogin === enabled || (enabled && settings.loginStatus === "requires-approval") ? null : "login-failed" };
    } catch { return { settings: readPreferences(), error: "login-failed" }; }
  });
  ipcMain.handle("preferences:open-data", async event => {
    assertTrustedWindow(event);
    // Only the fixed application data directory can be opened via this IPC.
    return (await shell.openPath(app.getPath("userData"))) === "";
  });
}

function showRendererFailureDialog(
  window: BrowserWindow,
  messageKey: TranslationKey,
  reload: () => void
): void {
  if (rendererFailureDialogOpen || isQuitting) return;
  rendererFailureDialogOpen = true;
  isNativeDialogOpen = true;
  void dialog.showMessageBox({
    type: "error",
    title: nativeText("G-paster 界面异常"),
    message: nativeText(messageKey),
    buttons: [nativeText("重新加载"), nativeText("退出 G-paster")],
    defaultId: 0,
    cancelId: 1
  }).then(({ response }) => {
    rendererFailureDialogOpen = false;
    isNativeDialogOpen = false;
    if (response === 0 && !isQuitting && !window.isDestroyed()) reload();
    else {
      isQuitting = true;
      app.quit();
    }
  }).catch(() => {
    rendererFailureDialogOpen = false;
    isNativeDialogOpen = false;
  });
}

async function showImageSaveDialog(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  isNativeDialogOpen = true;
  try {
    return mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
  } finally {
    isNativeDialogOpen = false;
  }
}

function getTrustedPolicy(): TrustedOriginPolicy {
  return {
    isPackaged: app.isPackaged,
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
    appPath: app.getAppPath()
  };
}

function assertTrustedWindow(event: IpcMainEvent | IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    !isTrustedPageUrl(event.senderFrame.url, getTrustedPolicy())
  ) {
    throw new Error("Untrusted IPC sender");
  }
}

async function toHistoryImage(image: StoredImage): Promise<ClipboardImageEntry> {
  const gallery = image.sources.includes("screenshot") || image.sources.length === 0;
  const previewKey = `${image.hash}:${gallery ? "gallery-360x270-v2" : "history-96x96-v2"}`;
  let cached = imagePreviewCache.get(image.id);
  if (!cached || cached.hash !== previewKey) {
    const bytes = await imageStore.read(image.id);
    if (!bytes) {
      cached = { hash: previewKey, dataUrl: BROKEN_IMAGE_PREVIEW };
      imagePreviewCache.set(image.id, cached);
    } else {
      const decoded = nativeImage.createFromBuffer(bytes);
      if (decoded.isEmpty()) {
        cached = { hash: previewKey, dataUrl: BROKEN_IMAGE_PREVIEW };
        imagePreviewCache.set(image.id, cached);
      } else {
        const size = decoded.getSize();
        // Two physical pixels per CSS pixel at the largest display size (about
        // 180 CSS px for the gallery and 42 CSS px for history rows).
        const scale = Math.min(1, (gallery ? 360 : 96) / size.width, (gallery ? 270 : 96) / size.height);
        cached = { hash: previewKey, dataUrl: decoded.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: "best"
        }).toDataURL() };
        imagePreviewCache.set(image.id, cached);
      }
    }
  }
  return {
    id: image.id,
    content: `图片 ${image.width} × ${image.height}`,
    kind: "image",
    createdAt: image.createdAt,
    copiedAt: image.copiedAt,
    width: image.width,
    height: image.height,
    previewDataUrl: cached.dataUrl,
    sources: [...image.sources],
    ...(cached.dataUrl === BROKEN_IMAGE_PREVIEW ? { unavailable: true } : {})
  };
}
async function listCombinedHistory(): Promise<ClipboardHistoryItem[]> {
  const [textEntries, images, files] = await Promise.all([historyStore.list(), imageStore.list(), fileStore.listHistory()]);
  fileImages.prune(new Set(files.map(file => file.id)));
  // Decode serially to bound peak memory when loading old image-file records.
  for (const file of files) {
    const image = await fileImages.preview(file);
    if (image) file.image = image;
  }
  const currentImageIds = new Set(images.map((image) => image.id));
  for (const id of imagePreviewCache.keys()) if (!currentImageIds.has(id)) imagePreviewCache.delete(id);
  const imageEntries = await Promise.all(images.map(toHistoryImage));
  return [...textEntries, ...imageEntries, ...files].sort((left, right) => right.copiedAt - left.copiedAt);
}

function trimNonImageHistory(): Promise<void> {
  const operation = historyLimitQueue.then(async () => {
    const [text, files] = await Promise.all([historyStore.list(), fileStore.list()]);
    const expired = [...text, ...files].sort((a, b) => b.copiedAt - a.copiedAt).slice(preferences.options.textLimit);
    await Promise.all([historyStore.deleteMany(expired.filter(entry => entry.kind !== "file").map(entry => entry.id)),
      fileStore.deleteMany(expired.filter(entry => entry.kind === "file").map(entry => entry.id))]);
  });
  historyLimitQueue = operation.catch(() => undefined);
  return operation;
}

function savePendingFileCopy(entry: StoredFileEntry): void {
  if (entry.copyState !== "pending") return;
  void fileStore.saveCopies(entry.id).then(async result => {
    if (!result) return;
    reportCaptureIssue("clipboard-file", result.copyState === "limit"
      ? "文件副本超过容量保护限制，仅保留原始引用（单批 100 MB，总副本 500 MB）。"
      : result.copyState === "failed" ? "文件副本保存失败，仅保留原始引用。请检查文件权限及磁盘空间。" : null);
    await publishHistory();
  }).catch(() => reportCaptureIssue("clipboard-file", "文件副本保存失败，仅保留原始引用。请检查文件权限及磁盘空间。"));
}

async function publishHistory(): Promise<void> {
  const generation = ++historyPublishGeneration;
  const entries = await listCombinedHistory();
  if (generation === historyPublishGeneration && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("history:changed", entries);
  }
}

async function updateClipboard<T>(operation: () => Promise<T>): Promise<T> {
  clipboardWriteGeneration++;
  imageCapturePauseDepth++;
  try { return await operation(); }
  finally { clipboardWriteGeneration++; imageCapturePauseDepth--; }
}

function clearImageCaptureIssue(): void {
  nextImagePollAt = 0;
  reportCaptureIssue("clipboard-image", null);
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function registerHistoryIpc(): void {
  ipcMain.handle("system:settings", (event) => {
    assertTrustedWindow(event);
    return refreshSystemSettings();
  });
  ipcMain.handle("capture:issues", (event) => {
    assertTrustedWindow(event);
    return [...captureIssues.values()];
  });
  ipcMain.handle("history:list", async (event) => {
    assertTrustedWindow(event);
    return listCombinedHistory();
  });

  ipcMain.handle("history:delete", async (event, id: unknown) => {
    assertTrustedWindow(event);
    if (typeof id !== "string" || id.length > 100) return false;
    const deletedText = await historyStore.delete(id);
    const deletedImage = deletedText ? false : await imageStore.delete(id);
    const deletedFile = deletedText || deletedImage ? false : await fileStore.deleteMany([id]);
    if (deletedText || deletedImage || deletedFile) await publishHistory();
    return deletedText || deletedImage || deletedFile;
  });

  ipcMain.handle("history:clear", async (event) => {
    assertTrustedWindow(event);
    // Invalidate any conversion that started before the user's clear operation.
    screenshotMonitor?.pauseForClear();
    imageCaptureGeneration++;
    clipboardWriteGeneration++;
    imageCapturePauseDepth++;
    try {
      const results = await Promise.allSettled([historyStore.clear(), imageStore.clear(), fileStore.clear()]);
      let hasFileRepresentation = false;
      try {
        const items = await readClipboardItems(() => clipboard.read());
        hasFileRepresentation = items.some(item => item.types.some(isFileClipboardType));
        const snapshot = await readClipboardCaptureSnapshot(items, lastClipboardImageHash, lastClipboardImageFileKey, nextClipboardImageFileRetryAt);
        lastClipboardFileKey = snapshot.files?.key ?? "";
        lastClipboardImageHash = snapshot.image?.hash ?? "";
        lastClipboardImageFileKey = snapshot.imageFileKey;
        nextClipboardImageFileRetryAt = snapshot.imageFileRetryAt;
      } catch { lastClipboardImageHash = ""; lastClipboardFileKey = ""; lastClipboardImageFileKey = ""; nextClipboardImageFileRetryAt = 0; }
      try {
        rememberClipboardText(hasFileRepresentation ? "" : await withClipboardReadTimeout(clipboard.readText()));
        reportCaptureIssue("clipboard-text", null);
      } catch { lastClipboardText = ""; }
      reportCaptureIssue("clipboard-file", null);
      await publishHistory();
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("部分记录未能清空，请检查后重试。");
      }
    } finally {
      imageCapturePauseDepth--;
      screenshotMonitor?.resumeAfterClear();
    }
  });

  ipcMain.handle("history:copy", async (event, id: unknown) => {
    assertTrustedWindow(event);
    if (typeof id !== "string" || id.length > 100) return false;
    const entry = await historyStore.get(id);
    if (entry) {
      return updateClipboard(async () => {
        await clipboard.writeText(entry.content);
        await historyStore.recordClipboardText(entry.content);
        await trimNonImageHistory();
        rememberClipboardText(entry.content);
        lastClipboardImageHash = "";
        lastClipboardFileKey = "";
        lastClipboardImageFileKey = "";
        nextClipboardImageFileRetryAt = 0;
        clearImageCaptureIssue();
        await publishHistory();
        hideWindow();
        return true;
      });
    }

    const file = await fileStore.get(id);
    if (file) {
      const paths = await fileStore.resolvePaths(id);
      if (!paths) { await publishHistory(); return false; }
      const image = await fileImages.read(id);
      if (image) return updateClipboard(async () => {
        await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(image.buffer)], { type: "image/png" }) })]);
        await fileStore.touch(id);
        rememberClipboardText("");
        lastClipboardFileKey = "";
        lastClipboardImageFileKey = "";
        lastClipboardImageHash = createHash("sha256").update(image.buffer).digest("hex");
        nextClipboardImageFileRetryAt = 0;
        clearImageCaptureIssue(); reportCaptureIssue("clipboard-file", null);
        await publishHistory(); hideWindow(); return true;
      });
      return updateClipboard(async () => {
        await clipboard.write([new ClipboardItem({ "text/uri-list": fileUriList(paths) })]);
        await fileStore.touch(id);
        await trimNonImageHistory();
        rememberClipboardText("");
        lastClipboardFileKey = fileReferenceKey(paths);
        lastClipboardImageFileKey = "";
        lastClipboardImageHash = "";
        nextClipboardImageFileRetryAt = 0;
        clearImageCaptureIssue(); reportCaptureIssue("clipboard-file", null);
        await publishHistory(); hideWindow(); return true;
      });
    }

    const image = await imageStore.get(id);
    const bytes = image ? await imageStore.read(id) : null;
    if (!image || !bytes) return false;
    return updateClipboard(async () => {
      await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(bytes)], { type: "image/png" }) })]);
      await imageStore.record(bytes, image.width, image.height);
      rememberClipboardText("");
      lastClipboardImageHash = createHash("sha256").update(bytes).digest("hex");
      lastClipboardFileKey = "";
      lastClipboardImageFileKey = "";
      nextClipboardImageFileRetryAt = 0;
      clearImageCaptureIssue();
      await publishHistory();
      hideWindow();
      return true;
    });
  });


  ipcMain.handle("image:preview", async (event, id: unknown) => {
    assertTrustedWindow(event);
    if (typeof id !== "string" || id.length > 100) return null;
    const bytes = await imageStore.read(id) ?? (await fileImages.read(id))?.buffer;
    return bytes ? `data:image/png;base64,${bytes.toString("base64")}` : null;
  });

  ipcMain.handle("image:drag-start", async (event, value: unknown, dismissAfterDrag: unknown = false) => {
    assertTrustedWindow(event);
    if (typeof dismissAfterDrag !== "boolean") return false;
    const ids = typeof value === "string" ? [value] : value;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 ||
      ids.some(id => typeof id !== "string" || !id || id.length > 100)) return false;
    const paths = await Promise.all([...new Set<string>(ids)].map(id => imageStore.getFilePath(id)));
    if (paths.some(path => !path) || event.sender.isDestroyed()) return false;
    const files = paths as string[];
    const image = nativeImage.createFromPath(files[0]);
    if (image.isEmpty()) return false;
    // A single image follows the original native-file path; selections export all files.
    const icon = image.resize({ width: 64 });
    event.sender.startDrag(files.length === 1 ? { file: files[0], icon } : { file: files[0], files, icon });
    if (dismissAfterDrag && files.length > 1 && process.platform === "darwin") {
      // Electron's native macOS drag source does not send DOM dragend or a drop result.
      // Wait for the physical gesture to end; hiding earlier can interrupt the native drag.
      await new Promise<void>((resolve, reject) => {
        execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e",
          'ObjC.import("AppKit"); while ((Number($.NSEvent.pressedMouseButtons) & 1) !== 0) { delay(0.05); }'
        ], { timeout: 60000 }, error => error ? reject(error) : resolve());
      });
      if (!event.sender.isDestroyed()) hideWindow();
    }
    return true;
  });

  ipcMain.handle("file:drag-start", async (event, id: unknown) => {
    assertTrustedWindow(event);
    if (typeof id !== "string" || id.length > 100) return false;
    const paths = await fileStore.resolvePaths(id);
    if (!paths) { await publishHistory(); return false; }
    const fallback = nativeImage.createFromPath(join(app.getAppPath(), "assets", "G-paster-icon.png"));
    let icon = await app.getFileIcon(paths[0], { size: "normal" }).catch(() => fallback);
    if (icon.isEmpty()) icon = fallback;
    if (icon.isEmpty() || event.sender.isDestroyed()) return false;
    event.sender.startDrag({ file: paths[0], files: paths, icon: icon.resize({ width: 64, height: 64 }) });
    return true;
  });

  ipcMain.handle("image:save", async (event, id: unknown) => {
    assertTrustedWindow(event);
    if (typeof id !== "string" || id.length > 100) return false;
    const bytes = await imageStore.read(id) ?? (await fileImages.read(id))?.buffer;
    if (!bytes) return false;
    const result = await showImageSaveDialog({
      title: nativeText("保存图片"),
      defaultPath: join(app.getPath("pictures"), `g-paster-${Date.now()}.png`),
      filters: [{ name: nativeText("PNG 图片"), extensions: ["png"] }]
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, bytes);
    return true;
  });
}

function registerPhraseIpc(): void {
  ipcMain.handle("phrase:list", async (event) => {
    assertTrustedWindow(event);
    return phraseStore.list();
  });

  ipcMain.handle("phrase:create", async (event, draft: unknown) => {
    assertTrustedWindow(event);
    if (!isStringRecord(draft) || typeof draft.text !== "string" || typeof draft.category !== "string") return null;
    return phraseStore.create(draft as unknown as QuickPhraseDraft);
  });

  ipcMain.handle("phrase:update", async (event, update: unknown) => {
    assertTrustedWindow(event);
    if (!isStringRecord(update) || typeof update.id !== "string" || typeof update.text !== "string" || typeof update.category !== "string") return null;
    return phraseStore.update(update as unknown as QuickPhraseUpdate);
  });

  ipcMain.handle("phrase:delete", async (event, id: unknown) => {
    assertTrustedWindow(event);
    return typeof id === "string" && id.length <= 100 ? phraseStore.delete(id) : false;
  });

  ipcMain.handle("phrase:copy", async (event, id: unknown) => {
    assertTrustedWindow(event);
    if (typeof id !== "string" || id.length > 100) return false;
    const phrase = await phraseStore.get(id);
    if (!phrase) return false;
    if (phrase.kind === "image") {
      const bytes = await phraseStore.readImage(id);
      if (!bytes || !phrase.image) return false;
      return updateClipboard(async () => {
        await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(bytes)], { type: "image/png" }) })]);
        await imageStore.record(bytes, phrase.image!.width, phrase.image!.height, Date.now(), "clipboard");
        rememberClipboardText("");
        lastClipboardImageHash = createHash("sha256").update(bytes).digest("hex");
        lastClipboardFileKey = "";
        lastClipboardImageFileKey = "";
        nextClipboardImageFileRetryAt = 0;
        clearImageCaptureIssue();
        await publishHistory();
        hideWindow();
        return true;
      });
    }
    return updateClipboard(async () => {
      await clipboard.writeText(phrase.text);
      await historyStore.recordClipboardText(phrase.text);
      await trimNonImageHistory();
      rememberClipboardText(phrase.text);
      lastClipboardImageHash = "";
      lastClipboardFileKey = "";
      lastClipboardImageFileKey = "";
      nextClipboardImageFileRetryAt = 0;
      clearImageCaptureIssue();
      await publishHistory();
      hideWindow();
      return true;
    });
  });

  ipcMain.handle("phrase:save-history", async (event, id: unknown, category: unknown) => {
    assertTrustedWindow(event);
    if (typeof id !== "string" || id.length > 100 || typeof category !== "string") return null;
    const entry = await historyStore.get(id);
    if (!entry) return null;
    return phraseStore.create({ text: entry.content, category });
  });

  ipcMain.handle("phrase:save-image", async (event, id: unknown, category: unknown) => {
    assertTrustedWindow(event);
    if (typeof id !== "string" || id.length > 100 || (category !== undefined && typeof category !== "string")) return null;
    const stored = await imageStore.get(id);
    if (stored) {
      const bytes = await imageStore.read(id);
      if (bytes) return phraseStore.createImage(bytes, stored.width, stored.height, typeof category === "string" ? category : "未分类");
    }
    const fileImage = await fileImages.read(id);
    if (!fileImage) return null;
    return phraseStore.createImage(fileImage.buffer, fileImage.width, fileImage.height, typeof category === "string" ? category : "未分类");
  });

  ipcMain.handle("phrase:import-image", async (event, category: unknown) => {
    assertTrustedWindow(event);
    if ((category !== undefined && typeof category !== "string") || isNativeDialogOpen) return null;
    isNativeDialogOpen = true;
    try {
      const options: Electron.OpenDialogOptions = {
        title: nativeText("添加图片"), properties: ["openFile"],
        filters: [{ name: nativeText("图片"), extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif"] }]
      };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return null;
      const image = await decodeImageBuffer(await readImageFile(result.filePaths[0]));
      if (!image) throw new Error("无法读取这张图片。");
      return await phraseStore.createImage(image.buffer, image.width, image.height, typeof category === "string" ? category : "未分类");
    } finally {
      isNativeDialogOpen = false;
    }
  });

  ipcMain.handle("phrase:preview-image", async (event, id: unknown) => {
    assertTrustedWindow(event);
    if (typeof id !== "string" || id.length > 100) return null;
    const bytes = await phraseStore.readImage(id);
    if (!bytes) return null;
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return null;
    return image.resize({ width: 120, quality: "best" }).toDataURL();
  });
}

function registerWindowIpc(): void {
  ipcMain.on("window:compact-mode", (event, compact: unknown) => {
    if (
      typeof compact !== "boolean" ||
      !mainWindow ||
      mainWindow.isDestroyed() ||
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame ||
      !isTrustedPageUrl(event.senderFrame.url, getTrustedPolicy())
    ) {
      return;
    }

    try {
      const [width, height] = mainWindow.getSize();
      const targetHeight = compact ? 340 : 460;
      if (height !== targetHeight) mainWindow.setSize(width, targetHeight, true);
    } catch {
      // Safely reject invalid window calls without throwing in main process
    }
  });
}

function updateTrayMenu(): void {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: nativeText("打开 G-paster"), click: showWindow },
    { label: nativeText("设置"), click: openSettings },
    { type: "separator" },
    { label: nativeText("退出 G-paster"), click: () => { isQuitting = true; app.quit(); } }
  ]));
}

function createTray(): void {
  const isMacTemplate = process.platform === "darwin";
  const iconPath = join(app.getAppPath(), "assets", isMacTemplate ? "trayTemplate.png" : "GpasterTray.png");
  if (!existsSync(iconPath)) {
    console.error("G-paster tray icon is missing:", iconPath);
    return;
  }
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    console.error("G-paster tray icon could not be loaded:", iconPath);
    return;
  }
  if (isMacTemplate) image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  updateTrayMenu();
  tray.on("right-click", () => { refreshSystemSettings(); });
  tray.on("click", showWindow);
}

function createWindow(): void {
  const preloadPath = join(__dirname, "preload.js");
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 400,
    height: 460,
    minWidth: 400,
    minHeight: 340,
    show: false,
    title: APP_NAME,
    icon: join(app.getAppPath(), "assets", "G-paster-icon.png"),
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    alwaysOnTop: true,
    skipTaskbar: process.platform === "win32",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--gpaster-system-settings=${encodeURIComponent(JSON.stringify(refreshSystemSettings()))}`]
    }
  };
  if (process.platform === "darwin") {
    // A non-activating NSPanel receives keyboard focus without switching Spaces.
    windowOptions.type = "panel";
    windowOptions.titleBarStyle = "hiddenInset";
    windowOptions.trafficLightPosition = { x: 12, y: 13 };
  }

  mainWindow = new BrowserWindow(windowOptions);
  const window = mainWindow;
  let rendererRecoveryAttempts = 0;
  let rendererRecoveryTimer: NodeJS.Timeout | null = null;
  let rendererStabilityTimer: NodeJS.Timeout | null = null;
  if (process.platform === "darwin") {
    mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    });
  }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("render-process-gone", () => {
    setShortcutRecording(false);
    if (isQuitting || window.isDestroyed()) return;
    if (rendererStabilityTimer) clearTimeout(rendererStabilityTimer);
    rendererStabilityTimer = null;
    if (rendererRecoveryTimer) clearTimeout(rendererRecoveryTimer);
    rendererRecoveryAttempts += 1;
    if (rendererRecoveryAttempts > 3) {
      showRendererFailureDialog(window, "界面未能恢复，请重新打开 G-paster。", () => {
        rendererRecoveryAttempts = 0;
        if (!isQuitting && !window.isDestroyed()) window.webContents.reload();
      });
      return;
    }
    rendererRecoveryTimer = setTimeout(() => {
      rendererRecoveryTimer = null;
      if (!isQuitting && mainWindow === window && !window.isDestroyed() && window.webContents.isCrashed()) {
        window.webContents.reload();
      }
    }, Math.min(300 * 2 ** (rendererRecoveryAttempts - 1), 2_000));
  });
  mainWindow.webContents.on("did-finish-load", () => {
    if (rendererRecoveryTimer) clearTimeout(rendererRecoveryTimer);
    rendererRecoveryTimer = null;
    if (rendererStabilityTimer) clearTimeout(rendererStabilityTimer);
    rendererStabilityTimer = setTimeout(() => {
      rendererRecoveryAttempts = 0;
      rendererStabilityTimer = null;
    }, 30_000);
    reportCaptureIssue("renderer", null);
  });
  mainWindow.webContents.on("did-start-navigation", () => setShortcutRecording(false));
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame || isQuitting || errorCode === -3) return;
    setShortcutRecording(false);
    showRendererFailureDialog(window, "界面加载失败，请重新打开 G-paster。", () => {
      rendererRecoveryAttempts = 0;
      if (!isQuitting && !window.isDestroyed()) window.webContents.reload();
    });
  });
  mainWindow.on("unresponsive", () => {
    showRendererFailureDialog(window, "界面无响应，请重新打开 G-paster。", () => {
      rendererRecoveryAttempts = 0;
      if (!isQuitting && !window.isDestroyed()) window.webContents.reload();
    });
  });

  const policy = getTrustedPolicy();
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedPageUrl(url, policy)) event.preventDefault();
  });
  mainWindow.webContents.on("will-redirect", (event, url) => {
    if (!isTrustedPageUrl(url, policy)) event.preventDefault();
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hideWindow();
    }
  });
  mainWindow.on("blur", () => {
    if (!isQuitting && !isNativeDialogOpen) hideWindow();
  });
  mainWindow.on("closed", () => {
    if (rendererRecoveryTimer) clearTimeout(rendererRecoveryTimer);
    if (rendererStabilityTimer) clearTimeout(rendererStabilityTimer);
    mainWindow = null;
  });

  if (!policy.isPackaged && policy.devServerUrl && getDevServerOrigin(policy.devServerUrl)) {
    void mainWindow.loadURL(policy.devServerUrl);
  } else {
    void mainWindow.loadFile(join(app.getAppPath(), "dist", "index.html"));
  }
  mainWindow.once("ready-to-show", () => {
    let loginLaunch = app.isPackaged && process.argv.includes("--gpaster-background");
    if (process.platform === "darwin" && app.isPackaged) {
      try { loginLaunch ||= app.getLoginItemSettings().wasOpenedAtLogin; } catch { /* Show normally if OS query fails. */ }
    }
    if (!loginLaunch) showWindow();
  });
}

function clipboardFormatSignature(items: Awaited<ReturnType<typeof readClipboardItems>>): string {
  return items.map(item => [...new Set(item.types)].sort().join(",")).sort().join("|");
}

function hasFileClipboardFormat(items: Awaited<ReturnType<typeof readClipboardItems>>): boolean {
  return items.some(item => item.types.some(isFileClipboardType));
}

async function pollClipboardImage(formatRead: ClipboardFormatRead): Promise<void> {
  if (isQuitting || isPollingImage || imageCapturePauseDepth > 0 || Date.now() < nextImagePollAt) return;
  isPollingImage = true;
  const generation = imageCaptureGeneration;
  const writeGeneration = clipboardWriteGeneration;
  const isCurrent = () => !isQuitting && generation === imageCaptureGeneration && writeGeneration === clipboardWriteGeneration;
  const copiedAt = Date.now();
  let capturingFiles = false;
  try {
    const items = await formatRead.items;
    capturingFiles = hasFileClipboardFormat(items);
    const formatSignature = clipboardFormatSignature(items);
    const hasImageOrFileFormat = capturingFiles || hasClipboardImagePayload(items);
    if (!hasImageOrFileFormat) {
      lastClipboardFormatSignature = formatSignature;
      nextImagePayloadProbeAt = 0;
    } else {
      // Reading and hashing image/file payloads is the expensive part of the
      // listener. Probe immediately when the clipboard format changes, and at
      // most once per IMAGE_PAYLOAD_PROBE_MS while the same formats remain.
      const probeDue = formatSignature !== lastClipboardFormatSignature || Date.now() >= nextImagePayloadProbeAt;
      lastClipboardFormatSignature = formatSignature;
      if (!probeDue) return;
      nextImagePayloadProbeAt = Date.now() + IMAGE_PAYLOAD_PROBE_MS;
    }
    const snapshot = await readClipboardCaptureSnapshot(items, lastClipboardImageHash, lastClipboardImageFileKey, nextClipboardImageFileRetryAt);
    if (!isCurrent()) return;
    if (snapshot.image) {
      lastClipboardFileKey = "";
      nextClipboardImageFileRetryAt = snapshot.imageFileRetryAt;
      if (snapshot.image.buffer && snapshot.image.width && snapshot.image.height) {
        await imageStore.record(snapshot.image.buffer, snapshot.image.width, snapshot.image.height, copiedAt, "clipboard");
        if (!isCurrent()) return;
        lastClipboardImageHash = snapshot.image.hash;
        lastClipboardImageFileKey = snapshot.imageFileKey;
        nextClipboardImageFileRetryAt = snapshot.imageFileRetryAt;
        await publishHistory();
      } else {
        lastClipboardImageHash = snapshot.image.hash;
        lastClipboardImageFileKey = snapshot.imageFileKey;
        nextClipboardImageFileRetryAt = snapshot.imageFileRetryAt;
      }
      reportCaptureIssue("clipboard-image", null);
      reportCaptureIssue("clipboard-file", null);
      return;
    }
    const files = snapshot.files;
    if (files) {
      lastClipboardImageFileKey = snapshot.imageFileKey;
      nextClipboardImageFileRetryAt = snapshot.imageFileRetryAt;
      lastClipboardImageHash = "";
      reportCaptureIssue("clipboard-image", null);
      if (files.key !== lastClipboardFileKey) {
        const entry = await fileStore.record(files.paths, preferences.options.saveFileCopies, copiedAt);
        if (!isCurrent()) return;
        lastClipboardFileKey = files.key;
        await trimNonImageHistory();
        reportCaptureIssue("clipboard-file", null);
        await publishHistory();
        savePendingFileCopy(entry);
      }
      return;
    }
    lastClipboardFileKey = "";
    lastClipboardImageHash = "";
    lastClipboardImageFileKey = "";
    nextClipboardImageFileRetryAt = 0;
    reportCaptureIssue("clipboard-file", null);
    reportCaptureIssue("clipboard-image", null);
  } catch (error) {
    if (!isCurrent()) return;
    console.error(capturingFiles ? "Could not save clipboard files." : "Could not save clipboard image.");
    nextImagePollAt = Date.now() + 3_000;
    if (capturingFiles) {
      const known = ["无法读取剪贴板文件引用，请重新复制文件。", "一次最多收集 1000 个文件或文件夹，请分批复制。", "文件引用已失效，请从原始位置重新复制。"];
      reportCaptureIssue("clipboard-file", error instanceof Error && known.includes(error.message)
        ? error.message : "文件引用读取或保存失败，请检查文件权限及本地存储空间。");
      return;
    }
    reportCaptureIssue("clipboard-image", error instanceof Error && (error.message.startsWith("剪贴板") || error.message.startsWith("无法读取剪贴板"))
      ? error.message : "剪贴板图片读取或保存失败，请检查系统剪贴板权限及应用数据目录。稍后会自动重试。");
  } finally {
    isPollingImage = false;
  }
}

async function pollClipboard(): Promise<void> {
  if (isQuitting || isPolling || imageCapturePauseDepth > 0) return;
  isPolling = true;
  const writeGeneration = clipboardWriteGeneration;
  // Share only this polling turn's format enumeration. A busy/backing-off image
  // path must not prevent text from using its original independent format checks.
  const formatRead = !isPollingImage && Date.now() >= nextImagePollAt
    ? new ClipboardFormatRead(() => clipboard.read()) : null;
  if (formatRead) void pollClipboardImage(formatRead);
  try {
    let changed = false;
    if (Date.now() >= nextTextPollAt) {
      try {
        const fallbackFormats = () => Promise.all([clipboard.has("text/uri-list"), clipboard.has(NATIVE_FILE_URL)]);
        const [currentText, [hasFiles, hasNativeFiles]] = await withClipboardReadTimeout(Promise.all([
          clipboard.readText(), formatRead ? formatRead.fileFormats(fallbackFormats) : fallbackFormats()
        ]));
        if (writeGeneration !== clipboardWriteGeneration || imageCapturePauseDepth > 0) return;
        if (hasNativeFiles || (hasFiles && !isWebUrl(currentText))) {
          rememberClipboardText("");
          reportCaptureIssue("clipboard-text", null);
          return;
        }
        if (currentText.length > MAX_CLIPBOARD_TEXT_LENGTH) {
          rememberClipboardText(currentText);
          reportCaptureIssue("clipboard-text", "文本过长（超过 200 万字符），本次未保存到历史记录。");
          return;
        }
        if (currentText !== lastClipboardText) {
          const entry = await historyStore.recordClipboardText(currentText);
          if (writeGeneration !== clipboardWriteGeneration || imageCapturePauseDepth > 0) return;
          if (entry) { await trimNonImageHistory(); changed = true; }
          rememberClipboardText(currentText);
        }
        reportCaptureIssue("clipboard-text", null);
      } catch {
        if (writeGeneration !== clipboardWriteGeneration) return;
        nextTextPollAt = Date.now() + 1_000;
        reportCaptureIssue("clipboard-text", "剪贴板文字读取或保存失败，请检查本地存储空间。稍后会自动重试。");
      }
    }
    if (changed) await publishHistory();
  } catch {
    if (writeGeneration === clipboardWriteGeneration) {
      nextTextPollAt = Date.now() + 1_000;
      reportCaptureIssue("clipboard-text", "剪贴板文字读取或保存失败，请检查本地存储空间。稍后会自动重试。");
    }
  } finally {
    isPolling = false;
  }
}

function registerGlobalShortcut(): void {
  const registered = preferences.register();
  console.info("G-paster global shortcut registered:", registered, preferences.shortcut);
  if (!registered) console.warn("G-paster could not register its global shortcut:", preferences.shortcut);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.on("before-quit", () => {
    isQuitting = true;
    clipboardPollingTimer.dispose();
    // Invalidate work already admitted before timer disposal.
    imageCaptureGeneration++;
    clipboardWriteGeneration++;
    screenshotMonitor?.stop();
    fileStore?.stop();
    if (app.isReady()) {
      setShortcutRecording(false);
      globalShortcut.unregisterAll();
    }
  });

  app.whenReady().then(async () => {
    refreshSystemSettings();
    const userData = app.getPath("userData");
    preferences = new Preferences(join(userData, "preferences.json"), GLOBAL_SHORTCUT, process.platform, globalShortcut, toggleWindow);
    await preferences.load();
    if (isQuitting) return;
    nativeTheme.themeSource = preferences.options.appearance;
    refreshSystemSettings();
    historyStore = new HistoryStore(join(userData, "history.json"), preferences.options.textLimit);
    imageStore = new ImageStore(join(userData, "image-history.json"), preferences.options.imageLimit);
    phraseStore = new PhraseStore(join(userData, "phrases.json"));
    fileStore = new FileStore(join(userData, "file-history.json"));
    fileImages = new FileImages(fileStore);
    await Promise.all([historyStore.list(), imageStore.list(), phraseStore.list(), fileStore.list()]);
    if (isQuitting) return;
    if (consumeCorruptionEvents().length) {
      reportCaptureIssue("storage", "部分本地数据文件损坏，已保留原文件并以空记录启动。请检查数据目录或备份文件。");
    }
    await trimNonImageHistory();
    if (isQuitting) return;
    try { rememberClipboardText(await withClipboardReadTimeout(clipboard.readText())); }
    catch { lastClipboardText = ""; }
    if (isQuitting) return;
    // Do not decode a lazy/large clipboard image before the tray and shortcut are ready.
    // The first background poll imports it; normalized PNG deduplication prevents duplicates.
    if (process.platform === "darwin") {
      app.dock?.setIcon(nativeImage.createFromPath(join(app.getAppPath(), "assets", "G-paster-icon.png")));
      app.dock?.hide();
    }
    Menu.setApplicationMenu(null);
    registerHistoryIpc();
    registerPhraseIpc();
    registerWindowIpc();
    registerPreferencesIpc();
    createTray();
    createWindow();
    registerGlobalShortcut();
    clipboardPollingTimer.start();
    const pendingFiles = await fileStore.list();
    if (isQuitting) return;
    for (const entry of pendingFiles) savePendingFileCopy(entry);

    if (process.platform === "darwin") {
      screenshotMonitor = new ScreenshotMonitor(
        getMacScreenshotDirectories(app.getPath("desktop")),
        async (screenshotPath) => {
          const generation = imageCaptureGeneration;
          const source = await readImageFile(screenshotPath);
          const image = await decodeImageBuffer(source);
          if (!image) throw new Error("Screenshot file is not a supported image.");
          if (generation !== imageCaptureGeneration) return;
          await imageStore.record(image.buffer, image.width, image.height, Date.now(), "screenshot");
          if (generation !== imageCaptureGeneration) return;
          await publishHistory();
        },
        (issue) => reportCaptureIssue("screenshots", issue),
        getMacScreenshotNamePrefix()
      );
      screenshotMonitor.start();
    }

    app.on("activate", showWindow);
  }).catch((error: unknown) => {
    console.error("G-paster could not start:", error);
    dialog.showErrorBox(nativeText("G-paster 无法启动"), nativeText("本地数据无法读取。请检查应用数据目录或备份文件后重试。"));
    app.quit();
  });
}
