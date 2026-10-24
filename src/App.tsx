import { useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type FormEvent } from "react";
import type { CaptureIssue, ClipboardEntry, ClipboardHistoryItem, ClipboardImageEntry, QuickPhrase } from "./shared/contracts";
import { errorKey, translate, translateMessage, type TranslationKey, type TranslationValues } from "./shared/i18n";
import gpasterIcon from "../assets/G-paster-brand.png";
import SettingsPanel from "./SettingsPanel";
import { DEFAULT_PREFERENCES } from "./shared/preferences";

type ModuleName = "history" | "phrases" | "screenshots";
type IconName = "history" | "phrase" | "image" | "search" | "link" | "text" | "file" | "folder" | "files" | "copy" | "trash" | "close" | "plus" | "edit" | "save" | "bookmark" | "settings";
type PhraseEditorState = { id?: string; sourceHistoryId?: string; originalText?: string; text: string; category: string };

const moduleNames: Record<ModuleName, TranslationKey> = { history: "剪贴板", phrases: "常用语", screenshots: "截图" };

function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  const base = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  switch (name) {
    case "history": return <svg {...base}><path d="M4.5 8.5H2.8V4.8" /><path d="M4.1 7.8a8 8 0 1 1-1 6.6" /><path d="M12 7v5l3.2 1.8" /></svg>;
    case "phrase": return <svg {...base}><path d="M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 3v-3H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" /><path d="M7.5 9h9M7.5 12.5h6" /></svg>;
    case "image": return <svg {...base}><rect x="3.5" y="4" width="17" height="16" rx="2.4" /><circle cx="9" cy="9.5" r="1.4" /><path d="m5 17 4.5-4.5 3.2 3.1 2.2-2.1 4.1 3.8" /></svg>;
    case "search": return <svg {...base}><circle cx="10.8" cy="10.8" r="6.5" /><path d="m16 16 4.2 4.2" /></svg>;
    case "link": return <svg {...base}><path d="M9.8 14.2 8 16a3.3 3.3 0 0 1-4.7-4.7l3.4-3.4A3.3 3.3 0 0 1 11.4 8" /><path d="m14.2 9.8 1.8-1.8a3.3 3.3 0 0 1 4.7 4.7l-3.4 3.4A3.3 3.3 0 0 1 12.6 16" /><path d="m8.5 15.5 7-7" /></svg>;
    case "text": return <svg {...base}><path d="M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /><path d="M8 9h8M8 12.5h8M8 16h5" /></svg>;
    case "file": return <svg {...base}><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Z" /><path d="M13 3v7h7M8 14h8M8 17h5" /></svg>;
    case "folder": return <svg {...base}><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>;
    case "files": return <svg {...base}><path d="M7 3h10l4 4v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2ZM17 3v5h4M3 7v12a3 3 0 0 0 3 3h10" /></svg>;
    case "copy": return <svg {...base}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>;
    case "trash": return <svg {...base}><path d="M4.5 7h15M9 7V4.5h6V7m2.5 0-.8 12.5H7.3L6.5 7M10 10.5v5.5M14 10.5v5.5" /></svg>;
    case "close": return <svg {...base}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case "plus": return <svg {...base}><path d="M12 5v14M5 12h14" /></svg>;
    case "edit": return <svg {...base}><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5 4 16.5Z" /><path d="m13.8 6.7 3.5 3.5" /></svg>;
    case "save": return <svg {...base}><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>;
    case "bookmark": return <svg {...base}><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z" /></svg>;
    case "settings": return <svg {...base}><path d="M10.25 3.78 10.37 1.73 13.63 1.73 13.75 3.78 14.87 5.07 16.57 4.96 18.11 3.59 20.41 5.89 19.04 7.43 18.93 9.13 20.22 10.25 22.27 10.37 22.27 13.63 20.22 13.75 18.93 14.87 19.04 16.57 20.41 18.11 18.11 20.41 16.57 19.04 14.87 18.93 13.75 20.22 13.63 22.27 10.37 22.27 10.25 20.22 9.13 18.93 7.43 19.04 5.89 20.41 3.59 18.11 4.96 16.57 5.07 14.87 3.78 13.75 1.73 13.63 1.73 10.37 3.78 10.25 5.07 9.13 4.96 7.43 3.59 5.89 5.89 3.59 7.43 4.96 9.13 5.07Z" /><circle cx="12" cy="12" r="3" /></svg>;
  }
}

function BrandIcon({ size = 18 }: { size?: number }) {
  return <img className="gpaster-brand-image" src={gpasterIcon} width={size} height={size} alt="" draggable={false} />;
}

