import { Component, type ErrorInfo, type ReactNode } from "react";

interface State { failed: boolean }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    // Keep diagnostics content-free; clipboard text must never be logged.
    console.error("G-paster renderer error:", error instanceof Error ? error.name : "unknown");
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const zh = navigator.language.toLowerCase().startsWith("zh");
    return <div style={{ display: "grid", height: "100%", placeItems: "center", padding: 24, fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
      <div>
        <h1 style={{ fontSize: 15 }}>G-paster</h1>
        <p style={{ fontSize: 12, lineHeight: 1.5 }}>{zh ? "界面发生异常，请重新加载。" : "The interface encountered an error. Reload to continue."}</p>
        <button type="button" onClick={() => window.location.reload()}>{zh ? "重新加载" : "Reload"}</button>
      </div>
    </div>;
  }
}
