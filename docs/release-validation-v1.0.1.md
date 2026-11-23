# Mac v1.0.1 发布验证

- 版本与 Git 标签：`1.0.1` / `v1.0.1`；发布 macOS Apple Silicon（arm64）ZIP 与 SHA-256 校验文件。
- 使用 ad-hoc 签名，未经 Developer ID 签名和 Apple 公证；最低系统版本元数据为 macOS 13.0。
- 类型检查通过；82 项单元测试通过。
- 隔离的 Electron 设置页集成检查通过：保存常用语后提示自动消失，提前收起窗口后提示不再出现；三个内容页进入设置后收起并重开会回到原内容页。
- 本轮未验证 Intel Mac、Windows、Linux、Gatekeeper 首次打开或长期运行。
