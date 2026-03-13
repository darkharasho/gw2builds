# Game Mode Toggle Design (PvE / WvW)

## Overview

Add a per-build PvE/WvW game mode toggle to AxiForge. The toggle controls which balance context applies to skills, traits, and stats. This is Phase 1 of a 3-phase feature; it establishes the UI, state management, persistence, and data-layer plumbing that subsequent phases build on.

## Phasing

### Phase 1: Toggle + Persistence + Data Plumbing (this spec)
- Subnav converted from vertical column to horizontal bar above page content
- UI toggle right-aligned in the horizontal subnav
- Per-build game mode state, serialized with builds
- Sticky default persisted to disk (survives restarts)
- Mode switch triggers `enforceEditorConsistency()` to clear invalid selections
- `gameMode` threaded through to data-fetching layer (pass-through, no API changes yet)

### Phase 2: Split Registry + Wiki Seeding + Fact Resolution (separate package)
- **Standalone public package** (separate repo, e.g., `gw2-balance-splits`) — reusable by any GW2 community tool
- Data model (JSON) for tracking which skills/traits have PvE vs WvW balance splits
- Wiki scraper scripts to seed the registry from the GW2 wiki
- Cross-reference logic: given a skill ID and game mode, resolve which API facts apply
- Published as an npm package and/or a public JSON file that tools can fetch
- AxiForge consumes this as a dependency to display mode-appropriate facts in the detail panel

### Phase 3: Patch Note Crawler (part of the same package)
- Runnable scripts within the `gw2-balance-splits` package
- Periodic crawl/RSS of https://wiki.guildwars2.com/wiki/Game_updates
- Auto-detect new balance splits from patch notes
- Update the registry JSON with newly discovered splits
- Can be run manually or via CI/scheduled action to keep the data current

---

## Phase 1 Specification

### UI: Subnav Conversion + Game Mode Toggle

**Subnav layout change:** The subnav (`#subnav`) is currently a 120px-wide vertical column (flex-direction: column) that occupies its own grid column in `.app-layout`. It will be converted to a horizontal bar that sits above the page content area, inside the content column. This eliminates the dedicated subnav grid column.

**Layout grid change:**
- `.app-layout` grid changes from `100px 120px 1fr` (3 columns) to `100px 1fr` (2 columns)
- `.app-layout--subnav` modifier is removed or repurposed
- `#subnav` moves from being a grid column sibling to being a horizontal bar prepended inside `.page-content` (or positioned above it via the grid)

**Subnav new styling:**
- `flex-direction: row` (horizontal), `align-items: center`, `gap: 8px`
- Full width of the content area
- Background and border-bottom matching the existing subnav aesthetic
- Tab buttons remain the same but lay out horizontally
- Width property and overflow:hidden removed (no longer a narrow column)

**Game mode toggle placement:** Right-aligned in the now-horizontal subnav bar, using `margin-left: auto`.

**Markup:**

```html
<nav id="subnav" class="subnav subnav--visible">
  <button class="subnav__item subnav__item--active" data-subtab="build" type="button">
    <span class="subnav__icon">&#9876;</span> Build
  </button>
  <button class="subnav__item" data-subtab="equipment" type="button">
    <span class="subnav__icon">&#9775;</span> Equipment
  </button>
  <div class="game-mode-toggle">
    <button class="game-mode-toggle__btn game-mode-toggle__btn--active" data-mode="pve" type="button">PvE</button>
    <button class="game-mode-toggle__btn" data-mode="wvw" type="button">WvW</button>
  </div>
</nav>
```

**Toggle styling:**
- Container: `margin-left: auto` to push right, `display: flex`, `border-radius: 4px`, `overflow: hidden`
- Inactive button: dark background (`#2a2a3e`), muted text color
- Active button: gold background (`#c5a855`), dark text, `font-weight: 600`
- Each button: compact padding (~4px 10px), font-size ~11px, no border, cursor pointer
- Visible only when subnav is visible (editor page only) — inherits existing subnav visibility logic since it's a child of `#subnav`

### State

**Editor state:** Add `gameMode` field to the editor object.

