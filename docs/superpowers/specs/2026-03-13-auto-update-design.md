# Auto-Update & Release System Design

**Date:** 2026-03-13
**Status:** Approved

## Overview

Add automatic update checking, downloading, and installation to the AxiForge Electron desktop app using `electron-builder` + `electron-updater` with GitHub Releases as the distribution source. Provide two Claude Code agent actions: `/release` for full release publishing and `/build-local` for beta artifact builds.

## Architecture

### Packaging: electron-builder

**Prerequisite:** Move `electron` from `dependencies` to `devDependencies` in `package.json`. electron-builder expects `electron` in devDependencies; having it in dependencies causes it to be bundled inside the asar, bloating the package and causing runtime failures.

**New dependencies:**
- `electron-builder` (devDependency) — packages AppImage (Linux) + NSIS installer (Windows)
- `electron-updater` (runtime dependency) — auto-update from GitHub Releases

**package.json `build` config:**
```json
{
  "build": {
    "appId": "com.darkharasho.axiforge",
    "productName": "AxiForge",
    "directories": { "output": "dist_out" },
    "artifactName": "AxiForge-${version}.${ext}",
    "publish": {
      "provider": "github",
      "owner": "darkharasho",
      "repo": "axiforge",
      "releaseType": "draft"
    },
    "files": [
      "src/**/*",
      "dist/renderer/**/*",
      "public/**/*",
      "lib/**/*",
      "package.json"
    ],
    "linux": { "target": ["AppImage"] },
    "win": { "target": ["nsis"] },
    "nsis": { "oneClick": true, "differentialPackage": true }
  }
}
```

**New npm scripts:**
- `build:app` — runs `vite build` then `electron-builder --publish never` (platform auto-detected)
- `build:app:linux` — runs `vite build` then `electron-builder --linux --publish never`
- `build:app:win` — runs `vite build` then `electron-builder --win --publish never` (requires Wine on Linux)

Note: Cross-compiling Windows NSIS from Linux requires Wine. The `/release` and `/build-local` agent actions should build for the current platform by default and note the Wine requirement if cross-compiling.

**Production loadFile path:** `src/main/index.js` must update its production `loadFile` path to point to `dist/renderer/index.html` (the Vite build output) instead of `src/renderer/index.html`. Use `app.isPackaged` to determine the correct path:
```js
// Packaged: resources/app/dist/renderer/index.html
// Dev: src/renderer/index.html (via Vite dev server or direct)
const rendererPath = app.isPackaged
  ? path.join(__dirname, "../../dist/renderer/index.html")
  : path.join(__dirname, "../renderer/index.html");
```

### Auto-Update: src/main/autoUpdate.js (new file)

Isolated module for update lifecycle. Exports `initAutoUpdate(win)` which takes the BrowserWindow instance. Called from `app.whenReady()` in `src/main/index.js` — `createWindow()` must be updated to return the `win` instance.

**Initialization:**
- Skip if `!app.isPackaged` (dev mode) — send fake "update-not-available" to renderer
- Detect AppImage via `!!process.env.APPIMAGE`. On Linux, if not running from AppImage, disable auto-update entirely (not just auto-download) — `checkForUpdates()` itself will error
- `autoUpdater.autoDownload = true`
- `autoUpdater.autoInstallOnAppQuit = true`
- After 3-second delay, call `autoUpdater.checkForUpdates()` with 30-second timeout
- Retryable network errors get one automatic retry after 2 seconds. Check both `error.code` and `error.message` for: ECONNRESET, ETIMEDOUT, socket hang up, HTTP 502/503/504
- Timeout implemented via `Promise.race` with a 30-second `setTimeout` rejection

**Events forwarded to renderer via `webContents.send()`:**
- `update-available` — `{ version, releaseDate }`
- `update-not-available` — `{ version }`
- `update-error` — `{ message }`
- `download-progress` — `{ percent, transferred, total }`
- `update-downloaded` — `{ version, releaseNotes }`

**IPC handlers registered:**
- `updater:check` — manual update check from UI
- `updater:restart` — `autoUpdater.quitAndInstall()`
- `updater:get-version` — returns `app.getVersion()`

### Preload Bridge Additions (src/preload/index.js)

