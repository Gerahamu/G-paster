# G-paster

G-paster is a local-first desktop clipboard history application for macOS (Apple Silicon arm64).

## Features

- **Menu Bar & Tray**: Runs quietly from the macOS menu bar and system tray.
- **Clipboard Monitoring**: Checks the system clipboard every 180 ms for new text, HTTP/HTTPS links, and images.
- **Text & Link History**:
  - Keeps up to 300 unique entries sorted by most recent copied timestamp (`copiedAt`).
  - Moves exact duplicate text to the top upon re-copying.
  - Search, re-copy, delete single entries, or clear clipboard history.
- **Image & Screenshot Transit**:
  - Copied images and collected screenshots share a single local image store.
  - Retains up to 10 unique images sorted by most recent copied or collected timestamp (`copiedAt`), automatically removing older images based on their copied/collected time when new ones arrive.
  - Image Favorite (Star): lets you star images for quick visual identification; **favorite status does not exempt an image from eviction based on copied/collected time**.
  - On macOS, newly saved screenshots from the Desktop or system screenshot location are automatically monitored and imported while original files remain untouched.
  - Supports image preview, native drag-and-drop (`startDrag`), and native save-to-file dialog.
- **Quick Phrases (常用语)**:
  - Create, edit, categorize, and one-click copy frequently used text.
  - Save text directly from clipboard history into quick phrases.
  - Duplicate phrase content is supported.
- **Global Shortcuts**:
  - macOS: `Control+C`
  - Windows: `Control+Shift+G`
  - If a global shortcut conflicts with another app, G-paster can always be opened via the menu bar icon.
- **Security & Isolation**:
  - Sandboxed renderer with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
  - Exposes a strictly typed, limited IPC preload API (`window.gpaster`).
  - Unified trusted page origin policy enforces that production builds only load the local application package, rejecting untrusted origins across navigation, redirection, and IPC.

## Development & Build

Requires Node.js 22.12.0 or newer and npm.

1. `npm install` - Install dependencies.
2. `npm run dev` - Start development server and launch Electron app.
3. `npm test` - Run storage and security regression tests.
4. `npm run typecheck` - Run TypeScript checks on both electron and renderer projects.
5. `npm run build` - Compile main process TypeScript and build Vite renderer output.
6. `npm run package:mac` - Package macOS arm64 application bundle into `work/packaged/`.

## Local Data & Privacy

All data is stored locally in Electron's per-user `userData` directory:
- `history.json` - Text and link clipboard history.
- `image-history.json` and `images/*.png` - Image metadata and image files.
- `phrases.json` - Quick phrases.

Data persistence uses atomic writes with `.bak` backups and corruption recovery. G-paster does not send clipboard contents to any external service or network endpoint.

## Platform Status & Notes

- **macOS (Apple Silicon arm64)**: Verified for development, packaging, and execution.
- **macOS Gatekeeper**: Unnotarized or ad-hoc signed builds downloaded from GitHub may trigger macOS Gatekeeper quarantine. If blocked, right-click and choose "Open", or remove quarantine attributes via terminal:
  ```bash
  xattr -cr /Applications/G-paster.app
  ```
- **Windows, Intel Mac & Linux**: Core clipboard and phrase logic includes cross-platform compatibility, but screenshot directory monitoring and Windows/Linux packaging scripts are currently unverified and not included in this release.