```js
// In createEmptyEditor(profession, gameMode):
gameMode: gameMode || "pve",  // "pve" or "wvw"
```

`createEmptyEditor` gains an optional `gameMode` parameter. The caller is responsible for passing the sticky default.

**Sticky default:** The last-used game mode is persisted to disk via `desktopApi` so it survives app restarts.

- On mode change: write to disk via `desktopApi.setSetting("lastGameMode", mode)` (fire-and-forget, no await needed)
- On app init: read via `await desktopApi.getSetting("lastGameMode")` — falls back to `"pve"` if unset. This is read once at startup and cached in a module-level variable (e.g., `let _lastGameMode = "pve"`) so that `createEmptyEditor` can use it synchronously.
- On mode change: also update the in-memory `_lastGameMode` variable so subsequent new builds within the same session use the latest value without another IPC call.

**New IPC methods — full specification:**

`src/main/buildStore.js` — add `settings.json` alongside `builds.json`:
```js
// In constructor:
this.settingsPath = path.join(baseDir, "settings.json");

// In init():
await this.#ensureFile(this.settingsPath, {});

// New methods:
async getSetting(key) {
  const data = await this.#readJson(this.settingsPath, {});
  return data[key] ?? null;
}

async setSetting(key, value) {
  const data = await this.#readJson(this.settingsPath, {});
  data[key] = value;
  await fs.writeFile(this.settingsPath, JSON.stringify(data, null, 2));
}
```

`src/main/index.js` — add IPC handlers:
```js
ipcMain.handle("settings:get", async (_e, key) => store.getSetting(key));
ipcMain.handle("settings:set", async (_e, key, value) => store.setSetting(key, value));
```

`src/preload/index.js` — expose to renderer:
```js
getSetting: (key) => ipcRenderer.invoke("settings:get", key),
setSetting: (key, value) => ipcRenderer.invoke("settings:set", key, value),
```

### Behavior on Mode Switch

When the user clicks the inactive mode button:

1. Update `state.editor.gameMode` to the new mode
2. Update `_lastGameMode` in-memory variable
3. Write the new mode to disk via `desktopApi.setSetting("lastGameMode", mode)` (fire-and-forget)
4. Run `enforceEditorConsistency()` — this validates current skill/trait selections against the catalog and clears anything invalid
5. Trigger full re-render: skills, traits, equipment, detail panel
6. Mark build as dirty (unsaved changes)
7. Update the toggle UI to reflect the new active state

### Serialization

**Save (`serializeEditorToBuild`):**
```js
build.gameMode = editor.gameMode;  // "pve" or "wvw"
```

**Load (`loadBuildIntoEditor`):**
```js
// Add gameMode to the top-level editor object literal (alongside activeKit, activeWeaponSet, etc.):
gameMode: build.gameMode || "pve",  // backward compat default
```
After loading, sync the toggle UI to reflect the loaded build's mode (update `--active` class on toggle buttons). This can be done by calling a `syncGameModeToggleUI(editor.gameMode)` helper from the load path.

**Import (`parseBuildImportPayload`):**
```js
// Accept gameMode from imported JSON, default to "pve" if absent
gameMode: payload.gameMode || "pve"
```

**Dirty tracking (`computeEditorSignature`):**
The function builds a `payload` object and returns `JSON.stringify(payload)`. Add `gameMode` to the payload:
```js
// Add to the payload object inside computeEditorSignature:
gameMode: String(editor.gameMode || "pve"),
```

### Data Layer Plumbing

**IPC signature change:** The `gameMode` is passed from renderer through preload to the main process catalog fetch.

`src/preload/index.js`:
```js
getProfessionCatalog: (professionId, gameMode) =>
  ipcRenderer.invoke("gw2:get-profession-catalog", professionId, gameMode),
```

`src/main/index.js`:
```js
ipcMain.handle("gw2:get-profession-catalog", async (_e, professionId, gameMode) =>
  getProfessionCatalog(professionId, "en", gameMode)
);
```

