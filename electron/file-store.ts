import { randomUUID } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { access, chmod, lstat, mkdir, open, readdir, readlink, rename, rm, stat, statfs, symlink, utimes } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ClipboardFileEntry, FileCopyState } from "../src/shared/contracts";
import { readJsonArray, writeJsonArray } from "./atomic-json";
import { fileReferenceKey, MAX_FILE_REFERENCES } from "./clipboard-files";

export const FILE_COPY_BATCH_BYTES = 100 * 1024 * 1024;
export const FILE_COPY_TOTAL_BYTES = 500 * 1024 * 1024;
const MAX_COPY_ITEMS = 10_000;
const ENTRY_OVERHEAD_BYTES = 4096;
const COPY_ROOT = /^snapshot-[0-9a-f-]{36}$/;
const OWNED_ROOT = /^(?:snapshot|stage)-[0-9a-f-]{36}$/;

interface StoredFileReference {
  name: string;
  originalPath: string;
  isDirectory: boolean;
  extension: string;
  size: number | null;
}
export interface StoredFileEntry {
  id: string;
  hash: string;
  kind: "file";
  files: StoredFileReference[];
  createdAt: number;
  copiedAt: number;
  copyState: FileCopyState;
  copyRoot?: string;
  copyToken: string;
}

class CopyLimitError extends Error {}

async function mapLimited<T, U>(values: readonly T[], operation: (value: T, index: number) => Promise<U>, concurrency = 8): Promise<U[]> {
  const result = new Array<U>(values.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) { const current = index++; result[current] = await operation(values[current], current); }
  }));
  return result;
}

function inside(parent: string, path: string): boolean {
  const value = relative(parent, path);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

function clone(entry: StoredFileEntry): StoredFileEntry {
  return { ...entry, files: entry.files.map(file => ({ ...file })) };
}

function validEntry(value: unknown): value is StoredFileEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as StoredFileEntry;
  return typeof entry.id === "string" && /^[\w-]+$/.test(entry.id) && entry.kind === "file" &&
    typeof entry.hash === "string" && typeof entry.copyToken === "string" &&
    Number.isFinite(entry.createdAt) && Number.isFinite(entry.copiedAt) &&
    ["reference", "pending", "saved", "failed", "limit"].includes(entry.copyState) &&
    (entry.copyRoot === undefined || (typeof entry.copyRoot === "string" && COPY_ROOT.test(entry.copyRoot))) &&
    Array.isArray(entry.files) && entry.files.length > 0 && entry.files.length <= MAX_FILE_REFERENCES && entry.files.every(file =>
      file && typeof file.originalPath === "string" && isAbsolute(file.originalPath) && !file.originalPath.includes("\0") &&
      typeof file.name === "string" && !!file.name && file.name !== "." && file.name !== ".." && basename(file.name) === file.name &&
      !file.name.includes("\0") && typeof file.isDirectory === "boolean" && typeof file.extension === "string" &&
      (file.size === null || (Number.isFinite(file.size) && file.size >= 0)));
}

export class FileStore {
  private entries: StoredFileEntry[] = [];
  private loadPromise: Promise<void> | null = null;
  private loaded = false;
  private mutationQueue: Promise<void> = Promise.resolve();
  private copyQueue: Promise<unknown> = Promise.resolve();
  private scheduled = new Map<string, Promise<StoredFileEntry | null>>();
  private activeCopy: AbortController | null = null;
  private stopped = false;
  private readonly copiesDirectory: string;

  constructor(private readonly metadataPath: string) {
    this.copiesDirectory = join(dirname(metadataPath), "managed-files");
  }

  async list(): Promise<StoredFileEntry[]> {
    await this.mutationQueue; await this.ensureLoaded();
    return this.entries.map(clone);
  }

  async get(id: string): Promise<StoredFileEntry | undefined> {
    return (await this.list()).find(entry => entry.id === id);
  }

