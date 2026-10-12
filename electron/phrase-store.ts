import { randomUUID } from "node:crypto";
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
  return typeof candidate.id === "string" && typeof candidate.text === "string" &&
    typeof candidate.category === "string" && typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number";
}

export class PhraseStore {
  private phrases: QuickPhrase[] = [];
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<QuickPhrase[]> {
    await this.mutationQueue;
    await this.ensureLoaded();
    return this.phrases.map((phrase) => ({ ...phrase }));
  }

  async get(id: string): Promise<QuickPhrase | undefined> {
    await this.mutationQueue;
    await this.ensureLoaded();
    const phrase = this.phrases.find((candidate) => candidate.id === id);
    return phrase ? { ...phrase } : undefined;
  }

  async create(draft: QuickPhraseDraft, now = Date.now()): Promise<QuickPhrase> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const normalized = normalizeDraft(draft);
      const phrase: QuickPhrase = { id: randomUUID(), ...normalized, createdAt: now, updatedAt: now };
      const next = [phrase, ...this.phrases];
      await this.persist(next);
      this.phrases = next;
      return { ...phrase };
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
      return { ...phrase };
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const next = this.phrases.filter((phrase) => phrase.id !== id);
      if (next.length === this.phrases.length) return false;
      await this.persist(next);
      this.phrases = next;
      return true;
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const phrases = (await readJsonArray(this.filePath)).filter(isPhrase);
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
}
