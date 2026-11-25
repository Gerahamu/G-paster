import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("regionCapture", {
  onInit: (callback: (data: { language: string; backdrop?: string; pointer: { x: number; y: number }; candidates: Array<{ x: number; y: number; width: number; height: number }> }) => void) => {
    ipcRenderer.once("region:init", (_event, data) => callback(data));
  },
  finish: (action: "save" | "text" | "cancel", rect?: { x: number; y: number; width: number; height: number }) => {
    ipcRenderer.send("region:finish", { action, rect });
  }
});
