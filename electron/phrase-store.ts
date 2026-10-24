import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { QuickPhrase, QuickPhraseDraft, QuickPhraseUpdate } from "../src/shared/contracts";
import { readJsonArray, writeJsonArray } from "./atomic-json";

const MAX_PHRASE_LENGTH = 20_000;
const MAX_CATEGORY_LENGTH = 50;

function normalizeDraft(draft: QuickPhraseDraft): QuickPhraseDraft {
  const text = draft.text.trim();
  const category = draft.category.trim() || "未分类";
  if (!text) throw new Error("常用语内容不能为空");
  if (text.length > MAX_PHRASE_LENGTH) throw new Error("常用语内容过长");
  if (category.length > MAX_CATEGORY_LENGTH) throw new Error("分类名称过长");
  return { text, category };
}

function isPhrase(value: unknown): value is QuickPhrase {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<QuickPhrase>;
  const hasImage = candidate.kind !== "image" || (Boolean(candidate.image) &&
    typeof candidate.image?.width === "number" && Number.isFinite(candidate.image.width) && candidate.image.width > 0 &&
    typeof candidate.image?.height === "number" && Number.isFinite(candidate.image.height) && candidate.image.height > 0);
  return typeof candidate.id === "string" && candidate.id.length <= 100 && typeof candidate.text === "string" &&
    typeof candidate.category === "string" &&
    typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt) && candidate.createdAt >= 0 && candidate.createdAt <= 8.64e15 &&
    typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt) && candidate.updatedAt >= 0 && candidate.updatedAt <= 8.64e15 &&
    (candidate.kind === undefined || candidate.kind === "text" || candidate.kind === "image") && hasImage;
}

export class PhraseStore {
  private phrases: QuickPhrase[] = [];
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly imagesDirectory: string;

  constructor(private readonly filePath: string) {
    this.imagesDirectory = join(dirname(filePath), "phrase-images");
  }

  async list(): Promise<QuickPhrase[]> {
    await this.mutationQueue;
    await this.ensureLoaded();
    return this.phrases.map((phrase) => this.clone(phrase));
  }

  async get(id: string): Promise<QuickPhrase | undefined> {
    await this.mutationQueue;
    await this.ensureLoaded();
    const phrase = this.phrases.find((candidate) => candidate.id === id);
    return phrase ? this.clone(phrase) : undefined;
  }

  async create(draft: QuickPhraseDraft, now = Date.now()): Promise<QuickPhrase> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const normalized = normalizeDraft(draft);
      const phrase: QuickPhrase = { id: randomUUID(), ...normalized, createdAt: now, updatedAt: now };
      const next = [phrase, ...this.phrases];
      await this.persist(next);
      this.phrases = next;
      return this.clone(phrase);
    });
  }

  async update(update: QuickPhraseUpdate, now = Date.now()): Promise<QuickPhrase | null> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const index = this.phrases.findIndex((phrase) => phrase.id === update.id);
      if (index < 0) return null;
      const normalized = normalizeDraft(update);
      const phrase = { ...this.phrases[index], ...normalized, updatedAt: now };
      const next = this.phrases.map((item, itemIndex) => itemIndex === index ? phrase : item);
      await this.persist(next);
      this.phrases = next;
      return this.clone(phrase);
    });
  }

  async createImage(buffer: Buffer, width: number, height: number, category: string, now = Date.now()): Promise<QuickPhrase> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const normalizedCategory = category.trim() || "未分类";
      if (normalizedCategory.length > MAX_CATEGORY_LENGTH) throw new Error("分类名称过长");
      if (!buffer.length || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error("图片数据无效");
      }
      const id = randomUUID();
      const target = join(this.imagesDirectory, `${id}.png`);
      const temporary = `${target}.tmp`;
      const phrase: QuickPhrase = { id, text: "", category: normalizedCategory, kind: "image", image: { width, height }, createdAt: now, updatedAt: now };
      await mkdir(this.imagesDirectory, { recursive: true });
      try {
        await writeFile(temporary, buffer, { flag: "wx" });
        await rename(temporary, target);
        const next = [phrase, ...this.phrases];
        await this.persist(next);
        this.phrases = next;
        return this.clone(phrase);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        await rm(target, { force: true }).catch(() => undefined);
        throw error;
      }
    });
  }

  async readImage(id: string): Promise<Buffer | null> {
    const phrase = await this.get(id);
    if (!phrase || phrase.kind !== "image") return null;
    try { return await readFile(this.imagePath(id)); }
    catch { return null; }
  }

  async delete(id: string): Promise<boolean> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const phrase = this.phrases.find((candidate) => candidate.id === id);
      if (!phrase) return false;
      const next = this.phrases.filter((phrase) => phrase.id !== id);
      const assetPath = phrase.kind === "image" ? this.imagePath(id) : null;
      let assetBytes: Buffer | null = null;
      if (assetPath) {
        try {
          assetBytes = await readFile(assetPath);
          await rm(assetPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      try {
        await this.persist(next);
      } catch (error) {
        if (assetBytes && assetPath) {
          try {
            const restorePath = `${assetPath}.restore.tmp`;
            await writeFile(restorePath, assetBytes, { flag: "wx" });
            await rename(restorePath, assetPath);
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], "Image phrase deletion failed and its asset could not be restored");
          }
        }
        throw error;
      }
      this.phrases = next;
      return true;
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const phrases = (await readJsonArray(this.filePath, { recoverCorrupt: true })).filter(isPhrase);
        phrases.sort((left, right) => right.updatedAt - left.updatedAt);
        this.phrases = phrases;
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

  private async persist(phrases: QuickPhrase[]): Promise<void> {
    await writeJsonArray(this.filePath, phrases);
  }

  private imagePath(id: string): string {
    if (!/^[\w-]{1,100}$/.test(id)) throw new Error("Invalid phrase id");
    return join(this.imagesDirectory, `${id}.png`);
  }

  private clone(phrase: QuickPhrase): QuickPhrase {
    return { ...phrase, ...(phrase.image ? { image: { ...phrase.image } } : {}) };
  }
}
