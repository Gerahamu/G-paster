export type LanguageChoice = "system" | "zh" | "en";
export type AppearanceChoice = "system" | "light" | "dark";
export interface EditablePreferences {
  language: LanguageChoice;
  appearance: AppearanceChoice;
  textLimit: number;
  imageLimit: number;
  saveFileCopies: boolean;
}
export const DEFAULT_PREFERENCES: EditablePreferences = { language: "system", appearance: "system", textLimit: 300, imageLimit: 10, saveFileCopies: false };
export const TEXT_LIMIT_RANGE = { min: 1, max: 1000 };
export const IMAGE_LIMIT_RANGE = { min: 1, max: 100 };

export function preferencePatch(value: unknown): Partial<EditablePreferences> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const patch = value as Record<string, unknown>;
  const keys = Object.keys(patch);
  if (!keys.length || keys.some(key => !Object.hasOwn(DEFAULT_PREFERENCES, key))) return null;
  if ("language" in patch && (typeof patch.language !== "string" || !["system", "zh", "en"].includes(patch.language))) return null;
  if ("appearance" in patch && (typeof patch.appearance !== "string" || !["system", "light", "dark"].includes(patch.appearance))) return null;
  if ("saveFileCopies" in patch && typeof patch.saveFileCopies !== "boolean") return null;
  for (const [key, range] of [["textLimit", TEXT_LIMIT_RANGE], ["imageLimit", IMAGE_LIMIT_RANGE]] as const) {
    if (key in patch && (typeof patch[key] !== "number" || !Number.isInteger(patch[key]) || patch[key] < range.min || patch[key] > range.max)) return null;
  }
  return patch as Partial<EditablePreferences>;
}
