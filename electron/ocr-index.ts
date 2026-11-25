import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeRename } from "./atomic-json";
import { withTimeout } from "./async-timeout";
import { FILE_OPERATION_TIMEOUT_MS, MAX_IMAGE_SOURCE_BYTES } from "./image-limits";

interface Item { key: string; path: string }
interface Entry { fingerprint: string; text: string }
export type RecognizeImage = (path: string, signal?: AbortSignal, background?: boolean) => Promise<string>;

async function fingerprint(path: string): Promise<string | undefined> {
  try {
    const info = await withTimeout(stat(path), FILE_OPERATION_TIMEOUT_MS, "OCR image stat timed out");
    if (info.isFile() && info.size > 0 && info.size <= MAX_IMAGE_SOURCE_BYTES) {
      return JSON.stringify([path, info.size, info.mtimeMs, info.ctimeMs]);
    }
  } catch { /* A missing or inaccessible image is checked again on the next scan. */ }
}

export class OcrIndex {
  private readonly entries = new Map<string, Entry>();
  private readonly visible = new Map<string, string>();
  private readonly failures = new Map<string, { fingerprint: string; retryAt: number; attempts: number }>();
  private readonly abort = new AbortController();
  private items = new Map<string, string>();
  private timer?: NodeJS.Timeout;
  private persistTimer?: NodeJS.Timeout;
  private running = false;
  private writeTask?: Promise<void>;
  private dirty = false;
  private revision = 0;

  constructor(private readonly indexPath: string, private readonly recognize: RecognizeImage,
    private readonly changed: () => void, private readonly scanMs = 10_000) {}

  async load(): Promise<void> {
    try {
      const stored: unknown = JSON.parse(await readFile(this.indexPath, "utf8"));
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        for (const [key, value] of Object.entries(stored)) {
          if (!/^(image|phrase|file):[\w-]{1,100}$/.test(key) || !value || typeof value !== "object") continue;
          if (typeof value.fingerprint === "string" && typeof value.text === "string") {
            this.entries.set(key, { fingerprint: value.fingerprint, text: value.text.slice(0, 100_000) });
          }
        }
      }
    } catch { /* The cache can be rebuilt from local image files. */ }
  }

  snapshot(): Record<string, string> { return Object.fromEntries(this.visible); }

  reconcile(items: Item[]): void {
    if (this.abort.signal.aborted) return;
    const next = new Map(items.map(({ key, path }) => [key, path]));
    if (next.size !== this.items.size || [...next].some(([key, path]) => this.items.get(key) !== path)) ++this.revision;
    let changed = false;
    for (const key of this.entries.keys()) {
      if (!next.has(key) || (this.items.has(key) && this.items.get(key) !== next.get(key))) {
        this.entries.delete(key);
        changed = this.visible.delete(key) || changed;
        this.persist();
      }
    }
    for (const key of this.failures.keys()) if (this.items.get(key) !== next.get(key)) this.failures.delete(key);
    this.items = next;
    if (changed) this.changed();
    this.schedule(0);
  }

  invalidate(): void {
    if (this.abort.signal.aborted) return;
    ++this.revision;
    this.entries.clear();
    this.visible.clear();
    this.failures.clear();
    this.changed();
    this.persist();
    this.schedule(0);
  }

  private schedule(ms: number): void {
    if (this.running || this.abort.signal.aborted) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.scan(); }, ms);
    this.timer.unref();
  }

  private async scan(): Promise<void> {
    if (this.abort.signal.aborted) return;
    this.running = true;
    const revision = this.revision;
    const workUntil = Date.now() + 3000;
    let pending = false;
    const valid = (key: string, path: string) => this.items.get(key) === path && !this.abort.signal.aborted;
    try {
      // Validate cached results before exposing them and check externally deleted files even while idle.
      const items = await Promise.all([...this.items].map(async ([key, path]) => ({ key, path, stamp: await fingerprint(path) })));
      if (revision !== this.revision || this.abort.signal.aborted) return;
      let changed = false;
      for (const { key, stamp } of items) {
        const cached = this.entries.get(key);
        if (cached && cached.fingerprint === stamp) {
          if (cached.text && this.visible.get(key) !== cached.text) { this.visible.set(key, cached.text); changed = true; }
        } else {
          if (cached) { this.entries.delete(key); this.persist(); }
          changed = this.visible.delete(key) || changed;
        }
      }
      if (changed) this.changed();
      for (const { key, path, stamp } of items) {
        if (revision !== this.revision || this.abort.signal.aborted) break;
        if (!stamp || this.entries.has(key)) continue;
        const previous = this.failures.get(key);
        if (previous?.fingerprint === stamp && previous.retryAt > Date.now()) continue;
        if (Date.now() > workUntil) { pending = true; break; }
        try {
          const text = (await this.recognize(path, this.abort.signal, true)).slice(0, 100_000);
          if (await fingerprint(path) !== stamp || revision !== this.revision || !valid(key, path)) continue;
          this.entries.set(key, { fingerprint: stamp, text });
          this.failures.delete(key);
          if (text) { this.visible.set(key, text); this.changed(); }
          this.persist();
        } catch {
          if (revision !== this.revision || !valid(key, path)) continue;
          const attempts = previous?.fingerprint === stamp ? previous.attempts + 1 : 1;
          this.failures.set(key, { fingerprint: stamp, attempts,
            retryAt: Date.now() + Math.min(300_000, this.scanMs * 2 ** Math.min(attempts - 1, 5)) });
        }
      }
    } finally {
      this.running = false;
      this.schedule(revision !== this.revision ? 0 : pending ? 150 : this.scanMs);
    }
  }

  private persist(): void {
    this.dirty = true;
    if (!this.writeTask && !this.persistTimer && !this.abort.signal.aborted) this.scheduleWrite(100);
  }

  private scheduleWrite(ms: number): void {
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.writeTask = this.write();
    }, ms);
    this.persistTimer.unref();
  }

  private async write(): Promise<void> {
    this.dirty = false;
    let failed = false;
    try {
      const snapshot = JSON.stringify(Object.fromEntries(this.entries));
      await mkdir(dirname(this.indexPath), { recursive: true });
      await writeFile(this.indexPath + ".tmp", snapshot, { mode: 0o600 });
      await safeRename(this.indexPath + ".tmp", this.indexPath);
    } catch {
      this.dirty = true;
      failed = true;
    } finally {
      this.writeTask = undefined;
      if (this.dirty && !this.abort.signal.aborted) this.scheduleWrite(failed ? this.scanMs : 100);
    }
  }

  async close(): Promise<void> {
    this.abort.abort();
    clearTimeout(this.timer);
    clearTimeout(this.persistTimer);
    await this.writeTask;
    if (this.dirty) await this.write();
    if (this.dirty) console.warn("G-paster couldn't write the image text cache; it will be reconciled on restart.");
  }
}