  async listHistory(): Promise<ClipboardFileEntry[]> {
    return mapLimited(await this.list(), async entry => {
      const paths = await this.resolveEntryPaths(entry);
      const copyState = entry.copyState === "saved" && (!entry.copyRoot || paths.some((path, index) =>
        path !== join(this.copiesDirectory, entry.copyRoot!, String(index), entry.files[index].name))) ? "failed" : entry.copyState;
      return { id: entry.id, kind: "file", content: entry.files.map(file => file.name).join(", "),
        createdAt: entry.createdAt, copiedAt: entry.copiedAt, copyState,
        files: entry.files.map((file, index) => ({ ...file, available: paths[index] !== null })),
        available: paths.every(path => path !== null) };
    }, 4);
  }

  async resolvePaths(id: string): Promise<string[] | null> {
    const entry = await this.get(id);
    if (!entry) return null;
    const paths = await this.resolveEntryPaths(entry);
    return paths.every((path): path is string => path !== null) ? paths : null;
  }

  async record(paths: readonly string[], saveCopies: boolean, copiedAt = Date.now()): Promise<StoredFileEntry> {
    if (!paths.length || paths.length > MAX_FILE_REFERENCES || paths.some(path => !isAbsolute(path) || path.includes("\0"))) throw new Error("Invalid file references");
    const normalized = paths.map(path => resolve(path));
    return this.exclusive(async () => {
      await this.ensureLoaded();
      const restored = this.entries.find(entry => entry.copyRoot && entry.files.length === normalized.length &&
        entry.files.every((file, index) => join(this.copiesDirectory, entry.copyRoot!, String(index), file.name) === normalized[index]));
      if (restored) {
        const entry = { ...restored, copiedAt };
        const next = [entry, ...this.entries.filter(item => item.id !== entry.id)];
        await writeJsonArray(this.metadataPath, next); this.entries = next; return clone(entry);
      }
      if (normalized.some(path => inside(this.copiesDirectory, path))) throw new Error("文件引用已失效，请从原始位置重新复制。");
      const files = await mapLimited(normalized, async originalPath => {
        let info; try { info = await stat(originalPath); } catch { /* Keep unavailable references visible. */ }
        return { originalPath, name: basename(originalPath) || "Root", isDirectory: info?.isDirectory() ?? false,
          extension: info?.isDirectory() ? "" : extname(originalPath).slice(1).toLowerCase(), size: info?.isFile() ? info.size : null };
      });
      const hash = fileReferenceKey(normalized);
      const existing = this.entries.find(entry => entry.hash === hash);
      const requestCopy = saveCopies && !existing?.copyRoot && existing?.copyState !== "pending";
      const entry: StoredFileEntry = { id: existing?.id ?? randomUUID(), hash, kind: "file", files,
        createdAt: existing?.createdAt ?? copiedAt, copiedAt,
        copyState: requestCopy ? "pending" : existing?.copyState ?? "reference",
        copyRoot: existing?.copyRoot, copyToken: requestCopy ? randomUUID() : existing?.copyToken ?? randomUUID() };
      const next = [entry, ...this.entries.filter(item => item.id !== entry.id)];
      await writeJsonArray(this.metadataPath, next); this.entries = next;
      return clone(entry);
    });
  }

  async touch(id: string, copiedAt = Date.now()): Promise<void> {
    await this.exclusive(async () => {
      await this.ensureLoaded();
      const entry = this.entries.find(item => item.id === id); if (!entry) return;
      const next = [{ ...entry, copiedAt }, ...this.entries.filter(item => item.id !== id)];
      await writeJsonArray(this.metadataPath, next); this.entries = next;
    });
  }

  async deleteMany(ids: readonly string[]): Promise<boolean> {
    return this.exclusive(async () => {
      await this.ensureLoaded(); const selected = new Set(ids);
      const removed = this.entries.filter(entry => selected.has(entry.id));
      if (!removed.length) return false;
      const next = this.entries.filter(entry => !selected.has(entry.id));
      await writeJsonArray(this.metadataPath, next); this.entries = next;
      await Promise.all(removed.map(entry => this.removeCopy(entry.copyRoot)));
      return true;
    });
  }

  async clear(): Promise<void> { await this.deleteMany((await this.list()).map(entry => entry.id)); }

