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
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from "electron";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CaptureIssue, ClipboardHistoryItem, QuickPhraseDraft, QuickPhraseUpdate, SystemSettings } from "../src/shared/contracts";
import { HistoryStore } from "./history-store";
import { ImageStore, type StoredImage } from "./image-store";
import { PhraseStore } from "./phrase-store";
import { getMacScreenshotDirectories, ScreenshotMonitor } from "./screenshot-monitor";
import { getDevServerOrigin, isTrustedPageUrl, type TrustedOriginPolicy } from "./trusted-origin";
import { decodeImageBuffer } from "./image-codec";
import { readImageItems } from "./clipboard-images";
import { readSystemSettings } from "./system-settings";
import { translate, type TranslationKey } from "../src/shared/i18n";

const APP_NAME = "G-paster";
const GLOBAL_SHORTCUT = process.platform === "darwin" ? "Control+C" : "Control+Shift+G";
const CLIPBOARD_POLL_MS = 180;
const MAX_CLIPBOARD_TEXT_LENGTH = 2_000_000;
const MAX_SCREENSHOT_FILE_BYTES = 100 * 1024 * 1024;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let historyStore: HistoryStore;
let imageStore: ImageStore;
let phraseStore: PhraseStore;
let screenshotMonitor: ScreenshotMonitor | null = null;
let lastClipboardText = "";
let nextTextPollAt = 0;
let nextImagePollAt = 0;
let lastClipboardImageHash = "";
let isQuitting = false;
let isNativeDialogOpen = false;
let isPolling = false;
let isPollingImage = false;
let imageCaptureGeneration = 0;
let historyPublishGeneration = 0;
const imagePreviewCache = new Map<string, { hash: string; dataUrl: string }>();
const captureIssues = new Map<CaptureIssue["source"], CaptureIssue>();
let currentSystemSettings: SystemSettings | null = null;

function refreshSystemSettings(): SystemSettings {
  const next = readSystemSettings();
  const changed = next.language !== currentSystemSettings?.language || next.locale !== currentSystemSettings?.locale;
  currentSystemSettings = next;
  if (changed) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("system:settings-changed", next);
    updateTrayMenu();
  }
  return next;
}

function nativeText(key: TranslationKey): string {
  return translate((currentSystemSettings ?? readSystemSettings()).language, key);
}

function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? "#171d26" : "#f4f6f9";
}

function reportCaptureIssue(source: CaptureIssue["source"], message: string | null): void {
  if ((captureIssues.get(source)?.message ?? null) === message) return;
  if (message) captureIssues.set(source, { source, message });
  else captureIssues.delete(source);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("capture:issues-changed", [...captureIssues.values()]);
}

function rememberClipboardText(value: string): void {
  lastClipboardText = value.length <= MAX_CLIPBOARD_TEXT_LENGTH ? value : "";
  nextTextPollAt = value.length <= MAX_CLIPBOARD_TEXT_LENGTH ? 0 : Date.now() + 1_000;
}

app.setName(APP_NAME);
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
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
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

async function toHistoryImage(image: StoredImage): Promise<ClipboardHistoryItem | null> {
  let cached = imagePreviewCache.get(image.id);
  if (!cached || cached.hash !== image.hash) {
    const bytes = await imageStore.read(image.id);
    if (!bytes) return null;
    const decoded = nativeImage.createFromBuffer(bytes);
    if (decoded.isEmpty()) return null;
    cached = { hash: image.hash, dataUrl: decoded.resize({ width: 180, height: 110, quality: "good" }).toDataURL() };
    imagePreviewCache.set(image.id, cached);
  }
  return {
    id: image.id,
    content: `图片 ${image.width} × ${image.height}`,
    kind: "image",
    createdAt: image.createdAt,
    copiedAt: image.copiedAt,
    width: image.width,
    height: image.height,
    isFavorite: image.isFavorite,
    previewDataUrl: cached.dataUrl
  };
}

async function listCombinedHistory(): Promise<ClipboardHistoryItem[]> {
  const [textEntries, images] = await Promise.all([historyStore.list(), imageStore.list()]);
  const currentImageIds = new Set(images.map((image) => image.id));
  for (const id of imagePreviewCache.keys()) if (!currentImageIds.has(id)) imagePreviewCache.delete(id);
  const imageEntries = (await Promise.all(images.map(toHistoryImage))).filter(
    (entry): entry is ClipboardHistoryItem => entry !== null
  );
  return [...textEntries, ...imageEntries].sort((left, right) => right.copiedAt - left.copiedAt);
}

