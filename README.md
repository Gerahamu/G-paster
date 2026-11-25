<div align="center">

<img src="assets/G-paster-icon.png" width="88" alt="G-paster 图标" />

# G-paster

**复制、查找，再接着做。**

一个为 macOS 设计的本地剪贴板工具。<br />
把文字、图片、文件、常用语和截图收进一个轻巧的面板。

![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-262626?style=flat-square)
![本地处理](https://img.shields.io/badge/处理-本地完成-707786?style=flat-square)

[macOS v1.10 下载](https://github.com/Gerahamu/G-paster/releases/download/v1.10/G-paster-v1.10-macos-arm64.zip) · [Windows v1.1.0](https://github.com/Gerahamu/G-paster/releases/tag/v1.1.0-windows) · [快速开始](#快速开始) · [功能](#功能) · [开发构建](#开发构建)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/hero-dark.png" />
  <img src="docs/readme/hero-light.png" width="1060" alt="G-paster 剪贴板面板示意" />
</picture>

<sub>示意图使用虚构内容。界面以实际应用为准。</sub>

</div>

## 功能

### 剪贴板

文字、链接、图片和文件引用集中在一处。搜索后点击条目即可复制，图片和文件也支持拖出使用。文件默认只记录引用，可在设置中选择是否保存副本。

### 常用语

将经常使用的文字或图片存起来，按分类整理，随时搜索和复制。图片常用语也支持文字识别搜索。

### 截图与文字识别

按 **Control + V** 打开区域截图，悬停预选窗口，或拖动框选屏幕。调整选区后，可以保存截图或识别文字并复制。快捷键可在设置中更改。

图片会在后台进行本地文字识别，可在剪贴板、常用语和截图中搜索图片里的关键词。索引随对应记录清理。

### 本地与个性化

剪贴板内容、图片和文字识别索引保存在本机。支持浅色、深色和跟随系统外观，也可调整保留数量、开机启动和窗口行为。

## 快速开始

1. 从 [macOS v1.10 Release](https://github.com/Gerahamu/G-paster/releases/tag/v1.10) 下载 Apple Silicon 安装包，解压后将 G-paster 拖入「应用程序」。
2. 打开 G-paster，默认按 **Control + C** 显示或收起面板。快捷键可在设置中更改。
3. 使用区域截图时，在系统设置的「隐私与安全性 → 屏幕与系统音频录制」中允许 G-paster，并按系统提示重新打开应用。

macOS v1.10 为 ad-hoc 临时签名构建，未经 Apple 公证，Gatekeeper 可能限制首次打开。更换临时签名构建后，系统可能要求重新授权录屏。Windows 版本请查看 [Windows v1.1.0 Release](https://github.com/Gerahamu/G-paster/releases/tag/v1.1.0-windows)。Intel Mac 构建尚未验证。

## 数据位置

macOS 应用数据位于 `~/Library/Application Support/G-paster/`。清空历史会移除应用管理的对应记录和图片，文件引用指向的原文件不会因此删除。

## 开发构建

项目使用 Electron、React 和 TypeScript。

```bash
npm ci
npm run typecheck
npm test
npm run desktop
```

在 Apple Silicon Mac 上构建本地测试包：

```bash
npm run package:mac:adhoc
```

该命令生成临时签名的测试包。正式分发签名、公证及构建要求请参阅项目打包脚本。查看 [更新记录](CHANGELOG.md) 和 [Releases](https://github.com/Gerahamu/G-paster/releases) 了解已发布版本。
