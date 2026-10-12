import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readJsonArray, writeJsonArray } from "./atomic-json";

export const MAX_CLIPBOARD_IMAGES = 10;

export interface StoredImage {
  id: string;
  hash: string;
  fileName: string;
  width: number;
  height: number;
  createdAt: number;
  copiedAt: number;
  isFavorite: boolean;
}

export class ImageStore {
  private entries: StoredImage[] = [];
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly metadataPath: string;
  private readonly imagesDirectory: string;

  constructor(metadataPath: string) {
    this.metadataPath = metadataPath;
    this.imagesDirectory = join(dirname(metadataPath), "images");
  }

  async list(): Promise<StoredImage[]> {
    await this.mutationQueue;
    await this.ensureLoaded();
    return this.entries.map((entry) => ({ ...entry }));
  }

  async get(id: string): Promise<StoredImage | undefined> {
    await this.mutationQueue;
    await this.ensureLoaded();
    const entry = this.entries.find((candidate) => candidate.id === id);
    return entry ? { ...entry } : undefined;
  }

  async read(id: string): Promise<Buffer | null> {
    const entry = await this.get(id);
    if (!entry) return null;
    try {
      const bytes = await readFile(join(this.imagesDirectory, entry.fileName));
      return createHash("sha256").update(bytes).digest("hex") === entry.hash ? bytes : null;
    } catch {
      return null;
    }
  }

  async getFilePath(id: string): Promise<string | null> {
    const entry = await this.get(id);
    if (!entry || !(await this.read(id))) return null;
    return join(this.imagesDirectory, entry.fileName);
  }

  async record(buffer: Buffer, width: number, height: number, copiedAt = Date.now()): Promise<StoredImage> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const hash = createHash("sha256").update(buffer).digest("hex");
      const existingIndex = this.entries.findIndex((entry) => entry.hash === hash);
      let entry: StoredImage;

      if (existingIndex >= 0) {
        const existing = this.entries[existingIndex];
        entry = { ...existing, copiedAt, width, height };
      } else {
        const id = randomUUID();
        const fileName = `${id}.png`;
        entry = { id, hash, fileName, width, height, createdAt: copiedAt, copiedAt, isFavorite: false };
      }

      await mkdir(this.imagesDirectory, { recursive: true });
      const target = join(this.imagesDirectory, entry.fileName);
      await writeFile(target + ".tmp", buffer);
      await rename(target + ".tmp", target);

      const next = [entry, ...this.entries.filter((candidate) => candidate.id !== entry.id)];
      const evicted = next.slice(MAX_CLIPBOARD_IMAGES);
      try {
        await this.persist(next.slice(0, MAX_CLIPBOARD_IMAGES));
      } catch (error) {
        if (existingIndex < 0) await rm(join(this.imagesDirectory, entry.fileName), { force: true }).catch(() => undefined);
        throw error;
      }
      this.entries = next.slice(0, MAX_CLIPBOARD_IMAGES);
      await Promise.all(evicted.map((old) => rm(join(this.imagesDirectory, old.fileName), { force: true }).catch(() => undefined)));
      return { ...entry };
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const entry = this.entries.find((candidate) => candidate.id === id);
      if (!entry) return false;
      const next = this.entries.filter((candidate) => candidate.id !== id);
      await this.persist(next);
      this.entries = next;
      await rm(join(this.imagesDirectory, entry.fileName), { force: true }).catch(() => undefined);
      return true;
    });
  }

  async clear(): Promise<void> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const previous = this.entries;
      await this.persist([]);
      this.entries = [];
      await Promise.all(previous.map((entry) => rm(join(this.imagesDirectory, entry.fileName), { force: true }).catch(() => undefined)));
    });
  }

  async toggleFavorite(id: string): Promise<boolean> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const entry = this.entries.find((candidate) => candidate.id === id);
      if (!entry) return false;
      const updated = { ...entry, isFavorite: !entry.isFavorite };
      const next = this.entries.map((candidate) => candidate.id === id ? updated : candidate);
      await this.persist(next);
      this.entries = next;
      return updated.isFavorite;
    });
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const entries = (await readJsonArray(this.metadataPath)).filter((value): value is StoredImage => {
            if (!value || typeof value !== "object") return false;
            const candidate = value as Partial<StoredImage>;
            return typeof candidate.id === "string" &&
              typeof candidate.hash === "string" &&
              typeof candidate.fileName === "string" &&
              /^[\w-]+\.png$/.test(candidate.fileName) &&
              typeof candidate.width === "number" && typeof candidate.height === "number" &&
              typeof candidate.createdAt === "number" && typeof candidate.copiedAt === "number" &&
              typeof candidate.isFavorite === "boolean";
          });
        entries.sort((left, right) => right.copiedAt - left.copiedAt);
        const next = entries.slice(0, MAX_CLIPBOARD_IMAGES);
        if (entries.length > MAX_CLIPBOARD_IMAGES) {
          await this.persist(next);
          await Promise.all(entries.slice(MAX_CLIPBOARD_IMAGES).map((entry) => rm(join(this.imagesDirectory, entry.fileName), { force: true }).catch(() => undefined)));
        }
        this.entries = next;
        this.loaded = true;
      })().finally(() => { this.loadPromise = null; });
    }
    await this.loadPromise;
  }

  private async persist(entries: StoredImage[]): Promise<void> {
    await writeJsonArray(this.metadataPath, entries);
  }
}
