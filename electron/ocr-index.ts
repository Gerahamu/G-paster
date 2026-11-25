import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

interface Item { key: string; path: string }

export class OcrIndex {
  private entries = new Map<string, string>();
  private items = new Map<string, string>();
  private worker: ChildProcessWithoutNullStreams | null = null;
  private running = false;
  private closed = false;
  private persistQueue: Promise<void> = Promise.resolve();
  private indexDirty = false;
  private failures = new Set<string>();

  constructor(private readonly indexPath: string, private readonly executable: string, private readonly changed: () => void) {}

  async load(): Promise<void> {
    try {
      const stored: unknown = JSON.parse(await readFile(this.indexPath, "utf8"));
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        for (const [key, value] of Object.entries(stored)) {
          if (/^(image|phrase):[\w-]+$/.test(key) && typeof value === "string") this.entries.set(key, value.slice(0, 100000));
        }
      }
    } catch { /* Missing or invalid cache can be rebuilt. */ }
  }

  get(key: string): string { return this.entries.get(key) ?? ""; }

  snapshot(): Record<string, string> { return Object.fromEntries(this.entries); }

  reconcile(items: Item[]): void {
    if (this.closed) return;
    this.items = new Map(items.map(item => [item.key, item.path]));
    let removed = false;
    for (const key of this.entries.keys()) {
      if (!this.items.has(key)) { this.entries.delete(key); removed = true; }
    }
    for (const key of this.failures) if (!this.items.has(key)) this.failures.delete(key);
    if (removed) {
      this.indexDirty = true;
      this.changed();
    }
    if (this.indexDirty) void this.persist();
    void this.run();
  }

  private async persist(): Promise<void> {
    this.persistQueue = this.persistQueue.then(async () => {
      if (!this.indexDirty) return;
      this.indexDirty = false;
      await mkdir(dirname(this.indexPath), { recursive: true });
      await writeFile(this.indexPath + ".tmp", JSON.stringify(Object.fromEntries(this.entries)), { mode: 0o600 });
      await rename(this.indexPath + ".tmp", this.indexPath);
    }).catch(() => {
      this.indexDirty = true;
      console.warn("G-paster could not write the image text index; it will retry on the next update.");
    });
    return this.persistQueue;
  }

  private async recognize(path: string): Promise<string> {
    if (!this.worker || this.worker.exitCode !== null || this.worker.signalCode !== null) {
      this.worker = spawn("/usr/bin/nice", ["-n", "10", this.executable], { stdio: ["pipe", "pipe", "pipe"] });
      this.worker.stderr.resume();
      this.worker.stdin.on("error", () => { /* The active request handles a closed pipe. */ });
    }
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      const lines = createInterface({ input: worker.stdout });
      let settled = false;
      const timeout = setTimeout(() => { worker.kill(); finish(new Error("OCR timed out")); }, 120000);
      const finish = (error?: Error, text?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        lines.close();
        worker.removeListener("error", onError);
        worker.removeListener("close", onExit);
        if (error) { if (this.worker === worker) this.worker = null; worker.kill(); reject(error); } else resolve(text ?? "");
      };
      const onError = (error: Error) => finish(error);
      const onExit = () => finish(new Error("OCR process exited"));
      worker.once("error", onError);
      worker.once("close", onExit);
      lines.once("line", line => {
        try {
          const result: unknown = JSON.parse(line);
          if (!result || typeof result !== "object" || typeof (result as { text?: unknown }).text !== "string") throw new Error("OCR failed");
          finish(undefined, (result as { text: string }).text.slice(0, 100000));
        } catch { finish(new Error("OCR failed")); }
      });
      worker.stdin.write(JSON.stringify({ path }) + "\n", error => { if (error) finish(error); });
    });
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.closed) {
        const next = [...this.items].find(([key]) => !this.entries.has(key) && !this.failures.has(key));
        if (!next) break;
        const [key, path] = next;
        try {
          const text = await this.recognize(path);
          if (this.closed || this.items.get(key) !== path) continue;
          this.entries.set(key, text);
          this.indexDirty = true;
          this.changed();
          await this.persist();
        } catch {
          if (this.items.get(key) === path) this.failures.add(key);
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } finally { this.running = false; }
  }

  close(): void { this.closed = true; this.worker?.kill(); this.worker = null; }
}
