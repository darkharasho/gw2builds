# Game Mode Toggle (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-build PvE/WvW game mode toggle with persistent sticky defaults, plumbed through the data layer for future mode-aware balance.

**Architecture:** Game mode is stored as `"pve"` or `"wvw"` on each build's editor state. A settings.json file persists the last-used mode across app restarts. The subnav converts from a vertical column to a horizontal bar to accommodate the toggle. The mode value is threaded through the IPC catalog fetch but has no effect on API calls in Phase 1.

**Tech Stack:** Electron (main + preload + renderer), vanilla JS, CSS, Jest

**Spec:** `docs/superpowers/specs/2026-03-11-game-mode-toggle-design.md`

---

## Chunk 1: Backend — Settings persistence + normalization

### Task 1: BuildStore settings persistence

**Files:**
- Modify: `src/main/buildStore.js:6-16` (constructor + init)
- Modify: `src/main/buildStore.js:80` (before class closing brace)
- Test: `tests/unit/buildStore.test.js`

- [ ] **Step 1: Write failing tests for getSetting/setSetting**

Add to `tests/unit/buildStore.test.js`:

```js
describe("BuildStore — settings", () => {
  let dir;

  afterEach(async () => { if (dir) await cleanupDir(dir); });

  test("getSetting returns null for unknown key", async () => {
    ({ dir } = (await makeTempStore()));
    const store = new BuildStore(dir);
    await store.init();
    expect(await store.getSetting("nonexistent")).toBeNull();
  });

  test("setSetting persists and getSetting retrieves", async () => {
    ({ dir } = (await makeTempStore()));
    const store = new BuildStore(dir);
    await store.init();
    await store.setSetting("lastGameMode", "wvw");
    expect(await store.getSetting("lastGameMode")).toBe("wvw");
  });

  test("setSetting overwrites previous value", async () => {
    ({ dir } = (await makeTempStore()));
    const store = new BuildStore(dir);
    await store.init();
    await store.setSetting("lastGameMode", "wvw");
    await store.setSetting("lastGameMode", "pve");
    expect(await store.getSetting("lastGameMode")).toBe("pve");
  });

  test("settings survive re-instantiation (disk persistence)", async () => {
    ({ dir } = (await makeTempStore()));
    const store1 = new BuildStore(dir);
    await store1.init();
    await store1.setSetting("lastGameMode", "wvw");

    const store2 = new BuildStore(dir);
    await store2.init();
    expect(await store2.getSetting("lastGameMode")).toBe("wvw");
  });

  test("init creates settings.json if missing", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-settings-test-"));
    dir = tmpDir;
    const store = new BuildStore(tmpDir);
    await store.init();
    const exists = await fs.access(path.join(tmpDir, "settings.json")).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/buildStore.test.js --verbose`
Expected: FAIL — `store.getSetting is not a function`

- [ ] **Step 3: Implement getSetting/setSetting in BuildStore**

In `src/main/buildStore.js`, add `settingsPath` to constructor (line 9), add to `init()` (line 15), and add methods before the class closing brace:

```js
// In constructor (after line 9):
this.settingsPath = path.join(baseDir, "settings.json");

// In init() (after line 15):
await this.#ensureFile(this.settingsPath, {});

// New methods (before the closing brace of the class, after line 79):
async getSetting(key) {
  const data = await this.#readJson(this.settingsPath, {});
  return data[key] ?? null;
}

async setSetting(key, value) {
  const data = await this.#readJson(this.settingsPath, {});
  data[key] = value;
  await this.#writeJson(this.settingsPath, data);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/buildStore.test.js --verbose`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/buildStore.js tests/unit/buildStore.test.js
