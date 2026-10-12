export type UiLanguage = "zh" | "en";

const english = {
  "剪贴板": "Clipboard", "常用语": "Phrases", "截图": "Screenshots",
  "全部": "All", "未分类": "Uncategorized", "链接": "Link", "文字": "Text",
  "G-paster 工作区": "G-paster workspace", "功能模块": "Modules",
  "搜索剪贴板内容": "Search clipboard", "搜索常用语或分类": "Search phrases or categories", "搜索图片尺寸": "Search image dimensions",
  "清除搜索": "Clear search", "关闭提示": "Dismiss message", "关闭": "Close", "关闭预览": "Close preview",
  "剪贴板历史": "Clipboard history", "剪贴板记录": "Clipboard entries", "清空记录": "Clear history",
  "正在读取记录": "Loading history", "这里还没有剪贴板记录": "Your clipboard is empty",
  "没有找到匹配内容": "No matches found", "试试更短的关键词。": "Try a shorter search.",
  "复制文字或图片，G-paster 会自动收好。": "Copy text or an image. G-paster will keep it here.",
  "图片 {width} × {height}": "Image {width} × {height}", "预览图片": "Preview image",
  "预览图片 {width} × {height}": "Preview image {width} × {height}",
  "剪贴板图片，{width} × {height}": "Clipboard image, {width} × {height}", "剪贴板图片": "Clipboard image",
  "复制：{content}": "Copy: {content}", "找到 {count} 条": "{count} found",
  "保存为常用语": "Save as phrase", "取消收藏": "Unstar", "收藏图片": "Star image", "收藏": "Star", "已收藏": "Starred",
  "复制图片": "Copy image", "复制图片回剪贴板": "Copy image to clipboard", "复制这条记录": "Copy entry", "复制": "Copy",
  "删除这条记录": "Delete entry", "删除": "Delete", "删除图片": "Delete image",
  "按分类筛选": "Filter by category", "新增": "New", "正在读取常用语": "Loading phrases", "常用语列表": "Phrase list",
  "点击复制": "Click to copy", "编辑常用语": "Edit phrase", "删除常用语": "Delete phrase", "新增常用语": "New phrase",
  "没有找到常用语": "No phrases found", "常用语还空着": "No saved phrases yet",
  "换个关键词或分类试试。": "Try another search or category.",
  "把常用文字收在这里，之后一点就能复制。": "Keep reusable text here. Copy it with one click.", "创建第一条": "Create a phrase",
  "截图中转站": "Screenshot collection", "截图列表": "Screenshot list", "保存图片到本地": "Save image to file", "保存到本地": "Save to file",
  "没有找到这类图片": "No images found", "截图中转站还空着": "No images yet", "试试输入图片尺寸。": "Try searching by image dimensions.",
  "复制或保存截图后，会自动收集最近 10 张。": "Copy an image or take a screenshot. The latest 10 stay here.",
  "最近 {count} / 10 张": "Recent {count} / 10", "已收藏 {count}": "{count} starred",
  "内容": "Content", "分类": "Category", "输入常用文字": "Enter reusable text", "例如：工作、回复": "e.g. Work, Replies",
  "取消": "Cancel", "保存": "Save", "编辑": "Edit", "图片预览": "Image preview",
  "读取本地内容失败。": "Could not load local data.", "读取本地内容失败。请稍后重试。": "Could not load local data. Please try again.",
  "这条记录已不存在。": "This entry no longer exists.", "复制失败，请重试。": "Copy failed. Please try again.",
  "这张图片已不存在，无法拖动。": "This image no longer exists and cannot be dragged.", "拖动图片失败，请重试。": "Could not drag the image. Please try again.",
  "删除失败，请重试。": "Delete failed. Please try again.",
  "清空全部剪贴板历史和截图？此操作无法撤销。": "Clear all clipboard history and images? This cannot be undone.",
  "清空失败，请重试。": "Could not clear history. Please try again.", "部分记录未能清空，请检查后重试。": "Some entries could not be cleared. Please check and try again.",
  "无法读取这张图片。": "Could not read this image.", "无法打开图片预览。": "Could not open the image preview.",
  "更新收藏状态失败。": "Could not update the star.", "图片已保存到本地。": "Image saved to file.", "保存图片失败，请重试。": "Could not save the image. Please try again.",
  "删除这条常用语？": "Delete this phrase?", "删除常用语失败。": "Could not delete the phrase.",
  "这条常用语已不存在。": "This phrase no longer exists.", "复制常用语失败，请重试。": "Could not copy the phrase. Please try again.",
  "常用语内容不能为空。": "Phrase content cannot be empty.", "常用语内容不能为空": "Phrase content cannot be empty.",
  "常用语内容过长": "Phrase content is too long.", "分类名称过长": "Category name is too long.",
  "原记录已不存在，请重新选择。": "The original entry no longer exists. Please choose another.",
  "常用语已保存。": "Phrase saved.", "保存常用语失败。": "Could not save the phrase.", "放弃未保存的常用语修改？": "Discard your unsaved phrase changes?",
  "剪贴板图片体积过大或无法解码，请尝试较小的 PNG 图片（保存上限 25 MB）。": "The image is too large or could not be decoded. Try a smaller PNG (25 MB storage limit).",
  "无法读取剪贴板图片，请检查图片格式及文件访问权限，再尝试重新复制。": "Could not read the image. Check its format and file permissions, then copy it again.",
  "剪贴板图片读取或保存失败，请检查系统剪贴板权限及应用数据目录。稍后会自动重试。": "Could not read or save the image. Check clipboard access and the app data folder. Retrying shortly.",
  "无法访问部分截图目录。请在系统设置 → 隐私与安全性 → 文件与文件夹中允许 G-paster 访问截图所在目录。": "Some screenshot folders are inaccessible. Allow G-paster access in System Settings → Privacy & Security → Files and Folders.",
  "部分截图导入失败，正在重试。请检查图片格式及本地存储权限。": "Some screenshots could not be imported. Retrying. Check their format and local storage permissions.",
  "保存图片": "Save image", "PNG 图片": "PNG image", "打开 G-paster": "Open G-paster", "退出 G-paster": "Quit G-paster",
  "G-paster 无法启动": "G-paster could not start", "本地数据无法读取。请检查应用数据目录或备份文件后重试。": "Local data could not be read. Check the app data folder or backup files, then try again."
} as const;

