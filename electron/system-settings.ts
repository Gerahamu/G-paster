import { app } from "electron";
import type { SystemSettings } from "../src/shared/contracts";
import { systemLanguage, systemLocale } from "../src/shared/i18n";

export function readSystemSettings(): SystemSettings {
  const language = systemLanguage(app.getPreferredSystemLanguages());
  return { language, locale: systemLocale(app.getSystemLocale(), language) };
}
