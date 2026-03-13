# Auto-Update & Release System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-update, electron-builder packaging, and Claude Code agent actions for releasing and local-building the AxiForge Electron app.

**Architecture:** electron-builder packages AppImage (Linux) + NSIS (Windows). electron-updater checks GitHub Releases for updates, downloads in background, prompts user to restart via titlebar UI. Two Claude Code commands (`/release`, `/build-local`) orchestrate the build/release process.

**Tech Stack:** electron-builder, electron-updater, GitHub Releases API, `gh` CLI

**Spec:** `docs/superpowers/specs/2026-03-13-auto-update-design.md`

---

## Chunk 1: Package Configuration & Dependencies

### Task 1: Move electron to devDependencies and add new dependencies

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Move electron from dependencies to devDependencies**

In `package.json`, remove `"electron": "^37.2.0"` from `dependencies` (line 51) and add it to `devDependencies`. electron-builder requires electron in devDependencies.

```json
"dependencies": {
  "dotenv": "^17.2.3",
  "electron-updater": "^6.6.2",
  "gw2-class-icons": "^0.1.0"
},
"devDependencies": {
  "@babel/core": "^7.29.0",
  "@babel/preset-env": "^7.29.0",
  "babel-jest": "^30.3.0",
  "cheerio": "^1.2.0",
  "concurrently": "^9.2.1",
  "electron": "^37.2.0",
  "electron-builder": "^26.0.12",
  "electronmon": "^2.0.3",
  "jest": "^30.3.0",
  "vite": "^7.1.5",
  "wait-on": "^8.0.5"
}
```

- [ ] **Step 2: Add build config to package.json**

Add the `build` key at the top level of `package.json` (after `"main"`):

```json
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
},
```

- [ ] **Step 3: Add build scripts to package.json**

Add these scripts alongside existing ones:

```json
"build:app": "npm run build:renderer && electron-builder --publish never",
"build:app:linux": "npm run build:renderer && electron-builder --linux --publish never",
"build:app:win": "npm run build:renderer && electron-builder --win --publish never"
```

- [ ] **Step 4: Add dist_out/ to .gitignore**

Append `dist_out/` to `.gitignore` so electron-builder output is never committed.

Final `.gitignore`:
```
node_modules/
dist/
.DS_Store
.env
.worktrees/
dist_out/
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`

Expected: `electron-updater` appears in `node_modules/`, `electron-builder` available as dev dep. No errors.

- [ ] **Step 6: Run existing tests to verify nothing broke**

Run: `npm test`

Expected: All existing tests pass. Moving electron to devDependencies and adding new deps should not affect test behavior.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: add electron-builder and electron-updater dependencies

Move electron to devDependencies (required by electron-builder).
Add build config, build scripts, and dist_out/ to .gitignore."
```

---

### Task 2: Fix production loadFile path in main process

**Files:**
- Modify: `src/main/index.js:30-75` (createWindow function)

- [ ] **Step 1: Update createWindow to use correct production path and return win**

In `src/main/index.js`, modify `createWindow()` to:
1. Return `win` so callers can pass it to `initAutoUpdate`
2. Use `app.isPackaged` to resolve the correct renderer HTML path for packaged builds

Change the `else` branch at line 72-74 from:
```js
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
```

To:
```js
  } else {
    const rendererPath = app.isPackaged
      ? path.join(__dirname, "../../dist/renderer/index.html")
      : path.join(__dirname, "../renderer/index.html");
    win.loadFile(rendererPath);
  }

  return win;
}
```

And update line 140 from `createWindow();` to `const win = createWindow();` (the `win` variable will be used later when adding auto-update in Task 3).

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.js
git commit -m "fix: use correct renderer path for packaged builds

createWindow() now returns the BrowserWindow instance and resolves
dist/renderer/index.html when app.isPackaged is true."
```

---

## Chunk 2: Auto-Update Module

### Task 3: Create autoUpdate.js module

**Files:**
- Create: `src/main/autoUpdate.js`

- [ ] **Step 1: Write the auto-update module**

Create `src/main/autoUpdate.js`:

