# v1.0.0 发布验证

## 发布产物

- 源码与应用内部版本：`1.0.0`；Git 标签：`v1.0.0`。
- macOS Apple Silicon（arm64）应用包：`G-paster-v1.0.0-macos-arm64.zip`。
- 校验文件：`SHA256SUMS.txt`；其中包含 ZIP 的 SHA-256。
- 签名：ad-hoc；没有 Developer ID 签名、hardened runtime 或 Apple 公证。
- 最低系统版本元数据：macOS 13.0；发布验证设备：macOS 27.0.1 / arm64。

## 本轮验证

- `npm run typecheck`：通过。
- `npm test`：82 项通过，0 项失败。
- `npm run test:settings:app`：通过；验证「记住上次页面」默认开启、持久化切换、关闭后回到剪贴板页，以及设置页与快捷键录制状态。
- `npm run build` 与 `npm run package:mac:adhoc`：通过。
- `codesign --verify --deep --strict`：通过；包内 bundle ID 为 `com.gpaster.desktop`，版本和构建号均为 `1.0.0`，可执行文件为 arm64。
- 包内 `electron.icns` 与项目正式图标一致；ZIP 完整性检查通过，SHA-256 记录在 `SHA256SUMS.txt`。
- 设置页集成测试使用临时用户数据与受控系统接口；未修改正式应用的剪贴板数据或登录项。

## 范围说明

- 验证重点为本次设置与快捷键录制改动，以及既有自动化存储和 IPC 回归。
- 本轮没有 Apple 公证或 Gatekeeper 接受评估；首次打开时 macOS 可能提示无法验证开发者。
- Intel Mac、Windows 和 Linux 未实机验证。
