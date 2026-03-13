# Optional First-Time Setup

**Date:** 2026-03-13
**Status:** Approved

## Problem

The app currently blocks behind a full-screen setup gate that requires GitHub authentication and GitHub Pages setup before the user can access any functionality. This forces users to complete publishing setup before they can even use the build editor.

## Goal

Make the entire setup flow optional. The app opens directly into the build editor. Authentication and publishing setup are available in the titlebar user dropdown when the user is ready.

## Design

### 1. Remove the setup gate

- Delete `renderSetupGate()` function from `render-pages.js`
- Remove `#setupGate` element from `index.html`
- Remove `setupGate: q("#setupGate")` from the DOM element cache in `renderer.js`
- Remove `.setup-gate` / `.gate-*` CSS styles from `detail-panel.css`
- Remove `renderSetupGate()` call from the top-level `render()` function
- Replace `renderSetupGate()` calls inside `runPagesBuildPoll()` and `startLoginFlow()` with `renderOnboarding()` so the dropdown shows live progress for device code and poll status

### 2. Titlebar user area — unauthenticated state

- In `render()` (not `renderAuth()`), when `state.user` is null, set `#titlebarUser` text to **"Sign in"** instead of empty string
- Clicking the workspace button opens the existing dropdown with the login button
- The user icon SVG (generic person silhouette) stays as-is for both states

### 3. Workspace dropdown — progressive setup steps

The `#workspaceMenu` dropdown shows context-dependent content. The `renderOnboarding()` early return on `status.isAuthenticated` (line 106) must be removed and replaced with conditional rendering for all three states below.

**Not authenticated:**
- "Login with GitHub" button (existing, in `renderAuth()`)
- Step 2 (repo/Pages setup) is hidden — only appears after auth
- Device code display shown inline in `#onboarding` when `state.loginFlow.beginData` is set (see UI details below)

**Authenticated, Pages not ready:**
- "Signed in as {login}" label (in `renderAuth()`)
- Target picker dropdown (moved from the deleted gate into `renderOnboarding()`)
- "Setup Publishing" button — triggers repo + Pages setup. This replaces the current "Re-run Setup" label in `renderAuth()` when `!repoReady || !pagesReady`
- Pages poll status shown inline in `#onboarding` when `state.pagesPoll.active` is true (see UI details below)
- "Re-authenticate" / "Log out" buttons (in `renderAuth()`)

**Authenticated, Pages ready:**
- "Signed in as {login}" label
- "Re-run Setup" button (only shown when `repoReady && pagesReady`)
- "Re-authenticate" / "Log out" buttons

**Edge case — dropdown closed during active flow:** Login and Pages poll flows run asynchronously in the background regardless of dropdown visibility. `state.loginFlow.beginData` persists across dropdown open/close, so re-opening the dropdown will restore the device code display. No spinner or external indicator needed — the flow is silent until complete, then `render()` updates the titlebar user label. Note: `renderOnboarding()` calls during active flows will update the DOM inside the hidden dropdown — this is fine, the updates become visible when the user reopens it.

#### Device code display (moved from gate to dropdown)

Rendered inside `renderOnboarding()` when `state.loginFlow.beginData` is set. Uses the existing `status-card` class (already used by onboarding step cards) instead of the deleted `.gate-card` / `.gate-code` classes. Structure:

- A `status-card` article containing:
  - Heading: "GitHub Device Code"
  - Instruction text: "Approve login at GitHub using this code."
  - The user code displayed in a styled `<div>` with `text-align: center; font-size: 1.5rem; font-family: monospace; padding: 0.75rem; background: #060d1d;` (inline or a small new class like `.device-code-display`)
  - A "Copy code" button using `makeButton("Copy code", "secondary", ...)` — click handler calls `window.desktopApi.writeClipboardText()` and briefly changes text to "Copied" (same behavior as the gate version)
  - A link to the verification URI

#### Pages poll status display (moved from gate to dropdown)

Rendered inside `renderOnboarding()` when `state.pagesPoll.active` is true. Uses `status-card` class. Structure:

- A `status-card` article containing:
  - Heading: "Waiting For GitHub Pages"
  - Status text: `"Current status: {formatPagesStatus(status)}"`
  - Error line (if `state.pagesPoll.error`): paragraph with class `error-line`

#### Target picker in dropdown

Rendered inside `renderOnboarding()` for authenticated users when `!repoReady || !pagesReady`. Call `renderTargetPicker(container)` with a dynamically created `<div>` appended to `_el.onboarding`, matching the existing pattern from `renderSetupGate()`.

#### CSS approach

The deleted `.gate-*` classes are not replaced. All moved UI elements reuse the existing `status-card` class (already styled in the codebase). The only new CSS needed is minimal inline styling or a small `.device-code-display` class for the monospace code block. No new stylesheet or major CSS additions required.

### 4. Publish button behavior

The "Publish Static Site" button is always rendered (as today). Add `title` attribute for tooltip (this does not exist currently — new behavior). Disabled states:

- Not logged in: disabled, `title = "Sign in and set up publishing to enable this"`
- Logged in but repo/Pages not ready: disabled, `title = "Set up publishing in the user menu to enable this"`
- Ready (`isAuthenticated && repoReady`): enabled, `title = ""` (cleared)

Note: the existing `canPublish` check (`isAuthenticated && repoReady`) stays as-is. Publishing works once the repo exists — it doesn't need to wait for Pages to finish building. The tooltip for "Pages not ready" covers the case where auth is done but repo setup hasn't been run yet.

### 5. Changes summary

**Deleted:**
- `renderSetupGate()` function from `render-pages.js`
- `#setupGate` DOM element from `index.html`
- `setupGate` entry from the `el` cache in `renderer.js`
- `.setup-gate` / `.gate-*` CSS from `detail-panel.css`

**Moved into workspace dropdown (`renderOnboarding()`):**
- Device code display (login flow UI) — from gate
- Pages poll status indicator — from gate
- Target picker — from gate

**Modified:**
- `render()` in `render-pages.js` — remove `renderSetupGate()` call; set `#titlebarUser` to "Sign in" when `state.user` is null
- `renderOnboarding()` — remove early return on `isAuthenticated`; add conditional rendering for all three auth states; include target picker, device code, and poll status inline
- `renderAuth()` — change "Re-run Setup" label to "Setup Publishing" when `!repoReady || !pagesReady`
- `renderEditorForm()` — add `title` attribute to `publishSiteBtn` based on auth/setup state
- `runPagesBuildPoll()` — replace `renderSetupGate()` calls with `renderOnboarding()`
- `startLoginFlow()` — replace `renderSetupGate()` calls with `renderOnboarding()`

**Unchanged:**
- Main process (`src/main/index.js`) — all IPC handlers remain
- `githubApi.js`, `githubAuth.js` — backend logic unchanged
- `state.js` — state shape unchanged
- `preload/index.js` — API bridge unchanged
