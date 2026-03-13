# Wiki Modal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Open Wiki Page" external link in the detail panel with an in-app fullscreen modal that renders the wiki page using Electron's `<webview>` element.

**Architecture:** A new self-contained `wiki-modal.js` renderer module owns all modal DOM and state. It is initialized once at startup and exposes `openWikiModal(url)` / `closeWikiModal()`. The `initDetailPanel()` call in `renderer.js` is updated to inject `openWikiModal` as a callback, avoiding a circular module dependency.

**Tech Stack:** Electron 37 (`webviewTag`), vanilla JS ES modules, Jest (node env), CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-03-12-wiki-modal-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/index.js` | Modify | Enable `webviewTag: true`; add `will-attach-webview` security guard |
| `src/renderer/modules/wiki-modal.js` | **Create** | Modal DOM, open/close state, URL tracking, loading indicator |
| `src/renderer/modules/detail-panel.js` | Modify | Accept `openWikiModal` callback; swap `<a>` for `<button data-url>`; add delegated click listener once in `initDetailPanel` |
| `src/renderer/styles/wiki-modal.css` | **Create** | All wiki modal styles |
| `src/renderer/styles.css` | Modify | `@import` the new wiki-modal.css |
| `src/renderer/renderer.js` | Modify | Import + call `initWikiModal()`; pass `{ openWikiModal }` to `initDetailPanel` |
| `tests/unit/renderer/detail-panel.test.js` | **Create** | Unit tests for `initDetailPanel` callback injection |

---

## Chunk 1: Main process + detail-panel TDD

### Task 1: Enable `webviewTag` and security guard in main process

**Files:**
- Modify: `src/main/index.js`

- [ ] **Step 1.1: Add `webviewTag: true` to `webPreferences`**

  Open `src/main/index.js`. Find the `webPreferences` object inside `createWindow()` (around line 40). Add `webviewTag: true`:

  ```js
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: true,          // enables <webview> tag in renderer
    // sandbox: false,         // uncomment if webview fails to render; sandbox controls
    //                         // process isolation (not network access), but some Electron
    //                         // versions require sandbox:false for webviewTag to activate
    preload: path.join(__dirname, "../preload/index.js"),
  },
  ```

- [ ] **Step 1.2: Add `will-attach-webview` security handler**

  The `will-attach-webview` event fires on **`webContents`**, not on `app`. Add this handler inside `createWindow()`, immediately after the `const win = new BrowserWindow(...)` declaration:

  ```js
  win.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    // Strip any preload the renderer tries to attach — prevents privilege escalation
    delete webPreferences.preload;
    delete webPreferences.preloadURL;
    // Block any webview whose initial src is not the GW2 wiki
    if (!params.src.startsWith("https://wiki.guildwars2.com/")) {
      event.preventDefault();
    }
  });
  ```

- [ ] **Step 1.3: Commit**

  ```bash
  git add src/main/index.js
  git commit -m "feat: enable webviewTag and add will-attach-webview security guard"
  ```

---

### Task 2: TDD — `initDetailPanel` callback injection

**Files:**
- Create: `tests/unit/renderer/detail-panel.test.js`
- Modify: `src/renderer/modules/detail-panel.js`

- [ ] **Step 2.1: Write the failing tests**

  Create `tests/unit/renderer/detail-panel.test.js`:

  ```js
  "use strict";

  const detailPanel = require("../../../src/renderer/modules/detail-panel");

  function makeDetachHost() {
    return { addEventListener: jest.fn() };
  }

  describe("initDetailPanel — openWikiModal callback injection", () => {
    test("registers a click listener on detailHost", () => {
      const detailHost = makeDetachHost();
      detailPanel.initDetailPanel({ detailHost, hoverPreview: null }, {});
      expect(detailHost.addEventListener).toHaveBeenCalledWith("click", expect.any(Function));
    });

    test("calls openWikiModal with the data-url when a [data-url] element is clicked", () => {
      const openWikiModal = jest.fn();
      const detailHost = makeDetachHost();
      detailPanel.initDetailPanel({ detailHost, hoverPreview: null }, { openWikiModal });

      const [, handler] = detailHost.addEventListener.mock.calls.at(-1);
      const btn = { dataset: { url: "https://wiki.guildwars2.com/wiki/Fireball" } };
      handler({ target: { closest: () => btn } });

      expect(openWikiModal).toHaveBeenCalledWith("https://wiki.guildwars2.com/wiki/Fireball");
    });

    test("does not call openWikiModal when the clicked element has no [data-url]", () => {
      const openWikiModal = jest.fn();
      const detailHost = makeDetachHost();
      detailPanel.initDetailPanel({ detailHost, hoverPreview: null }, { openWikiModal });

      const [, handler] = detailHost.addEventListener.mock.calls.at(-1);
      handler({ target: { closest: () => null } });

      expect(openWikiModal).not.toHaveBeenCalled();
    });

    test("does not throw when no openWikiModal callback is provided", () => {
      const detailHost = makeDetachHost();
      detailPanel.initDetailPanel({ detailHost, hoverPreview: null }, {});

      const [, handler] = detailHost.addEventListener.mock.calls.at(-1);
      const btn = { dataset: { url: "https://wiki.guildwars2.com/wiki/Fireball" } };
      expect(() => handler({ target: { closest: () => btn } })).not.toThrow();
    });
  });
  ```

- [ ] **Step 2.2: Run tests — verify they fail**

  ```bash
  npx jest tests/unit/renderer/detail-panel.test.js --no-coverage
  ```

  Expected: 3–4 failures. `initDetailPanel` currently takes only one argument and adds no click listener.

- [ ] **Step 2.3: Implement the changes in `detail-panel.js`**

  Open `src/renderer/modules/detail-panel.js`.

  **a)** Add a module-level variable after the existing `let _el = ...` line:

  ```js
  let _openWikiModal = null;
  ```

  **b)** Update `initDetailPanel` to accept and store the callback, and register the delegated click listener:

  ```js
  export function initDetailPanel(domRefs, callbacks = {}) {
    _el = { ..._el, ...domRefs };
    _openWikiModal = callbacks.openWikiModal || null;
    _el.detailHost.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-url]");
      if (btn && _openWikiModal) _openWikiModal(btn.dataset.url);
    });
  }
  ```

  **Do NOT swap the `<a>` for `<button>` yet.** The HTML swap happens in Task 5 in the same commit that wires up `openWikiModal` — this ensures the button is never dead in the running app.

- [ ] **Step 2.4: Run tests — verify they pass**

  ```bash
  npx jest tests/unit/renderer/detail-panel.test.js --no-coverage
  ```

  Expected: 4 tests pass.

- [ ] **Step 2.5: Run full test suite — verify nothing regressed**

  ```bash
  npx jest --no-coverage
  ```

  Expected: all existing tests still pass.

- [ ] **Step 2.6: Commit**

  ```bash
  git add tests/unit/renderer/detail-panel.test.js src/renderer/modules/detail-panel.js
  git commit -m "feat: add openWikiModal callback injection to initDetailPanel"
  ```

---

## Chunk 2: Wiki modal module + styles + wiring

### Task 3: Create `wiki-modal.js`

**Files:**
- Create: `src/renderer/modules/wiki-modal.js`

- [ ] **Step 3.1: Create the module**

  Create `src/renderer/modules/wiki-modal.js` with the following content:

  ```js
  // Module-level state — one modal instance for the entire app lifetime
  let _overlay = null;
  let _webview = null;
  let _urlDisplay = null;
  let _currentUrl = "";
  let _escHandler = null;

  export function initWikiModal() {
    _overlay = document.createElement("div");
    _overlay.className = "wiki-modal-overlay wiki-modal-overlay--hidden";
    _overlay.innerHTML = `
      <div class="wiki-modal">
        <div class="wiki-modal-toolbar">
          <span class="wiki-modal-label">Wiki</span>
          <div class="wiki-modal-url" id="wiki-modal-url"></div>
          <button class="wiki-modal-btn" id="wiki-modal-copy">Copy URL</button>
          <button class="wiki-modal-btn wiki-modal-btn--close" id="wiki-modal-close">&#x2715;</button>
        </div>
        <div class="wiki-modal-body">
          <div class="wiki-modal-loading wiki-modal-loading--hidden" id="wiki-modal-loading">Loading&hellip;</div>
          <webview class="wiki-modal-webview" id="wiki-modal-webview" partition="wiki"></webview>
        </div>
      </div>
    `;
    document.body.appendChild(_overlay);

    _webview = document.getElementById("wiki-modal-webview");
    _urlDisplay = document.getElementById("wiki-modal-url");
    const loadingEl = document.getElementById("wiki-modal-loading");

    document.getElementById("wiki-modal-close").addEventListener("click", closeWikiModal);

    document.getElementById("wiki-modal-copy").addEventListener("click", () => {
      if (_currentUrl) window.desktopApi?.writeClipboardText(_currentUrl);
    });

    _webview.addEventListener("did-navigate", (e) => {
      _currentUrl = e.url;
      _urlDisplay.textContent = e.url;
    });

    _webview.addEventListener("did-navigate-in-page", (e) => {
      _currentUrl = e.url;
      _urlDisplay.textContent = e.url;
    });

    _webview.addEventListener("did-start-loading", () => {
      loadingEl.classList.remove("wiki-modal-loading--hidden");
    });

    _webview.addEventListener("did-stop-loading", () => {
      loadingEl.classList.add("wiki-modal-loading--hidden");
    });
  }

  export function openWikiModal(url) {
    _currentUrl = url;
    _urlDisplay.textContent = url;
    if (_webview.src !== url) _webview.src = url; // skip reload if same URL already loaded

    if (!_overlay.classList.contains("wiki-modal-overlay--hidden")) {
      return; // Already visible — webview src updated above if needed;
              // Escape handler is already registered, no need to re-register
    }

    _overlay.classList.remove("wiki-modal-overlay--hidden");
    _escHandler = (e) => { if (e.key === "Escape") closeWikiModal(); };
    document.addEventListener("keydown", _escHandler);
  }

  export function closeWikiModal() {
    _overlay.classList.add("wiki-modal-overlay--hidden");
    if (_escHandler) {
      document.removeEventListener("keydown", _escHandler);
      _escHandler = null;
    }
  }
  ```

- [ ] **Step 3.2: Commit**

  ```bash
  git add src/renderer/modules/wiki-modal.js
  git commit -m "feat: add wiki-modal module with webview, URL tracking, and Escape close"
  ```

---

### Task 4: Add CSS styles

**Files:**
- Create: `src/renderer/styles/wiki-modal.css`
- Modify: `src/renderer/styles.css`

- [ ] **Step 4.1: Create `wiki-modal.css`**

  Create `src/renderer/styles/wiki-modal.css`:

  ```css
  /* Wiki Modal */

  .wiki-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .wiki-modal-overlay--hidden {
    display: none;
  }

  .wiki-modal {
    position: fixed;
    inset: 24px;
    display: flex;
    flex-direction: column;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.7);
    overflow: hidden;
  }

  .wiki-modal-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
  }

  .wiki-modal-label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
    flex-shrink: 0;
    padding-right: 4px;
  }

  .wiki-modal-url {
    flex: 1;
    font-family: "Menlo", "Consolas", monospace;
    font-size: 0.75rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: all;
    min-width: 0;
  }

  .wiki-modal-btn {
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--muted);
    font-family: inherit;
    font-size: 0.78rem;
    padding: 5px 12px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .wiki-modal-btn:hover {
    background: var(--panel);
    color: var(--text);
    border-color: var(--accent-2);
  }

  .wiki-modal-btn--close:hover {
    background: rgba(197, 72, 95, 0.2);
    color: #e07080;
    border-color: var(--danger);
  }

  .wiki-modal-body {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .wiki-modal-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--panel-2);
    color: var(--muted);
    font-size: 0.9rem;
    z-index: 1;
    pointer-events: none;
  }

  .wiki-modal-loading--hidden {
    display: none;
  }

  .wiki-modal-webview {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
  }

  /* "Open Wiki Page" button — styled to look like the former anchor link */
  .wiki-open-btn {
    background: none;
    border: none;
    padding: 0;
    color: #9ac9ff;
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
    text-decoration: underline;
  }

  .wiki-open-btn:hover {
    color: #c8e4ff;
  }
  ```

- [ ] **Step 4.2: Import the new stylesheet**

  Open `src/renderer/styles.css` and add the import at the end:

  ```css
  @import "./styles/wiki-modal.css";
  ```

- [ ] **Step 4.3: Commit**

  ```bash
  git add src/renderer/styles/wiki-modal.css src/renderer/styles.css
  git commit -m "feat: add wiki modal styles"
  ```

---

### Task 5: Wire up `renderer.js`

**Files:**
- Modify: `src/renderer/renderer.js`

- [ ] **Step 5.1: Import `wiki-modal.js` exports**

  Open `src/renderer/renderer.js`. After the last existing `import` block (around line 30), add:

  ```js
  import { initWikiModal, openWikiModal } from "./modules/wiki-modal.js";
  ```

- [ ] **Step 5.2: Call `initWikiModal()` at startup and update `initDetailPanel` call**

  Find the block of `init*` calls (around line 80). Replace the existing `initDetailPanel(...)` call with:

  ```js
  initWikiModal();
  initDetailPanel({ detailHost: el.detailHost, hoverPreview: el.hoverPreview }, { openWikiModal });
  ```

- [ ] **Step 5.3: Swap `<a>` for `<button>` in `detail-panel.js`**

  Now that `openWikiModal` will be live when the app runs, do the HTML swap in `renderDetailPanel`. Find the `wikiLink` variable (around line 75) and replace:

  ```js
  // Before:
  const wikiLink = wiki.url
    ? `<a href="${escapeHtml(wiki.url)}" target="_blank" rel="noreferrer">Open Wiki Page</a>`
    : "";

  // After:
  const wikiLink = wiki.url
    ? `<button class="wiki-open-btn" data-url="${escapeHtml(wiki.url)}">Open Wiki Page</button>`
    : "";
  ```

- [ ] **Step 5.4: Run full test suite — verify nothing broke**

  ```bash
  npx jest --no-coverage
  ```

  Expected: all tests pass.

- [ ] **Step 5.5: Commit**

  ```bash
  git add src/renderer/renderer.js src/renderer/modules/detail-panel.js
  git commit -m "feat: wire up wiki modal — initWikiModal, openWikiModal callback, swap wiki link to button"
  ```

---

### Task 6: Manual smoke test

The webview and DOM interactions can't be unit-tested in the Jest node environment. Verify the following manually by running `npm run dev`:

- [ ] **Step 6.1: Start the app**

  ```bash
  npm run dev
  ```

- [ ] **Step 6.2: Verify the modal opens**

  1. Select any profession and click a skill or trait to populate the detail panel
  2. Click **"Open Wiki Page"** in the detail panel's Wiki section
  3. Expected: the modal overlay appears fullscreen (24px inset), showing the wiki page loading

- [ ] **Step 6.3: Verify URL bar updates**

  1. While the modal is open, click any internal wiki link
  2. Expected: the URL bar updates to the new page's URL

- [ ] **Step 6.4: Verify Copy URL**

  1. Click **"⧉ Copy URL"**
  2. Paste somewhere — expected: the current wiki URL is in the clipboard

- [ ] **Step 6.5: Verify close buttons**

  1. Click **✕** — expected: modal closes
  2. Open the modal again, press **Escape** — expected: modal closes

- [ ] **Step 6.6: Verify re-open with new URL**

  1. Open modal for skill A (wiki page loads)
  2. Without closing, click a different skill in the editor, then click "Open Wiki Page"
  3. Expected: modal stays open but the webview navigates to the new URL and the URL bar updates

- [ ] **Step 6.7: If webview is blank (sandbox issue)**

  If the webview area is blank/empty, open `src/main/index.js` and uncomment `// sandbox: false,` in `webPreferences`, then restart.

  > **Note — `sandbox` attribute on `<webview>`:** The webview element intentionally has no HTML `sandbox` attribute. Adding it would restrict the loaded page (blocking scripts, forms, etc.) and break the GW2 wiki's functionality. Process-level isolation is already provided by Electron's webview guest process and the `will-attach-webview` security guard in the main process.

  > **Note — external link navigation:** The spec explicitly allows the user to navigate to any site within the modal (the webview has no `will-navigate` restriction). This is intentional — see `docs/superpowers/specs/2026-03-12-wiki-modal-design.md` Out of Scope section.

- [ ] **Step 6.8: Final commit (if any fixups were needed)**

  ```bash
  git add -p   # stage only intentional changes
  git commit -m "fix: wiki modal smoke test fixups"
  ```