  saveCopies(id: string): Promise<StoredFileEntry | null> {
    const pending = this.scheduled.get(id); if (pending) return pending;
    const operation = this.copyQueue.then(() => this.performCopy(id));
    this.copyQueue = operation.catch(() => undefined);
    this.scheduled.set(id, operation);
    void operation.finally(() => this.scheduled.delete(id)).catch(() => undefined);
    return operation;
  }

  stop(): void { this.stopped = true; this.activeCopy?.abort(); }

  private async resolveEntryPaths(entry: StoredFileEntry): Promise<(string | null)[]> {
    return mapLimited(entry.files, async (file, index) => {
      const candidates = entry.copyRoot ? [join(this.copiesDirectory, entry.copyRoot, String(index), file.name), file.originalPath] : [file.originalPath];
      for (const path of candidates) {
        try { const info = await stat(path); if (!info.isFile() && !info.isDirectory()) continue;
          await access(path, constants.R_OK | (info.isDirectory() ? constants.X_OK : 0)); return path;
        } catch { /* Try the original reference if an owned copy is unavailable. */ }
      }
      return null;
    });
  }

  private async performCopy(id: string): Promise<StoredFileEntry | null> {
    const entry = await this.get(id);
    if (this.stopped || !entry || entry.copyState !== "pending") return null;
    const controller = new AbortController(); this.activeCopy = controller;
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const stage = `stage-${randomUUID()}`; const snapshot = `snapshot-${randomUUID()}`;
    let finalCreated = false;
    let state: FileCopyState = "saved";
    try {
      await mkdir(this.copiesDirectory, { recursive: true, mode: 0o700 });
      const budget = { bytes: (entry.files.length + 1) * ENTRY_OVERHEAD_BYTES, items: 0 };
      for (const file of entry.files) {
        if (inside(this.copiesDirectory, file.originalPath) || (file.isDirectory && inside(file.originalPath, this.copiesDirectory))) throw new CopyLimitError("Recursive managed copy");
        if ((await lstat(file.originalPath)).isSymbolicLink()) throw new Error("A standalone symbolic link remains a reference");
        await this.measure(file.originalPath, budget, FILE_COPY_BATCH_BYTES, controller.signal);
      }
      const used = { bytes: 0, items: 0 };
      for (const item of await readdir(this.copiesDirectory)) if (OWNED_ROOT.test(item)) await this.measure(join(this.copiesDirectory, item), used, FILE_COPY_TOTAL_BYTES, controller.signal, false);
      if (used.bytes + budget.bytes > FILE_COPY_TOTAL_BYTES) throw new CopyLimitError("Managed file capacity exceeded");
      const disk = await statfs(this.copiesDirectory);
      if (disk.bavail * disk.bsize < budget.bytes + 50 * 1024 * 1024) throw new CopyLimitError("Insufficient free space");
      await mkdir(join(this.copiesDirectory, stage), { mode: 0o700 });
      const copied = { bytes: (entry.files.length + 1) * ENTRY_OVERHEAD_BYTES, items: 0 };
      for (let index = 0; index < entry.files.length; index++) {
        const target = join(this.copiesDirectory, stage, String(index)); await mkdir(target, { mode: 0o700 });
        await this.copyTree(entry.files[index].originalPath, join(target, entry.files[index].name), copied,
          Math.min(FILE_COPY_BATCH_BYTES, FILE_COPY_TOTAL_BYTES - used.bytes), controller.signal);
      }
      controller.signal.throwIfAborted();
      await rename(join(this.copiesDirectory, stage), join(this.copiesDirectory, snapshot)); finalCreated = true;
    } catch (error) {
      if (this.stopped) return null;
      state = error instanceof CopyLimitError ? "limit" : "failed";
    } finally {
      clearTimeout(timeout);
      await rm(join(this.copiesDirectory, stage), { recursive: true, force: true }).catch(() => undefined);
      this.activeCopy = null;
    }
    try {
      return await this.exclusive(async () => {
        const current = this.entries.find(item => item.id === id);
        if (this.stopped || !current || current.copyToken !== entry.copyToken || current.copyState !== "pending") return null;
        const updated = { ...current, copyState: state, copyRoot: state === "saved" ? snapshot : current.copyRoot };
        const next = this.entries.map(item => item.id === id ? updated : item);
        await writeJsonArray(this.metadataPath, next); this.entries = next;
        if (state === "saved") finalCreated = false;
        return clone(updated);
      });
    } finally { if (finalCreated) await this.removeCopy(snapshot); }
  }

