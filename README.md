<div align="center">

<img src="assets/G-paster-icon.png" width="88" alt="G-paster 应用图标" />

# G-paster

**把复制过的内容，变成随时可用的下一步。**

一款桌面剪贴板效率工具。<br />剪贴板、常用语、截图中转站，在一个紧凑面板里接着用。

![Windows 0.9.0](https://img.shields.io/badge/Windows-0.9.0-262626?style=flat-square&labelColor=707786) ![macOS 0.1.7 Apple Silicon](https://img.shields.io/badge/macOS-0.1.7%20Apple%20Silicon-707786?style=flat-square&labelColor=20222a) ![本地存储](https://img.shields.io/badge/data-local%20only-707786?style=flat-square&labelColor=20222a)

[下载 Windows 版](https://github.com/Gerahamu/G-paster/releases/download/v0.9.0/Gpaster-Setup-0.9.0-win-x64.exe) · [下载 macOS 版](https://github.com/Gerahamu/G-paster/releases/download/v0.9.0/G-paster-v0.1.7-macos-arm64-20261019.zip) · [版本与校验](https://github.com/Gerahamu/G-paster/releases/tag/v0.9.0) · [开始使用](#开始使用) · [参与开发](#开发与构建)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/hero-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/readme/hero-light.png" />
  <img src="docs/readme/hero-light.png" width="1060" alt="G-paster 界面示意：紧凑的菜单栏面板，集中展示剪贴板、常用语和截图三个模块。" />
</picture>

<sub>界面示意使用虚构内容，不包含真实剪贴板数据。</sub>

</div>

<br />

## 0.1.7 · 冷白雾银与黑白交互

**延续紧凑面板布局，统一浅色与深色模式的黑白灰视觉层级。** 本次更新聚焦表面材质、边缘、悬停与焦点状态，让界面更接近 macOS 的轻量桌面工具质感。

| 冷白雾银 | 黑白控件 | 深色适配 |
| :--- | :--- | :--- |
| 浅色工作区采用冷白、雾银与低对比细边框，并保留内容区域的清晰度。 | 蓝色强调统一为石墨色与中性灰；按钮、链接、选中和键盘焦点仍保持清楚可辨。 | 深色表面、文字、边框与窗口背景同步调整，沿用系统或用户选择的外观。 |

剪贴板、常用语、截图管理、快捷键与本地数据格式保持兼容。

[完整更新记录](CHANGELOG.md) · [0.1.6 图片采集验证范围](docs/release-validation-v0.1.6.md)

<br />

## 0.1.6 · 更可靠地接住图片

**补齐照片亭图片格式，改善相机照片与截图的采集。** 本次集中修复图片采集与异步操作问题，并回归紧凑操作面板。

| 图片更可靠 | 面板更轻巧 | 操作更稳定 |
| :--- | :--- | :--- |
| 识别旧版 Apple TIFF / JPEG / PNG 和原生文件 URL；Photo Booth 提供图片数据时，可直接采集，减少对原图文件路径的依赖。 | 搜索框移入顶部工具栏，统一导航间距与图标尺寸，保留 400 × 460 px 的基本窗口。 | 修复慢图片解码与清空、重新复制之间的状态冲突；读取超时可恢复，图片失败时文本监听继续工作。 |

相机照片在 macOS 上按 EXIF 方向转换为 PNG；启动时现有剪贴板图片也能进入历史。新增像素和文件读取边界，超限会提示，原文件保持原样。

[完整更新记录](CHANGELOG.md) · [本次验证范围](docs/release-validation-v0.1.6.md)

<br />

## 三个模块，一个面板

> macOS v0.1.7 的 20261019 更新构建已包含文件历史支持：文件、文件夹和一次多文件复制会作为一条历史保存；Finder 中复制 PNG/JPEG 文件时保存文件引用，图片数据本身仍按图片机制保存。

文件默认只记录路径，不复制本体。点击记录会恢复整组文件引用，可回到 Finder 粘贴；路径失效时会显示状态，不会部分恢复或删除原文件。文件与文本、链接共用原有的非图片历史上限，图片上限保持独立。一次最多接收 1000 个文件引用；副本预检最多遍历 10000 个目录项，后台复制设有 60 秒超时保护。

设置中的「保存文件副本」默认关闭，只影响之后收集的文件，不会在开启时批量复制旧记录。副本保存于应用数据目录的 `managed-files/`，单批上限 100 MiB、总副本上限 500 MiB（含保守的目录项开销），并检查磁盘剩余空间；超限或失败会保留引用并提示。删除、淘汰或清空历史会移除对应的应用副本，原始文件保持不变。文件夹内符号链接保持链接结构；单独的符号链接和含旧式资源分叉的文件保留引用，避免生成不完整副本。Finder 标签、ACL 等扩展元数据不属于当前副本模式的保存保证。

复制一段文字、存一句常用回复，或接着使用刚刚的截图。G-paster 把这些小动作收在一起，减少来回查找。

| 剪贴板 | 常用语 | 截图中转站 |
| :--- | :--- | :--- |
| **找回刚刚复制的内容** | **少打一次重复的文字** | **让图片流转更顺手** |
| 自动记录文本、HTTP / HTTPS 链接、图片及文件引用；搜索、重新复制、单条删除或清空记录。 | 创建、编辑、分类和搜索常用语，点击即可复制；也可以从文本历史直接保存。 | 收集复制的图片和 macOS 新截图；预览、重新复制、多选拖出图片或另存本地。 |
| 文本、链接和文件批次默认共用 **300 条**上限，可在设置中修改。 | 常用语独立持久化保存。 | 图片与截图默认合计 **10 张**，可在设置中修改。 |

### 用完即收，随时再开

- **住在菜单栏。** macOS 上后台运行，默认不占据 Dock；点击菜单栏图标即可打开。
- **按习惯设置。** 标题栏齿轮和菜单栏「设置」提供快捷键录入、恢复默认、开机启动及本地存储说明。支持中文／英文／跟随系统，浅色／深色／跟随系统，以及文本和图片保留数量编辑。修改保存到本机，快捷键和外观即时生效。
- **跟随系统。** 语言和外观默认跟随系统，也可以在设置中手动选择；时间格式仍跟随系统区域。系统语言模式下，中文系统使用中文，其余语言使用英文。修改系统语言后，如 macOS 提示重启应用，请按提示重新启动。
- **一个紧凑面板。** 默认 400 × 460 px，空记录状态约 400 × 340 px；点击窗口外部或关闭窗口后继续在后台运行。
- **在当前桌面呼出。** macOS 使用可跨 Spaces 显示的面板窗口，减少唤出时被带回旧桌面的情况；完整跨桌面操作仍需在目标系统验证。
- **复制 → 搜索 → 再复制 → 粘贴。** 在面板里找到内容并重新复制，回到目标应用使用正常的粘贴操作。

| 操作 | macOS | 说明 |
| :--- | :--- | :--- |
| 打开／收起面板 | <kbd>Control</kbd> + <kbd>C</kbd> | 再次按下收起；可在设置中更改 |
| 聚焦搜索 | <kbd>⌘</kbd> + <kbd>F</kbd> | 在 G-paster 窗口内使用 |
| 粘贴内容 | <kbd>⌘</kbd> + <kbd>V</kbd> | 在目标应用内使用 |

<details>
<summary><strong>关于快捷键与截图识别</strong></summary>

`Control+C` 是当前 macOS 默认全局快捷键，可能与终端的中断操作或其他软件冲突。标题栏齿轮或菜单栏「设置」可更换快捷键、恢复默认和设置开机启动；如快捷键注册失败，可通过菜单栏打开面板。Windows 源码中的默认快捷键为 `Control+Shift+G`，该平台尚未完成发布验证。

保留数量更改后自动保存并生效，输入过程中有短暂防抖，离开输入框时立即提交。下次收集或启动时，最旧记录会按新上限淘汰；常用语不受影响。默认数量可一键恢复。设置保存在独立的 `preferences.json`，不更改历史或常用语的数据格式。

开机启动使用系统登录项，由用户主动开启；需要系统批准时，设置页会显示提示。开发模式禁用此项，避免把 Electron 开发进程注册为登录项。当前 macOS 包尚未经过 Apple 公证，系统可能限制登录项注册；以设置页读取的实际状态为准。实际注销／登录流程仍需真机验证。参见 [Electron 登录项说明](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows)。

macOS 截图监控读取桌面及系统配置的截图保存目录，在应用运行时收集新生成、符合截图文件名规则的图片，等待文件写入稳定后再导入。它不是对所有文件夹的图片扫描，也不会自动导入启动前的旧截图。原始截图文件保持原样；应用内保存的是独立图片副本。

复制到剪贴板的普通图片数据也会进入截图中转站。20261019 Mac 更新构建将 Finder 复制的图片文件作为文件历史记录，直接复制的图片数据仍进入截图中转站。macOS 的 TIFF、HEIC 等图片表示会先转为 PNG 保存；当前版本不对图像内容做语义识别。

Photo Booth 可能提供旧版 TIFF 与文件引用，而非标准 PNG。0.1.6 会尝试可读的图片表示及本机文件来源；源文件不可访问时，只要剪贴板仍含可解码图片数据，就能继续采集。仅有失效文件引用、尚未下载的云端原图或不支持的格式，仍需原文件可访问后重试。

保存图片上限为 **25 MiB PNG、5000 万像素**。TIFF / BMP 原始表示与截图源文件可读取到 **100 MiB**，转换后的 PNG 仍须符合保存上限。不会为绕过上限自动缩小或裁剪照片。GIF 按静态图片处理；本轮实测 PNG、JPEG、TIFF、HEIC、BMP、GIF 与 JPEG 2000。WebP / AVIF 的识别已接入，解码依赖系统支持，尚未逐环境验证。

若截图没有出现，请检查「系统设置 → 隐私与安全性 → 文件与文件夹」中 G-paster 对截图目录的访问权限，并在应用运行时新截一张图。0.1.1 起，目录访问、图片读取和导入失败会在面板显示提示，失败截图会重试；一个目录无法访问不会阻止其他可访问目录。

</details>

<br />

## 开始使用

### 直接下载

#### Windows

1. 下载 [Gpaster v0.9.0 · Windows x64 安装程序](https://github.com/Gerahamu/G-paster/releases/download/v0.9.0/Gpaster-Setup-0.9.0-win-x64.exe)，运行安装程序并按 Windows 提示完成安装。

#### macOS

**当前下载为 20261019 更新构建**（应用内版本号仍为 0.1.7）。包含截图多选及多图拖出、单击图片复制并收起面板、右击图片打开详情、设置自动保存，以及剪贴板监听的第一阶段优化。点击图片左上角复选框可多选，也可使用 Command/Control 点击切换选择。

1. 下载 [G-paster v0.1.7 · macOS Apple Silicon](https://github.com/Gerahamu/G-paster/releases/download/v0.9.0/G-paster-v0.1.7-macos-arm64-20261019.zip)。
2. 解压后将 `G-paster.app` 放入「应用程序」文件夹。更新已有版本时，先从菜单栏退出旧应用，再替换 `.app`。
3. 打开应用，通过菜单栏图标或 <kbd>Control</kbd> + <kbd>C</kbd> 呼出面板；如快捷键冲突，可在设置中修改。

macOS 下载包面向 **Apple Silicon（arm64）**，安装包元数据要求 macOS 13.0 或更高。本轮实测环境为 macOS 27.0.1 / arm64；Intel Mac 和其他 macOS 版本尚未完成验证。Windows 当前提供 x64 安装程序；Linux 暂无发行包。

发布包使用 **ad-hoc 签名**并检查完整性，尚未经过 Developer ID 签名或 Apple 公证。若系统限制打开，请参阅下方说明。

<details>
<summary><strong>校验下载文件</strong></summary>

从本次 [Release](https://github.com/Gerahamu/G-paster/releases/tag/v0.9.0) 下载 `SHA256SUMS.txt`，与压缩包放在同一文件夹，再执行：

```bash
shasum -a 256 -c SHA256SUMS.txt
```

成功时显示压缩包文件名及 `OK`。校验只能确认文件完整性，不代表 Apple 公证。

</details>

### 从源码启动

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
xattr -dr com.apple.quarantine /Applications/G-paster.app
```

移除隔离属性不等于应用已经过 Apple 公证，也不能替代安装与安全验证。

</details>

<br />

## 数据留在你的电脑上

G-paster 无需账户或云端服务，不向外部服务上传剪贴板内容。记录由 Electron 主进程保存在当前用户的应用数据目录中；macOS 默认位置通常为 `~/Library/Application Support/G-paster/`。

| 内容 | 本地文件 | 保留规则 |
| :--- | :--- | :--- |
| 文本、链接 | `history.json` | 与文件批次共用默认 300 条上限，可设置 1–1000 条；完全相同的文本去重，再次复制移到最前面 |
| 文件、文件夹 | `file-history.json`、可选的 `managed-files/` | 默认仅保存原始引用；一组有序路径作为一条记录参与去重和淘汰，删除历史不删除原始文件 |
| 图片、截图 | `image-history.json`、`images/*.png` | 共用图片池，默认 10 张，可设置 1–100 张；按最近复制或收集时间保留，超出的旧记录及内部图片副本自动移除 |
| 常用语 | `phrases.json` | 独立保存，支持相同内容的不同常用语 |

截图收藏功能已移除。「清空记录」会清空剪贴板历史与截图；常用语不受此操作影响。截图的外部原文件不会因此删除。

存储采用原子写入、`.bak` 备份和损坏恢复机制。数据保存在本地，并不意味着已加密：剪贴板可能包含密码或其他敏感信息，当前版本没有敏感内容过滤和本地数据加密功能。

<details>
<summary><strong>开发者：隔离与通信边界</strong></summary>

- 渲染进程启用 `contextIsolation` 与 `sandbox`，关闭 `nodeIntegration`。
- 通过带 TypeScript 类型约束的 preload API 暴露有限 IPC 操作。
- 生产构建仅加载应用内的 `dist/index.html`；导航、重定向及 IPC 使用统一的受信页面校验。
- 文本剪贴板轮询间隔为 25 ms，macOS 截图目录扫描间隔为 750 ms。

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
| `npm run test:files:app` | 用隔离数据验证文件批次、恢复、副本模式、失效路径、共享上限及清空竞态，不修改系统剪贴板 |
| `npm run test:files:mac` | 可选原生 NSPasteboard 验证：需先关闭安装版，会暂时使用并恢复系统剪贴板；设置 `GPASTER_TEST_FINDER=1` 可进行 Finder 复制、粘贴人工配合验证 |
| `npm run test:system:app` | 用隔离数据验证中英文、浅深色、原生菜单和未保存输入保留（不修改系统设置） |
| `npm run test:settings:app` | 验证窗口开关、设置入口、快捷键录入与冲突回退；使用隔离数据和受控系统接口，不修改系统登录项 |
| `npm run test:window:mac` | macOS 原生面板焦点、显示／隐藏、关闭及后台采集回归；完整跨 Spaces 操作另需人工验证 |
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

<sub>当前版本 0.1.7 · macOS arm64 发布包 · 仓库尚未添加开源许可证</sub>

</div>
