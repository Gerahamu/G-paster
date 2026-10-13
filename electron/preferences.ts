import { readJsonArray, writeJsonArray } from "./atomic-json";
import { normalizeShortcut } from "../src/shared/shortcuts";
import { DEFAULT_PREFERENCES, preferencePatch, type EditablePreferences } from "../src/shared/preferences";

interface ShortcutRegistry {
  register(shortcut: string, callback: () => void): boolean;
  unregister(shortcut: string): void;
  isRegistered(shortcut: string): boolean;
}

export class Preferences {
  shortcut: string;
  options: EditablePreferences = { ...DEFAULT_PREFERENCES };
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
      if (value && typeof value === "object") {
        for (const key of Object.keys(DEFAULT_PREFERENCES) as (keyof EditablePreferences)[]) {
          if (key in value) {
            const patch = preferencePatch({ [key]: (value as Record<string, unknown>)[key] });
            if (patch) this.options = { ...this.options, ...patch };
          }
        }
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
      try { await writeJsonArray(this.path, [{ shortcut: candidate, ...this.options }]); }
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

  async update(value: unknown): Promise<"preferences-invalid" | "settings-save-failed" | null> {
    const operation = this.queue.then(async () => {
      const patch = preferencePatch(value);
      if (!patch) return "preferences-invalid" as const;
      const next = { ...this.options, ...patch };
      try { await writeJsonArray(this.path, [{ shortcut: this.shortcut, ...next }]); }
      catch { return "settings-save-failed" as const; }
      this.options = next;
      return null;
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