git commit -m "feat: add getSetting/setSetting to BuildStore for persistent app settings"
```

---

### Task 2: Add gameMode to normalizeBuild

**Files:**
- Modify: `src/main/buildStore.js:82-100` (normalizeBuild function)
- Test: `tests/unit/buildStore.test.js`

- [ ] **Step 1: Write failing test for gameMode normalization**

Add to `tests/unit/buildStore.test.js`:

```js
describe("BuildStore — gameMode normalization", () => {
  let dir;

  afterEach(async () => { if (dir) await cleanupDir(dir); });

  test("build without gameMode defaults to pve", async () => {
    ({ dir } = (await makeTempStore()));
    const store = new BuildStore(dir);
    await store.init();
    const saved = await store.upsertBuild(makeBuild());
    expect(saved.gameMode).toBe("pve");
  });

  test("build with gameMode wvw is preserved", async () => {
    ({ dir } = (await makeTempStore()));
    const store = new BuildStore(dir);
    await store.init();
    const saved = await store.upsertBuild(makeBuild({ gameMode: "wvw" }));
    expect(saved.gameMode).toBe("wvw");
  });

  test("gameMode is truncated to 10 chars", async () => {
    ({ dir } = (await makeTempStore()));
    const store = new BuildStore(dir);
    await store.init();
    const saved = await store.upsertBuild(makeBuild({ gameMode: "a".repeat(50) }));
    expect(saved.gameMode.length).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/buildStore.test.js --verbose --testNamePattern "gameMode"`
Expected: FAIL — `saved.gameMode` is `undefined`

- [ ] **Step 3: Add gameMode to normalizeBuild**

In `src/main/buildStore.js`, add to the `normalizeBuild` return object (after line 98, before the closing `};`):

```js
gameMode: asString(input.gameMode, 10) || "pve",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/buildStore.test.js --verbose`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/buildStore.js tests/unit/buildStore.test.js
git commit -m "feat: add gameMode field to normalizeBuild with pve default"
```

---

### Task 3: Add IPC handlers + preload entries

**Files:**
- Modify: `src/main/index.js:252-254` (near existing IPC handlers)
- Modify: `src/preload/index.js:27-28` (desktopApi entries)

- [ ] **Step 1: Add settings IPC handlers to main process**

In `src/main/index.js`, add after line 254 (after the `wiki:get-summary` handler):

```js
ipcMain.handle("settings:get", async (_e, key) => store.getSetting(key));
ipcMain.handle("settings:set", async (_e, key, value) => store.setSetting(key, value));
```

- [ ] **Step 2: Update getProfessionCatalog IPC handler to accept gameMode**

In `src/main/index.js`, replace lines 252-254:

```js
// Before:
ipcMain.handle("gw2:get-profession-catalog", async (_e, professionId) =>
  getProfessionCatalog(professionId, "en")
);

// After:
ipcMain.handle("gw2:get-profession-catalog", async (_e, professionId, gameMode) =>
  getProfessionCatalog(professionId, "en", gameMode)
);
```

- [ ] **Step 3: Add preload entries**

In `src/preload/index.js`, add after line 29 (after `showError`):

```js
getSetting: (key) => ipcRenderer.invoke("settings:get", key),
setSetting: (key, value) => ipcRenderer.invoke("settings:set", key, value),
```

And update the `getProfessionCatalog` entry (line 27-28):

```js
// Before:
getProfessionCatalog: (professionId) =>
  ipcRenderer.invoke("gw2:get-profession-catalog", professionId),

// After:
getProfessionCatalog: (professionId, gameMode) =>
  ipcRenderer.invoke("gw2:get-profession-catalog", professionId, gameMode),
```

- [ ] **Step 4: Update catalog.js to accept gameMode parameter**

In `src/main/gw2Data/catalog.js`, update the function signature at line 58:

```js
// Before:
async function getProfessionCatalog(professionId, lang = "en") {

// After:
async function getProfessionCatalog(professionId, lang = "en", gameMode = "pve") {
```

And at the end of the function, before `return catalog;`, add:

```js
catalog.gameMode = gameMode || "pve";
```

- [ ] **Step 5: Commit**

```bash
git add src/main/index.js src/preload/index.js src/main/gw2Data/catalog.js
git commit -m "feat: add settings IPC, thread gameMode through catalog fetch pipeline"
```

---

## Chunk 2: Renderer — State, serialization, editor logic

### Task 4: Add gameMode to editor state

**Files:**
- Modify: `src/renderer/modules/state.js:35-78` (createEmptyEditor)

- [ ] **Step 1: Add gameMode param and field to createEmptyEditor**

In `src/renderer/modules/state.js`, update the function signature (line 35) and add `gameMode` to the return object (after line 76, before `antiquaryArtifacts`):

```js
// Line 35 — update signature:
export function createEmptyEditor(profession = "", gameMode = "pve") {

// After line 76 (after allianceTacticsForm), add:
    gameMode: gameMode || "pve",
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/state.js
git commit -m "feat: add gameMode field to createEmptyEditor with optional parameter"
```

---

### Task 5: Add gameMode to serialization + dirty tracking

**Files:**
- Modify: `src/renderer/modules/editor.js:309-344` (computeEditorSignature)
- Modify: `src/renderer/modules/editor.js:371-415` (parseBuildImportPayload)
- Modify: `src/renderer/modules/editor.js:475-555` (loadBuildIntoEditor)
- Modify: `src/renderer/modules/editor.js:578-677` (serializeEditorToBuild)

- [ ] **Step 1: Add gameMode to computeEditorSignature**

In `src/renderer/modules/editor.js`, add `gameMode` to the `payload` object inside `computeEditorSignature` (after line 342, before the closing `};`):

```js
gameMode: String(editor.gameMode || "pve"),
```

- [ ] **Step 2: Add gameMode to parseBuildImportPayload**

In `src/renderer/modules/editor.js`, add `gameMode` to the return object of `parseBuildImportPayload` (after line 414, before the closing `};`):

```js
gameMode: String(source.gameMode || "pve"),
```

- [ ] **Step 3: Add gameMode to loadBuildIntoEditor**

In `src/renderer/modules/editor.js`, add `gameMode` to the `state.editor` object literal in `loadBuildIntoEditor` (after line 554, before the closing `};`):

```js
gameMode: String(build.gameMode || "pve"),
```

- [ ] **Step 4: Add gameMode to serializeEditorToBuild**

In `src/renderer/modules/editor.js`, add `gameMode` to the return object of `serializeEditorToBuild` (after line 675, before the closing `};`):

```js
gameMode: String(state.editor.gameMode || "pve"),
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/editor.js
git commit -m "feat: add gameMode to editor serialization, import, load, and dirty tracking"
```

---

### Task 6: Add gameMode to search and library cards

**Files:**
- Modify: `src/renderer/modules/utils.js:34-46` (matchesBuildQuery)
- Modify: `src/renderer/modules/render-pages.js:330-338` (renderBuildList card rendering)

- [ ] **Step 1: Add gameMode to matchesBuildQuery haystack**

In `src/renderer/modules/utils.js`, add `build.gameMode || ""` to the haystack array (after line 41):

```js
// After the specializations line (line 41), add:
    build.gameMode || "",
```

- [ ] **Step 2: Add game mode badge to library cards**

In `src/renderer/modules/render-pages.js`, update the card innerHTML (lines 335-338) to include a mode badge:

```js
// Replace lines 335-338:
card.innerHTML = `
  <h3>${escapeHtml(build.title || "Untitled Build")}</h3>
  <p>${escapeHtml(build.profession || "Unknown Profession")} | ${escapeHtml((build.gameMode || "pve").toUpperCase())} | Updated ${escapeHtml(formatDate(build.updatedAt))}${escapeHtml(dirtySuffix)}</p>
`;
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/utils.js src/renderer/modules/render-pages.js
git commit -m "feat: add gameMode to build search haystack and library card display"
```

---

### Task 7: Update getCatalog + renderer plumbing

**Files:**
- Modify: `src/renderer/renderer.js:150-172` (init)
- Modify: `src/renderer/renderer.js:181-192` (startNewBuild)
- Modify: `src/renderer/renderer.js:251-290` (setProfession, getCatalog)

- [ ] **Step 1: Add sticky gameMode init to renderer**

In `src/renderer/renderer.js`, add a module-level variable near the top imports (after line 6):

```js
let _lastGameMode = "pve";
```

In `init()` (after line 152, before the `Promise.all`), add:

```js
_lastGameMode = (await window.desktopApi.getSetting("lastGameMode")) || "pve";
```

- [ ] **Step 2: Update getCatalog to accept gameMode**

In `src/renderer/renderer.js`, update `getCatalog` (lines 268-290):

```js
// Before:
async function getCatalog(professionId) {
  if (state.catalogCache.has(professionId)) return state.catalogCache.get(professionId);
  const raw = await window.desktopApi.getProfessionCatalog(professionId);

// After:
async function getCatalog(professionId, gameMode = "pve") {
  const cacheKey = `${professionId}_${gameMode}`;
  if (state.catalogCache.has(cacheKey)) return state.catalogCache.get(cacheKey);
  const raw = await window.desktopApi.getProfessionCatalog(professionId, gameMode);
```

And update the cache set (line 280):

```js
// Before:
state.catalogCache.set(professionId, catalog);

// After:
state.catalogCache.set(cacheKey, catalog);
```

- [ ] **Step 3: Update setProfession to pass gameMode**

In `src/renderer/renderer.js`, update `setProfession` (line 255):

```js
// Before:
const catalog = await getCatalog(selected);

// After:
const catalog = await getCatalog(selected, state.editor.gameMode || "pve");
```

- [ ] **Step 4: Update startNewBuild to use sticky default**

In `src/renderer/renderer.js`, update `startNewBuild` (line 184):

```js
// Before:
state.editor = createEmptyEditor(profession);

// After:
state.editor = createEmptyEditor(profession, _lastGameMode);
```

- [ ] **Step 5: Update init to pass sticky default for empty editor**

In `src/renderer/renderer.js`, update init (line 165):

```js
// Before:
state.editor = createEmptyEditor(state.professions[0].id);

// After:
state.editor = createEmptyEditor(state.professions[0].id, _lastGameMode);
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/renderer.js
git commit -m "feat: thread gameMode through catalog fetch, use sticky default for new builds"
```

---

## Chunk 3: UI — Subnav conversion + toggle

### Task 8: Convert subnav from vertical to horizontal

**Files:**
- Modify: `src/renderer/index.html:42-62` (app-layout + subnav structure)
- Modify: `src/renderer/styles/layout.css:91-153` (app-layout + subnav styles)

- [ ] **Step 1: Move subnav into page-content in HTML**

In `src/renderer/index.html`, remove the `#subnav` from its current position (lines 59-62) as a sibling of `.leftnav` and `.page-content`. Instead, place it as the first child inside `.page-content` (before line 64):

```html
<!-- The app-layout grid becomes 2 columns: leftnav + content -->
<div class="app-layout">
  <nav class="leftnav">
    <!-- ... leftnav buttons unchanged ... -->
  </nav>

  <div class="page-content">
    <!-- Subnav is now a horizontal bar inside page-content -->
    <nav id="subnav" class="subnav subnav--visible">
      <button class="subnav__item subnav__item--active" data-subtab="build" type="button"><span class="subnav__icon">&#9876;</span> Build</button>
      <button class="subnav__item" data-subtab="equipment" type="button"><span class="subnav__icon">&#9775;</span> Equipment</button>
      <div class="game-mode-toggle">
        <button class="game-mode-toggle__btn game-mode-toggle__btn--active" data-mode="pve" type="button">PvE</button>
        <button class="game-mode-toggle__btn" data-mode="wvw" type="button">WvW</button>
      </div>
    </nav>

    <!-- Build Editor page -->
    <div id="page-editor" class="page">
      <!-- ... unchanged ... -->
```

Remove the `app-layout--subnav` class from the `.app-layout` div (line 42).

- [ ] **Step 2: Update layout CSS for horizontal subnav**

In `src/renderer/styles/layout.css`, update the grid and subnav styles:

```css
/* Replace .app-layout (lines 92-98): */
.app-layout {
  display: grid;
  grid-template-columns: 100px 1fr;
  min-height: calc(100vh - 40px);
  margin-top: 40px;
}

/* Remove .app-layout--subnav (lines 100-102) */

/* Replace .subnav (lines 104-119): */
.subnav {
  display: none;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: rgba(10, 17, 34, 0.98);
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  z-index: 10;
}

/* Replace .subnav--visible (lines 116-119): */
.subnav--visible {
  display: flex;
}

/* Update .subnav__item (lines 121-138) — remove width: 100%: */
.subnav__item {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: var(--text-dim, #7a9abf);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 7px;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}
```

- [ ] **Step 3: Add game mode toggle styles**

In `src/renderer/styles/layout.css`, append:

```css
/* ── Game mode toggle ─────────────────────────────────────────────────────── */
.game-mode-toggle {
  margin-left: auto;
  display: flex;
  border-radius: 4px;
  overflow: hidden;
}

.game-mode-toggle__btn {
  padding: 4px 10px;
  border: none;
  background: #2a2a3e;
  color: var(--text-dim, #7a9abf);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.game-mode-toggle__btn:hover {
  background: #3a3a52;
}

.game-mode-toggle__btn--active {
  background: var(--accent, #c5a855);
  color: #1a1a2e;
  font-weight: 600;
}

.game-mode-toggle__btn--active:hover {
  background: var(--accent, #c5a855);
}
```

- [ ] **Step 4: Update wireEvents for subnav visibility**

In `src/renderer/renderer.js`, update the page-switching logic (lines 451-454). Remove the `app-layout--subnav` toggle since the grid is now always 2-column:

```js
// Before (line 454):
el.appLayout.classList.toggle("app-layout--subnav", showSubnav);

// After:
// (remove this line — no longer needed)
```

- [ ] **Step 5: Verify the app launches and subnav displays horizontally**

Run: `npm start`
Expected: Subnav appears as a horizontal bar above the editor content. Build and Equipment tabs display side by side. The PvE/WvW toggle appears on the right.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/index.html src/renderer/styles/layout.css src/renderer/renderer.js
git commit -m "feat: convert subnav to horizontal bar, add game mode toggle UI"
```

---

### Task 9: Wire toggle click handler + mode switch behavior

**Files:**
- Modify: `src/renderer/renderer.js:344-469` (wireEvents)

- [ ] **Step 1: Add syncGameModeToggleUI helper**

In `src/renderer/renderer.js`, add a helper function (after the `getCatalog` function, around line 290):

```js
function syncGameModeToggleUI(mode) {
  document.querySelectorAll(".game-mode-toggle__btn").forEach((btn) => {
    btn.classList.toggle("game-mode-toggle__btn--active", btn.dataset.mode === mode);
  });
}
```

- [ ] **Step 2: Add toggle click handler in wireEvents**

In `src/renderer/renderer.js`, add to `wireEvents()` (after the subnav tab switching block, around line 469):

```js
// Game mode toggle
document.querySelectorAll(".game-mode-toggle__btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const mode = btn.dataset.mode;
    if (!mode || mode === state.editor.gameMode) return;

    state.editor.gameMode = mode;
    _lastGameMode = mode;
    window.desktopApi.setSetting("lastGameMode", mode);

    // Re-fetch catalog for the new mode (cache key includes mode)
    if (state.editor.profession) {
      const catalog = await getCatalog(state.editor.profession, mode);
      state.activeCatalog = catalog;
      enforceEditorConsistency();
    }

    markEditorChanged();
    syncGameModeToggleUI(mode);
    renderEditor();
  });
});
```

Note: `markEditorChanged()` must be called before `renderEditor()` so that `state.editorDirty` is true when the editor meta (unsaved badge) renders.

- [ ] **Step 3: Sync toggle UI after every render() call in renderer.js**

`render()` and `renderEditor()` are imported from `render-pages.js` — we cannot add `syncGameModeToggleUI` inside them without creating a circular dependency. Instead, add a `syncGameModeToggleUI` call after each `render()` call in `renderer.js`. There are 5 call sites (lines 171, 190, 202, 242, 385). After each one, add:

```js
syncGameModeToggleUI(state.editor.gameMode || "pve");
```

This ensures the toggle reflects the correct mode after init, startNewBuild, saveCurrentBuild, duplicateCurrentBuild, and loadBuildIntoEditor paths.

- [ ] **Step 4: Verify toggle works end-to-end**

Run: `npm start`
Expected:
1. Click WvW → toggle highlights WvW, build marked dirty
2. Save build → reload → build still shows WvW
3. Start new build → defaults to WvW (sticky)
4. Restart app → new build defaults to WvW (persisted)
5. Load an old PvE build → toggle switches back to PvE

- [ ] **Step 5: Commit**

```bash
git add src/renderer/renderer.js
git commit -m "feat: wire game mode toggle with sticky persistence and editor re-render"
```

---

## Chunk 4: Verification

### Task 10: Run full test suite + manual verification

- [ ] **Step 1: Run all tests**

Run: `npx jest --verbose`
Expected: ALL PASS — no regressions. The new buildStore tests pass. Existing tests are unaffected (gameMode defaults to "pve" everywhere via fallbacks).

- [ ] **Step 2: Manual end-to-end verification**

Run: `npm start`

Verify:
1. Subnav is horizontal with Build | Equipment tabs and PvE/WvW toggle on right
2. Default mode is PvE (gold highlight on PvE button)
3. Click WvW → WvW highlights, "Unsaved changes" badge appears
4. Save build → game mode badge shows "WVW" in library card
5. Search "wvw" in library → WvW builds appear
6. Start new build → defaults to WvW (last used)
7. Close and reopen app → new build still defaults to WvW
8. Load a previously saved PvE build → toggle switches to PvE
9. Copy JSON → paste JSON with gameMode "wvw" → editor loads as WvW
10. Import JSON without gameMode → defaults to PvE

- [ ] **Step 3: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: address any issues found during manual verification"
```

(Skip this step if no fixups were needed.)