function PhraseImagePreview({ id }: { id: string }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    let active = true;
    let requested = false;
    const load = () => {
      if (requested) return;
      requested = true;
      void window.gpaster.previewPhraseImage(id).then((result) => { if (active) setDataUrl(result); }).catch(() => undefined);
    };
    if (typeof IntersectionObserver === "undefined") load();
    else {
      const observer = new IntersectionObserver((items) => {
        if (items.some(item => item.isIntersecting)) { observer.disconnect(); load(); }
      });
      observer.observe(node);
      return () => { active = false; observer.disconnect(); };
    }
    return () => { active = false; };
  }, [id]);

  return <span className="phrase-image-preview" ref={containerRef}>{dataUrl ? <img src={dataUrl} alt="" draggable={false} /> : <Icon name="image" size={17} />}</span>;
}


function isImageEntry(entry: ClipboardHistoryItem): entry is ClipboardImageEntry {
  return entry.kind === "image";
}

// A file-backed image keeps its history ID and file drag semantics.
function previewableImage(entry: ClipboardHistoryItem): ClipboardImageEntry | null {
  if (isImageEntry(entry)) return entry;
  if (entry.kind !== "file" || !entry.image) return null;
  return { id: entry.id, content: entry.content, kind: "image", createdAt: entry.createdAt,
    copiedAt: entry.copiedAt, ...entry.image, sources: ["clipboard"] };
}