```js
getAppVersion: () => ipcRenderer.invoke("updater:get-version"),
checkForUpdates: () => ipcRenderer.send("updater:check"),
restartApp: () => ipcRenderer.send("updater:restart"),
onUpdateAvailable: (cb) => { ipcRenderer.removeAllListeners("update-available"); ipcRenderer.on("update-available", (_e, info) => cb(info)); },
onUpdateNotAvailable: (cb) => { ipcRenderer.removeAllListeners("update-not-available"); ipcRenderer.on("update-not-available", (_e, info) => cb(info)); },
onUpdateDownloaded: (cb) => { ipcRenderer.removeAllListeners("update-downloaded"); ipcRenderer.on("update-downloaded", (_e, info) => cb(info)); },
onUpdateError: (cb) => { ipcRenderer.removeAllListeners("update-error"); ipcRenderer.on("update-error", (_e, info) => cb(info)); },
onDownloadProgress: (cb) => { ipcRenderer.removeAllListeners("download-progress"); ipcRenderer.on("download-progress", (_e, info) => cb(info)); },
```

### Titlebar Update UI

A status area inserted between the brand and window controls in the titlebar.

**HTML (in index.html titlebar):**
```html
<div class="titlebar__update-status no-drag">
  <span id="updateVersionLabel" class="titlebar__version"></span>
  <button id="updateRestartBtn" class="titlebar__restart-btn hidden" type="button">Restart to update</button>
</div>
```

**States with smooth animations:**
- **Idle:** Shows version text like `v0.2.0` (small, muted)
- **Downloading:** Progress indicator, e.g. `Updating... 45%`
- **Ready:** "Restart to update" pill button appears (styled like alpha badge — accent border, small pill). Clicking calls `restartApp()`
- **Error:** Briefly shows "Update failed", fades back to version after 5 seconds

**Animations:** All state transitions use CSS transitions (opacity, transform) for smooth, sleek visual feedback. The restart button slides in; progress text cross-fades.

**Styles:** Added to `src/renderer/styles/layout.css`.

### Renderer Wiring (src/renderer/renderer.js)

On DOM ready:
- Call `desktopApi.getAppVersion()` → set version label text
- Listen to update events → update titlebar UI state accordingly
- Wire restart button click → `desktopApi.restartApp()`

## Agent Actions

### /release (.claude/commands/release.md)

Full release workflow:
1. Run `npm test` — abort if tests fail
2. Ask user for version bump type (patch/minor/major)
3. Bump version in `package.json`
4. Analyze `git log` since last tag
5. Generate release notes inline (Claude writes them — no external API)
6. Prepend to `RELEASE_NOTES.md` with version + date header
7. `vite build` then `electron-builder --linux --win --publish never`
8. Commit version bump + release notes, tag `v{version}`, push
9. Create GitHub draft release via `gh release create`, upload artifacts from `dist_out/`
10. Publish draft via `gh release edit --draft=false`
11. Report release URL

### /build-local (.claude/commands/build-local.md)

Local build for beta testing:
1. Run `npm test` — abort if tests fail
2. `vite build` then `electron-builder --linux --win --publish never`
3. Report artifact paths from `dist_out/`
4. No version bump, no tag, no GitHub release

## File Change Summary

| Area | File | Change |
|------|------|--------|
| Dependencies | `package.json` | Move `electron` to devDeps, add `electron-updater` dep, `electron-builder` devDep, `build` config, `build:app` scripts |
| Auto-update | `src/main/autoUpdate.js` | New — update init, events, retry, IPC handlers |
| Main process | `src/main/index.js` | Return `win` from `createWindow()`, update production `loadFile` path, import + call `initAutoUpdate(win)` |
| Preload | `src/preload/index.js` | Expose update IPC methods |
| HTML | `src/renderer/index.html` | Add update status element in titlebar |
| Styles | `src/renderer/styles/layout.css` | Update status + restart button styles with animations |
| Renderer | `src/renderer/renderer.js` | Wire update event listeners, manage titlebar UI |
| Agent action | `.claude/commands/release.md` | New — full release workflow |
| Agent action | `.claude/commands/build-local.md` | New — local build only |
| Release notes | `RELEASE_NOTES.md` | Created by `/release`, prepended each release |

## Housekeeping

- Add `dist_out/` to `.gitignore` (electron-builder output directory)
- Replace titlebar "alpha" badge with the version label (avoids clutter from two small labels)

## Out of Scope

- CI/CD workflow changes (releases are manual via `/release`)
- Code signing (can add later)
- macOS builds (not currently targeted)
