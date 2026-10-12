import { contextBridge, ipcRenderer } from "electron";
import type {
  ClipboardHistoryItem,
  GpasterBridge,
  QuickPhraseDraft,
  QuickPhraseUpdate
} from "../src/shared/contracts";

const bridge: GpasterBridge = {
  listHistory: async () => (await ipcRenderer.invoke("history:list")) as ClipboardHistoryItem[],
  deleteHistory: async (id) => (await ipcRenderer.invoke("history:delete", id)) as boolean,
  clearHistory: async () => {
    await ipcRenderer.invoke("history:clear");
  },
  copyHistory: async (id) => (await ipcRenderer.invoke("history:copy", id)) as boolean,
  toggleImageFavorite: async (id) => (await ipcRenderer.invoke("image:favorite", id)) as boolean,
  previewImage: async (id) => (await ipcRenderer.invoke("image:preview", id)) as string | null,
  startImageDrag: async (id) => (await ipcRenderer.invoke("image:drag-start", id)) as boolean,
  saveImage: async (id) => (await ipcRenderer.invoke("image:save", id)) as boolean,
  listPhrases: async () => (await ipcRenderer.invoke("phrase:list")) as Awaited<ReturnType<GpasterBridge["listPhrases"]>>,
  createPhrase: async (draft: QuickPhraseDraft) => (await ipcRenderer.invoke("phrase:create", draft)) as Awaited<ReturnType<GpasterBridge["createPhrase"]>>,
  updatePhrase: async (update: QuickPhraseUpdate) => (await ipcRenderer.invoke("phrase:update", update)) as Awaited<ReturnType<GpasterBridge["updatePhrase"]>>,
  deletePhrase: async (id) => (await ipcRenderer.invoke("phrase:delete", id)) as boolean,
  copyPhrase: async (id) => (await ipcRenderer.invoke("phrase:copy", id)) as boolean,
  saveHistoryAsPhrase: async (id, category) => (await ipcRenderer.invoke("phrase:save-history", id, category)) as Awaited<ReturnType<GpasterBridge["saveHistoryAsPhrase"]>>,
  setCompactMode: (compact) => ipcRenderer.send("window:compact-mode", compact),
  onHistoryChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, entries: ClipboardHistoryItem[]) => callback(entries);
    ipcRenderer.on("history:changed", listener);
    return () => ipcRenderer.removeListener("history:changed", listener);
  },
  onWindowShown: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("window:shown", listener);
    return () => ipcRenderer.removeListener("window:shown", listener);
  },
  platform: process.platform as GpasterBridge["platform"]
};

contextBridge.exposeInMainWorld("gpaster", bridge);
