import type { UiLanguage } from "./i18n";
import type { EditablePreferences } from "./preferences";

export interface SystemSettings {
  language: UiLanguage;
  locale: string;
}

export interface AppPreferences extends EditablePreferences {
  shortcut: string;
  defaultShortcut: string;
  shortcutRegistered: boolean;
  loginSupported: boolean;
  openAtLogin: boolean;
  loginStatus: "enabled" | "disabled" | "requires-approval" | "unavailable";
  version: string;
  textLimit: number;
  imageLimit: number;
}

export type PreferenceFailure = "shortcut-invalid" | "shortcut-conflict" | "settings-save-failed" | "login-unavailable" | "login-failed" | "preferences-invalid";
export interface PreferenceResult { settings: AppPreferences; error: PreferenceFailure | null }

export type ClipboardEntryKind = "text" | "link";

export interface ClipboardEntry {
  id: string;
  content: string;
  kind: ClipboardEntryKind;
  createdAt: number;
  copiedAt: number;
}

export interface ClipboardImageEntry {
  id: string;
  content: string;
  kind: "image";
  createdAt: number;
  copiedAt: number;
  width: number;
  height: number;
  isFavorite: boolean;
  previewDataUrl: string;
}

export type ClipboardHistoryItem = ClipboardEntry | ClipboardImageEntry;

export interface CaptureIssue {
  source: "clipboard-image" | "screenshots";
  message: string;
}

export interface QuickPhrase {
  id: string;
  text: string;
  category: string;
  createdAt: number;
  updatedAt: number;
}

export interface QuickPhraseDraft {
  text: string;
  category: string;
}

export interface QuickPhraseUpdate extends QuickPhraseDraft {
  id: string;
}

export interface GpasterBridge {
  getPreferences(): Promise<AppPreferences>;
  updatePreferences(patch: Partial<EditablePreferences>): Promise<PreferenceResult>;
  onPreferencesChanged(callback: (preferences: AppPreferences) => void): () => void;
  setShortcut(shortcut: string): Promise<PreferenceResult>;
  setOpenAtLogin(enabled: boolean): Promise<PreferenceResult>;
  setShortcutRecording(recording: boolean): Promise<void>;
  openDataDirectory(): Promise<boolean>;
  onSettingsRequested(callback: () => void): () => void;
  readonly initialSystemSettings: SystemSettings;
  getSystemSettings(): Promise<SystemSettings>;
  onSystemSettingsChanged(callback: (settings: SystemSettings) => void): () => void;
  listCaptureIssues(): Promise<CaptureIssue[]>;
  onCaptureIssuesChanged(callback: (issues: CaptureIssue[]) => void): () => void;
  listHistory(): Promise<ClipboardHistoryItem[]>;
  deleteHistory(id: string): Promise<boolean>;
  clearHistory(): Promise<void>;
  copyHistory(id: string): Promise<boolean>;
  toggleImageFavorite(id: string): Promise<boolean>;
  previewImage(id: string): Promise<string | null>;
  startImageDrag(id: string): Promise<boolean>;
  saveImage(id: string): Promise<boolean>;
  listPhrases(): Promise<QuickPhrase[]>;
  createPhrase(draft: QuickPhraseDraft): Promise<QuickPhrase>;
  updatePhrase(update: QuickPhraseUpdate): Promise<QuickPhrase | null>;
  deletePhrase(id: string): Promise<boolean>;
  copyPhrase(id: string): Promise<boolean>;
  saveHistoryAsPhrase(id: string, category: string): Promise<QuickPhrase | null>;
  setCompactMode(compact: boolean): void;
  onHistoryChanged(callback: (entries: ClipboardHistoryItem[]) => void): () => void;
  onWindowShown(callback: () => void): () => void;
  platform: "darwin" | "win32" | "linux";
}