```js
const { autoUpdater } = require("electron-updater");
const { app, ipcMain } = require("electron");

const RETRY_ERRORS = [
  "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EPIPE",
  "socket hang up", "ERR_HTTP2_SERVER_REFUSED_STREAM",
];
const RETRY_HTTP_CODES = [502, 503, 504];
const CHECK_DELAY_MS = 3000;
const CHECK_TIMEOUT_MS = 30000;
const RETRY_DELAY_MS = 2000;

let mainWindow = null;
let retryAttempts = 0;

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function isRetryableError(err) {
  const msg = String(err?.message || err || "");
  const code = err?.code || "";
  if (RETRY_ERRORS.some((e) => msg.includes(e) || code.includes(e))) return true;
  if (RETRY_HTTP_CODES.some((c) => msg.includes(String(c)))) return true;
  return false;
}

function checkWithTimeout() {
  return Promise.race([
    autoUpdater.checkForUpdates(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Update check timed out")), CHECK_TIMEOUT_MS)
    ),
  ]);
}

function initAutoUpdate(win) {
  mainWindow = win;

  // Dev mode — skip entirely, send fake "not available"
  if (!app.isPackaged) {
    send("update-not-available", { version: app.getVersion() });
    return;
  }

  // Linux without AppImage — auto-update will error
  if (process.platform === "linux" && !process.env.APPIMAGE) {
    send("update-not-available", { version: app.getVersion() });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    send("update-available", {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    send("update-not-available", { version: info.version });
  });

  autoUpdater.on("error", (err) => {
    if (isRetryableError(err) && retryAttempts < 1) {
      retryAttempts++;
      setTimeout(() => {
        checkWithTimeout().catch(() => {});
      }, RETRY_DELAY_MS);
      return;
    }
    send("update-error", { message: String(err?.message || err) });
  });

  autoUpdater.on("download-progress", (progress) => {
    send("download-progress", {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    send("update-downloaded", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  // IPC handlers
  ipcMain.on("updater:check", () => {
    retryAttempts = 0;
    checkWithTimeout().catch(() => {});
  });

  ipcMain.on("updater:restart", () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle("updater:get-version", () => {
    return app.getVersion();
  });

  // Auto-check after delay
  setTimeout(() => {
    checkWithTimeout().catch(() => {});
  }, CHECK_DELAY_MS);
}

module.exports = { initAutoUpdate };
```

- [ ] **Step 2: Verify the file was created correctly**

Run: `node -e "require('./src/main/autoUpdate.js'); console.log('OK')"`

