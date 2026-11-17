# Mac v0.999 发布验证

## 身份与范围

- 发布名：G-paster · Mac v0.999；应用内部版本：0.999.0；Git 标签：`v0.999`。
- 平台：macOS Apple Silicon（arm64）；测试环境：macOS 27.0.1、Electron 44.7.0。最低系统版本以 Info.plist 的 macOS 13.0 为准，未在 macOS 13 上实测。
- 源码：该标签指向独立发布分支 `release/mac-v0.999` 的已提交快照；打包时 Git 工作区干净。构建产物不进入 Git，依赖由 package-lock.json 锁定。
- 安装包为 ad-hoc 签名，未进行 Developer ID 签名、hardened runtime 发布验证或 Apple 公证；公开下载不等同于 Apple 认可的正式分发包。
- 仅发布 macOS arm64 ZIP；不替换旧 Release 的 Windows 安装包。

## 本轮检查

- `npm run typecheck`：通过。
- `npm test`：82 项通过，0 失败、0 跳过。
- `npm run build`：通过。
- `node --test scripts/test-clipboard-monitor.cjs`：6 项通过。
- 隔离 Electron 集成测试通过：`test-app-text.cjs`、`test-clipboard-monitor-app.cjs`、`test-image-runtime.cjs`、`test-app-images.cjs`、`test-app-phrase-images.cjs`、`test-files-app.cjs`、`test-system-mode.cjs`、`test-settings-app.cjs`、`test-screenshot-gallery.cjs`、`test-broken-image.cjs`。
- 检查包含文本捕获/清空竞态/超时、renderer 崩溃恢复、图片格式与 EXIF、图片采集/预览/复制、图片常用语与草稿保护、文件引用与副本、中英/浅深主题、受控快捷键与登录项、16:10 画廊和多选收尾、缺失图片占位。
- 测试使用临时 userData、合成剪贴板和截图目录，不使用真实用户历史、截图或常用语。故障注入产生的错误日志属于预期测试分支。
- 打包命令：`npm run package:mac:adhoc`；随后执行严格 codesign 校验、最终 asar 隔离冒烟及 ZIP 内容/校验检查。具体发布产物校验值见 Release 附件 `SHA256SUMS.txt`。

## 保留的功能边界

- 截图双列卡片为 16:10，预览使用 `object-fit: contain`；缩略图最大 360×270，不扩大源图，小图显示也受原始尺寸限制。
- 截图多选拖移通过 macOS 鼠标释放收尾，隐藏窗口并清空选择。取消拖移也会清空；不检测第三方输入框是否成功接收。
- 自动化多选拖移测试替换原生 startDrag 和鼠标状态检查，验证的是 IPC/状态/收尾逻辑，不代表真实跨应用拖放已验证。
- 性能轮询参数为 180 ms / 750 ms；此前 0.9.0 基准没有在本次重复测量，不将旧 CPU 数值作为本次实测结果。
- 文件操作超时限制等待时长，不保证取消底层系统 I/O。

## 未覆盖

- Intel Mac、Windows/Linux、其他 macOS 版本。
- 真实第三方输入框接收、Finder 原生拖放、TCC 首次授权、真实注销/登录启动项、完整 Spaces/多显示器、24 小时压力与休眠/锁屏闭环。
- Developer ID、公证、Gatekeeper 独立机器验证。

## 产物

- `G-paster-v0.999-macos-arm64.zip`，使用 ditto 保留 macOS 应用包结构。
- `SHA256SUMS.txt`，记录 ZIP 的 SHA-256。
- 代码来源以 GitHub Release 的 `v0.999` 标签为准；发布说明明确 ad-hoc、平台范围及验证限制。
