import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorKey, systemLanguage, systemLocale, translate, translateMessage } from "../src/shared/i18n";

describe("system-driven language", () => {
  it("follows the first OS language independently of regional format", () => {
    assert.equal(systemLanguage(["en-GB", "zh-CN"]), "en");
    assert.equal(systemLanguage(["zh-Hans-US", "en-US"]), "zh");
    assert.equal(systemLanguage(["zh-Hant-TW"]), "zh");
    assert.equal(systemLanguage(["fr-FI", "zh-CN"]), "en");
    assert.equal(systemLanguage([]), "en");
    assert.equal(systemLocale("fr-FI", "en"), "fr-FI");
  });
  it("normalizes OS locales and safely handles unavailable or malformed values", () => {
    assert.equal(systemLocale("en_US", "en"), "en-US");
    assert.equal(systemLocale("", "zh"), "zh-CN");
    assert.equal(systemLocale("invalid!", "en"), "en-US");
  });
  it("formats labels without changing the values supplied by users", () => {
    assert.equal(translate("en", "图片 {width} × {height}", { width: 3840, height: 2160 }), "Image 3840 × 2160");
    assert.equal(translate("zh", "当前 {count} 张，上限 {limit}", { count: 0, limit: 10 }), "当前 0 张，上限 10");
    assert.equal(translateMessage("en", "我的自定义分类"), "我的自定义分类");
  });
  it("localizes bounded clipboard and renderer recovery status messages", () => {
    assert.match(translateMessage("en", "剪贴板文字读取或保存失败，请检查本地存储空间。稍后会自动重试。"), /Retrying shortly/);
    assert.match(translateMessage("en", "文本过长（超过 200 万字符），本次未保存到历史记录。"), /2 million characters/);
    assert.match(translateMessage("en", "界面未能恢复，请重新打开 G-paster。"), /Reopen G-paster/);
    assert.match(translateMessage("en", "部分本地数据文件损坏，已保留原文件并以空记录启动。请检查数据目录或备份文件。"), /preserved/);
  });
  it("turns validation errors into translated messages without exposing IPC details", () => {
    const key = errorKey(new Error("Error invoking remote method 'phrase:create': Error: 分类名称过长"), "保存常用语失败。");
    assert.equal(translate("en", key), "Category name is too long.");
    assert.equal(errorKey(new Error("Unexpected error in a 内容 folder"), "保存常用语失败。"), "保存常用语失败。");
  });
});
