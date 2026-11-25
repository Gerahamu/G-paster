import { BrowserWindow, screen } from "electron";

type Feedback = "saving" | "recognizing" | "saved" | "copied" | "empty";
const content = {
  saving: { zh: "正在保存截图…", en: "Saving screenshot…" },
  recognizing: { zh: "正在识别文字…", en: "Recognizing text…" },
  saved: { zh: "截图已保存", en: "Screenshot saved" },
  copied: { zh: "文字已复制", en: "Text copied" },
  empty: { zh: "未识别到文字", en: "No text recognized" }
};

export class CaptureFeedback {
  private window?: BrowserWindow;
  private timer?: NodeJS.Timeout;

  processing(action: "save" | "text", language: "zh" | "en"): void {
    this.dismiss();
    this.timer = setTimeout(() => this.show(action === "save" ? "saving" : "recognizing", language), 250);
  }

  complete(result: "saved" | "copied" | "empty", language: "zh" | "en"): void {
    this.show(result, language);
  }

  dismiss(): boolean {
    clearTimeout(this.timer);
    this.timer = undefined;
    const window = this.window;
    this.window = undefined;
    const visible = Boolean(window && !window.isDestroyed() && window.isVisible());
    if (window && !window.isDestroyed()) window.destroy();
    return visible;
  }

  private show(feedback: Feedback, language: "zh" | "en"): void {
    this.dismiss();
    const progress = feedback === "saving" || feedback === "recognizing";
    const success = feedback === "saved" || feedback === "copied";
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const width = 244;
    const height = 58;
    let window: BrowserWindow;
    try {
      window = new BrowserWindow({
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: workArea.y + workArea.height - height - 28,
        width, height,
        frame: false,
        show: false,
        transparent: true,
        resizable: false,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
      });
      this.window = window;
      window.setIgnoreMouseEvents(true);
      window.setAlwaysOnTop(true, "floating");
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      // The page interpolates only fixed labels and classes, never captured text.
      const page = `<!doctype html><html lang="${language}"><meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
        <style>
          :root { color-scheme: light dark; }
          body { margin: 0; user-select: none; font: 600 13px -apple-system, BlinkMacSystemFont, sans-serif; }
          .toast {
            width: max-content; max-width: calc(100% - 36px); box-sizing: border-box;
            margin: 5px auto; padding: 9px 14px; display: flex; align-items: center; gap: 8px;
            border-radius: 13px; border: 1px solid #d9e0dc; background: #fbfcfb; color: #242c27;
            box-shadow: 0 3px 10px #18291f26;
          }
          .icon { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; color: #66706a; }
          .success { color: #477455; background: #e2f2e7; }
          .progress { box-sizing: border-box; border: 2px solid #91a09966; border-top-color: #567367; animation: spin .85s linear infinite; }
          @keyframes spin { to { transform: rotate(360deg); } }
          @media (prefers-reduced-motion: reduce) { .progress { animation: none; } }
          @media (prefers-color-scheme: dark) {
            .toast { color: #edf3ef; background: #242b27; border-color: #46534b; }
            .icon { color: #b1beb5; }
            .success { color: #9bceb3; background: #305541; }
            .progress { border-top-color: #9bceb3; }
          }
        </style>
        <body><div class="toast" role="status"><span aria-hidden="true" class="icon ${progress ? "progress" : success ? "success" : ""}">${success ? "✓" : progress ? "" : "–"}</span>${content[feedback][language]}</div></body></html>`;
      void window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(page)).then(() => {
        if (this.window !== window || window.isDestroyed()) return;
        window.showInactive();
        if (!progress) this.timer = setTimeout(() => this.dismiss(), 3000);
      }).catch(() => {
        if (this.window === window) this.dismiss();
      });
    } catch {
      this.dismiss();
    }
  }
}