async function publishHistory(): Promise<void> {
  const generation = ++historyPublishGeneration;
  const entries = await listCombinedHistory();
  if (generation === historyPublishGeneration && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("history:changed", entries);
  }
}

async function readClipboardImage(): Promise<{ buffer?: Buffer; width?: number; height?: number; hash: string } | null> {
  return readImageItems(await clipboard.read(), lastClipboardImageHash, decodeImageBuffer);
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
    if (deletedText || deletedImage) await publishHistory();
    return deletedText || deletedImage;
  });

  ipcMain.handle("history:clear", async (event) => {
    assertTrustedWindow(event);
    // Invalidate any conversion that started before the user's clear operation.
    imageCaptureGeneration++;
    const results = await Promise.allSettled([historyStore.clear(), imageStore.clear()]);
    try { lastClipboardImageHash = (await readClipboardImage())?.hash ?? ""; }
    catch { lastClipboardImageHash = ""; }
    try { rememberClipboardText(await clipboard.readText()); }
    catch { lastClipboardText = ""; }
    await publishHistory();
    if (results.some((result) => result.status === "rejected")) {
      throw new Error("部分记录未能清空，请检查后重试。");
    }
  });

  ipcMain.handle("history:copy", async (event, id: unknown) => {
    assertTrustedWindow(event);
    if (typeof id !== "string" || id.length > 100) return false;
    const entry = await historyStore.get(id);
    if (entry) {
      await clipboard.writeText(entry.content);
      await historyStore.recordClipboardText(entry.content);
      rememberClipboardText(entry.content);
      lastClipboardImageHash = "";
      await publishHistory();
      hideWindow();
      return true;
    }

    const image = await imageStore.get(id);
    const bytes = image ? await imageStore.read(id) : null;
    if (!image || !bytes) return false;
    await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(bytes)], { type: "image/png" }) })]);
    await imageStore.record(bytes, image.width, image.height);
    rememberClipboardText("");
    lastClipboardImageHash = createHash("sha256").update(bytes).digest("hex");
    await publishHistory();
    hideWindow();
    return true;
  });

  ipcMain.handle("image:favorite", async (event, id: unknown) => {
    assertTrustedWindow(event);
    if (typeof id !== "string" || id.length > 100) return false;
    const state = await imageStore.toggleFavorite(id);
    if (await imageStore.get(id)) await publishHistory();
    return state;
  });

  ipcMain.handle("image:preview", async (event, id: unknown) => {
    assertTrustedWindow(event);
    if (typeof id !== "string" || id.length > 100) return null;
    const bytes = await imageStore.read(id);
    return bytes ? `data:image/png;base64,${bytes.toString("base64")}` : null;
  });

  ipcMain.handle("image:drag-start", async (event, id: unknown) => {
    assertTrustedWindow(event);
    if (typeof id !== "string" || id.length > 100) return false;
    const filePath = await imageStore.getFilePath(id);
    if (!filePath || event.sender.isDestroyed()) return false;
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return false;
    event.sender.startDrag({ file: filePath, icon: image.resize({ width: 64, height: 64 }) });
    return true;
  });

  ipcMain.handle("image:save", async (event, id: unknown) => {
    assertTrustedWindow(event);
    if (typeof id !== "string" || id.length > 100) return false;
    const bytes = await imageStore.read(id);
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
    await clipboard.writeText(phrase.text);
    await historyStore.recordClipboardText(phrase.text);
    rememberClipboardText(phrase.text);
    lastClipboardImageHash = "";
    await publishHistory();
    hideWindow();
    return true;
  });

  ipcMain.handle("phrase:save-history", async (event, id: unknown, category: unknown) => {
    assertTrustedWindow(event);
    if (typeof id !== "string" || id.length > 100 || typeof category !== "string") return null;
    const entry = await historyStore.get(id);
    if (!entry) return null;
    return phraseStore.create({ text: entry.content, category });
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
    windowOptions.titleBarStyle = "hiddenInset";
    windowOptions.trafficLightPosition = { x: 12, y: 13 };
  }

  mainWindow = new BrowserWindow(windowOptions);
  if (process.platform === "darwin") {
    mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: false,
      skipTransformProcessType: true
    });
  }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

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
    mainWindow = null;
  });

  if (!policy.isPackaged && policy.devServerUrl && getDevServerOrigin(policy.devServerUrl)) {
    void mainWindow.loadURL(policy.devServerUrl);
  } else {
    void mainWindow.loadFile(join(app.getAppPath(), "dist", "index.html"));
  }
  mainWindow.once("ready-to-show", showWindow);
}

