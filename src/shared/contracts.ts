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

export type ImageSource = "clipboard" | "screenshot";

export interface ClipboardImageEntry {
  id: string;
  content: string;
  kind: "image";
  createdAt: number;
  copiedAt: number;
  width: number;
  height: number;
  previewDataUrl: string;
  sources: ImageSource[];
  unavailable?: boolean;
}

export type FileCopyState = "reference" | "pending" | "saved" | "failed" | "limit";

export interface ClipboardFileReference {
  name: string;
  originalPath: string;
  isDirectory: boolean;
  extension: string;
  size: number | null;
  available: boolean;
}

export interface ClipboardFileEntry {
  id: string;
  content: string;
  kind: "file";
  createdAt: number;
  copiedAt: number;
  files: ClipboardFileReference[];
  available: boolean;
  copyState: FileCopyState;
  // Derived display data only; file-history.json keeps its existing format.
  image?: { width: number; height: number; previewDataUrl: string };
}

export type ClipboardHistoryItem = ClipboardEntry | ClipboardImageEntry | ClipboardFileEntry;

export interface CaptureIssue {
  source: "clipboard-text" | "clipboard-image" | "screenshots" | "clipboard-file" | "renderer" | "storage";
  message: string;
}

export interface QuickPhrase {
  id: string;
  text: string;
  category: string;
  createdAt: number;
  updatedAt: number;
  // Legacy text phrases omit kind; image phrases keep their bitmap in a separate local asset.
  kind?: "text" | "image";
  image?: { width: number; height: number };
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
  previewImage(id: string): Promise<string | null>;
  startImageDrag(id: string | string[], dismissAfterDrag?: boolean): Promise<boolean>;
  startFileDrag(id: string): Promise<boolean>;
  saveImage(id: string): Promise<boolean>;
  listPhrases(): Promise<QuickPhrase[]>;
  createPhrase(draft: QuickPhraseDraft): Promise<QuickPhrase>;
  updatePhrase(update: QuickPhraseUpdate): Promise<QuickPhrase | null>;
  deletePhrase(id: string): Promise<boolean>;
  copyPhrase(id: string): Promise<boolean>;
  saveHistoryAsPhrase(id: string, category: string): Promise<QuickPhrase | null>;
  saveImageAsPhrase(id: string, category?: string): Promise<QuickPhrase | null>;
  importPhraseImage(category?: string): Promise<QuickPhrase | null>;
  previewPhraseImage(id: string): Promise<string | null>;
  setCompactMode(compact: boolean): void;
  onHistoryChanged(callback: (entries: ClipboardHistoryItem[]) => void): () => void;
  onWindowShown(callback: () => void): () => void;
  platform: "darwin" | "win32" | "linux";
}
