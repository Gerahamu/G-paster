# v0.9.0 发布前质量修复记录

## 环境与范围

- 环境：macOS 27.0.1（26A434），Apple Silicon arm64，Node.js 22.12.0，Electron 44.7.0。
- 版本：0.9.0（本机 QA 构建）。
- 构建：ad-hoc 签名；未使用 Developer ID，未公证，未上传公开 Release。
- 测试数据：所有自动化测试使用隔离的临时 userData 和受控/合成剪贴板；未读取或改动真实剪贴板历史、截图、常用语或数据目录内容。
- 未执行任何使用真实系统剪贴板的测试（`test:files:mac`、原生 Finder 交互和真实拖放测试本轮未运行）。

## 本轮执行结果

| 检查 | 结果 |
| :--- | :--- |
| `npm run typecheck` | 通过：主进程和 renderer 类型检查 |
| `npm test` | 通过：82 项单元测试，0 失败、0 跳过 |
| `npm run build` | 通过：主进程 + Vite 生产构建 |
| `scripts/test-app-text.cjs` | 通过：180 ms 文本监听、220 ms 连续复制 20/20、清空/存储错误/超时/崩溃恢复；隔离主进程 idle CPU 0.949% 单核 |
| `scripts/test-clipboard-monitor-app.cjs` | 通过：启动超时、清空暂停、慢枚举、慢 payload、退出释放 |
| `scripts/test-clipboard-monitor.cjs` | 通过：6 项枚举/计时器测试 |
| `scripts/test-image-runtime.cjs` | 通过：PNG/JPEG/TIFF/HEIC/BMP/GIF/JPEG 2000、8 方向 EXIF、4K TIFF、持久化/淘汰/截图原文件保留 |
| `scripts/test-app-images.cjs` | 通过：图片采集、预览、复制、清除竞态、原生文件 URL 文件历史、截图来源、隔离数据 |
| `scripts/test-app-phrase-images.cjs` | 通过：图片常用语、独立存储、PNG 复制、导入取消、文字草稿保护 |
| `scripts/test-files-app.cjs` | 通过：文件批次、拖拽参数、副本模式、失效路径、共享上限、清理竞态 |
| `scripts/test-system-mode.cjs` | 通过：中英/浅深色、原生菜单、搜索、草稿保留 |
| `scripts/test-settings-app.cjs` | 通过：窗口、快捷键、登录项受控接口、自动保存上限、语言/主题 |
| `scripts/test-screenshot-gallery.cjs` | 通过：360×270 预览、16:10 双列、多选、多拖拽等待释放 |
| `scripts/test-broken-image.cjs` | 通过：缺失图片显示“图片不可用”、不可复制、可删除 |
| `scripts/benchmark-clipboard.cjs` | 通过：合成剪贴板 10 秒采样（见下） |
| macOS 打包 | 通过：arm64、Info.plist 0.9.0、本地化资源、ad-hoc 严格验证 |
| 安装包 asar 功能冒烟 | 通过：使用最终 `app.asar` 运行缺失图片集成测试 |
| 安装与进程 | 通过：`/Applications/G-paster.app` 为 0.9.0；主进程与 renderer 均来自新安装包；面板窗口 400×460 已在屏幕上 |

## 性能基准

`scripts/benchmark-clipboard.cjs`，10 秒采样，renderer 隐藏，合成剪贴板：

| 状态 | 0.9.0 结果 | 修复前（既有基准） |
| :--- | :--- | :--- |
| 空闲 CPU | 0.592% 单核 | 约 2.44% 单核 |
| 2.77 MB PNG 驻留 CPU | 1.252% 单核 | 约 26.46% 单核 |
| 2.77 MB PNG payload 读取 | 30,515,562 bytes / 10 s | 约 1.06 GB / 10 s |
| 文本延迟 mean | 170.5 ms | 约 19 ms |
| 图片/文件延迟 mean | 864/860 ms | 约 19 ms |

图片/文件延迟增加来自 750 ms payload 探测窗口；这是为降低持续 CPU 做的显式取舍。文本仍按 180 ms 检查。

## 修复覆盖

- 自适应剪贴板探测：格式变化时立即读取；格式不变时最多每 750 ms 探测图片/文件 payload。
- 原生 `public.file-url` 文件历史优先级；实际图片数据和 URI 图片的兼容路径保留。
- 图片文件读取、引用 stat、截图 stat、文件预览增加超时。
- renderer 崩溃/加载失败/无响应原生恢复；React ErrorBoundary。
- 缺失/损坏图片占位；保留 metadata 可删除。
- 主文件和 `.bak` 同时损坏时保留 `.corrupt-*` 并从空记录启动，界面提示存储问题。
- 草稿保护、错误弹窗焦点、旧预览清理、共享图片池计数。
- 常见本地化截图名和自定义名称前缀。
- 文本历史增加 32 MiB 总量预算，超出时淘汰最旧文本；搜索计算延迟。
- 开发模式独立 userData；生产 CSP 移除开发服务器地址。
- 版本更新到 0.9.0；打包脚本使用锁定版本的 `@electron/packager`；新增 ad-hoc QA 打包模式。

## 安装与产物

- 构建产物：`work/packaged/G-paster-darwin-arm64/G-paster.app`。
- `app.asar` SHA-256：`497205c47213314928e66af96b096c77a3180381ba27a532d6f856eb641e91d5`。
- 安装版 `app.asar` 与该产物一致。
- 签名：ad-hoc，`codesign --verify --deep --strict` 通过；`TeamIdentifier=not set`。
- 安装前原始 0.1.7 应用备份：`work/install-backups/G-paster-before-v0.9-20261024-130157.app`。
- 安装前 0.9.0 预总量预算构建备份：`work/install-backups/G-paster-before-v0.9-final-20261024-130545.app`。
- 运行中主进程：`/Applications/G-paster.app/Contents/MacOS/G-paster`；renderer 的 `--app-path` 指向安装包的 `app.asar`；面板窗口 400×460 在屏幕上。

## 未覆盖与发布限制

- Windows、Linux、Intel Mac、其他 macOS 版本未实机验证。
- 未执行真实系统剪贴板原生测试、真实 Finder 拖放、完整 Spaces/多显示器交互、真实登录项注销/登录、TCC 权限首次授权、休眠/锁屏闭环。
- 未执行 24 小时长期运行、100 张图片/2M 字符历史量级压测。
- 未完成 Developer ID 签名、hardened runtime、Apple 公证、Gatekeeper 独立机器验证。
- 当前源码仍有未提交改动；正式发布前必须提交、审查、打 tag 并从 clean tree 构建。
- 0.9.0 仅为 ad-hoc 本机 QA 包，不可作为正式分发包。