export type TranslationKey = keyof typeof english;
export type TranslationValues = Record<string, string | number>;
export function systemLanguage(preferredLanguages: readonly string[]): UiLanguage {
  return /^zh(?:[-_]|$)/i.test(preferredLanguages[0] ?? "") ? "zh" : "en";
}
export function systemLocale(locale: string, language: UiLanguage): string {
  try { return Intl.getCanonicalLocales(locale.replace(/_/g, "-"))[0] ?? (language === "zh" ? "zh-CN" : "en-US"); }
  catch { return language === "zh" ? "zh-CN" : "en-US"; }
}
export function translate(language: UiLanguage, key: TranslationKey, values: TranslationValues = {}): string {
  const text = language === "en" ? english[key] : key;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => String(values[name] ?? placeholder));
}
export function translateMessage(language: UiLanguage, message: string): string {
  return Object.hasOwn(english, message) ? translate(language, message as TranslationKey) : message;
}
export function errorKey(error: unknown, fallback: TranslationKey): TranslationKey {
  if (!(error instanceof Error)) return fallback;
  const validationKeys: TranslationKey[] = ["常用语内容不能为空。", "常用语内容不能为空", "常用语内容过长", "分类名称过长", "原记录已不存在，请重新选择。", "部分记录未能清空，请检查后重试。"];
  return validationKeys.find((key) => error.message.includes(key) || error.message.includes(english[key])) ?? fallback;
}
