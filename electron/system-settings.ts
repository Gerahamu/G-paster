import { app } from "electron";
import type { SystemSettings } from "../src/shared/contracts";
import { systemLanguage, systemLocale } from "../src/shared/i18n";
import type { LanguageChoice } from "../src/shared/preferences";

export function readSystemSettings(choice: LanguageChoice = "system"): SystemSettings {
  const language = choice === "system" ? systemLanguage(app.getPreferredSystemLanguages()) : choice;
  return { language, locale: systemLocale(app.getSystemLocale(), language) };
}