Expected: May warn about Electron not being available outside packaged context, but should not throw a syntax error. (electron-updater import will fail outside Electron — that's expected.)

- [ ] **Step 3: Commit**

```bash
git add src/main/autoUpdate.js
git commit -m "feat: add auto-update module with electron-updater

Checks GitHub releases on startup after 3s delay. Retries once on
network errors. Forwards all update events to renderer via IPC."
```

---

### Task 4: Wire autoUpdate into main process

**Files:**
- Modify: `src/main/index.js:1-5` (imports) and `src/main/index.js:138-140` (app.whenReady)

- [ ] **Step 1: Import initAutoUpdate**

Add at line 19 of `src/main/index.js` (after the siteBundle import):

```js
const { initAutoUpdate } = require("./autoUpdate");
```

- [ ] **Step 2: Call initAutoUpdate after createWindow**

In the `app.whenReady()` callback, after `const win = createWindow();` (line 140, updated in Task 2), add:

```js
  initAutoUpdate(win);
```

So lines 138-141 become:
```js
app.whenReady().then(async () => {
  await store.init();
  const win = createWindow();
  initAutoUpdate(win);
```

- [ ] **Step 3: Run tests**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js
git commit -m "feat: wire auto-update into main process startup"
```

---

### Task 5: Add update APIs to preload bridge

**Files:**
- Modify: `src/preload/index.js`

- [ ] **Step 1: Add update-related methods to the preload bridge**

Add the following methods inside the `contextBridge.exposeInMainWorld("desktopApi", { ... })` block, after the `setSetting` line (line 33):

```js
  getAppVersion: () => ipcRenderer.invoke("updater:get-version"),
  checkForUpdates: () => ipcRenderer.send("updater:check"),
  restartApp: () => ipcRenderer.send("updater:restart"),
  onUpdateAvailable: (cb) => {
    ipcRenderer.removeAllListeners("update-available");
    ipcRenderer.on("update-available", (_e, info) => cb(info));
  },
  onUpdateNotAvailable: (cb) => {
    ipcRenderer.removeAllListeners("update-not-available");
    ipcRenderer.on("update-not-available", (_e, info) => cb(info));
  },
  onUpdateDownloaded: (cb) => {
    ipcRenderer.removeAllListeners("update-downloaded");
    ipcRenderer.on("update-downloaded", (_e, info) => cb(info));
  },
  onUpdateError: (cb) => {
    ipcRenderer.removeAllListeners("update-error");
    ipcRenderer.on("update-error", (_e, info) => cb(info));
  },
  onDownloadProgress: (cb) => {
    ipcRenderer.removeAllListeners("download-progress");
    ipcRenderer.on("download-progress", (_e, info) => cb(info));
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/preload/index.js
git commit -m "feat: expose auto-update IPC methods in preload bridge"
```

---

## Chunk 3: Titlebar UI

### Task 6: Add update status HTML to titlebar

**Files:**
- Modify: `src/renderer/index.html:16-33` (titlebar header)

- [ ] **Step 1: Replace alpha badge with update status area**

In `src/renderer/index.html`, replace the alpha badge span and add the update status div. Change line 19 from:

```html
        <span>AxiForge Editor</span><span class="titlebar__alpha-badge">alpha</span>
```

To:

```html
        <span>AxiForge Editor</span>
```

Then insert the update status area between `</div>` (closing `.titlebar__brand`) and `<div class="titlebar__controls ...">`. After line 20 (closing `</div>` of `.titlebar__brand`), insert:

```html
      <div class="titlebar__update-status no-drag">
        <span id="updateVersionLabel" class="titlebar__version"></span>
        <span id="updateProgressLabel" class="titlebar__progress"></span>
        <button id="updateRestartBtn" class="titlebar__restart-btn hidden" type="button">Restart to update</button>
      </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/index.html
git commit -m "feat: add update status area in titlebar

Replaces alpha badge with version label, progress indicator,
and restart-to-update button."
```

---

### Task 7: Add titlebar update styles with animations

**Files:**
- Modify: `src/renderer/styles/layout.css`

- [ ] **Step 1: Remove the alpha badge styles and add update status styles**

In `src/renderer/styles/layout.css`, replace the `.titlebar__alpha-badge` block (lines 25-38) with the update status styles:

```css
/* ── Update status (titlebar) ─────────────────────────────────────────────── */
.titlebar__update-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  margin-right: 8px;
}

.titlebar__version {
  font-family: system-ui, sans-serif;
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: color-mix(in srgb, var(--text-dim, #7a9abf) 60%, transparent);
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.titlebar__progress {
  font-family: system-ui, sans-serif;
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--accent, #c8a96e);
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.3s ease, transform 0.3s ease;
  pointer-events: none;
}

.titlebar__progress.visible {
  opacity: 1;
  transform: translateY(0);
}

.titlebar__restart-btn {
  font-family: system-ui, sans-serif;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent, #c8a96e);
  border: 1px solid color-mix(in srgb, var(--accent, #c8a96e) 60%, transparent);
  border-radius: 3px;
  padding: 2px 8px;
  line-height: 1.4;
  background: transparent;
  cursor: pointer;
  opacity: 0;
  transform: translateX(8px);
  transition: opacity 0.4s ease, transform 0.4s ease, background 0.15s ease, border-color 0.15s ease;
  -webkit-font-smoothing: antialiased;
}

.titlebar__restart-btn.visible {
  opacity: 1;
  transform: translateX(0);
}

.titlebar__restart-btn:hover {
  background: color-mix(in srgb, var(--accent, #c8a96e) 15%, transparent);
  border-color: var(--accent, #c8a96e);
}

.titlebar__update-status .hidden {
  display: none;
}

.titlebar__version--error {
  color: #e06060;
  transition: opacity 0.3s ease;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles/layout.css
git commit -m "feat: add titlebar update status styles with smooth animations

Version label, download progress, and restart button all use CSS
transitions for opacity and transform. Restart button slides in
from the right."
```

---

### Task 8: Wire update events in renderer

**Files:**
- Modify: `src/renderer/renderer.js:46-78` (el cache) and `src/renderer/renderer.js:80-125` (module init)
- Modify: `src/renderer/index.html` (indirectly, DOM elements already added in Task 6)

- [ ] **Step 1: Add update DOM refs to the element cache**

In `src/renderer/renderer.js`, add these entries to the `el` object (after `titlebar: q("#titlebar"),` at line 77):

```js
  updateVersionLabel: q("#updateVersionLabel"),
  updateProgressLabel: q("#updateProgressLabel"),
  updateRestartBtn:    q("#updateRestartBtn"),
```

- [ ] **Step 2: Add update UI wiring after module initialization**

After the module initialization block (after line ~157, after `initRenderPagesCallbacks`), add the update UI wiring:

```js
// ── Auto-update titlebar UI ──────────────────────────────────────────────────

(async function initUpdateUI() {
  if (!window.desktopApi?.getAppVersion) return;

  try {
    const version = await window.desktopApi.getAppVersion();
    if (el.updateVersionLabel) el.updateVersionLabel.textContent = `v${version}`;
  } catch { /* not available in web builds */ }

  let errorTimeout = null;

  window.desktopApi.onUpdateAvailable?.((info) => {
    if (el.updateVersionLabel) el.updateVersionLabel.textContent = `v${info.version} available`;
  });

  window.desktopApi.onUpdateNotAvailable?.((info) => {
    if (el.updateVersionLabel) el.updateVersionLabel.textContent = `v${info.version}`;
  });

  window.desktopApi.onDownloadProgress?.((info) => {
    if (el.updateProgressLabel) {
      el.updateProgressLabel.textContent = `Updating... ${Math.round(info.percent)}%`;
      el.updateProgressLabel.classList.add("visible");
    }
    if (el.updateVersionLabel) el.updateVersionLabel.style.opacity = "0";
  });

  window.desktopApi.onUpdateDownloaded?.(() => {
    if (el.updateProgressLabel) {
      el.updateProgressLabel.textContent = "";
      el.updateProgressLabel.classList.remove("visible");
    }
    if (el.updateVersionLabel) el.updateVersionLabel.style.opacity = "";
    if (el.updateRestartBtn) {
      el.updateRestartBtn.classList.remove("hidden");
      // Trigger reflow before adding visible class for transition
      void el.updateRestartBtn.offsetWidth;
      el.updateRestartBtn.classList.add("visible");
    }
  });

  window.desktopApi.onUpdateError?.((info) => {
    if (errorTimeout) clearTimeout(errorTimeout);
    if (el.updateVersionLabel) {
      el.updateVersionLabel.classList.add("titlebar__version--error");
      el.updateVersionLabel.textContent = "Update failed";
    }
    if (el.updateProgressLabel) {
      el.updateProgressLabel.textContent = "";
      el.updateProgressLabel.classList.remove("visible");
    }
    errorTimeout = setTimeout(async () => {
      if (el.updateVersionLabel) {
        el.updateVersionLabel.classList.remove("titlebar__version--error");
        try {
          const version = await window.desktopApi.getAppVersion();
          el.updateVersionLabel.textContent = `v${version}`;
        } catch {
          el.updateVersionLabel.textContent = "";
        }
      }
    }, 5000);
  });

  if (el.updateRestartBtn) {
    el.updateRestartBtn.addEventListener("click", () => {
      window.desktopApi.restartApp?.();
    });
  }
})();
```

- [ ] **Step 3: Run tests**

Run: `npm test`

Expected: All tests pass. The update UI code is guarded by `window.desktopApi?.getAppVersion` so it won't run in test environments.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/renderer.js
git commit -m "feat: wire auto-update events to titlebar UI

Shows version, download progress, restart button, and error states
with smooth CSS transitions."
```

---

## Chunk 4: Agent Actions

### Task 9: Create /release agent action

**Files:**
- Create: `.claude/commands/release.md`

- [ ] **Step 1: Write the release command**

Create `.claude/commands/release.md`:

````markdown
You are a release agent for the axiforge Electron desktop app.

Your task: create a new release with version bump type **$ARGUMENTS** (must be one of: `patch`, `minor`, `major`).

If `$ARGUMENTS` is empty or not one of patch/minor/major, ask the user which bump type they want.

## Steps

Follow these steps in order. Do not skip steps.

### Step 1 — Validate

1. Ensure working tree is clean: `git status --porcelain` must be empty. If not, abort: "Working tree is not clean. Commit or stash changes first."
2. Run `npm test`. If tests fail, abort: "Tests failed — fix before releasing."
3. Validate the bump type is one of: patch, minor, major.

### Step 2 — Bump version

1. Read current version from `package.json`.
2. Compute new version by bumping the requested component (patch/minor/major).
3. Edit `package.json` to set the new version string.
4. Run `npm install --package-lock-only` to update package-lock.json.

### Step 3 — Generate release notes

1. Find the most recent git tag: `git describe --tags --abbrev=0 2>/dev/null`
   - If no tag exists, use the initial commit as the range start.
2. Get the commit log since that tag: `git log <tag>..HEAD --oneline`
3. Get the diff stats: `git diff <tag>..HEAD --stat`
4. Analyze the commits and write human-readable release notes. Group changes by category:
   - **New Features** — commits starting with `feat:`
   - **Bug Fixes** — commits starting with `fix:`
   - **Other Changes** — everything else (chore, refactor, docs, etc.)

   Write 1-2 sentences per change explaining what it does from a user perspective. Skip merge commits and trivial chores.
5. Prepend to `RELEASE_NOTES.md` (create if it doesn't exist) with this format:

```
## Version v{version} — {Month Day, Year}

{release notes body}

```

### Step 4 — Build

```bash
npm run build:renderer && electron-builder --linux --win --publish never
```

If the build fails, abort: "Build failed — see output above."

Note: Building Windows from Linux requires Wine. If `--win` fails due to Wine, retry with `--linux` only and warn the user.

### Step 5 — Commit, tag, and push

```bash
git add package.json package-lock.json RELEASE_NOTES.md
git commit -m "release: v{version}"
git tag v{version}
git push origin main --follow-tags
```

### Step 6 — Create GitHub release

1. Create the release with artifacts:

```bash
gh release create v{version} \
  --repo darkharasho/axiforge \
  --title "v{version}" \
  --notes-file <(head -n <lines_for_this_version> RELEASE_NOTES.md) \
  --draft \
  dist_out/*.AppImage dist_out/*.exe dist_out/*.blockmap dist_out/latest*.yml
```

2. Publish the draft:

```bash
gh release edit v{version} --repo darkharasho/axiforge --draft=false
```

### Step 7 — Report

End your response with: `Release published: <release-url>`
````

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/release.md
git commit -m "feat: add /release agent action for publishing releases"
```

---

### Task 10: Create /build-local agent action

**Files:**
- Create: `.claude/commands/build-local.md`

- [ ] **Step 1: Write the build-local command**

Create `.claude/commands/build-local.md`:

````markdown
You are a build agent for the axiforge Electron desktop app.

Your task: build the app locally for beta testing. No version bump, no git tag, no GitHub release.

## Steps

### Step 1 — Validate

Run `npm test`. If tests fail, abort: "Tests failed — fix before building."

### Step 2 — Build

```bash
npm run build:renderer && electron-builder --linux --win --publish never
```

Note: Building Windows from Linux requires Wine. If `--win` fails due to Wine, retry with `--linux` only and note this in the output.

### Step 3 — Report artifacts

List the built artifacts:

```bash
ls -lh dist_out/*.AppImage dist_out/*.exe 2>/dev/null
```

End your response with the full paths of each artifact, e.g.:

```
Build complete:
  Linux: dist_out/AxiForge-0.1.0.AppImage
  Windows: dist_out/AxiForge-0.1.0.exe
```

If only one platform was built, list only that one.
````

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/build-local.md
git commit -m "feat: add /build-local agent action for beta builds"
```

---

## Chunk 5: Verification

### Task 11: End-to-end verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 2: Run dev mode to verify titlebar UI renders**

Run: `npm run dev`

Expected: App launches. Titlebar shows a version label (e.g. `v0.1.0`). Since this is dev mode, `initAutoUpdate` sends fake `update-not-available` — the version label should appear with no errors. The restart button should remain hidden.

- [ ] **Step 3: Verify electron-builder can produce a Linux build**

Run: `npm run build:app:linux`

Expected: AppImage artifact created in `dist_out/`. Output shows something like `AxiForge-0.1.0.AppImage`.

- [ ] **Step 4: Verify the agent commands exist and are syntactically valid**

Run: `cat .claude/commands/release.md | head -5` and `cat .claude/commands/build-local.md | head -5`

Expected: Both files exist and contain the expected header text.

- [ ] **Step 5: Commit any final fixes if needed**

If any issues were found and fixed during verification, commit them.
