import { readJsonArray, writeJsonArray } from "./atomic-json";
import { normalizeShortcut } from "../src/shared/shortcuts";

interface ShortcutRegistry {
  register(shortcut: string, callback: () => void): boolean;
  unregister(shortcut: string): void;
  isRegistered(shortcut: string): boolean;
}

export class Preferences {
  shortcut: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string, readonly defaultShortcut: string, private readonly platform: string,
    private readonly registry: ShortcutRegistry, private readonly toggle: () => void) {
    this.shortcut = defaultShortcut;
  }

  async load(): Promise<void> {
    try {
      const [value] = await readJsonArray(this.path);
      if (value && typeof value === "object" && "shortcut" in value) {
        this.shortcut = normalizeShortcut(value.shortcut, this.platform) ?? this.defaultShortcut;
      }
    } catch (error) {
      // Preferences must not prevent clipboard recovery or normal application startup.
      console.error("Could not load preferences; using default shortcut:", error);
    }
  }

  register(): boolean {
    try { return this.registry.register(this.shortcut, this.toggle); }
    catch { return false; }
  }

  get registered(): boolean { return this.registry.isRegistered(this.shortcut); }

  async setShortcut(value: unknown): Promise<"shortcut-invalid" | "shortcut-conflict" | "settings-save-failed" | null> {
    const operation = this.queue.then(async () => {
      const candidate = normalizeShortcut(value, this.platform);
      if (!candidate) return "shortcut-invalid" as const;
      const previous = this.shortcut;
      if (candidate === previous && this.registered) return null;
      let registered = false;
      try { registered = this.registry.register(candidate, this.toggle); } catch { /* Invalid OS binding. */ }
      if (!registered) return "shortcut-conflict" as const;
      try { await writeJsonArray(this.path, [{ shortcut: candidate }]); }
      catch {
        this.registry.unregister(candidate);
        return "settings-save-failed" as const;
      }
      this.shortcut = candidate;
      if (previous !== candidate) this.registry.unregister(previous);
      return null;
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
