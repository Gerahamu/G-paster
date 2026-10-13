import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type FormEvent } from "react";
import type { CaptureIssue, ClipboardEntry, ClipboardHistoryItem, ClipboardImageEntry, QuickPhrase } from "./shared/contracts";
import { errorKey, translate, translateMessage, type TranslationKey, type TranslationValues } from "./shared/i18n";
import gpasterIcon from "../assets/G-paster-brand.png";
import SettingsPanel from "./SettingsPanel";
import { DEFAULT_PREFERENCES } from "./shared/preferences";

type ModuleName = "history" | "phrases" | "screenshots";
type IconName = "history" | "phrase" | "image" | "search" | "link" | "text" | "copy" | "trash" | "close" | "plus" | "edit" | "star" | "save" | "bookmark";
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
    case "copy": return <svg {...base}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>;
    case "trash": return <svg {...base}><path d="M4.5 7h15M9 7V4.5h6V7m2.5 0-.8 12.5H7.3L6.5 7M10 10.5v5.5M14 10.5v5.5" /></svg>;
    case "close": return <svg {...base}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case "plus": return <svg {...base}><path d="M12 5v14M5 12h14" /></svg>;
    case "edit": return <svg {...base}><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5 4 16.5Z" /><path d="m13.8 6.7 3.5 3.5" /></svg>;
    case "star": return <svg {...base}><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" /></svg>;
    case "save": return <svg {...base}><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>;
    case "bookmark": return <svg {...base}><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z" /></svg>;
  }
}

function BrandIcon({ size = 18 }: { size?: number }) {
  return <img className="gpaster-brand-image" src={gpasterIcon} width={size} height={size} alt="" draggable={false} />;
}


function isImageEntry(entry: ClipboardHistoryItem): entry is ClipboardImageEntry {
  return entry.kind === "image";
}

