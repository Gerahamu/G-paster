# G-paster

G-paster 是一个本地剪贴板工具。Windows 版常驻系统托盘，在同一个面板中管理剪贴板记录、常用语和截图。

## Windows v1.1.0

Windows x64 版提供 NSIS 安装包和便携版。下载、SHA-256 和发布说明见 [Windows v1.1.0](https://github.com/Gerahamu/G-paster/releases/tag/v1.1.0-windows)。本版安装包未作 Authenticode 签名，Windows 可能显示未知发布者提示。已安装 v1.0.0 的用户可就地升级。安装版可在设置中启用开机后台启动，普通卸载会保留本地记录。

- 默认按 **Alt+V** 打开或收起面板。
- 默认按 **Ctrl+Shift+F9** 开始截图，也可从系统托盘菜单启动。两个组合键均可在设置中修改。若组合键被其他程序占用，修改失败时保留之前的有效设置。
- 剪贴板历史支持文本、链接、图片和文件。常用语支持文本与图片。原有文件引用、可选本地文件副本和图片导出均保留。
- 开启「记住上次页面」后，关闭设置再打开面板时回到此前的内容模块。关闭此选项后从剪贴板打开。常用语保存提示约 3 秒后消失，关闭面板会立即清除提示。

### 区域截图和图片文字搜索

在显示器上悬停可预选窗口，也可直接拖动框选。选区外压暗 20%。框选后可以移动选区，或拖拽边缘和四角调整。选区工具条提供「截图保存」「识别文字并复制」「关闭」。按 Esc 可取消。截图保存到「截图中转站」。每次选区以一块显示器为范围。

剪贴板图片、截图和图片常用语在后台进行本地 OCR。在对应模块的搜索框输入识别到的词即可查找。符合图片格式条件的单个文件记录也可在剪贴板搜索中匹配。删除记录时，应用会清理对应索引。清空剪贴板与截图记录保留常用语及其索引。

Windows 版使用系统 OCR。可用语言取决于「语言和区域」中已安装的 OCR 功能。应用优先使用与界面语言匹配的已装识别语言，然后回退到系统或其他已装语言。受保护内容、锁屏、安全桌面以及限制 PowerShell 的环境可能导致无法截图或识别。识别并复制不会在无文字时改写剪贴板。

### 验证范围

见 [Windows v1.1.0 验证记录](docs/release-validation-windows-v1.1.0.md)。

## 开发与构建

从 Windows 发布分支检出源码，使用支持当前 Electron 和 Vite 版本的 Node.js（本版使用 Node 24）。

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run package:win
```

如果 `npm ci` 后 `node_modules/electron/dist/electron.exe` 尚未下载，可运行 `node node_modules/electron/install.js`。打包生成 Windows x64 独立应用、NSIS 安装包和便携版。安装包和便携版交付到 `outputs/`。

Windows 实机回归脚本使用临时数据和程序内测试剪贴板。它调用真实的桌面捕获和 Windows OCR。

```powershell
node --test scripts/test-region-overlay.mjs
npm exec -- electron scripts/test-windows-capture.cjs
```

macOS 发行版在独立分支维护，见 [Mac v1.0.1](https://github.com/Gerahamu/G-paster/releases/tag/v1.0.1)。