**`getProfessionCatalog(professionId, lang, gameMode)` in `catalog.js`:**
- Accept `gameMode` as a third parameter (after existing `lang`)
- Store it on the returned catalog object: `catalog.gameMode = gameMode || "pve"`
- For Phase 1: no changes to actual API calls (same endpoints, same params)
- Phase 2 will use this to pass `?game_mode=` to skill/trait fetches or apply split overrides

**Renderer catalog fetch (`renderer.js`):**
- The `getCatalog(professionId)` function (or equivalent) is updated to also accept `gameMode`: `getCatalog(professionId, gameMode)`
- It passes `gameMode` through to `desktopApi.getProfessionCatalog(professionId, gameMode)`
- Cache key includes game mode: `${professionId}_${gameMode}`
- When game mode changes on an existing build, a new catalog fetch is triggered (cache miss for the new mode key on first switch; cache hit thereafter)
- For Phase 1, PvE and WvW catalogs contain identical data, but the cache structure is ready for Phase 2
- **Phase 1 trade-off:** The background pre-warming loop in `index.js` only warms catalogs without a game mode (effectively "pve"). On first WvW switch for any profession, there will be a full network round-trip. This is acceptable for Phase 1; Phase 2 can optionally pre-warm both modes.
- **Pre-warming loop:** The existing pre-warm call `getProfessionCatalog(id, "en")` in `index.js` is left as-is for Phase 1 (the `gameMode` param defaults to `"pve"` when omitted). No signature breakage.

### Build Library Integration

**Library cards:** Display the game mode as a small badge/tag on each build card (e.g., "PvE" or "WvW" label).

**Search/filter:** Add `build.gameMode || ""` to the haystack array in `matchesBuildQuery()` in `src/renderer/modules/utils.js` so searching "wvw" surfaces WvW builds.

### Build Store Normalization

Add `gameMode` to the `normalizeBuild` function in `buildStore.js` so the field survives save/load:
```js
// In normalizeBuild return object:
gameMode: asString(input.gameMode, 10) || "pve",
```

### Backward Compatibility

- Existing saved builds have no `gameMode` field — they default to `"pve"` on load (via `normalizeBuild` fallback)
- No migration needed; the fallback is applied at load time
- Exported JSON without `gameMode` imports as PvE

### Files Changed

| File | Change |
|------|--------|
| `src/renderer/index.html` | Add game mode toggle markup in `#subnav` |
| `src/renderer/styles/layout.css` | Toggle styling (`.game-mode-toggle`, `.game-mode-toggle__btn`) |
| `src/renderer/modules/state.js` | `gameMode` in `createEmptyEditor()` (new optional param), sticky default init |
| `src/renderer/modules/editor.js` | Serialize/deserialize `gameMode`, include in dirty signature |
| `src/renderer/renderer.js` | Toggle click handler, re-render on switch, sticky write, `getCatalog` signature update |
| `src/renderer/modules/utils.js` | Add `gameMode` to `matchesBuildQuery` haystack |
| `src/renderer/modules/render-pages.js` | Game mode badge on library cards |
| `src/main/gw2Data/catalog.js` | Accept `gameMode` param (3rd arg after `lang`), store on catalog |
| `src/main/index.js` | Update `gw2:get-profession-catalog` handler to pass `gameMode`; add `settings:get`/`settings:set` IPC handlers |
| `src/main/buildStore.js` | Add `settingsPath`, `getSetting()`, `setSetting()` methods |
| `src/preload/index.js` | Add `getSetting`, `setSetting` to `desktopApi`; update `getProfessionCatalog` to pass `gameMode` |

### Edge Cases

- **No profession selected:** Toggle is still functional; mode is stored. When a profession is selected, the catalog fetch uses the current mode.
- **Switching mode with unsaved changes:** Mode switch marks the build dirty. The existing unsaved-changes guard handles navigation away.
- **Rapid toggling:** Each toggle triggers a re-render. No debounce needed — `enforceEditorConsistency` and render are synchronous.
- **Loading a build that was saved with a different mode than the current sticky default:** The build's saved mode takes precedence. The toggle updates to reflect the loaded build's mode. The sticky default is NOT updated when loading a build (only when the user explicitly clicks the toggle).
