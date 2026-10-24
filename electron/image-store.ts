import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readJsonArray, writeJsonArray } from "./atomic-json";
import type { ImageSource } from "../src/shared/contracts";

export const MAX_CLIPBOARD_IMAGES = 10;

export interface StoredImage {
  id: string;
  hash: string;
  fileName: string;
  width: number;
  height: number;
  createdAt: number;
  copiedAt: number;
  sources: ImageSource[];
}

export class ImageStore {
  private entries: StoredImage[] = [];
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly metadataPath: string;
  private readonly imagesDirectory: string;

  constructor(metadataPath: string, private limit = MAX_CLIPBOARD_IMAGES) {
    this.metadataPath = metadataPath;
    this.imagesDirectory = join(dirname(metadataPath), "images");
  }

  configureLimit(limit: number): void { this.limit = limit; }

  async list(): Promise<StoredImage[]> {
    await this.mutationQueue;
    await this.ensureLoaded();
    return this.entries.map((entry) => ({ ...entry, sources: [...entry.sources] }));
  }

  async get(id: string): Promise<StoredImage | undefined> {
    await this.mutationQueue;
    await this.ensureLoaded();
    const entry = this.entries.find((candidate) => candidate.id === id);
    return entry ? { ...entry, sources: [...entry.sources] } : undefined;
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

  async record(buffer: Buffer, width: number, height: number, copiedAt = Date.now(), source: ImageSource = "clipboard"): Promise<StoredImage> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const hash = createHash("sha256").update(buffer).digest("hex");
      const existingIndex = this.entries.findIndex((entry) => entry.hash === hash);
      let entry: StoredImage;

      if (existingIndex >= 0) {
        const existing = this.entries[existingIndex];
        entry = { ...existing, copiedAt, width, height, sources: [...new Set([...existing.sources, source])] };
      } else {
        const id = randomUUID();
        const fileName = `${id}.png`;
        entry = { id, hash, fileName, width, height, createdAt: copiedAt, copiedAt, sources: [source] };
      }

      await mkdir(this.imagesDirectory, { recursive: true });
      const target = join(this.imagesDirectory, entry.fileName);
      await writeFile(target + ".tmp", buffer);
      await rename(target + ".tmp", target);

      const next = [entry, ...this.entries.filter((candidate) => candidate.id !== entry.id)];
      const limit = this.limit;
      const evicted = next.slice(limit);
      try {
        await this.persist(next.slice(0, limit));
      } catch (error) {
        if (existingIndex < 0) await rm(join(this.imagesDirectory, entry.fileName), { force: true }).catch(() => undefined);
        throw error;
      }
      this.entries = next.slice(0, limit);
      await Promise.all(evicted.map((old) => rm(join(this.imagesDirectory, old.fileName), { force: true }).catch(() => undefined)));
      return { ...entry, sources: [...entry.sources] };
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const entry = this.entries.find((candidate) => candidate.id === id);
      if (!entry) return false;
      const previous = this.entries;
      const next = this.entries.filter((candidate) => candidate.id !== id);
      await this.persist(next);
      this.entries = next;
      try {
        await rm(join(this.imagesDirectory, entry.fileName), { force: true });
      } catch (error) {
        try {
          await this.persist(previous);
          this.entries = previous;
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Image deletion failed and its history entry could not be restored");
        }
        throw error;
      }
      return true;
    });
  }

  async clear(): Promise<void> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      await this.persist([]);
      this.entries = [];
      // Scan only app-generated UUID PNGs so a retry can remove leftovers even
      // after the metadata was successfully cleared on an earlier attempt.
      await this.removeGeneratedImageFiles();
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
        const entries = (await readJsonArray(this.metadataPath, { recoverCorrupt: true })).filter((value): value is StoredImage => {
            if (!value || typeof value !== "object") return false;
            const candidate = value as Partial<StoredImage>;
            return typeof candidate.id === "string" &&
              typeof candidate.hash === "string" &&
              typeof candidate.fileName === "string" &&
              /^[\w-]+\.png$/.test(candidate.fileName) &&
              typeof candidate.width === "number" && Number.isFinite(candidate.width) && candidate.width > 0 &&
              typeof candidate.height === "number" && Number.isFinite(candidate.height) && candidate.height > 0 &&
              typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt) && candidate.createdAt >= 0 && candidate.createdAt <= 8.64e15 &&
              typeof candidate.copiedAt === "number" && Number.isFinite(candidate.copiedAt) && candidate.copiedAt >= 0 && candidate.copiedAt <= 8.64e15;
          });
        // Older releases stored a favorite flag. Ignore it while loading and omit it
        // whenever this metadata is next written; keep image bytes and records intact.
        const compatibleEntries = entries.map((entry) => {
          const { isFavorite: _legacyFavorite, ...current } = entry as StoredImage & { isFavorite?: boolean };
          // Missing provenance is left unknown; legacy images stay available in Screenshots.
          const sources = Array.isArray(current.sources)
            ? [...new Set(current.sources.filter((source): source is ImageSource => source === "clipboard" || source === "screenshot"))] : [];
          return { ...current, sources };
        });
        compatibleEntries.sort((left, right) => right.copiedAt - left.copiedAt);
        const limit = this.limit;
        const next = compatibleEntries.slice(0, limit);
        if (compatibleEntries.length > limit) {
          await this.persist(next);
          await Promise.all(compatibleEntries.slice(limit).map((entry) => rm(join(this.imagesDirectory, entry.fileName), { force: true }).catch(() => undefined)));
        }
        this.entries = next;
        this.loaded = true;
      })().finally(() => { this.loadPromise = null; });
    }
    await this.loadPromise;
  }

  private async persist(entries: StoredImage[]): Promise<void> {
    const cleanEntries = entries.map(({ id, hash, fileName, width, height, createdAt, copiedAt, sources }) =>
      ({ id, hash, fileName, width, height, createdAt, copiedAt, sources }));
    await writeJsonArray(this.metadataPath, cleanEntries);
  }

  private async removeGeneratedImageFiles(): Promise<void> {
    let names: string[];
    try { names = await readdir(this.imagesDirectory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const generated = names.filter((name) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/.test(name));
    await Promise.all(generated.map((name) => rm(join(this.imagesDirectory, name), { force: true })));
  }
}