async function pollClipboardImage(): Promise<void> {
  if (isPollingImage || Date.now() < nextImagePollAt) return;
  isPollingImage = true;
  const generation = imageCaptureGeneration;
  try {
    const currentImage = await readClipboardImage();
    if (generation !== imageCaptureGeneration) return;
    if (currentImage?.buffer && currentImage.width && currentImage.height) {
      await imageStore.record(currentImage.buffer, currentImage.width, currentImage.height);
      if (generation !== imageCaptureGeneration) return;
      lastClipboardImageHash = currentImage.hash;
      await publishHistory();
    } else if (!currentImage) {
      lastClipboardImageHash = "";
    }
    reportCaptureIssue("clipboard-image", null);
  } catch (error) {
    console.error("Could not save clipboard image:", error);
    nextImagePollAt = Date.now() + 3_000;
    reportCaptureIssue("clipboard-image", error instanceof Error && (error.message.startsWith("剪贴板") || error.message.startsWith("无法读取剪贴板"))
      ? error.message : "剪贴板图片读取或保存失败，请检查系统剪贴板权限及应用数据目录。稍后会自动重试。");
  } finally {
    isPollingImage = false;
  }
}

async function pollClipboard(): Promise<void> {
  if (isPolling) return;
  isPolling = true;
  // Slow native conversion must not prevent text changes from being recorded.
  void pollClipboardImage();
  try {
    let changed = false;
    if (Date.now() >= nextTextPollAt) {
      try {
        const currentText = await clipboard.readText();
        if (currentText !== lastClipboardText) {
          if (currentText.length <= MAX_CLIPBOARD_TEXT_LENGTH) {
            const entry = await historyStore.recordClipboardText(currentText);
            if (entry) changed = true;
          }
          rememberClipboardText(currentText);
        }
      } catch (error) {
        console.error("Could not save clipboard text:", error);
      }
    }
    if (changed) await publishHistory();
  } catch (error) {
    console.error("Could not save clipboard history:", error);
  } finally {
    isPolling = false;
  }
}

function registerGlobalShortcut(): void {
  const registered = globalShortcut.register(GLOBAL_SHORTCUT, showWindow);
  console.info("G-paster global shortcut registered:", registered, GLOBAL_SHORTCUT);
  if (!registered) console.warn("G-paster could not register its global shortcut:", GLOBAL_SHORTCUT);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);

  app.whenReady().then(async () => {
    refreshSystemSettings();
    const userData = app.getPath("userData");
    historyStore = new HistoryStore(join(userData, "history.json"));
    imageStore = new ImageStore(join(userData, "image-history.json"));
    phraseStore = new PhraseStore(join(userData, "phrases.json"));
    await Promise.all([historyStore.list(), imageStore.list(), phraseStore.list()]);
    try { rememberClipboardText(await clipboard.readText()); }
    catch { lastClipboardText = ""; }
    try {
      lastClipboardImageHash = (await readClipboardImage())?.hash ?? "";
    } catch {
      lastClipboardImageHash = "";
    }
    if (process.platform === "darwin") {
      app.dock?.setIcon(nativeImage.createFromPath(join(app.getAppPath(), "assets", "G-paster-icon.png")));
      app.dock?.hide();
    }
    Menu.setApplicationMenu(null);
    registerHistoryIpc();
    registerPhraseIpc();
    registerWindowIpc();
    createTray();
    createWindow();
    registerGlobalShortcut();
    setInterval(() => void pollClipboard(), CLIPBOARD_POLL_MS);

    if (process.platform === "darwin") {
      screenshotMonitor = new ScreenshotMonitor(
        getMacScreenshotDirectories(app.getPath("desktop")),
        async (screenshotPath) => {
          const generation = imageCaptureGeneration;
          const source = await readFile(screenshotPath);
          if (source.byteLength > MAX_SCREENSHOT_FILE_BYTES) throw new Error("Screenshot file is too large.");
          const image = await decodeImageBuffer(source);
          if (!image) throw new Error("Screenshot file is not a supported image.");
          if (generation !== imageCaptureGeneration) return;
          await imageStore.record(image.buffer, image.width, image.height);
          if (generation !== imageCaptureGeneration) return;
          await publishHistory();
        },
        (issue) => reportCaptureIssue("screenshots", issue)
      );
      screenshotMonitor.start();
    }

    app.on("activate", showWindow);
    app.on("before-quit", () => {
      isQuitting = true;
      screenshotMonitor?.stop();
      globalShortcut.unregisterAll();
    });
  }).catch((error: unknown) => {
    console.error("G-paster could not start:", error);
    dialog.showErrorBox(nativeText("G-paster 无法启动"), nativeText("本地数据无法读取。请检查应用数据目录或备份文件后重试。"));
    app.quit();
  });
}
