# 文件与文件夹历史：实现及验证记录

实现与主要测试日期：2026-10-14；2026-10-15 完成安装构建一致性与进程复核。环境：macOS 27.0.1、arm64、Electron 44.7.0。

## 备份与本机交付

- 桌面备份：`~/Desktop/G-paster-backup-20261014-210902/`。
- 包含原安装版 `G-paster-installed-v0.1.6.app`、修改前源码归档（含 Git 历史及当时未提交的瘦身改动）和数据快照。
- 替换前另存停机数据快照至 `user-data-before-final-install/`。新安装启动后，对其中 18 个原有数据文件核对，均未改变。
- 已安装并打开 `/Applications/G-paster.app`；ad-hoc 签名严格递归验证通过，未进行 GitHub 发布。
- 已安装 `app.asar` SHA-256：`beb2187e31d7d06a0f2d90e6c83e627784f3c043c55ecc9fb2a8ed793cc4453d`，与验证后的构建一致。
- 与修改前源码归档比较，`src/styles.css`、全部原有图标资源、产品名称和版本号一致。

## 存储与识别

- 原 `history.json`、`image-history.json`、`images/`、`phrases.json` 的数据格式保持原样。
- 新增 `file-history.json`，保存一组有序原始路径、名称、类型、大小、时间和副本状态；默认不读取或复制文件内容。一次复制为一条历史，按有序路径整体去重。
- 使用现有 Electron ClipboardItem API，`text/uri-list` 对应 macOS NSPasteboard 原生复制文件格式；兼容原生 `public.file-url` 表示。文件表示优先于图片、文本表示，Finder 复制图片文件归入文件历史。
- 文本、链接、文件批次共用现有非图片数量上限；图片数量上限独立，默认仍为 10。文件历史删除、清空和淘汰只清理 G-paster 自己管理的副本。
- `preferences.json` 新增可选布尔字段 `saveFileCopies`，旧设置缺失该字段时默认为 `false`；不自动复制旧历史。
- 副本位于独立的 `managed-files/`：串行后台队列、流式复制、单批 100 MiB、总量 500 MiB、最多 10000 个目录项、50 MiB 剩余空间保护及 60 秒超时。容量统计包含保守的目录项开销。
- 元数据沿用原子写入与 `.bak` 恢复机制。副本暂存完成后才提交，失败保留引用；退出中止任务，重启清理已识别的中断暂存目录并恢复待处理任务。
- 恢复历史时优先使用副本，失效时尝试原始引用；任一项目不可访问时整组恢复失败，并刷新失效状态。重启后也会把副本路径匹配回原记录，避免重复收录。
- 文件转为同名普通文本路径时会正确重新收录；文件格式的显示文本不会污染文本去重标记。

## 已执行验证

| 项目 | 结果与范围 |
| --- | --- |
| TypeScript 类型检查 | 通过 |
| 自动化测试 | 66 项通过、0 失败、0 跳过；包含原有 57 项和新增 9 项文件测试 |
| 生产构建与 macOS arm64 打包 | 通过 |
| 最终 app.asar 文件集成测试 | 通过；真实主进程、preload、React 界面，隔离数据、受控剪贴板，运行宿主 `isPackaged=false` |
| app.asar 图片与截图集成（最后一处文件文本标记修复前） | 通过；旧格式图片、缩略图、截图收集、重新复制、错误恢复及清空竞态 |
| app.asar 设置集成（最后一处文件文本标记修复前） | 通过；新增副本开关默认关闭、UI 修改与持久化；原快捷键、窗口开关、语言及外观回归通过 |
| 中英文与浅深色回归 | 通过；原卡片布局、图片预览及未保存输入保持 |
| 原生 NSPasteboard 读写 | 单文件、文件夹、含 PNG 的有序批次双向读写通过；原生文件类型检查通过 |
| Finder 实际复制 | PDF、PNG、文件夹批量选择复制 → Electron 读取 → 文件历史保存 → 重新加载 → 系统剪贴板恢复，通过 |
| Finder 实际粘贴 | 独立一轮中实际粘贴 PDF、PNG、文件夹通过，逐字节核对文件内容和嵌套结构 |
| Finder 连续整轮闭环 | 未完成：后续人工配合轮次发生操作中断及等待超时；不能将分段验证描述为一次连续闭环通过 |
| 本机安装与数据兼容 | 签名及安装构建一致性通过，应用进程启动；18 个安装前数据文件均未改变 |

原生测试临时使用系统剪贴板，结束或超时时已恢复原内容；其他应用集成测试均使用隔离数据和受控剪贴板。原安装版在原生测试期间暂时退出，以避免收录测试文件。

## 边界及尚未验证项

- 文件移动、删除、卷卸载或权限丢失后会显示不可用，不自动寻找新位置。
- 一次最多 1000 个文件引用。副本过大、目录项过多、磁盘空间不足、源文件在复制中变化或复制失败时，保存原始引用并提示。
- 单独的符号链接、含旧式资源分叉的文件不制作永久副本；文件夹内符号链接保留为链接，不递归读取链接目标。Finder 标签、ACL 等扩展元数据不属于当前副本保存保证。
- Windows、Linux、Intel Mac、其他 macOS 版本、网络卷、iCloud 未下载文件和长期运行压力尚未真机验证。
- 仍使用原 180 ms 剪贴板轮询与 750 ms 截图目录扫描；两次轮询之间已被覆盖的内容无法补回。
- 本机为 ad-hoc 签名，未执行 Apple 公证或公开 Release 流程。
- 2026-10-15 上传前，改用已安装的 Command Line Tools 完成 Git 差异检查，并重新执行类型检查、66 项自动化测试及生产构建，均通过；未修改系统 Xcode 许可状态。

## 本次修改文件

新增：

- `electron/clipboard-files.ts`
- `electron/file-store.ts`
- `electron/file-store.test.ts`
- `scripts/test-files-app.cjs`
- `scripts/test-files-macos.cjs`
- `docs/file-history-validation.md`

修改：

- `electron/main.ts`
- `electron/clipboard-images.ts`
- `electron/history-store.ts`
- `electron/preferences.test.ts`
- `src/shared/contracts.ts`
- `src/shared/preferences.ts`
- `src/shared/i18n.ts`
- `src/App.tsx`
- `src/SettingsPanel.tsx`
- `scripts/test-app-images.cjs`
- `scripts/test-settings-app.cjs`
- `scripts/test-system-mode.cjs`
- `scripts/test-window-spaces.cjs`
- `package.json`
- `README.md`

开始本轮时已经存在的 `package-lock.json`、`scripts/clean-electron-build.mjs` 等瘦身改动已保留；本轮未新增依赖。
