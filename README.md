<div align="center">

<img src="assets/G-paster-icon.png" width="88" alt="G-paster 应用图标" />

# G-paster

**把复制过的内容，变成随时可用的下一步。**

一个常驻 macOS 菜单栏的轻量剪贴板工具。<br />剪贴板、常用语、截图中转站，在一个紧凑面板里接着用。

![版本 0.1.1](https://img.shields.io/badge/version-0.1.1-355de7?style=flat-square&labelColor=202a38) ![macOS Apple Silicon](https://img.shields.io/badge/macOS-Apple%20Silicon-8691a1?style=flat-square&labelColor=202a38) ![本地存储](https://img.shields.io/badge/data-local%20only-579a86?style=flat-square&labelColor=202a38)

[认识 G-paster](#三个模块一个面板) · [开始使用](#开始使用) · [数据与隐私](#数据留在你的电脑上) · [参与开发](#开发与构建)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/hero-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="docs/readme/hero-light.svg" />
  <img src="docs/readme/hero-light.svg" width="1060" alt="G-paster 界面示意：紧凑的菜单栏面板，集中展示剪贴板、常用语和截图三个模块。" />
</picture>

<sub>界面示意使用虚构内容，不包含真实剪贴板数据。</sub>

</div>

<br />

## 三个模块，一个面板

复制一段文字、存一句常用回复，或接着使用刚刚的截图。G-paster 把这些小动作收在一起，减少来回查找。

| 剪贴板 | 常用语 | 截图中转站 |
| :--- | :--- | :--- |
| **找回刚刚复制的内容** | **少打一次重复的文字** | **让图片流转更顺手** |
| 自动记录文本、HTTP / HTTPS 链接和图片；搜索、重新复制、单条删除或清空记录。 | 创建、编辑、分类和搜索常用语，点击即可复制；也可以从文本历史直接保存。 | 收集复制的图片和 macOS 新截图；预览、收藏、重新复制、拖出图片或另存本地。 |
| 最多 **300 条**文本与链接记录。 | 常用语独立持久化保存。 | 图片与截图合计最多 **10 张**。 |

### 用完即收，随时再开

- **住在菜单栏。** macOS 上后台运行，默认不占据 Dock；点击菜单栏图标即可打开。
- **一个紧凑面板。** 默认 400 × 460 px，空记录状态约 400 × 340 px；点击窗口外部或关闭窗口后继续在后台运行。
- **复制 → 搜索 → 再复制 → 粘贴。** 在面板里找到内容并重新复制，回到目标应用使用正常的粘贴操作。

| 操作 | macOS | 说明 |
| :--- | :--- | :--- |
| 呼出面板 | <kbd>Control</kbd> + <kbd>C</kbd> | 也可直接点击菜单栏图标 |
| 聚焦搜索 | <kbd>⌘</kbd> + <kbd>F</kbd> | 在 G-paster 窗口内使用 |
| 粘贴内容 | <kbd>⌘</kbd> + <kbd>V</kbd> | 在目标应用内使用 |

<details>
<summary><strong>关于快捷键与截图识别</strong></summary>

`Control+C` 是当前 macOS 默认全局快捷键，可能与终端的中断操作或其他软件冲突。当前版本没有快捷键设置界面；如快捷键注册失败，可通过菜单栏打开面板。Windows 源码中的默认快捷键为 `Control+Shift+G`，该平台尚未完成发布验证。

macOS 截图监控读取桌面及系统配置的截图保存目录，在应用运行时收集新生成、符合截图文件名规则的图片，等待文件写入稳定后再导入。它不是对所有文件夹的图片扫描，也不会自动导入启动前的旧截图。原始截图文件保持原样；应用内保存的是独立图片副本。

复制到剪贴板的普通图片也会进入截图中转站，Finder 中复制的本地图片文件也支持收集。macOS 的 TIFF、HEIC 等表示会先转为 PNG 保存；当前版本不对图像内容做语义识别。

若截图没有出现，请检查「系统设置 → 隐私与安全性 → 文件与文件夹」中 G-paster 对截图目录的访问权限，并在应用运行时新截一张图。0.1.1 起，目录访问、图片读取和导入失败会在面板显示提示，失败截图会重试；一个目录无法访问不会阻止其他可访问目录。

</details>

<br />

## 开始使用

**当前 GitHub 仓库提供源码，还没有可直接下载的 App 安装包。** 已进行开发、打包和启动验证的平台为 macOS Apple Silicon（arm64）；Intel Mac、Windows 和 Linux 尚未完成发布验证。

在 macOS 上准备 **Node.js 22.12.0 或更新版本**与 npm，然后执行：

```bash
git clone https://github.com/Gerahamu/G-paster.git
cd G-paster
npm ci
npm run dev
```

启动后复制一段文字，通过菜单栏图标或 <kbd>Control</kbd> + <kbd>C</kbd> 打开面板，在「剪贴板」里搜索并点击复制，再切回其他应用粘贴。

### 构建自己的 macOS App

```bash
npm run package:mac
```

生成的应用位于 `work/packaged/G-paster-darwin-arm64/G-paster.app`。将它复制到「应用程序」文件夹后打开即可。打包脚本不会自动完成开发者签名或 Apple 公证。

<details>
<summary><strong>macOS 提示应用无法打开时</strong></summary>

未经 Apple 公证的下载包可能受到 Gatekeeper 限制。确认来源后，可先尝试在 Finder 中右键选择「打开」，或查看系统设置中的「隐私与安全性」。

只有在你确认应用来源和内容可信时，才考虑移除该应用的隔离属性。以下路径适用于放在「应用程序」中的 G-paster：

```bash
xattr -cr /Applications/G-paster.app
```

移除隔离属性不等于应用已经过 Apple 公证，也不能替代安装与安全验证。

</details>

<br />

## 数据留在你的电脑上

G-paster 无需账户或云端服务，不向外部服务上传剪贴板内容。记录由 Electron 主进程保存在当前用户的应用数据目录中；macOS 默认位置通常为 `~/Library/Application Support/G-paster/`。

| 内容 | 本地文件 | 保留规则 |
| :--- | :--- | :--- |
| 文本、链接 | `history.json` | 最多 300 条，完全相同的文本去重，再次复制移到最前面 |
| 图片、截图 | `image-history.json`、`images/*.png` | 共用一个 10 张图片池，按最近复制或收集时间保留，超出的旧记录及内部图片副本自动移除 |
| 常用语 | `phrases.json` | 独立保存，支持相同内容的不同常用语 |

**图片收藏用于标记，不会阻止自动淘汰。**「清空记录」会清空剪贴板历史与截图，包括收藏图片；常用语不受此操作影响。截图的外部原文件不会因此删除。

存储采用原子写入、`.bak` 备份和损坏恢复机制。数据保存在本地，并不意味着已加密：剪贴板可能包含密码或其他敏感信息，当前版本没有敏感内容过滤和本地数据加密功能。

<details>
<summary><strong>开发者：隔离与通信边界</strong></summary>

- 渲染进程启用 `contextIsolation` 与 `sandbox`，关闭 `nodeIntegration`。
- 通过带 TypeScript 类型约束的 preload API 暴露有限 IPC 操作。
- 生产构建仅加载应用内的 `dist/index.html`；导航、重定向及 IPC 使用统一的受信页面校验。
- 文本剪贴板轮询间隔为 180 ms，macOS 截图目录扫描间隔为 750 ms。

这些是当前实现的安全与运行机制，不代表已完成所有系统环境下的安全和长期稳定性验证。

</details>

<br />

## 开发与构建

**Electron · React · TypeScript · Vite**。数据存储与系统剪贴板操作在主进程处理，React 渲染紧凑的操作面板。

| 命令 | 用途 |
| :--- | :--- |
| `npm ci` | 按锁定文件安装依赖 |
| `npm run dev` | 启动 Vite 和 Electron 开发环境 |
| `npm run typecheck` | 检查主进程与渲染进程类型 |
| `npm test` | 执行存储、受信页面、图片表示和截图监控回归测试 |
| `npm run test:images:electron` | 在真实 Electron 中验证图片解码、存储、缩略图和截图导入（隔离数据，不修改系统剪贴板） |
| `npm run test:images:app` | 用隔离数据和可控剪贴板输入，验证实际主进程、preload、UI、错误恢复与清空竞态 |
| `npm run build` | 编译 Electron 主进程并构建前端 |
| `npm run package:mac` | 生成 macOS arm64 应用 |

<details>
<summary><strong>项目结构</strong></summary>

```text
assets/                 品牌与菜单栏图标
docs/readme/            README 展示资源
electron/               主进程、preload、存储与回归测试
  main.ts               窗口、托盘、剪贴板及 IPC
  screenshot-monitor.ts macOS 截图目录监控
  trusted-origin.ts     受信页面策略
src/                    React 界面与共享类型
scripts/                开发启动及 macOS 后台应用配置
```

存储和策略测试不覆盖完整的原生系统操作。跨应用图片粘贴、拖放、Gatekeeper 安装及长期后台运行仍需要相应系统环境中的实际验证。请在报告问题时附上 macOS 版本、芯片类型、复现步骤和预期结果，避免公开真实剪贴板或其他敏感内容。

</details>

---

<div align="center">

**G-paster · 让复制之后的事情，简单一点。**

[反馈问题](https://github.com/Gerahamu/G-paster/issues) · [浏览源码](https://github.com/Gerahamu/G-paster)

<sub>当前版本 0.1.1 · macOS arm64 优先 · 仓库尚未添加开源许可证</sub>

</div>
