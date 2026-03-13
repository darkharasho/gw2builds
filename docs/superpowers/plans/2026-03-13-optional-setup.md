# Optional First-Time Setup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the blocking setup gate so the app opens directly into the editor, with auth and publishing setup available optionally in the titlebar dropdown.

**Architecture:** Remove the full-screen `#setupGate` overlay and its rendering function. Move device code, poll status, and target picker UI into `renderOnboarding()` in the workspace dropdown. Update titlebar to show "Sign in" for unauthenticated users. Add tooltip to publish button based on auth/setup state.

**Tech Stack:** Vanilla JS (Electron renderer), CSS, HTML

**Spec:** `docs/superpowers/specs/2026-03-13-optional-setup-design.md`

---

## Chunk 1: Remove the setup gate and update titlebar

### Task 1: Remove `#setupGate` from HTML and renderer DOM cache

**Files:**
- Modify: `src/renderer/index.html:45`
- Modify: `src/renderer/renderer.js:47`

- [ ] **Step 1: Remove the `#setupGate` element from `index.html`**

Delete line 45:
```html
    <section id="setupGate" class="setup-gate hidden"></section>
```

- [ ] **Step 2: Remove `setupGate` from the DOM element cache in `renderer.js`**

In `renderer.js`, remove from the `el` object:
```js
  setupGate:         q("#setupGate"),
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.html src/renderer/renderer.js
git commit -m "refactor: remove #setupGate DOM element and cache entry"
```

### Task 2: Remove all `renderSetupGate()` references and delete the function

**Files:**
- Modify: `src/renderer/modules/render-pages.js:22-27` (render function)
- Modify: `src/renderer/modules/render-pages.js:167-279` (renderSetupGate function)
- Modify: `src/renderer/modules/render-pages.js:470-494` (runPagesBuildPoll)
- Modify: `src/renderer/modules/render-pages.js:499-512` (startLoginFlow)

All `renderSetupGate()` references must be removed in a single commit to avoid broken intermediate states.

- [ ] **Step 1: Remove `renderSetupGate()` call from `render()` and update titlebar text**

In the `render()` function (line 22-39), remove the call at line 27 and change the empty string to `"Sign in"`:

```js
export function render() {
  hideHoverPreview();
  closeCustomSelect();
  renderAuth();
  renderOnboarding();
  renderBuildList();
  renderEditor();
  // Update titlebar user display
  const titlebarUser = document.querySelector("#titlebarUser");
  if (titlebarUser) {
    titlebarUser.textContent = state.user ? state.user.login : "Sign in";
  }
  if (_el.workspaceBtn) {
    _el.workspaceBtn.title = state.user ? `Workspace (${state.user.login})` : "Workspace (not signed in)";
    _el.workspaceBtn.classList.toggle("titlebar__workspace-btn--active", Boolean(state.user));
  }
}
```

- [ ] **Step 2: Replace `renderSetupGate()` calls in `startLoginFlow()`**

Replace all `renderSetupGate()` calls in `startLoginFlow()` (lines 499-512) with `renderOnboarding()`:

```js
export async function startLoginFlow() {
  state.loginFlow.pending = true;
  state.loginFlow.waitingForApproval = true;
  renderOnboarding();
  try {
    const beginData = await window.desktopApi.beginLogin();
    state.loginFlow.beginData = beginData;
    renderOnboarding();
    await window.desktopApi.completeLogin(beginData);
  } finally {
    state.loginFlow.waitingForApproval = false;
    state.loginFlow.pending = false;
  }
}
```

- [ ] **Step 3: Replace `renderSetupGate()` calls in `runPagesBuildPoll()`**

Replace all `renderSetupGate()` calls in `runPagesBuildPoll()` (lines 470-494) with `renderOnboarding()`:

```js
export async function runPagesBuildPoll() {
  state.pagesPoll.active = true;
  state.pagesPoll.status = "queued";
  state.pagesPoll.error = null;
  renderOnboarding();

  try {
    for (let i = 0; i < 120; i += 1) {
      const poll = await window.desktopApi.pollPagesStatus();
      state.pagesPoll.status = poll.status || "unknown";
      state.pagesPoll.error = poll.error || null;
      renderOnboarding();

      if (poll.ready && poll.pagesUrl) return;
      if (poll.status === "errored" || poll.status === "error") {
        throw new Error(poll.error || "GitHub Pages build failed.");
      }
      await delay(3000);
    }
    throw new Error("Timed out waiting for GitHub Pages to finish building.");
  } finally {
    state.pagesPoll.active = false;
    renderOnboarding();
  }
}
```

