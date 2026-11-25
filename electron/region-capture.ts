import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { app, BrowserWindow, desktopCapturer, ipcMain, screen, systemPreferences, type NativeImage } from "electron";
import { decodeImageBuffer } from "./image-codec";
import { withTimeout } from "./async-timeout";

interface Selection { action: "save" | "text"; image: NativeImage }
interface CaptureRect { x: number; y: number; width: number; height: number }

const runFile = promisify(execFile);
export class RegionCaptureError extends Error {
  constructor(readonly stage: "permission" | "capture" | "overlay" | "save" | "text", cause?: unknown) {
    super(stage, { cause });
  }
}

async function listWindows(executable: string): Promise<CaptureRect[]> {
  try {
    const { stdout } = await runFile(executable, ["--list-windows"], { timeout: 1500, maxBuffer: 256 * 1024 });
    return JSON.parse(stdout) as CaptureRect[];
  } catch {
    console.warn("Region capture: window geometry unavailable; manual selection remains available.");
    return [];
  }
}

async function selectRegion(executable: string, language: "zh" | "en"): Promise<Selection | null> {
  const permission = systemPreferences.getMediaAccessStatus("screen");
  if (permission === "denied" || permission === "restricted") {
    throw new RegionCaptureError("permission");
  }
  const displays = screen.getAllDisplays();
  const maxWidth = Math.ceil(Math.max(...displays.map(display => display.size.width * display.scaleFactor)));
  const maxHeight = Math.ceil(Math.max(...displays.map(display => display.size.height * display.scaleFactor)));
  const [sources, candidates] = await Promise.all([
    withTimeout(desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: maxWidth, height: maxHeight }, fetchWindowIcons: false }),
      8_000, "Screen capture timed out")
      .catch(error => { throw new RegionCaptureError("capture", error); }),
    listWindows(executable)
  ]);
  const screens = displays.flatMap(display => {
    const source = sources.find(source => source.display_id === String(display.id)) ?? (displays.length === 1 ? sources[0] : undefined);
    return source && !source.thumbnail.isEmpty() ? [{ display, source }] : [];
  });
  if (!screens.length) throw new RegionCaptureError("capture");
  const pointerDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
  const focusDisplay = screens.find(({ display }) => display.id === pointerDisplay) ?? screens[0];
  return new Promise((resolve, reject) => {
    const windows = new Map<number, { window: BrowserWindow; image: NativeImage; display: CaptureRect }>();
    let finished = false;
    let pending = screens.length;
    const loadTimeout = setTimeout(() => finish(null, new RegionCaptureError("overlay")), 5_000);
    const finish = (result: Selection | null, error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(loadTimeout);
      ipcMain.removeListener("region:finish", onFinish);
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
      if (rect.x < 0 || rect.y < 0 || rect.width < 8 || rect.height < 8 || rect.x + rect.width > item.display.width + 1 || rect.y + rect.height > item.display.height + 1) return;
      const size = item.image.getSize();
      const x1 = Math.max(0, Math.floor(rect.x * size.width / item.display.width));
      const y1 = Math.max(0, Math.floor(rect.y * size.height / item.display.height));
      const x2 = Math.min(size.width, Math.ceil((rect.x + rect.width) * size.width / item.display.width));
      const y2 = Math.min(size.height, Math.ceil((rect.y + rect.height) * size.height / item.display.height));
      if (x2 <= x1 || y2 <= y1) return;
      try {
        finish({ action: data.action, image: item.image.crop({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 }) });
      } catch (error) {
        finish(null, new RegionCaptureError(data.action, error));
      }
    };
    ipcMain.on("region:finish", onFinish);
    for (const { display, source } of screens) {
      try {
        const window = new BrowserWindow({ ...display.bounds, transparent: true, backgroundColor: "#00000000", enableLargerThanScreen: true, roundedCorners: false, frame: false, show: false, skipTaskbar: true, resizable: false, movable: false, hasShadow: false, alwaysOnTop: true, webPreferences: { preload: join(__dirname, "region-capture-preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false } });
        const image = source.thumbnail;
        windows.set(window.webContents.id, { window, image, display: display.bounds });
        window.setAlwaysOnTop(true, "screen-saver");
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        window.on("closed", () => finish(null));
        window.webContents.on("will-navigate", event => event.preventDefault());
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.once("did-finish-load", () => {
          if (finished || window.isDestroyed()) return;
          window.setBounds(display.bounds);
          const bounds = window.getContentBounds();
          const pointer = screen.getCursorScreenPoint();
          window.webContents.send("region:init", {
            language,
            pointer: { x: pointer.x - bounds.x, y: pointer.y - bounds.y },
            candidates: candidates.map(rect => ({ ...rect, x: rect.x - bounds.x, y: rect.y - bounds.y }))
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
  ocrExecutable: string,
  save: (buffer: Buffer, width: number, height: number) => Promise<void>,
  copyText: (text: string) => Promise<void>,
  language: "zh" | "en",
  onProcessing?: (action: Selection["action"]) => void
): Promise<"saved" | "copied" | "empty" | "cancelled"> {
  const selection = await selectRegion(ocrExecutable, language);
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
      const text = await recognizeImage(ocrExecutable, imagePath);
      if (!text.trim()) return "empty";
      await copyText(text);
      return "copied";
    } finally { await rm(directory, { recursive: true, force: true }); }
  } catch (error) {
    throw new RegionCaptureError(selection.action, error);
  }
}

async function recognizeImage(executable: string, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let settled = false;
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    const timer = setTimeout(() => { child.kill(); finish(new Error("Text recognition timed out")); }, 120000);
    function finish(error?: Error, text?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(text ?? "");
    }
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 1_000_000) { child.kill(); finish(new Error("Text recognition output too large")); }
    });
    child.once("error", error => finish(error));
    child.once("close", code => {
      try {
        const parsed = JSON.parse(output) as { text?: unknown };
        if (code !== 0 || typeof parsed.text !== "string") throw new Error("Text recognition failed");
        finish(undefined, parsed.text);
      } catch { finish(new Error("Text recognition failed")); }
    });
    child.stdin.on("error", error => finish(error));
    child.stdin.end(JSON.stringify({ path }) + "\n");
  });
}
