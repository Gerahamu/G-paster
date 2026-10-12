import type { GpasterBridge } from "./contracts";

declare global {
  interface Window {
    gpaster: GpasterBridge;
  }
}

export {};
