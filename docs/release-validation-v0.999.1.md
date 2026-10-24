# Mac v0.999.1 发布验证

- 应用内部版本、Git 标签、安装包版本分别为 `0.999.1`、`v0.999.1`、`G-paster-v0.999.1-macos-arm64.zip`。
- 本版本汇总此前本机窗口清理与单图拖移修复；此前本机临时编号不作为另一个公开版本。
- 平台：macOS Apple Silicon（arm64）；实测环境 macOS 27.0.1，最低系统元数据为 macOS 13.0，未在最低系统实测。
- 签名：ad-hoc；无 Developer ID、无 Apple 公证或 hardened runtime 发布验证。

## 本轮验证

- `npm run typecheck`、`npm test`（82 项）、`npm run build`。
- 隔离 Electron 集成：`scripts/test-screenshot-gallery.cjs`，验证 16:10 双列、多图/直接单图/勾选单图拖移的释放收尾、无效调用、关闭/失焦/重新打开清空选择。
- 隔离 Electron 集成：`scripts/test-settings-app.cjs`，验证窗口收起、快捷键、设置及受控登录项流程。
- 提交源码后从干净 Git 工作区运行 `npm run package:mac:adhoc`，严格验证签名；对最终 app.asar 重复截图画廊集成检查，并验证 ZIP 解压后的签名与 app.asar 一致性。
- 发布 ZIP 和 `SHA256SUMS.txt`，远端附件摘要须与本地一致；发布标签指向独立分支 `release/mac-v0.999.1` 的源码提交。

测试使用临时用户数据、合成剪贴板与截图；未操作真实用户历史、截图或常用语。故障注入错误属于预期测试分支。

## 边界

- 拖移后以鼠标释放触发收尾，不判断外部输入框是否成功接收；取消拖移也会收起并清空。
- 自动化拖移替换了原生 startDrag 和鼠标状态检查，只证明 IPC/状态收尾，真实跨应用接收尚未验证。
- 本轮不重复此前完整格式、性能或长期压力测试；历史验证参见 [v0.999](release-validation-v0.999.md)。
- Intel Mac、Windows、Linux、TCC 首次授权、真实登录项、完整 Spaces/多显示器未验证。
- 为避免系统应用列表出现重复图标，安装完成后清理临时打包/解压的应用副本，仅保留已安装应用和 ZIP。
