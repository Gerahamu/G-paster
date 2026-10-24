import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AppPreferences, PreferenceFailure, PreferenceResult, SystemSettings } from "./shared/contracts";
import { translate, type TranslationKey } from "./shared/i18n";
import { displayShortcut, shortcutFromKey } from "./shared/shortcuts";
import { DEFAULT_PREFERENCES, IMAGE_LIMIT_RANGE, TEXT_LIMIT_RANGE, preferencePatch, type AppearanceChoice, type LanguageChoice } from "./shared/preferences";

const failureKeys: Record<PreferenceFailure, TranslationKey> = {
  "shortcut-invalid": "请使用 Ctrl、Option / Alt 或 Command 加字母、数字、空格或功能键。",
  "shortcut-conflict": "此快捷键已被占用，原快捷键保留。",
  "settings-save-failed": "设置保存失败，请重试。",
  "login-unavailable": "安装版可设置开机启动。",
  "login-failed": "未能更改开机启动，请检查系统登录项。",
  "preferences-invalid": "请输入有效的保留数量：文本 1–1000 条，图片 1–100 张。"
};

export default function SettingsPanel({ system, onBack }: { system: SystemSettings; onBack: () => void }) {
  const t = (key: TranslationKey, values?: Record<string, string | number>) => translate(system.language, key, values);
  const [preferences, setPreferences] = useState<AppPreferences | null>(null);
  const [error, setError] = useState<TranslationKey | "">("");
  const [notice, setNotice] = useState<TranslationKey | "">("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [textLimit, setTextLimit] = useState("");
  const [imageLimit, setImageLimit] = useState("");
  const dirtyLimits = useRef(false);
  const limitRevision = useRef(0);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLimitSave = useRef<(() => void) | null>(null);
  const recordButton = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  useEffect(() => { if (recording && !busy) recordButton.current?.focus(); }, [recording, busy]);

  async function refresh() {
    try { const next = await window.gpaster.getPreferences(); if (alive.current) {
      setPreferences(next); setError("");
      if (!dirtyLimits.current) { setTextLimit(String(next.textLimit)); setImageLimit(String(next.imageLimit)); }
    } }
    catch { if (alive.current) setError("无法读取设置，请重试。"); }
  }
  useEffect(() => {
    alive.current = true;
    const unsubscribe = window.gpaster.onPreferencesChanged(next => {
      setPreferences(next);
      if (!dirtyLimits.current) { setTextLimit(String(next.textLimit)); setImageLimit(String(next.imageLimit)); }
    });
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      flushLimits();
      alive.current = false;
      unsubscribe();
      window.removeEventListener("focus", onFocus);
      void window.gpaster.setShortcutRecording(false).catch(() => undefined);
    };
  }, []);

  async function apply(operation: () => Promise<PreferenceResult>, shortcut = false) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await operation();
      if (!alive.current) return;
      setPreferences(result.settings);
      if (result.error) setError(failureKeys[result.error]);
      else setNotice(shortcut ? "快捷键已更新。" : "设置已保存。");
    } catch { if (alive.current) setError("设置保存失败，请重试。"); }
    finally { if (alive.current) setBusy(false); }
  }

  function flushLimits() {
    if (limitTimer.current) clearTimeout(limitTimer.current);
    limitTimer.current = null;
    const save = pendingLimitSave.current;
    pendingLimitSave.current = null;
    save?.();
  }

  function scheduleLimits(text: string, images: string) {
    if (limitTimer.current) clearTimeout(limitTimer.current);
    dirtyLimits.current = true;
    ++limitRevision.current;
    // Avoid committing each intermediate digit; navigation/blur flushes the latest edit.
    pendingLimitSave.current = () => { void saveLimits(text, images); };
    limitTimer.current = setTimeout(flushLimits, 500);
  }

  async function saveLimits(text = textLimit, images = imageLimit) {
    if (!preferences) return;
    const revision = ++limitRevision.current;
    dirtyLimits.current = true;
    const patch = preferencePatch({ textLimit: Number(text), imageLimit: Number(images) });
    if (!patch || !text.trim() || !images.trim()) { setError(failureKeys["preferences-invalid"]); return; }
    setError(""); setNotice("");
    // Once submitted, leaving the panel cannot cancel a pending valid edit.
    // The main process serializes writes; only the latest result normalizes the fields.
    try {
      const result = await window.gpaster.updatePreferences(patch);
      if (!alive.current || revision !== limitRevision.current) return;
      setPreferences(result.settings);
      if (result.error) setError(failureKeys[result.error]);
      else {
        dirtyLimits.current = false;
        setTextLimit(String(result.settings.textLimit)); setImageLimit(String(result.settings.imageLimit));
        setNotice("数量已保存，下次收集或启动时按新上限清理。");
      }
    } catch { if (alive.current && revision === limitRevision.current) setError("设置保存失败，请重试。"); }
  }

  async function startRecording() {
    setBusy(true); setError(""); setNotice("");
    try {
      await window.gpaster.setShortcutRecording(true);
      if (!alive.current) { await window.gpaster.setShortcutRecording(false); return; }
      setRecording(true);
    } catch { if (alive.current) setError("设置保存失败，请重试。"); }
    finally { if (alive.current) setBusy(false); }
  }
  function cancelRecording() {
    setRecording(false);
    void window.gpaster.setShortcutRecording(false).catch(() => setError("设置保存失败，请重试。"));
  }
  function recordKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!recording) return;
    event.preventDefault(); event.stopPropagation();
    if (event.repeat) return;
    if (event.key === "Escape") { cancelRecording(); return; }
    if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
    const candidate = shortcutFromKey(event, window.gpaster.platform);
    if (!candidate) { setError(failureKeys["shortcut-invalid"]); return; }
    setRecording(false);
    void apply(() => window.gpaster.setShortcut(candidate), true);
  }

  return <section className="settings-panel" aria-label={t("设置")}>
    <div className="settings-heading"><button className="settings-back" type="button" onClick={onBack} aria-label={t("返回")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>{t("返回")}</button><h1>{t("设置")}</h1></div>
    <div className="settings-scroll">
      {error && <div className="error-message" role="alert">{t(error)}{!preferences ? <button type="button" onClick={() => void refresh()}>{t("重试")}</button> : dirtyLimits.current && <button type="button" onClick={() => void saveLimits()}>{t("重试")}</button>}</div>}
      {notice && <div className="notice-message" role="status">{t(notice)}</div>}
      {!preferences ? !error && <div className="empty-state"><span className="loading-dot" /></div> : <>
        <section className="settings-section" aria-labelledby="general-heading"><h2 id="general-heading">{t("使用习惯")}</h2>
          <div className="settings-group">
            <div className="settings-row shortcut-row"><div className="settings-copy"><strong>{t("打开 / 收起面板")}</strong><span>{t("再按一次快捷键即可收起。")}</span></div><div className="shortcut-control"><kbd>{displayShortcut(preferences.shortcut, window.gpaster.platform)}</kbd><button ref={recordButton} className={"settings-action" + (recording ? " recording" : "")} type="button" disabled={busy} onClick={() => recording ? cancelRecording() : void startRecording()} onKeyDown={recordKey} onBlur={() => { if (recording) cancelRecording(); }} aria-label={t("更改快捷键")}>{t(recording ? "按下新组合键" : "更改")}</button></div></div>
            <div className="settings-shortcut-footer"><span>{recording ? t("按 Esc 取消") : !preferences.shortcutRegistered ? t("快捷键未生效，可更换组合或使用菜单栏打开。") : ""}</span><button className="settings-link" disabled={busy || recording || preferences.shortcut === preferences.defaultShortcut} type="button" onClick={() => void apply(() => window.gpaster.setShortcut(preferences.defaultShortcut), true)}>{t("恢复默认")}</button></div>
            <div className="settings-row"><div className="settings-copy"><strong>{t("开机启动")}</strong><span>{t(!preferences.loginSupported ? "安装版可设置开机启动。" : preferences.loginStatus === "unavailable" ? "无法读取开机启动状态，请检查系统登录项。" : preferences.loginStatus === "requires-approval" ? "需在系统登录项中允许启动。" : "登录后在后台运行。")}</span></div><button className="settings-switch" type="button" role="switch" aria-checked={preferences.openAtLogin || preferences.loginStatus === "requires-approval"} aria-label={t("开机启动")} disabled={busy || recording || !preferences.loginSupported || preferences.loginStatus === "unavailable"} onClick={() => void apply(() => window.gpaster.setOpenAtLogin(!(preferences.openAtLogin || preferences.loginStatus === "requires-approval")))}><span /></button></div>
          </div>
        </section>
        <section className="settings-section" aria-labelledby="system-heading"><h2 id="system-heading">{t("偏好设置")}</h2><div className="settings-group">
          <div className="settings-row"><label htmlFor="language-choice">{t("界面语言")}</label><select id="language-choice" className="settings-select" value={preferences.language} disabled={busy || recording} onChange={event => void apply(() => window.gpaster.updatePreferences({ language: event.target.value as LanguageChoice }))}><option value="system">{t("跟随系统")}</option><option value="zh">{t("中文")}</option><option value="en">English</option></select></div>
          <div className="settings-row"><label htmlFor="appearance-choice">{t("外观")}</label><select id="appearance-choice" className="settings-select" value={preferences.appearance} disabled={busy || recording} onChange={event => void apply(() => window.gpaster.updatePreferences({ appearance: event.target.value as AppearanceChoice }))}><option value="system">{t("跟随系统")}</option><option value="light">{t("浅色")}</option><option value="dark">{t("深色")}</option></select></div>
        </div><p className="settings-caption">{t("自定义语言与外观，或自动跟随系统。")}</p></section>
        <section className="settings-section" aria-labelledby="storage-heading"><h2 id="storage-heading">{t("本地存储")}</h2><div className="settings-group">
          <form className="settings-limits-form" onSubmit={event => { event.preventDefault(); flushLimits(); }}>
            <div className="settings-row"><label htmlFor="text-limit">{t("文本、链接与文件")}</label><input id="text-limit" className="settings-number" type="number" min={TEXT_LIMIT_RANGE.min} max={TEXT_LIMIT_RANGE.max} step="1" value={textLimit} disabled={busy || recording} onBlur={flushLimits} onChange={event => { dirtyLimits.current = true; setTextLimit(event.target.value); scheduleLimits(event.target.value, imageLimit); }} /></div>
            <div className="settings-row"><label htmlFor="image-limit">{t("图片与截图")}</label><input id="image-limit" className="settings-number" type="number" min={IMAGE_LIMIT_RANGE.min} max={IMAGE_LIMIT_RANGE.max} step="1" value={imageLimit} disabled={busy || recording} onBlur={flushLimits} onChange={event => { dirtyLimits.current = true; setImageLimit(event.target.value); scheduleLimits(textLimit, event.target.value); }} /></div>
            <div className="settings-row limits-actions"><button className="settings-link" type="button" disabled={busy || recording} onClick={() => { scheduleLimits(String(DEFAULT_PREFERENCES.textLimit), String(DEFAULT_PREFERENCES.imageLimit)); flushLimits(); }}>{t("恢复默认数量")}</button></div>
          </form>
          <div className="settings-row"><div className="settings-copy"><strong>{t("保存文件副本")}</strong><span>{t("仅影响之后收集的文件。单批 100 MB，总副本 500 MB；超限保留引用并提示。删除历史会移除副本，原文件不变。")}</span></div><button className="settings-switch" type="button" role="switch" aria-checked={preferences.saveFileCopies} aria-label={t("保存文件副本")} disabled={busy || recording} onClick={() => void apply(() => window.gpaster.updatePreferences({ saveFileCopies: !preferences.saveFileCopies }))}><span /></button></div>
          <div className="settings-row"><div className="settings-copy"><span>{t("仅存储在本机，原截图保持不变。")}</span></div><button className="settings-action" type="button" onClick={() => { void window.gpaster.openDataDirectory().then(ok => { if (!ok) setError("无法打开数据文件夹。"); }).catch(() => setError("无法打开数据文件夹。")); }}>{t("打开数据文件夹")}</button></div>
        </div><p className="settings-caption">{t("更改自动保存并生效；常用语不受此上限影响。")}</p></section>
      </>}
    </div>
    <footer className="settings-footer"><span>G-paster{preferences ? ` ${preferences.version}` : ""}</span><span>{t("本地运行，无需登录")}</span></footer>
  </section>;
}
