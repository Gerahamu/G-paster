import { contextBridge, ipcRenderer } from "electron";
import type {
  CaptureIssue,
  ClipboardHistoryItem,
  GpasterBridge,
  QuickPhraseDraft,
  QuickPhraseUpdate
} from "../src/shared/contracts";

function initialSystemSettings(): GpasterBridge["initialSystemSettings"] {
  try {
    const argument = process.argv.find((value) => value.startsWith("--gpaster-system-settings="));
    const settings = JSON.parse(decodeURIComponent(argument?.split("=").slice(1).join("=") ?? ""));
    if ((settings.language === "en" || settings.language === "zh") && typeof settings.locale === "string") return settings;
  } catch { /* Main supplies the initial system snapshot; fail safely if absent. */ }
  return { language: "en", locale: "en-US" };
}

const bridge: GpasterBridge = {
  getPreferences: () => ipcRenderer.invoke("preferences:get"),
  updatePreferences: (patch) => ipcRenderer.invoke("preferences:update", patch),
  onPreferencesChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, preferences: Parameters<typeof callback>[0]) => callback(preferences);
    ipcRenderer.on("preferences:changed", listener);
    return () => ipcRenderer.removeListener("preferences:changed", listener);
  },
  setShortcut: (shortcut) => ipcRenderer.invoke("preferences:shortcut", shortcut),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke("preferences:login", enabled),
  setShortcutRecording: (recording) => ipcRenderer.invoke("preferences:recording", recording),
  openDataDirectory: () => ipcRenderer.invoke("preferences:open-data"),
  onSettingsRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("settings:open", listener);
    return () => ipcRenderer.removeListener("settings:open", listener);
  },
  initialSystemSettings: initialSystemSettings(),
  getSystemSettings: async () => (await ipcRenderer.invoke("system:settings")) as GpasterBridge["initialSystemSettings"],
  onSystemSettingsChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: GpasterBridge["initialSystemSettings"]) => callback(settings);
    ipcRenderer.on("system:settings-changed", listener);
    return () => ipcRenderer.removeListener("system:settings-changed", listener);
  },
  listCaptureIssues: async () => (await ipcRenderer.invoke("capture:issues")) as CaptureIssue[],
  onCaptureIssuesChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, issues: CaptureIssue[]) => callback(issues);
    ipcRenderer.on("capture:issues-changed", listener);
    return () => ipcRenderer.removeListener("capture:issues-changed", listener);
  },
  listHistory: async () => (await ipcRenderer.invoke("history:list")) as ClipboardHistoryItem[],
  deleteHistory: async (id) => (await ipcRenderer.invoke("history:delete", id)) as boolean,
  clearHistory: async () => {
    await ipcRenderer.invoke("history:clear");
  },
  copyHistory: async (id) => (await ipcRenderer.invoke("history:copy", id)) as boolean,
  previewImage: async (id) => (await ipcRenderer.invoke("image:preview", id)) as string | null,
  startImageDrag: async (id, dismissAfterDrag = false) => (await ipcRenderer.invoke("image:drag-start", id, dismissAfterDrag)) as boolean,
  startFileDrag: async (id) => (await ipcRenderer.invoke("file:drag-start", id)) as boolean,
  saveImage: async (id) => (await ipcRenderer.invoke("image:save", id)) as boolean,
  listPhrases: async () => (await ipcRenderer.invoke("phrase:list")) as Awaited<ReturnType<GpasterBridge["listPhrases"]>>,
  createPhrase: async (draft: QuickPhraseDraft) => (await ipcRenderer.invoke("phrase:create", draft)) as Awaited<ReturnType<GpasterBridge["createPhrase"]>>,
  updatePhrase: async (update: QuickPhraseUpdate) => (await ipcRenderer.invoke("phrase:update", update)) as Awaited<ReturnType<GpasterBridge["updatePhrase"]>>,
  deletePhrase: async (id) => (await ipcRenderer.invoke("phrase:delete", id)) as boolean,
  copyPhrase: async (id) => (await ipcRenderer.invoke("phrase:copy", id)) as boolean,
  saveHistoryAsPhrase: async (id, category) => (await ipcRenderer.invoke("phrase:save-history", id, category)) as Awaited<ReturnType<GpasterBridge["saveHistoryAsPhrase"]>>,
  saveImageAsPhrase: async (id, category) => (await ipcRenderer.invoke("phrase:save-image", id, category)) as Awaited<ReturnType<GpasterBridge["saveImageAsPhrase"]>>,
  previewPhraseImage: async (id) => (await ipcRenderer.invoke("phrase:preview-image", id)) as string | null,
  importPhraseImage: async (category) => (await ipcRenderer.invoke("phrase:import-image", category)) as Awaited<ReturnType<GpasterBridge["importPhraseImage"]>>,
  setCompactMode: (compact) => ipcRenderer.send("window:compact-mode", compact),
  onHistoryChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, entries: ClipboardHistoryItem[]) => callback(entries);
    ipcRenderer.on("history:changed", listener);
    return () => ipcRenderer.removeListener("history:changed", listener);
  },
  onWindowHidden: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("window:hidden", listener);
    return () => ipcRenderer.removeListener("window:hidden", listener);
  },
  onWindowShown: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("window:shown", listener);
    return () => ipcRenderer.removeListener("window:shown", listener);
  },
  platform: process.platform as GpasterBridge["platform"]
};

contextBridge.exposeInMainWorld("gpaster", bridge);
