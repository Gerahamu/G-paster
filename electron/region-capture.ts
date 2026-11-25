import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, desktopCapturer, ipcMain, screen, systemPreferences, type NativeImage } from "electron";
import { decodeImageBuffer } from "./image-codec";
import { listCaptureWindows, OcrError } from "./capture-platform";
import type { RecognizeImage } from "./ocr-index";
import { projectWindow, cropRegion } from "./capture-geometry";
import { OperationTimeoutError, withTimeout } from "./async-timeout";

interface Selection { action: "save" | "text"; image: NativeImage }
interface CaptureRect { x: number; y: number; width: number; height: number }

export class RegionCaptureError extends Error {
  constructor(readonly stage: "permission" | "capture" | "overlay" | "save" | "text", cause?: unknown) {
    super(stage, { cause });
  }
}

async function selectRegion(language: "zh" | "en"): Promise<Selection | null> {
  const windowsPlatform = process.platform === "win32";
  if (process.platform === "darwin") {
    const permission = systemPreferences.getMediaAccessStatus("screen");
    if (permission === "denied" || permission === "restricted") throw new RegionCaptureError("permission");
  }
  const displays = screen.getAllDisplays();
  const maxWidth = Math.ceil(Math.max(...displays.map(display => display.size.width * display.scaleFactor)));
  const maxHeight = Math.ceil(Math.max(...displays.map(display => display.size.height * display.scaleFactor)));
  const [sources, candidates] = await Promise.all([
    withTimeout(desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: maxWidth, height: maxHeight }, fetchWindowIcons: false }),
      8_000, "Screen capture timed out")
      .catch(error => { throw new RegionCaptureError("capture", error); }),
    listCaptureWindows()
  ]);
  const screens = displays.flatMap(display => {
    const source = sources.find(source => source.display_id === String(display.id)) ?? (displays.length === 1 ? sources[0] : undefined);
    return source && !source.thumbnail.isEmpty() ? [{ display, source }] : [];
  });
  if (!screens.length || (windowsPlatform && screens.length !== displays.length)) throw new RegionCaptureError("capture");
  const pointerDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
  const focusDisplay = screens.find(({ display }) => display.id === pointerDisplay) ?? screens[0];
  return new Promise((resolve, reject) => {
    const windows = new Map<number, { window: BrowserWindow; image: NativeImage; display: CaptureRect }>();
    let finished = false;
    let pending = screens.length;
    const loadTimeout = setTimeout(() => finish(null, new RegionCaptureError("overlay", new OperationTimeoutError("Capture overlay timed out"))), 5_000);
    const finish = (result: Selection | null, error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(loadTimeout);
      ipcMain.removeListener("region:finish", onFinish);
      screen.removeListener("display-added", onDisplayChange);
      screen.removeListener("display-removed", onDisplayChange);
      screen.removeListener("display-metrics-changed", onDisplayChange);
      for (const item of windows.values()) if (!item.window.isDestroyed()) item.window.destroy();
      if (error) reject(error); else resolve(result);
    };
    const onFinish = (event: Electron.IpcMainEvent, value: unknown) => {
      const item = windows.get(event.sender.id);
      if (!item || event.senderFrame !== item.window.webContents.mainFrame || !value || typeof value !== "object") return;
      const data = value as { action?: unknown; rect?: Partial<CaptureRect> };
      if (data.action === "cancel") { finish(null); return; }
      if ((data.action !== "save" && data.action !== "text") || !data.rect) return;
      const { x, y, width, height } = data.rect;
      if (![x, y, width, height].every(v => typeof v === "number" && Number.isFinite(v))) return;
      const viewport = item.window.getContentBounds();
      const rect = { x: x! + viewport.x - item.display.x, y: y! + viewport.y - item.display.y, width: width!, height: height! };
      const crop = cropRegion(rect, item.display, item.image.getSize());
      if (!crop) return;
      try {
        const image = item.image.crop(crop);
        if (image.isEmpty()) throw new Error("The selected region is empty");
        finish({ action: data.action, image });
      } catch (error) {
        finish(null, new RegionCaptureError(data.action, error));
      }
    };
    const onDisplayChange = () => finish(null, new RegionCaptureError("capture"));
    screen.on("display-added", onDisplayChange);
    screen.on("display-removed", onDisplayChange);
    screen.on("display-metrics-changed", onDisplayChange);
    ipcMain.on("region:finish", onFinish);
    for (const { display, source } of screens) {
      try {
        const window = new BrowserWindow({ ...display.bounds, transparent: !windowsPlatform, backgroundColor: windowsPlatform ? "#171a1f" : "#00000000", useContentSize: true, enableLargerThanScreen: true, roundedCorners: false, frame: false, show: false, skipTaskbar: true, resizable: false, movable: false, hasShadow: false, alwaysOnTop: true, webPreferences: { preload: join(__dirname, "region-capture-preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false } });
        const image = source.thumbnail;
        windows.set(window.webContents.id, { window, image, display: display.bounds });
        window.setAlwaysOnTop(true, "screen-saver");
        if (process.platform === "darwin") window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        window.on("closed", () => finish(null));
        window.webContents.on("will-navigate", event => event.preventDefault());
        window.webContents.on("before-input-event", (event, input) => {
          if (input.type === "keyDown" && input.key === "Escape") {
            event.preventDefault();
            finish(null);
          }
        });
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.once("did-finish-load", () => {
          if (finished || window.isDestroyed()) return;
          window.setBounds(display.bounds);
          const bounds = window.getContentBounds();
          const pointer = screen.getCursorScreenPoint();
          const physical = windowsPlatform ? screen.dipToScreenRect(null, display.bounds) : null;
          const visibleCandidates = physical ? candidates.flatMap(rect => {
            const cropped = projectWindow(rect, physical, display.bounds, bounds);
            return cropped ? [cropped] : [];
          }) : candidates.map(rect => ({ ...rect, x: rect.x - bounds.x, y: rect.y - bounds.y }));
          window.webContents.send("region:init", {
            language,
            pointer: { x: pointer.x - bounds.x, y: pointer.y - bounds.y },
            candidates: visibleCandidates,
            backdrop: windowsPlatform ? "data:image/jpeg;base64," + image.toJPEG(85).toString("base64") : undefined
          });
          window.showInactive();
          if (focusDisplay.display.id === display.id) window.focus();
          if (--pending === 0) clearTimeout(loadTimeout);
        });
        window.webContents.once("render-process-gone", () => finish(null, new RegionCaptureError("overlay")));
        void window.loadFile(join(app.getAppPath(), "assets", "region-capture.html"))
          .catch(error => finish(null, new RegionCaptureError("overlay", error)));
      } catch (error) {
        finish(null, new RegionCaptureError("overlay", error));
        break;
      }
    }
  });
}

export async function captureRegion(
  recognize: RecognizeImage | undefined,
  save: (buffer: Buffer, width: number, height: number) => Promise<void>,
  copyText: (text: string) => Promise<void>,
  language: "zh" | "en",
  onProcessing?: (action: Selection["action"]) => void
): Promise<"saved" | "copied" | "empty" | "cancelled"> {
  const selection = await selectRegion(language);
  if (!selection) return "cancelled";
  onProcessing?.(selection.action);
  try {
    const decoded = await decodeImageBuffer(selection.image.toPNG());
    if (!decoded) throw new Error("Could not read selected image");
    const { buffer, width, height } = decoded;
    if (selection.action === "save") {
      await save(buffer, width, height);
      return "saved";
    }
    const directory = await mkdtemp(join(tmpdir(), "gpaster-region-"));
    const imagePath = join(directory, "selection.png");
    try {
      await writeFile(imagePath, buffer, { mode: 0o600 });
      if (!recognize) throw new OcrError("ocr-failed");
      const text = await recognize(imagePath);
      if (!text.trim()) return "empty";
      await copyText(text);
      return "copied";
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
        .catch(() => console.warn("Could not remove the temporary capture image."));
    }
  } catch (error) {
    throw new RegionCaptureError(selection.action, error);
  }
}