function App() {
  const [settings, setSettings] = useState(window.gpaster.initialSystemSettings);
  const t = (key: TranslationKey, values?: TranslationValues) => translate(settings.language, key, values);
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(settings.locale, { hour: "2-digit", minute: "2-digit" }), [settings.locale]);
  const formatTime = (timestamp: number) => timeFormatter.format(timestamp);
  const displayCategory = (value: string) => value === "未分类" ? t("未分类") : value;
  const displayContent = (entry: ClipboardHistoryItem) => isImageEntry(entry)
    ? t("图片 {width} × {height}", { width: entry.width, height: entry.height }) : entry.content;
  const [entries, setEntries] = useState<ClipboardHistoryItem[]>([]);
  const [phrases, setPhrases] = useState<QuickPhrase[]>([]);
  const [activeModule, setActiveModule] = useState<ModuleName>("history");
  const [showSettings, setShowSettings] = useState(false);
  const settingsDirty = useRef(false);
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
  const images = useMemo(() => entries.filter(isImageEntry), [entries]);
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
      if (!settingsDirty.current) setShowSettings(false);
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

  const activeCount = activeModule === "history" ? entries.length : activeModule === "phrases" ? phrases.length : images.length;
  useEffect(() => {
    if (showSettings || !loading) window.gpaster.setCompactMode(!showSettings && activeCount === 0);
  }, [activeCount, loading, showSettings]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (showSettings) {
        if (event.key === "Escape") closeSettings();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        if (preview) setPreview(null);
        else if (editor) closeEditor();
        else if (document.activeElement === searchRef.current) setQuery("");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editor, preview, settings.language, showSettings]);

  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? entries.filter((entry) => entry.content.toLocaleLowerCase().includes(normalized) || displayContent(entry).toLocaleLowerCase().includes(normalized)) : entries;
  }, [entries, query, settings.language]);

  const filteredPhrases = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return phrases.filter((phrase) => (category === "" || phrase.category === category) &&
      (!normalized || phrase.text.toLocaleLowerCase().includes(normalized) || phrase.category.toLocaleLowerCase().includes(normalized) || displayCategory(phrase.category).toLocaleLowerCase().includes(normalized)));
  }, [phrases, query, category, settings.language]);

  const filteredImages = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return images.filter((image) => !normalized || image.content.toLocaleLowerCase().includes(normalized) || displayContent(image).toLocaleLowerCase().includes(normalized));
  }, [images, query, settings.language]);

  async function copyEntry(entry: ClipboardHistoryItem): Promise<void> {
    setError("");
    try {
      if (!await window.gpaster.copyHistory(entry.id)) setError("这条记录已不存在。");
    } catch { setError("复制失败，请重试。"); }
  }

  function startImageDrag(event: ReactDragEvent<HTMLElement>, id: string): void {
    event.preventDefault();
    setError("");
    void window.gpaster.startImageDrag(id).then((started) => {
      if (!started) setError("这张图片已不存在，无法拖动。");
    }).catch(() => setError("拖动图片失败，请重试。"));
  }

  async function deleteEntry(id: string): Promise<void> {
    setError("");
    try { await window.gpaster.deleteHistory(id); }
    catch { setError("删除失败，请重试。"); }
  }

  async function clearHistory(): Promise<void> {
    if (!window.confirm(t("清空全部剪贴板历史和截图？此操作无法撤销。"))) return;
    setError("");
    try { await window.gpaster.clearHistory(); }
    catch { setError("清空失败，请重试。"); }
  }

  async function openImage(entry: ClipboardImageEntry): Promise<void> {
    try {
      const dataUrl = await window.gpaster.previewImage(entry.id);
      if (dataUrl) setPreview({ entry, dataUrl });
      else setError("无法读取这张图片。");
    } catch { setError("无法打开图片预览。"); }
  }

  async function toggleFavorite(entry: ClipboardImageEntry): Promise<void> {
    try {
      const isFavorite = await window.gpaster.toggleImageFavorite(entry.id);
      setPreview((current) => current?.entry.id === entry.id ? { ...current, entry: { ...current.entry, isFavorite } } : current);
    }
    catch { setError("更新收藏状态失败。"); }
  }

  async function saveImage(id: string): Promise<void> {
    try {
      if (await window.gpaster.saveImage(id)) setNotice("图片已保存到本地。");
      else setNotice("");
    } catch { setError("保存图片失败，请重试。"); }
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
    if (settingsDirty.current && !window.confirm(t("放弃未保存的数量修改？"))) return;
    setShowSettings(false);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }
  const searchPlaceholderKey = activeModule === "history" ? "搜索文字、链接或图片尺寸…" : activeModule === "phrases" ? "搜索常用语或分类" : "搜索图片尺寸";

  const searchPlaceholder = t(searchPlaceholderKey);

  return (
    <main className={"app-shell" + (isMac ? " platform-mac" : "")}>
      <header className="app-header">
        <span className="brand-mark" title="G-paster"><BrandIcon size={28} /></span>
        {showSettings ? <span className="settings-window-label">G-paster</span> : <div className="search-wrap">
          <Icon name="search" size={16} />
          <input ref={searchRef} aria-label={searchPlaceholder} autoFocus autoComplete="off" onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} value={query} />
          {query ? <button className="clear-search" type="button" aria-label={t("清除搜索")} onClick={() => { setQuery(""); searchRef.current?.focus(); }}><Icon name="close" size={14} /></button> : <kbd>{isMac ? "⌘ F" : "Ctrl F"}</kbd>}
        </div>}
        <div className="header-actions"><button className="settings-entry" type="button" disabled={!!editor || !!preview} onClick={() => showSettings ? closeSettings() : setShowSettings(true)} aria-label={t("设置")} title={t("设置")} aria-pressed={showSettings}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="m9 3-1 3-3 1-1 3 2 2-1 3 2 2 3-1 2 2 3-1 1-3 3-1 1-3-2-2 1-3-2-2-3 1-2-2Z" /><circle cx="12" cy="12" r="3" /></svg></button></div>
      </header>

      {showSettings ? <SettingsPanel system={settings} onBack={closeSettings} onDirtyChange={dirty => { settingsDirty.current = dirty; }} /> : <section className="workspace" aria-label={t("G-paster 工作区")}>

        <nav className="module-tabs" aria-label={t("功能模块")}>
          <button className={activeModule === "history" ? "module-tab active" : "module-tab"} onClick={() => selectModule("history")} type="button" aria-pressed={activeModule === "history"}><Icon name="history" size={15} /><span>{t(moduleNames.history)}</span><span className="tab-count">{entries.length}</span></button>
          <button className={activeModule === "phrases" ? "module-tab active" : "module-tab"} onClick={() => selectModule("phrases")} type="button" aria-pressed={activeModule === "phrases"}><Icon name="phrase" size={15} /><span>{t(moduleNames.phrases)}</span><span className="tab-count">{phrases.length}</span></button>
          <button className={activeModule === "screenshots" ? "module-tab active" : "module-tab"} onClick={() => selectModule("screenshots")} type="button" aria-pressed={activeModule === "screenshots"}><Icon name="image" size={15} /><span>{t(moduleNames.screenshots)}</span><span className="tab-count">{images.length}</span></button>
        </nav>

        {error && <div className="error-message" role="alert">{t(error)}<button type="button" aria-label={t("关闭提示")} onClick={() => setError("")}><Icon name="close" size={13} /></button></div>}
        {captureIssues.map((issue) => <div className="error-message" role="status" key={issue.source}>{translateMessage(settings.language, issue.message)}</div>)}
        {notice && <div className="notice-message" role="status">{t(notice)}<button type="button" aria-label={t("关闭提示")} onClick={() => setNotice("")}><Icon name="close" size={13} /></button></div>}

        {activeModule === "history" && <section className="history-panel" aria-label={t("剪贴板历史")}>
          {loading ? <div className="empty-state"><span className="loading-dot" /><span>{t("正在读取记录")}</span></div> : filteredEntries.length > 0 ? (
            <ul className="history-list" aria-label={t("剪贴板记录")}>
              {filteredEntries.map((entry) => <li className="history-item" key={entry.id}>
                {isImageEntry(entry) ? <button className="history-thumb-button" type="button" draggable onDragStart={(event) => startImageDrag(event, entry.id)} onClick={() => void openImage(entry)} aria-label={t("预览图片")}><img className="history-thumb" src={entry.previewDataUrl} alt="" /></button> : <span className={entry.kind === "link" ? "entry-kind link-kind" : "entry-kind"}><Icon name={entry.kind === "link" ? "link" : "text"} size={16} /></span>}
                <button className="entry-content" type="button" onClick={() => isImageEntry(entry) ? void openImage(entry) : void copyEntry(entry)} title={displayContent(entry)} aria-label={isImageEntry(entry) ? t("预览图片") : t("复制：{content}", { content: entry.content.slice(0, 80) })}>
                  <span className="entry-preview">{displayContent(entry)}</span>
                  <span className="entry-meta"><span>{entry.kind === "image" ? `${entry.width} × ${entry.height}` : entry.kind === "link" ? t("链接") : t("文字")}</span><span className="meta-separator" /><time dateTime={new Date(entry.copiedAt).toISOString()}>{formatTime(entry.copiedAt)}</time></span>
                </button>
                <div className="entry-actions">
                  {entry.kind !== "image" && <button className="icon-button" type="button" onClick={() => openEditor({ sourceHistoryId: entry.id, originalText: entry.content, text: entry.content, category: "未分类" })} aria-label={t("保存为常用语")} title={t("保存为常用语")}><Icon name="bookmark" size={15} /></button>}
                  {isImageEntry(entry) && <button className={entry.isFavorite ? "icon-button favorite active" : "icon-button favorite"} type="button" onClick={() => void toggleFavorite(entry)} aria-label={t(entry.isFavorite ? "取消收藏" : "收藏图片")} title={t(entry.isFavorite ? "取消收藏" : "收藏")}><Icon name="star" size={15} /></button>}
                  <button className="icon-button copy-button" type="button" onClick={() => void copyEntry(entry)} aria-label={t(entry.kind === "image" ? "复制图片" : "复制这条记录")} title={t(entry.kind === "image" ? "复制图片" : "复制")}><Icon name="copy" size={15} /></button>
                  <button className="icon-button delete-button" type="button" onClick={() => void deleteEntry(entry.id)} aria-label={t("删除这条记录")} title={t("删除")}><Icon name="trash" size={15} /></button>
                </div>
              </li>)}
            </ul>
          ) : <div className="empty-state"><span className="empty-icon">{query ? <Icon name="search" size={18} /> : <BrandIcon size={19} />}</span><strong>{t(query ? "没有找到匹配内容" : "这里还没有剪贴板记录")}</strong><span>{t(query ? "试试更短的关键词。" : "复制文字或图片，G-paster 会自动收好。")}</span></div>}
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
              <button className="phrase-copy-area" type="button" onClick={() => void copyPhrase(phrase)} title={t("点击复制")}><span className="phrase-text">{phrase.text}</span><span className="phrase-meta">{displayCategory(phrase.category)}</span></button>
              <div className="entry-actions"><button className="icon-button" type="button" onClick={() => openEditor({ id: phrase.id, text: phrase.text, category: phrase.category })} aria-label={t("编辑常用语")} title={t("编辑")}><Icon name="edit" size={15} /></button><button className="icon-button delete-button" type="button" onClick={() => void deletePhrase(phrase)} aria-label={t("删除常用语")} title={t("删除")}><Icon name="trash" size={15} /></button></div>
            </li>)}
          </ul> : <div className="empty-state"><span className="empty-icon"><Icon name={query ? "search" : "phrase"} size={18} /></span><strong>{t(query ? "没有找到常用语" : "常用语还空着")}</strong><span>{t(query ? "换个关键词或分类试试。" : "把常用文字收在这里，之后一点就能复制。")}</span><button className="text-action" type="button" onClick={() => openEditor({ text: "", category: "未分类" })}>{t("创建第一条")}</button></div>}
        </section>}

        {activeModule === "screenshots" && <section className="module-panel screenshot-panel" aria-label={t("截图中转站")}>
          {filteredImages.length ? <div className="image-grid" aria-label={t("截图列表")}>
            {filteredImages.map((image) => <article className="image-card" key={image.id}>
              <button className="image-preview-button" type="button" draggable onDragStart={(event) => startImageDrag(event, image.id)} onClick={() => void openImage(image)} aria-label={t("预览图片 {width} × {height}", { width: image.width, height: image.height })}><img src={image.previewDataUrl} alt={t("剪贴板图片")} /><span className="image-dimensions">{image.width} × {image.height}</span></button>
              <div className="image-card-footer"><time dateTime={new Date(image.copiedAt).toISOString()}>{formatTime(image.copiedAt)}</time><div className="entry-actions"><button className={image.isFavorite ? "icon-button favorite active" : "icon-button favorite"} type="button" onClick={() => void toggleFavorite(image)} aria-label={t(image.isFavorite ? "取消收藏" : "收藏图片")} title={t("收藏")}><Icon name="star" size={14} /></button><button className="icon-button" type="button" onClick={() => void copyEntry(image)} aria-label={t("复制图片回剪贴板")} title={t("复制图片")}><Icon name="copy" size={14} /></button><button className="icon-button" type="button" onClick={() => void saveImage(image.id)} aria-label={t("保存图片到本地")} title={t("保存到本地")}><Icon name="save" size={14} /></button><button className="icon-button delete-button" type="button" onClick={() => void deleteEntry(image.id)} aria-label={t("删除图片")} title={t("删除")}><Icon name="trash" size={14} /></button></div></div>
            </article>)}
          </div> : <div className="empty-state"><span className="empty-icon"><Icon name={query ? "search" : "image"} size={18} /></span><strong>{t(query ? "没有找到这类图片" : "截图中转站还空着")}</strong><span>{t(query ? "试试输入图片尺寸。" : "复制或保存截图后，会自动收集最近 {limit} 张。", { limit: imageLimit })}</span></div>}
          <div className="module-toolbar screenshot-footer"><span className="toolbar-caption">{t("当前 {count} 张，上限 {limit}", { count: images.length, limit: imageLimit })}</span><span className="toolbar-spacer" />{images.some((image) => image.isFavorite) && <span className="favorite-caption"><Icon name="star" size={13} />{t("已收藏 {count}", { count: images.filter((image) => image.isFavorite).length })}</span>}</div>
        </section>}
      </section>}

      {editor && <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}><form className="phrase-dialog" role="dialog" aria-modal="true" aria-labelledby="phrase-dialog-title" onSubmit={(event) => void savePhrase(event)}>
        <div className="dialog-heading"><h2 id="phrase-dialog-title">{t(editor.id ? "编辑常用语" : editor.sourceHistoryId ? "保存为常用语" : "新增常用语")}</h2><button className="icon-button" type="button" onClick={closeEditor} aria-label={t("关闭")}><Icon name="close" size={16} /></button></div>
        <label className="field-label" htmlFor="phrase-content">{t("内容")}</label><textarea id="phrase-content" autoFocus maxLength={20000} required rows={4} value={editor.text} onChange={(event) => setEditor({ ...editor, text: event.target.value })} placeholder={t("输入常用文字")} />
        <label className="field-label" htmlFor="phrase-category">{t("分类")}</label><input id="phrase-category" className="category-input" maxLength={50} value={displayCategory(editor.category)} onChange={(event) => setEditor({ ...editor, category: editor.category === "未分类" && event.target.value === t("未分类") ? "未分类" : event.target.value })} placeholder={t("例如：工作、回复")} />
        {editorError && <div className="error-message" role="alert">{t(editorError)}</div>}
        <div className="dialog-actions"><button className="secondary-button" type="button" onClick={closeEditor}>{t("取消")}</button><button className="primary-button" type="submit">{t("保存")}</button></div>
      </form></div>}

      {preview && <div className="modal-scrim image-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}><section className="image-dialog" role="dialog" aria-modal="true" aria-label={t("图片预览")}>
        <div className="dialog-heading"><span className="preview-title">{preview.entry.width} × {preview.entry.height}</span><button className="icon-button" type="button" onClick={() => setPreview(null)} aria-label={t("关闭预览")}><Icon name="close" size={16} /></button></div>
        <div className="large-image-wrap"><img draggable onDragStart={(event) => startImageDrag(event, preview.entry.id)} src={preview.dataUrl} alt={t("剪贴板图片，{width} × {height}", { width: preview.entry.width, height: preview.entry.height })} /></div>
        <div className="preview-actions"><button className={preview.entry.isFavorite ? "secondary-button favorite-button active" : "secondary-button favorite-button"} type="button" onClick={() => void toggleFavorite(preview.entry)}><Icon name="star" size={15} />{t(preview.entry.isFavorite ? "已收藏" : "收藏")}</button><button className="secondary-button" type="button" onClick={() => void saveImage(preview.entry.id)}><Icon name="save" size={15} />{t("保存")}</button><button className="primary-button" type="button" onClick={() => void copyEntry(preview.entry)}><Icon name="copy" size={15} />{t("复制图片")}</button></div>
      </section></div>}
    </main>
  );
}

export default App;