- [ ] **Step 4: Delete the entire `renderSetupGate()` function**

Delete lines 167-279 (the `renderSetupGate()` function and its comment block at lines 164-166).

- [ ] **Step 5: Verify the app loads without errors**

Run: `npm run dev`

Expected: App opens directly into the build editor. No setup gate overlay. No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/render-pages.js
git commit -m "refactor: remove renderSetupGate and replace all calls with renderOnboarding"
```

### Task 3: Delete gate CSS styles from `detail-panel.css`

**Files:**
- Modify: `src/renderer/styles/detail-panel.css:81-146`

- [ ] **Step 1: Delete gate CSS rules**

Delete lines 81-146 from `detail-panel.css` — the following rule blocks:
- `.setup-gate` (lines 81-88)
- `.gate-shell` (lines 90-99)
- `.gate-shell h1` (lines 101-105)
- `.gate-shell p` (lines 107-110)
- `.gate-card` (lines 112-117)
- `.gate-card h3` (lines 119-121)
- `.gate-code` (lines 123-133)
- `.gate-link` (lines 135-137)
- `.gate-steps` (lines 139-142)
- `.gate-card--poll` (lines 144-146)

Keep `.error-line` (line 148) and `.target-picker` (line 152) — those are still used.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles/detail-panel.css
git commit -m "refactor: remove unused gate CSS styles"
```

## Chunk 2: Update `renderOnboarding()` with device code, poll status, and target picker

### Task 4: Rewrite `renderOnboarding()` to handle all auth states

**Files:**
- Modify: `src/renderer/modules/render-pages.js:101-162`

- [ ] **Step 1: Replace `renderOnboarding()` with the new implementation**

Replace the entire `renderOnboarding()` function (lines 101-162) with:

```js
export function renderOnboarding() {
  const status = state.onboarding;
  _el.onboarding.innerHTML = "";
  if (!status) return;

  const target = getSelectedTarget();

  // Device code display — shown during active login flow regardless of auth state
  if (state.loginFlow.beginData) {
    const card = document.createElement("article");
    card.className = "status-card";
    const heading = document.createElement("h3");
    heading.textContent = "GitHub Device Code";
    const instruction = document.createElement("p");
    instruction.textContent = "Approve login at GitHub using this code.";

    const codeDisplay = document.createElement("div");
    codeDisplay.style.cssText = "text-align:center;font-size:1.5rem;font-family:monospace;padding:0.75rem;background:#060d1d;border-radius:6px;margin:8px 0;letter-spacing:0.15em;";
    codeDisplay.textContent = state.loginFlow.beginData.userCode || "";

    const copyBtn = makeButton("Copy code", "secondary", async () => {
      await window.desktopApi.writeClipboardText(state.loginFlow.beginData.userCode);
      copyBtn.textContent = "Copied";
      setTimeout(() => { copyBtn.textContent = "Copy code"; }, 1000);
    });

    const link = document.createElement("p");
    link.style.fontSize = "0.85rem";
    const a = document.createElement("a");
    a.href = state.loginFlow.beginData.verificationUri || "";
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = state.loginFlow.beginData.verificationUri || "";
    link.append("Open ", a);

    card.append(heading, instruction, codeDisplay, copyBtn, link);
    _el.onboarding.append(card);
  }

  // Pages poll status — shown during active Pages build poll
  if (state.pagesPoll.active) {
    const card = document.createElement("article");
    card.className = "status-card";
    const heading = document.createElement("h3");
    heading.textContent = "Waiting For GitHub Pages";
    const statusLine = document.createElement("p");
    statusLine.innerHTML = `Current status: <strong>${escapeHtml(formatPagesStatus(state.pagesPoll.status))}</strong>`;
    card.append(heading, statusLine);
    if (state.pagesPoll.error) {
      const errLine = document.createElement("p");
      errLine.className = "error-line";
      errLine.textContent = state.pagesPoll.error;
      card.append(errLine);
    }
    _el.onboarding.append(card);
  }

  // Onboarding steps — only show setup step when authenticated but not fully set up
  if (!status.isAuthenticated) return;

  const repoReady = status.repoReady;
  const pagesReady = status.pagesReady;

  if (!repoReady || !pagesReady) {
    // Target picker
    const pickerContainer = document.createElement("div");
    _el.onboarding.append(pickerContainer);
    renderTargetPicker(pickerContainer);

    // Setup Publishing step card
    const card = document.createElement("article");
    card.className = "status-card";
    const title = document.createElement("h3");
    title.textContent = "Setup Publishing";
    const body = document.createElement("p");
    body.textContent = target ? `Target: ${target.login}` : "Pick a target first.";
    card.append(title, body);

    if (target) {
      const btn = makeButton("Setup Publishing", "primary", async () => {
        try {
          btn.disabled = true;
          await window.desktopApi.setupRepoPages(target.login, target.type);
          await runPagesBuildPoll();
          await _callbacks.refreshOnboardingStatus();
          render();
        } catch (err) {
          showError(err);
        } finally {
          btn.disabled = false;
        }
      });
      btn.classList.add("mt-8");
      card.append(btn);
    }
    _el.onboarding.append(card);
  }
}
```

