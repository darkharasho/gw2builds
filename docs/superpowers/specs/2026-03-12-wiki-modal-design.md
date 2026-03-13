# Wiki Modal — Design Spec

**Date:** 2026-03-12
**Status:** Approved

## Overview

Replace the "Open Wiki Page" external link in the detail panel with an in-app modal that renders the wiki page using an Electron `<webview>`. The modal is almost fullscreen, shows the current URL in a read-only bar with a copy button, and closes via an ✕ button or the Escape key.

## Requirements

- Clicking "Open Wiki Page" opens the modal instead of launching an external browser window
- Modal is nearly fullscreen (small inset from the app edges)
- Toolbar contains: "Wiki" label · URL bar (read-only, updates as the webview navigates) · Copy URL button · ✕ close button
- Escape key also closes the modal
- Copy URL button writes the current webview URL to the clipboard via the existing `desktopApi.writeClipboardText`
- The wiki page renders fully (GW2 wiki sets `X-Frame-Options: SAMEORIGIN`; `<webview>` bypasses this)
- Calling `openWikiModal(url)` while the modal is already open updates the webview and URL bar to the new URL (no duplicate overlay)

## Out of Scope

- Back/forward navigation buttons
- Page title display (toolbar label stays "Wiki")
- Intercepting external links inside the webview — users may freely navigate to any site within the modal
- Focus trap / ARIA modal accessibility

## Architecture

### 1. `src/main/index.js`

**a)** Add `webviewTag: true` to the `webPreferences` object in `createWindow()`. In Electron 20+ the default for `sandbox` may be `true`; if the webview element fails to render, also add `sandbox: false`:

```js
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  webviewTag: true,          // ← add
  // sandbox: false,         // ← uncomment if webview does not render (Electron 20+ sandbox default)
  preload: path.join(__dirname, "../preload/index.js"),
}
```

**b)** Register a `will-attach-webview` handler on `app` to strip any preload from the webview and block any `src` that is not on `https://wiki.guildwars2.com/`. The guard calls `event.preventDefault()` when the src is **not** the allowed origin — this cancels the attach for disallowed URLs. This prevents a compromised renderer script from attaching a webview with a privileged preload:

```js
app.on("will-attach-webview", (event, webPreferences, params) => {
  // Strip any preload the renderer tries to attach
  delete webPreferences.preload;
  delete webPreferences.preloadURL;
  // Block any src that is NOT the GW2 wiki (prevent() cancels the attach)
  if (!params.src.startsWith("https://wiki.guildwars2.com/")) {
    event.preventDefault();
  }
});
```

### 2. `src/renderer/modules/wiki-modal.js` (new file)

Self-contained module. Creates modal DOM once on `initWikiModal()` and appends to `document.body`.

**Module-level state:**
```js
let _overlay = null;
let _webview = null;
let _urlDisplay = null;
let _currentUrl = "";
let _escHandler = null;   // stored so removeEventListener works correctly
```

**Exports:**
- `initWikiModal()` — creates and appends DOM, wires up static event listeners (close button, copy button, webview navigation events)
- `openWikiModal(url)` — if modal already visible just updates src; otherwise shows overlay. Always: sets `_currentUrl = url`, updates URL display immediately (before first navigation event fires), sets `webview.src = url`, registers `_escHandler`
- `closeWikiModal()` — hides overlay, removes `_escHandler` via the stored reference

**Escape key pattern** (stored reference required for correct removal):
```js
_escHandler = (e) => { if (e.key === "Escape") closeWikiModal(); };
document.addEventListener("keydown", _escHandler);
// on close:
document.removeEventListener("keydown", _escHandler);
_escHandler = null;
```

**URL tracking:** `webview` fires `did-navigate` and `did-navigate-in-page`; both handlers update `_urlDisplay.textContent` and `_currentUrl`.

**Loading indicator:** `webview` fires `did-start-loading` → show a loading overlay inside the modal body; `did-stop-loading` → hide it.

**Copy:** `desktopApi.writeClipboardText(_currentUrl)`.

**`partition="wiki"`** (non-persistent, in-memory) — the wiki is a read-only reference, no need for persistent session storage.