function App() {
  const [settings, setSettings] = useState(window.gpaster.initialSystemSettings);
  const t = (key: TranslationKey, values?: TranslationValues) => translate(settings.language, key, values);
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(settings.locale, { hour: "2-digit", minute: "2-digit" }), [settings.locale]);
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return Number.isFinite(date.getTime()) ? timeFormatter.format(date) : "";
  };
  const displayCategory = (value: string) => value === "未分类" ? t("未分类") : value;
  const displayContent = (entry: ClipboardHistoryItem) => isImageEntry(entry)
    ? t("图片 {width} × {height}", { width: entry.width, height: entry.height })
    : entry.kind === "file" && entry.files.length > 1 ? t("{count} 个项目 · {names}", { count: entry.files.length, names: entry.files.slice(0, 3).map(file => file.name).join(", ") }) : entry.content;
  const safeIsoDate = (value: number) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
  };
  const fileMeta = (entry: Extract<ClipboardHistoryItem, { kind: "file" }>) => {
    if (!entry.available) return t("路径失效或无访问权限");
    const kind = entry.files.length > 1 ? t("文件与文件夹") : entry.files[0].isDirectory ? t("文件夹") : entry.files[0].extension.toUpperCase() || t("文件");
    return `${kind} · ${t(entry.copyState === "saved" ? "已保存副本" : entry.copyState === "pending" ? "正在保存副本" : entry.copyState === "failed" || entry.copyState === "limit" ? "仅引用，副本未保存" : "原文件引用")}`;
  };
  const [entries, setEntries] = useState<ClipboardHistoryItem[]>([]);
  const [phrases, setPhrases] = useState<QuickPhrase[]>([]);
  const [activeModule, setActiveModule] = useState<ModuleName>("history");
  const [showSettings, setShowSettings] = useState(false);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const imageDragStarted = useRef(false);
  const previewRequest = useRef(0);
  const [imageLimit, setImageLimit] = useState(DEFAULT_PREFERENCES.imageLimit);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<TranslationKey | "">("");
  const [captureIssues, setCaptureIssues] = useState<CaptureIssue[]>([]);
  const [notice, setNotice] = useState<TranslationKey | "">("");
  const [editor, setEditor] = useState<PhraseEditorState | null>(null);
  const [editorError, setEditorError] = useState<TranslationKey | "">("");
  const editorInitial = useRef<{ text: string; category: string } | null>(null);
  const [preview, setPreview] = useState<{ entry: ClipboardImageEntry; dataUrl: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const isMac = window.gpaster.platform === "darwin";
  const allImages = useMemo(() => entries.filter(isImageEntry), [entries]);
  const images = useMemo(() => allImages.filter(image => image.sources.length === 0 || image.sources.includes("screenshot")), [allImages]);
  const historyEntries = useMemo(() => entries.filter(entry => !isImageEntry(entry) || entry.sources.includes("clipboard")), [entries]);
  const categories = useMemo(() => Array.from(new Set(phrases.map((phrase) => phrase.category))).sort((a, b) => a.localeCompare(b, settings.locale)), [phrases, settings.locale]);

  useEffect(() => {
    let changed = false;
    const unsubscribe = window.gpaster.onPreferencesChanged(next => { changed = true; setImageLimit(next.imageLimit); });
    void window.gpaster.getPreferences().then(next => { if (!changed) setImageLimit(next.imageLimit); }).catch(() => undefined);
    return unsubscribe;
  }, []);

  useEffect(() => {
    let changed = false;
    const unsubscribe = window.gpaster.onSystemSettingsChanged((next) => { changed = true; setSettings(next); });
    const refresh = () => { void window.gpaster.getSystemSettings().then((next) => { if (!changed) setSettings(next); }).catch(() => undefined); };
    refresh();
    const onLanguageChange = () => { void window.gpaster.getSystemSettings().then(setSettings).catch(() => undefined); };
    window.addEventListener("languagechange", onLanguageChange);
    return () => { unsubscribe(); window.removeEventListener("languagechange", onLanguageChange); };
  }, []);

  useEffect(() => {
    document.documentElement.lang = settings.language === "zh" ? "zh-CN" : "en";
  }, [settings.language]);

  async function refreshHistory(): Promise<void> {
    const next = await window.gpaster.listHistory();
    setEntries(next);
  }

  async function refreshPhrases(): Promise<void> {
    const next = await window.gpaster.listPhrases();
    setPhrases(next);
  }

  useEffect(() => {
    let receivedChange = false;
    let receivedIssues = false;
    const unsubscribeIssues = window.gpaster.onCaptureIssuesChanged((issues) => {
      receivedIssues = true;
      setCaptureIssues(issues);
    });
    void window.gpaster.listCaptureIssues().then((issues) => {
      if (!receivedIssues) setCaptureIssues(issues);
    }).catch(() => undefined);
    const unsubscribeHistory = window.gpaster.onHistoryChanged((nextEntries) => {
      receivedChange = true;
      setEntries(nextEntries);
      setLoading(false);
    });
    const unsubscribeShown = window.gpaster.onWindowShown(() => {
      setShowSettings(false);
      setPreview(null);
      previewRequest.current++;
      setQuery("");
      setActiveModule("history");
      void Promise.all([refreshHistory(), refreshPhrases()]).catch(() => setError("读取本地内容失败。"));
      window.setTimeout(() => searchRef.current?.focus(), 0);
    });
    void Promise.all([window.gpaster.listHistory(), window.gpaster.listPhrases()])
      .then(([initialEntries, initialPhrases]) => {
        if (!receivedChange) setEntries(initialEntries);
        setPhrases(initialPhrases);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        setError("读取本地内容失败。请稍后重试。");
      });
    const unsubscribeSettings = window.gpaster.onSettingsRequested(() => setShowSettings(true));
    return () => { unsubscribeHistory(); unsubscribeShown(); unsubscribeIssues(); unsubscribeSettings(); };
  }, []);

  useEffect(() => {
    if (category && !categories.includes(category)) setCategory("");
  }, [categories, category]);

  const activeCount = activeModule === "history" ? historyEntries.length : activeModule === "phrases" ? phrases.length : images.length;
  useEffect(() => {
    if (showSettings || !loading) window.gpaster.setCompactMode(!showSettings && activeCount === 0);
  }, [activeCount, loading, showSettings]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (showSettings) {
        if (event.key === "Escape") closeSettings();
        return;
      }
      if (!editor && !preview && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        if (preview) closePreview();
        else if (editor) closeEditor();
        else if (document.activeElement === searchRef.current) setQuery("");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editor, preview, settings.language, showSettings]);

  const deferredQuery = useDeferredValue(query);
  const filteredEntries = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase();
    return normalized ? historyEntries.filter((entry) => entry.content.toLocaleLowerCase().includes(normalized) || displayContent(entry).toLocaleLowerCase().includes(normalized) ||
      (entry.kind === "file" && entry.files.some(file => file.originalPath.toLocaleLowerCase().includes(normalized)))) : historyEntries;
  }, [historyEntries, deferredQuery, settings.language]);

  const filteredPhrases = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase();
    return phrases.filter((phrase) => (category === "" || phrase.category === category) &&
      (!normalized || phrase.text.toLocaleLowerCase().includes(normalized) || phrase.category.toLocaleLowerCase().includes(normalized) || displayCategory(phrase.category).toLocaleLowerCase().includes(normalized) ||
        (phrase.kind === "image" && `${phrase.image?.width ?? ""} × ${phrase.image?.height ?? ""}`.includes(normalized))));
  }, [phrases, deferredQuery, category, settings.language]);

  const filteredImages = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase();
    return images.filter((image) => !normalized || image.content.toLocaleLowerCase().includes(normalized) || displayContent(image).toLocaleLowerCase().includes(normalized));
  }, [images, deferredQuery, settings.language]);

  useEffect(() => {
    const visible = new Set(filteredImages.map(image => image.id));
    setSelectedImages(previous => {
      const next = new Set([...previous].filter(id => visible.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [filteredImages]);

  function toggleImageSelection(id: string): void {
    setSelectedImages(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function copyEntry(entry: ClipboardHistoryItem): Promise<void> {
    setError("");
    if (entry.kind === "image" && entry.unavailable) { setError("无法读取这张图片。"); return; }
    try {
      if (!await window.gpaster.copyHistory(entry.id)) {
        setError(entry.kind === "file" ? "部分文件已移动、删除或无访问权限，无法恢复完整文件列表。" : "这条记录已不存在。");
        if (entry.kind === "file") await refreshHistory();
      }
    } catch { setError("复制失败，请重试。"); }
  }

  function startImageDrag(event: ReactDragEvent<HTMLElement>, id: string, selection?: string[]): void {
    event.preventDefault();
    event.stopPropagation();
    imageDragStarted.current = true;
    setError("");
    const entry = entries.find(item => item.id === id);
    const dismissAfterDrag = activeModule === "screenshots" && (selection?.length ?? 0) > 1;
    const drag = entry?.kind === "file" ? window.gpaster.startFileDrag(id) : window.gpaster.startImageDrag(selection ?? id, dismissAfterDrag);
    void drag.then((started) => {
      if (!started) setError("这张图片已不存在，无法拖动。");
      else if (dismissAfterDrag) setSelectedImages(new Set());
    }).catch(() => setError("拖动图片失败，请重试。"));
  }

  function startFileDrag(event: ReactDragEvent<HTMLElement>, id: string): void {
    event.preventDefault();
    setError("");
    void window.gpaster.startFileDrag(id).then((started) => {
      if (!started) setError("文件已移动、删除或无访问权限，无法拖动。");
    }).catch(() => setError("拖动文件失败，请重试。"));
  }

  async function deleteEntry(id: string): Promise<void> {
    const entry = entries.find(item => item.id === id);
    if (entry?.kind === "file" && entry.copyState === "saved" &&
      !window.confirm(t("删除这条历史及 G-paster 保存的文件副本？原始文件不会被删除。"))) return;
    setError("");
    try { await window.gpaster.deleteHistory(id); }
    catch { setError("删除失败，请重试。"); }
  }

  async function clearHistory(): Promise<void> {
    if (!window.confirm(t("清空全部剪贴板历史、截图及文件副本？原始文件不会被删除，此操作无法撤销。"))) return;
    setError("");
    try { await window.gpaster.clearHistory(); }
    catch { setError("清空失败，请重试。"); }
  }

  async function openImage(entry: ClipboardImageEntry): Promise<void> {
    if (entry.unavailable) { setError("无法读取这张图片。"); return; }
    const request = ++previewRequest.current;
    setError("");
    try {
      const dataUrl = await window.gpaster.previewImage(entry.id);
      if (request !== previewRequest.current) return;
      if (dataUrl) setPreview({ entry, dataUrl });
      else setError("无法读取这张图片。");
    } catch { if (request === previewRequest.current) setError("无法打开图片预览。"); }
  }

  function closePreview(): void {
    previewRequest.current++;
    setPreview(null);
  }

  useEffect(() => () => { previewRequest.current++; }, []);

  async function saveImage(id: string): Promise<void> {
    try {
      if (await window.gpaster.saveImage(id)) setNotice("图片已保存到本地。");
      else setNotice("");
    } catch { setError("保存图片失败，请重试。"); }
  }

  async function saveImageAsPhrase(id: string): Promise<void> {
    setError("");
    try {
      const saved = await window.gpaster.saveImageAsPhrase(id);
      if (!saved) { setError("无法保存这张图片为常用语。"); return; }
      await refreshPhrases();
      setNotice("图片已保存到常用语。");
    } catch { setError("无法保存这张图片为常用语。"); }
  }

  async function importPhraseImage(): Promise<void> {
    if (!editor || editor.id || editor.sourceHistoryId) return;
    setEditorError("");
    if (editor.text.trim() && !window.confirm(t("添加图片会丢弃当前文字草稿，继续？"))) return;
    try {
      const saved = await window.gpaster.importPhraseImage(editor.category || "未分类");
      if (!saved) return;
      setQuery("");
      setCategory(saved.category);
      await refreshPhrases();
      setEditor(null);
      editorInitial.current = null;
      setNotice("图片已保存到常用语。");
    } catch { setEditorError("无法保存这张图片为常用语。"); }
  }

  async function deletePhrase(phrase: QuickPhrase): Promise<void> {
    if (!window.confirm(t("删除这条常用语？"))) return;
    try { await window.gpaster.deletePhrase(phrase.id); await refreshPhrases(); }
    catch { setError("删除常用语失败。"); }
  }

  async function copyPhrase(phrase: QuickPhrase): Promise<void> {
    setError("");
    try {
      if (!await window.gpaster.copyPhrase(phrase.id)) setError("这条常用语已不存在。");
    } catch { setError("复制常用语失败，请重试。"); }
  }

  async function savePhrase(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editor) return;
    setEditorError("");
    try {
      if (!editor.text.trim()) throw new Error("常用语内容不能为空。");
      let saved: QuickPhrase | null;
      if (editor.id) {
        saved = await window.gpaster.updatePhrase({ id: editor.id, text: editor.text, category: editor.category });
      } else if (editor.sourceHistoryId && editor.text.trim() === editor.originalText?.trim()) {
        saved = await window.gpaster.saveHistoryAsPhrase(editor.sourceHistoryId, editor.category);
      } else {
        saved = await window.gpaster.createPhrase({ text: editor.text, category: editor.category });
      }
      if (!saved) throw new Error("原记录已不存在，请重新选择。");
      await refreshPhrases();
      setEditor(null);
      editorInitial.current = null;
      setActiveModule("phrases");
      setNotice("常用语已保存。");
    } catch (saveError) {
      setEditorError(errorKey(saveError, "保存常用语失败。"));
    }
  }

  function openEditor(next: PhraseEditorState): void {
    editorInitial.current = { text: next.text, category: next.category };
    setEditorError("");
    setEditor(next);
  }

  function closeEditor(): void {
    if (!editor) return;
    const initial = editorInitial.current;
    if (initial && (editor.text !== initial.text || editor.category !== initial.category) &&
      !window.confirm(t("放弃未保存的常用语修改？"))) return;
    setEditor(null);
    setEditorError("");
    editorInitial.current = null;
  }

  function selectModule(module: ModuleName): void { setActiveModule(module); setQuery(""); setError(""); }
  function closeSettings(): void {
    setShowSettings(false);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }
  const searchPlaceholderKey = activeModule === "history" ? "搜索剪贴板内容" : activeModule === "phrases" ? "搜索常用语或分类" : "搜索图片尺寸";

  const searchPlaceholder = t(searchPlaceholderKey);

  return (
    <main className={"app-shell" + (isMac ? " platform-mac" : "")}>
      <header className="app-header">
        <div className="header-search-slot">
          {!showSettings && <div className="search-wrap">
            <Icon name="search" size={14} />
            <input ref={searchRef} aria-label={searchPlaceholder} autoFocus autoComplete="off" onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} value={query} />
            {query ? <button className="clear-search" type="button" aria-label={t("清除搜索")} onClick={() => { setQuery(""); searchRef.current?.focus(); }}><Icon name="close" size={14} /></button> : <kbd>{isMac ? "⌘ F" : "Ctrl F"}</kbd>}
          </div>}
        </div>
        <div className="header-actions"><button className="settings-entry" type="button" disabled={!!editor || !!preview} onClick={() => showSettings ? closeSettings() : setShowSettings(true)} aria-label={t("设置")} title={t("设置")} aria-pressed={showSettings}><Icon name="settings" size={16} /></button><span className="brand-mark"><BrandIcon size={18} /></span></div>
      </header>

      {showSettings ? <SettingsPanel system={settings} onBack={closeSettings} /> : <section className="workspace" aria-label={t("G-paster 工作区")}>
        <nav className="module-tabs" aria-label={t("功能模块")}>
          <button className={activeModule === "history" ? "module-tab active" : "module-tab"} onClick={() => selectModule("history")} type="button" aria-pressed={activeModule === "history"}><Icon name="history" size={15} /><span>{t(moduleNames.history)}</span><span className="tab-count">{historyEntries.length}</span></button>
          <button className={activeModule === "phrases" ? "module-tab active" : "module-tab"} onClick={() => selectModule("phrases")} type="button" aria-pressed={activeModule === "phrases"}><Icon name="phrase" size={15} /><span>{t(moduleNames.phrases)}</span><span className="tab-count">{phrases.length}</span></button>
          <button className={activeModule === "screenshots" ? "module-tab active" : "module-tab"} onClick={() => selectModule("screenshots")} type="button" aria-pressed={activeModule === "screenshots"}><Icon name="image" size={15} /><span>{t(moduleNames.screenshots)}</span><span className="tab-count">{images.length}</span></button>
        </nav>

        {error && <div className="error-message" role="alert">{t(error)}<button type="button" aria-label={t("关闭提示")} onClick={() => setError("")}><Icon name="close" size={13} /></button></div>}
        {captureIssues.map((issue) => <div className="error-message" role="status" key={issue.source}>{translateMessage(settings.language, issue.message)}</div>)}
        {notice && <div className="notice-message" role="status">{t(notice)}<button type="button" aria-label={t("关闭提示")} onClick={() => setNotice("")}><Icon name="close" size={13} /></button></div>}

        {activeModule === "history" && <section className="history-panel" aria-label={t("剪贴板历史")}>
          {loading ? <div className="empty-state"><span className="loading-dot" /><span>{t("正在读取记录")}</span></div> : filteredEntries.length > 0 ? (
            <ul className="history-list" aria-label={t("剪贴板记录")}>
              {filteredEntries.map((entry) => { const image = previewableImage(entry); return <li className="history-item" key={entry.id} data-kind={entry.kind}>
                {image ? <button className="history-thumb-button" type="button" draggable onPointerDown={() => { imageDragStarted.current = false; }} onDragStart={(event) => startImageDrag(event, entry.id)} onClick={(event) => { if (event.detail === 0 || !imageDragStarted.current) void openImage(image); }} onContextMenu={(event) => { event.preventDefault(); void openImage(image); }} aria-label={t("预览图片")}><img className="history-thumb" src={image.previewDataUrl} alt="" draggable={false} /></button> : entry.kind === "file" ? <button className="entry-kind file-drag-handle" type="button" draggable={entry.available} onDragStart={(event) => startFileDrag(event, entry.id)} onClick={() => void copyEntry(entry)} title={t("拖出文件或点击复制")} aria-label={t("拖出文件或点击复制")}><Icon name={entry.files.length > 1 ? "files" : entry.files[0].isDirectory ? "folder" : "file"} size={16} /></button> : <span className={entry.kind === "link" ? "entry-kind link-kind" : "entry-kind"}><Icon name={entry.kind === "link" ? "link" : "text"} size={16} /></span>}
                <button className="entry-content" type="button" draggable={Boolean(image) || (entry.kind === "file" && entry.available)} onPointerDown={() => { imageDragStarted.current = false; }} onDragStart={image ? (event) => startImageDrag(event, entry.id) : entry.kind === "file" ? (event) => startFileDrag(event, entry.id) : undefined} onClick={(event) => { if (image) { if (event.detail === 0 || !imageDragStarted.current) void openImage(image); } else void copyEntry(entry); }} onContextMenu={(event) => { if (image) { event.preventDefault(); void openImage(image); } }} title={entry.kind === "file" ? `${t("拖出文件或点击复制")}\n${entry.files.map(file => file.originalPath).join("\n")}` : image ? t("预览图片") : displayContent(entry)} aria-label={image ? t("预览图片") : t("复制：{content}", { content: entry.content.slice(0, 80) })}>
                  <span className="entry-preview">{displayContent(entry)}</span>
                  <span className="entry-meta"><span>{entry.kind === "image" ? entry.unavailable ? t("图片不可用") : `${entry.width} × ${entry.height}` : entry.kind === "file" ? fileMeta(entry) : entry.kind === "link" ? t("链接") : t("文字")}</span><span className="meta-separator" /><time dateTime={safeIsoDate(entry.copiedAt)}>{formatTime(entry.copiedAt)}</time></span>
                </button>
                <div className="entry-actions">
                  {(entry.kind === "text" || entry.kind === "link") && <button className="icon-button" type="button" onClick={() => openEditor({ sourceHistoryId: entry.id, originalText: entry.content, text: entry.content, category: "未分类" })} aria-label={t("保存为常用语")} title={t("保存为常用语")}><Icon name="bookmark" size={15} /></button>}
                  {image && <button className="icon-button" type="button" onClick={() => void saveImageAsPhrase(entry.id)} aria-label={t("保存图片到常用语")} title={t("保存图片到常用语")}><Icon name="bookmark" size={15} /></button>}
                  <button className="icon-button copy-button" type="button" onClick={() => void copyEntry(entry)} aria-label={t(image ? "复制图片" : "复制这条记录")} title={t(image ? "复制图片" : "复制")}><Icon name="copy" size={15} /></button>
                  <button className="icon-button delete-button" type="button" onClick={() => void deleteEntry(entry.id)} aria-label={t("删除这条记录")} title={t("删除")}><Icon name="trash" size={15} /></button>
                </div>
              </li>; })}
            </ul>
          ) : <div className="empty-state"><span className="empty-icon">{query ? <Icon name="search" size={18} /> : <BrandIcon size={19} />}</span><strong>{t(query ? "没有找到匹配内容" : "这里还没有剪贴板记录")}</strong><span>{t(query ? "试试更短的关键词。" : "复制文字、图片或文件，G-paster 会自动收好。")}</span></div>}
          {entries.length > 0 && <div className="history-toolbar history-footer">{query && <span className="result-count">{t("找到 {count} 条", { count: filteredEntries.length })}</span>}<button className="clear-all" type="button" onClick={() => void clearHistory()}>{t("清空记录")}</button></div>}
        </section>}

        {activeModule === "phrases" && <section className="module-panel" aria-label={t("常用语")}>
          <div className="module-toolbar">
            <label className="category-select-label"><span className="sr-only">{t("按分类筛选")}</span><select className="category-select" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">{t("全部")}</option>{categories.map((item) => <option key={item} value={item}>{displayCategory(item)}</option>)}</select></label>
            <span className="toolbar-spacer" />
            <button className="primary-button" type="button" onClick={() => openEditor({ text: "", category: category === "" ? "未分类" : category })}><Icon name="plus" size={15} />{t("新增")}</button>
          </div>
          {loading ? <div className="empty-state"><span className="loading-dot" /><span>{t("正在读取常用语")}</span></div> : filteredPhrases.length ? <ul className="phrase-list" aria-label={t("常用语列表")}>
            {filteredPhrases.map((phrase) => <li className="phrase-item" key={phrase.id}>
              <button className={"phrase-copy-area" + (phrase.kind === "image" ? " image-phrase-copy-area" : "")} type="button" onClick={() => void copyPhrase(phrase)} title={t(phrase.kind === "image" ? "点击复制图片" : "点击复制")}>
                {phrase.kind === "image" ? <><PhraseImagePreview id={phrase.id} /><span className="phrase-image-description">{t("图片 {width} × {height}", { width: phrase.image?.width ?? 0, height: phrase.image?.height ?? 0 })}</span><span className="phrase-meta">{displayCategory(phrase.category)}</span></> : <><span className="phrase-text">{phrase.text}</span><span className="phrase-meta">{displayCategory(phrase.category)}</span></>}
              </button>
              <div className="entry-actions">{phrase.kind !== "image" && <button className="icon-button" type="button" onClick={() => openEditor({ id: phrase.id, text: phrase.text, category: phrase.category })} aria-label={t("编辑常用语")} title={t("编辑")}><Icon name="edit" size={15} /></button>}<button className="icon-button delete-button" type="button" onClick={() => void deletePhrase(phrase)} aria-label={t("删除常用语")} title={t("删除")}><Icon name="trash" size={15} /></button></div>
            </li>)}
          </ul> : <div className="empty-state"><span className="empty-icon"><Icon name={query ? "search" : "phrase"} size={18} /></span><strong>{t(query ? "没有找到常用语" : "常用语还空着")}</strong><span>{t(query ? "换个关键词或分类试试。" : "把常用文字收在这里，之后一点就能复制。")}</span><button className="text-action" type="button" onClick={() => openEditor({ text: "", category: "未分类" })}>{t("创建第一条")}</button></div>}
        </section>}

        {activeModule === "screenshots" && <section className="module-panel screenshot-panel" aria-label={t("截图中转站")}>
          {filteredImages.length ? <div className="image-grid" aria-label={t("截图列表")}>
            {filteredImages.map((image) => <article className={"image-card" + (selectedImages.has(image.id) ? " selected" : "") + (image.unavailable ? " unavailable" : "")} key={image.id}>
              <label className="image-selection-control">
                <input className="image-selection" type="checkbox" checked={selectedImages.has(image.id)} onChange={() => toggleImageSelection(image.id)} aria-label={t("选择图片 {width} × {height}", { width: image.width, height: image.height })} />
                <span className="image-selection-mark" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="m3.5 8 3 3 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
              </label>
              <button className="image-preview-button" type="button" draggable={!image.unavailable} onPointerDown={() => { imageDragStarted.current = false; }} onDragStart={(event) => { const ids = selectedImages.has(image.id) ? filteredImages.filter(item => selectedImages.has(item.id)).map(item => item.id) : [image.id]; if (!selectedImages.has(image.id)) setSelectedImages(new Set([image.id])); startImageDrag(event, image.id, ids); }} onClick={(event) => { if (event.detail !== 0 && imageDragStarted.current) return; if (event.metaKey || event.ctrlKey) toggleImageSelection(image.id); else void copyEntry(image); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); void openImage(image); }} aria-label={image.unavailable ? t("图片不可用") : t("复制图片 {width} × {height}", { width: image.width, height: image.height })} title={image.unavailable ? t("图片不可用") : t("单击复制，右击查看详情")}><img src={image.previewDataUrl} alt={t(image.unavailable ? "图片不可用" : "剪贴板图片")} draggable={false} style={{ maxWidth: image.width, maxHeight: image.height }} /><span className="image-dimensions">{image.unavailable ? t("图片不可用") : `${image.width} × ${image.height}`}</span></button>
              <div className="image-card-footer"><time dateTime={safeIsoDate(image.copiedAt)}>{formatTime(image.copiedAt)}</time><div className="entry-actions"><button className="icon-button" type="button" disabled={image.unavailable} onClick={() => void saveImageAsPhrase(image.id)} aria-label={t("保存图片到常用语")} title={t("保存图片到常用语")}><Icon name="bookmark" size={14} /></button><button className="icon-button" type="button" disabled={image.unavailable} onClick={() => void copyEntry(image)} aria-label={t("复制图片回剪贴板")} title={t("复制图片")}><Icon name="copy" size={14} /></button><button className="icon-button" type="button" disabled={image.unavailable} onClick={() => void saveImage(image.id)} aria-label={t("保存图片到本地")} title={t("保存到本地")}><Icon name="save" size={14} /></button><button className="icon-button delete-button" type="button" onClick={() => void deleteEntry(image.id)} aria-label={t("删除图片")} title={t("删除")}><Icon name="trash" size={14} /></button></div></div>
            </article>)}
          </div> : <div className="empty-state"><span className="empty-icon"><Icon name={query ? "search" : "image"} size={18} /></span><strong>{t(query ? "没有找到这类图片" : "截图中转站还空着")}</strong><span>{t(query ? "试试输入图片尺寸。" : "保存截图后，会自动收集最近 {limit} 张。", { limit: imageLimit })}</span></div>}
          <div className="module-toolbar screenshot-footer"><span className="toolbar-caption">{t("截图 {screenshots} 张 · 图片池 {count}/{limit}", { screenshots: images.length, count: allImages.length, limit: imageLimit })}</span><span className="toolbar-spacer" />{selectedImages.size > 0 && <button className="settings-link" type="button" onClick={() => setSelectedImages(new Set())}>{t("已选择 {count} 张 · 取消选择", { count: selectedImages.size })}</button>}</div>
        </section>}
      </section>}

      {editor && <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}><form className="phrase-dialog" role="dialog" aria-modal="true" aria-labelledby="phrase-dialog-title" onSubmit={(event) => void savePhrase(event)}>
        <div className="dialog-heading"><h2 id="phrase-dialog-title">{t(editor.id ? "编辑常用语" : editor.sourceHistoryId ? "保存为常用语" : "新增常用语")}</h2><button className="icon-button" type="button" onClick={closeEditor} aria-label={t("关闭")}><Icon name="close" size={16} /></button></div>
        <label className="field-label" htmlFor="phrase-content">{t("内容")}</label><textarea id="phrase-content" autoFocus maxLength={20000} required rows={4} value={editor.text} onChange={(event) => setEditor({ ...editor, text: event.target.value })} placeholder={t("输入常用文字")} />
        {!editor.id && !editor.sourceHistoryId && <button className="secondary-button phrase-import-image" type="button" onClick={() => void importPhraseImage()}><Icon name="image" size={15} />{t("添加图片")}</button>}
        <label className="field-label" htmlFor="phrase-category">{t("分类")}</label><input id="phrase-category" className="category-input" maxLength={50} value={displayCategory(editor.category)} onChange={(event) => setEditor({ ...editor, category: editor.category === "未分类" && event.target.value === t("未分类") ? "未分类" : event.target.value })} placeholder={t("例如：工作、回复")} />
        {editorError && <div className="error-message" role="alert">{t(editorError)}</div>}
        <div className="dialog-actions"><button className="secondary-button" type="button" onClick={closeEditor}>{t("取消")}</button><button className="primary-button" type="submit">{t("保存")}</button></div>
      </form></div>}

      {preview && <div className="modal-scrim image-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) closePreview(); }}><section className="image-dialog" role="dialog" aria-modal="true" aria-label={t("图片预览")}>
        <div className="dialog-heading"><span className="preview-title">{preview.entry.width} × {preview.entry.height}</span><button className="icon-button" type="button" onClick={closePreview} aria-label={t("关闭预览")}><Icon name="close" size={16} /></button></div>
        <div className="large-image-wrap" draggable onPointerDown={() => { imageDragStarted.current = false; }} onDragStart={(event) => startImageDrag(event, preview.entry.id)}><img draggable={false} src={preview.dataUrl} alt={t("剪贴板图片，{width} × {height}", { width: preview.entry.width, height: preview.entry.height })} /></div>
        <div className="preview-actions"><button className="secondary-button" type="button" onClick={() => void saveImage(preview.entry.id)}><Icon name="save" size={15} />{t("保存")}</button><button className="primary-button" type="button" onClick={() => void copyEntry(preview.entry)}><Icon name="copy" size={15} />{t("复制图片")}</button></div>
      </section></div>}
    </main>
  );
}

export default App;