- [ ] **Step 2: Verify the dropdown shows correct content for unauthenticated state**

Run: `npm run dev`

Expected: Clicking the user icon in the titlebar opens the dropdown. When not logged in, only the "Login with GitHub" button appears (from `renderAuth()`). No setup step cards visible. Titlebar shows "Sign in".

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/render-pages.js
git commit -m "feat: rewrite renderOnboarding for progressive dropdown setup flow"
```

### Task 5: Update `renderAuth()` — conditional "Setup Publishing" vs "Re-run Setup" label

**Files:**
- Modify: `src/renderer/modules/render-pages.js:44-96`

- [ ] **Step 1: Update the setup button label in `renderAuth()`**

In `renderAuth()`, replace the `rerunSetup` button creation (lines 64-73) with:

```js
    const setupReady = status?.repoReady && status?.pagesReady;
    const rerunSetup = makeButton(setupReady ? "Re-run Setup" : "Setup Publishing", "secondary", async () => {
      try {
        if (!target) throw new Error("No target selected.");
        await window.desktopApi.setupRepoPages(target.login, target.type);
        await runPagesBuildPoll();
        await _callbacks.refreshOnboardingStatus();
        render();
      } catch (err) { showError(err); }
    });
    rerunSetup.disabled = !status?.isAuthenticated || !target;
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/render-pages.js
git commit -m "feat: show 'Setup Publishing' label when Pages not yet configured"
```

## Chunk 3: Publish button tooltip and final verification

### Task 6: Add tooltip to publish button based on auth/setup state

**Files:**
- Modify: `src/renderer/modules/render-pages.js:410-417` (renderEditorForm)

- [ ] **Step 1: Update `renderEditorForm()` to set tooltip on publish button**

Replace the publish button logic in `renderEditorForm()` (lines 412-414):

```js
  const status = state.onboarding;
  const canPublish = Boolean(status?.isAuthenticated && status?.repoReady);
  _el.publishSiteBtn.disabled = !canPublish;
```

With:

```js
  const status = state.onboarding;
  const canPublish = Boolean(status?.isAuthenticated && status?.repoReady);
  _el.publishSiteBtn.disabled = !canPublish;
  if (!status?.isAuthenticated) {
    _el.publishSiteBtn.title = "Sign in and set up publishing to enable this";
  } else if (!status?.repoReady) {
    _el.publishSiteBtn.title = "Set up publishing in the user menu to enable this";
  } else {
    _el.publishSiteBtn.title = "";
  }
```

- [ ] **Step 2: Verify tooltip appears on hover when not authenticated**

Run: `npm run dev`

Expected: Hovering over the disabled "Publish Static Site" button shows the tooltip "Sign in and set up publishing to enable this".

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/render-pages.js
git commit -m "feat: add tooltip to publish button explaining setup requirement"
```

### Task 7: Final manual verification

- [ ] **Step 1: Full flow verification**

Run: `npm run dev`

Verify the following:
1. App opens directly into the build editor — no setup gate
2. Titlebar shows "Sign in" with user icon when not logged in
3. Clicking the user icon opens dropdown with "Login with GitHub" button
4. No setup step cards visible when not authenticated
5. Publish button is disabled with tooltip when not logged in
6. All editor functionality works: profession selection, specializations, skills, equipment, save/load builds
7. No console errors

- [ ] **Step 2: Commit all changes if any uncommitted**

```bash
git status
# If clean, skip. Otherwise:
git add -A && git commit -m "chore: final cleanup for optional setup flow"
```