  private async measure(path: string, budget: { bytes: number; items: number }, limit: number, signal: AbortSignal, countItems = true): Promise<void> {
    signal.throwIfAborted(); const info = await lstat(path);
    if (countItems && ++budget.items > MAX_COPY_ITEMS) throw new CopyLimitError("Too many files");
    budget.bytes += ENTRY_OVERHEAD_BYTES;
    if (budget.bytes > limit) throw new CopyLimitError("Copy size exceeded");
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) { for (const name of await readdir(path)) await this.measure(join(path, name), budget, limit, signal, countItems); }
    else if (info.isFile()) {
      // Data-fork streaming must not silently turn a legacy resource-fork file into an incomplete copy.
      if (countItems && process.platform === "darwin") {
        let resourceSize = 0;
        try { resourceSize = (await stat(path + "/..namedfork/rsrc")).size; }
        catch (error) { if (!["ENOENT", "ENOTDIR", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
        if (resourceSize) throw new Error("Resource-fork files remain references");
      }
      budget.bytes += info.size; if (budget.bytes > limit) throw new CopyLimitError("Copy size exceeded");
    }
    else throw new Error("Unsupported file system item");
  }

  private async copyTree(source: string, target: string, budget: { bytes: number; items: number }, limit: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted(); if (++budget.items > MAX_COPY_ITEMS) throw new CopyLimitError("Too many files");
    budget.bytes += ENTRY_OVERHEAD_BYTES;
    if (budget.bytes > limit) throw new CopyLimitError("Copy size exceeded");
    const info = await lstat(source);
    if (info.isSymbolicLink()) { await symlink(await readlink(source), target); return; }
    if (info.isDirectory()) {
      await mkdir(target, { mode: 0o700 });
      for (const name of await readdir(source)) await this.copyTree(join(source, name), join(target, name), budget, limit, signal);
      const after = await lstat(source);
      if (!after.isDirectory() || after.mtimeMs !== info.mtimeMs) throw new Error("Source directory changed during copy");
    } else if (info.isFile()) {
      const sourceFile = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const before = await sourceFile.stat();
        await pipeline(sourceFile.createReadStream({ autoClose: false }), new Transform({ transform(chunk: Buffer, _encoding, callback) {
          budget.bytes += chunk.length;
          callback(budget.bytes > limit ? new CopyLimitError("Copy size exceeded") : null, chunk);
        } }), createWriteStream(target, { flags: "wx", mode: 0o600 }), { signal });
        const after = await sourceFile.stat();
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Source file changed during copy");
      } finally { await sourceFile.close().catch(() => undefined); }
      await chmod(target, info.mode & 0o777); await utimes(target, info.atime, info.mtime);
    } else throw new Error("Unsupported file system item");
  }

  private async removeCopy(root: string | undefined): Promise<void> {
    if (root && COPY_ROOT.test(root)) await rm(join(this.copiesDirectory, root), { recursive: true, force: true }).catch(() => undefined);
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation); this.mutationQueue = result.then(() => undefined, () => undefined); return result;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) this.loadPromise = (async () => {
      this.entries = (await readJsonArray(this.metadataPath)).filter(validEntry).sort((a, b) => b.copiedAt - a.copiedAt);
      const retained = new Set(this.entries.map(entry => entry.copyRoot));
      try { for (const name of await readdir(this.copiesDirectory)) if (OWNED_ROOT.test(name) && !retained.has(name)) {
        await rm(join(this.copiesDirectory, name), { recursive: true, force: true }).catch(() => undefined);
      } } catch { /* Inaccessible owned copies must not block text/image history startup. */ }
      this.loaded = true;
    })().finally(() => { this.loadPromise = null; });
    await this.loadPromise;
  }
}
