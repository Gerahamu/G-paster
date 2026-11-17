# Mac v0.999.2 发布验证

- 应用内部版本、Git 标签、安装包版本分别为 `0.999.2`、`v0.999.2`、`G-paster-v0.999.2-macos-arm64.zip`。
- 平台：macOS Apple Silicon（arm64）；最低系统元数据 macOS 13.0。兼容性测试范围以本机发布验证为准。
- 签名：ad-hoc；无 Developer ID、Apple 公证或 hardened runtime 发布验证。

## 本轮验证

- `npm run typecheck`、`npm test`、`npm run build`。
- 隔离 Electron 集成：剪贴板图片缩略图和内容单击复制 PNG 并收起；右击打开详情；拖动在鼠标释放后收起，拖动期间不误复制或提前隐藏。
- 隔离 Electron 集成：文件历史中的图片单击复制并收起，右击显示详情；截图多选状态在剪贴板图片拖动后清空。
- 从干净发布提交运行 `npm run package:mac:adhoc`；验证应用严格签名、ZIP 解压内容及最终 `app.asar`；在打包后的 `app.asar` 上复跑相关图片与画廊检查。
- GitHub ZIP 和 `SHA256SUMS.txt` 的远端摘要与本地计算值逐项比对后公开发布。

所有自动化使用临时用户数据、合成剪贴板图片和临时文件；未访问真实剪贴板或 `/Users/apple/Library/Application Support/G-paster`。

## 边界

- macOS 原生拖动以鼠标释放作为收尾时机；取消拖动也会触发收尾。测试替换了原生拖动及鼠标状态检查，不能证明第三方输入框实际接收图片。
- 本轮未重复执行完整格式兼容、性能、长期压力、Intel Mac、Windows、Linux、TCC 或多显示器测试。
- 本版本是 macOS Apple Silicon ad-hoc 本机包，不是经过 Developer ID 签名与 Apple 公证的正式分发包。