**DOM structure:**
```html
<div id="wiki-modal-overlay" class="wiki-modal-overlay wiki-modal-overlay--hidden">
  <div class="wiki-modal">
    <div class="wiki-modal-toolbar">
      <span class="wiki-modal-label">Wiki</span>
      <div class="wiki-modal-url" id="wiki-modal-url"></div>
      <button class="wiki-modal-btn" id="wiki-modal-copy">⧉ Copy URL</button>
      <button class="wiki-modal-btn wiki-modal-btn--close" id="wiki-modal-close">✕</button>
    </div>
    <div class="wiki-modal-body">
      <div class="wiki-modal-loading wiki-modal-loading--hidden" id="wiki-modal-loading">Loading…</div>
      <webview class="wiki-modal-webview" id="wiki-modal-webview" partition="wiki"></webview>
    </div>
  </div>
</div>
```

### 3. `src/renderer/modules/detail-panel.js`

Replace the `<a href="..." target="_blank">` anchor with a `<button>`:

```html
<!-- before -->
<a href="${escapeHtml(wiki.url)}" target="_blank" rel="noreferrer">Open Wiki Page</a>

<!-- after -->
<button class="wiki-open-btn" data-url="${escapeHtml(wiki.url)}">Open Wiki Page</button>
```

To avoid a circular ES module dependency (`detail-panel.js` ↔ `wiki-modal.js`, both imported by `renderer.js`), `openWikiModal` is **not imported** into `detail-panel.js`. Instead it is injected as a callback via `initDetailPanel()`. The delegated click listener is registered **once** inside `initDetailPanel()` (not inside `renderDetailPanel()`, which is called multiple times and would stack duplicate listeners):

```js
// detail-panel.js
let _el = { detailHost: null, hoverPreview: null };
let _openWikiModal = null;

export function initDetailPanel(domRefs, callbacks = {}) {
  _el = { ..._el, ...domRefs };
  _openWikiModal = callbacks.openWikiModal || null;
  // delegated handler — added once, survives innerHTML re-renders
  _el.detailHost.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-url]");
    if (btn && _openWikiModal) _openWikiModal(btn.dataset.url);
  });
}
```

In `renderer.js`, the call becomes:
```js
initDetailPanel({ detailHost, hoverPreview }, { openWikiModal });
```
```

### 4. `src/renderer/styles.css`

New rules for:
- `.wiki-modal-overlay` — `position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.72); display: flex; align-items: center; justify-content: center`
- `.wiki-modal-overlay--hidden` — `display: none`
- `.wiki-modal` — `position: fixed; inset: 24px; display: flex; flex-direction: column; background: (app dark); border: 1px solid (app border); border-radius: 8px; box-shadow: 0 24px 64px rgba(0,0,0,0.7); overflow: hidden`
- `.wiki-modal-toolbar` — `display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid (app border); flex-shrink: 0`
- `.wiki-modal-label` — small caps, gold accent color matching app theme
- `.wiki-modal-url` — `flex: 1; font-family: monospace; color: muted; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: all`
- `.wiki-modal-btn` — consistent with app secondary button style; `--close` variant with red-tinted hover
- `.wiki-modal-body` — `flex: 1; position: relative; overflow: hidden`
- `.wiki-modal-loading` — centered spinner/text overlay inside `.wiki-modal-body`; `--hidden` hides it
- `.wiki-modal-webview` — `width: 100%; height: 100%; border: none; display: block`

### 5. `src/renderer/renderer.js`

Import `initWikiModal` from `./modules/wiki-modal.js` and call it during startup alongside the other `init*` calls.

## Data Flow

```
User clicks "Open Wiki Page"
  → delegated click on detailHost (registered once in initDetailPanel)
    → openWikiModal(url)
      → _currentUrl = url; URL bar updated immediately
      → if hidden: show overlay
      → webview.src = url
      → _escHandler registered on document

webview fires did-start-loading
  → loading indicator shown

webview fires did-navigate / did-navigate-in-page
  → _currentUrl and URL bar updated

webview fires did-stop-loading
  → loading indicator hidden

User clicks Copy URL
  → desktopApi.writeClipboardText(_currentUrl)

User clicks ✕ or presses Escape
  → closeWikiModal()
    → overlay hidden
    → document.removeEventListener("keydown", _escHandler)
    → _escHandler = null
```

## Files Changed

| File | Change |
|------|--------|
| `src/main/index.js` | Add `webviewTag: true` to `webPreferences`; add `will-attach-webview` security handler |
| `src/renderer/modules/wiki-modal.js` | **New** — modal component |
| `src/renderer/modules/detail-panel.js` | Swap `<a>` for `<button data-url>`; move delegated click to `initDetailPanel` |
| `src/renderer/styles.css` | New modal styles |
| `src/renderer/renderer.js` | Import and call `initWikiModal()` |
