import { randomUUID } from "node:crypto";
import type { ClipboardEntry, ClipboardEntryKind } from "../src/shared/contracts";
import { readJsonArray, writeJsonArray } from "./atomic-json";

export const MAX_HISTORY_ENTRIES = 300;

export function classifyContent(content: string): ClipboardEntryKind {
  try {
    const parsed = new URL(content.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? "link" : "text";
  } catch {
    return "text";
  }
}

function isEntry(value: unknown): value is ClipboardEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ClipboardEntry>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.content === "string" &&
    (candidate.kind === "text" || candidate.kind === "link") &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.copiedAt === "number"
  );
}

export class HistoryStore {
  private entries: ClipboardEntry[] = [];
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly filePath: string;

  constructor(filePath: string, private limit = MAX_HISTORY_ENTRIES) {
    this.filePath = filePath;
  }

  configureLimit(limit: number): void { this.limit = limit; }

  async list(): Promise<ClipboardEntry[]> {
    await this.mutationQueue;
    await this.ensureLoaded();
    return this.entries.map((entry) => ({ ...entry }));
  }

  async get(id: string): Promise<ClipboardEntry | undefined> {
    await this.mutationQueue;
    await this.ensureLoaded();
    const entry = this.entries.find((candidate) => candidate.id === id);
    return entry ? { ...entry } : undefined;
  }

  async recordClipboardText(content: string, copiedAt = Date.now()): Promise<ClipboardEntry | null> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      if (!content.trim()) return null;

      const existing = this.entries.find((entry) => entry.content === content);
      const entry: ClipboardEntry = existing
        ? { ...existing, copiedAt }
        : { id: randomUUID(), content, kind: classifyContent(content), createdAt: copiedAt, copiedAt };

      const next = [entry, ...this.entries.filter((candidate) => candidate.id !== entry.id)].slice(0, this.limit);
      await this.persist(next);
      this.entries = next;
      return { ...entry };
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const next = this.entries.filter((entry) => entry.id !== id);
      if (next.length === this.entries.length) return false;
      await this.persist(next);
      this.entries = next;
      return true;
    });
  }

  async clear(): Promise<void> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      await this.persist([]);
      this.entries = [];
    });
  }

  async deleteMany(ids: readonly string[]): Promise<void> {
    await this.runExclusive(async () => {
      await this.ensureLoaded();
      const selected = new Set(ids);
      const next = this.entries.filter(entry => !selected.has(entry.id));
      if (next.length === this.entries.length) return;
      await this.persist(next); this.entries = next;
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const entries = (await readJsonArray(this.filePath)).filter(isEntry);
        entries.sort((left, right) => right.copiedAt - left.copiedAt);
        this.entries = entries.slice(0, this.limit);
        this.loaded = true;
      })().finally(() => { this.loadPromise = null; });
    }
    await this.loadPromise;
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async persist(entries: ClipboardEntry[]): Promise<void> {
    await writeJsonArray(this.filePath, entries);
  }
}
