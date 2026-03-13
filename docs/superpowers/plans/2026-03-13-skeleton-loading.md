# Skeleton Loading Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Facebook-style skeleton loading placeholders that show a pulsing silhouette of each panel while GW2 API data loads, replacing blank empty space.

**Architecture:** Hybrid approach — static skeleton HTML pre-populated in `index.html` for instant first paint, plus a `skeleton.js` module that can re-inject skeletons before subsequent fetches (profession switch, game mode toggle). Existing render functions clear skeletons automatically via `innerHTML = ...`. A 150ms CSS `animation-delay` prevents flashes on warm-cache loads.

**Tech Stack:** HTML, CSS (keyframe animations, clip-path), vanilla JS modules

**Spec:** `docs/superpowers/specs/2026-03-13-skeleton-loading-design.md`

---

## Chunk 1: CSS + JS Module + Tests

### Task 1: Create skeleton CSS

**Files:**
- Create: `src/renderer/styles/skeleton.css`
- Modify: `src/renderer/styles.css` (add import)

- [ ] **Step 1: Create `skeleton.css` with pulse animation and shape classes**

```css
/* AxiForge — skeleton loading placeholders */

@keyframes skel-pulse {
  0%   { opacity: 0; }
  50%  { opacity: 1; }
  100% { opacity: 0; }
}

.skel {
  background: #1a2744;
  border-radius: 4px;
  animation: skel-pulse 1.8s ease-in-out infinite;
  animation-delay: 150ms;
  opacity: 0;
  animation-fill-mode: both;
}

/* Hexagonal shape — matches specializations.css minor trait clip-path */
.skel-hex {
  clip-path: polygon(25% 5%, 75% 5%, 96% 50%, 75% 95%, 25% 95%, 4% 50%);
  border-radius: 0;
}

/* Staggered delays (50ms increments, added to base 150ms) */
.skel-d1 { animation-delay: 200ms; }
.skel-d2 { animation-delay: 250ms; }
.skel-d3 { animation-delay: 300ms; }
.skel-d4 { animation-delay: 350ms; }
.skel-d5 { animation-delay: 400ms; }

/* ── Skill bar skeleton ──────────────────────────────────────────────────── */
.skel-skills {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 8px;
}

.skel-skills__group {
  display: flex;
  gap: 6px;
}

.skel-skills__slot {
  width: 44px;
  height: 44px;
  border-radius: 6px;
}

.skel-skills__sep {
  width: 1px;
  height: 44px;
  background: #1a2744;
  flex-shrink: 0;
}

/* ── Specialization skeleton ─────────────────────────────────────────────── */
.skel-specs {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.skel-spec-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid #1a2744;
  border-radius: 8px;
}

.skel-spec-card__emblem {
  width: calc(40px * var(--spec-scale, 1.1));
  height: calc(40px * var(--spec-scale, 1.1));
  flex-shrink: 0;
}

.skel-spec-card__traits {
  display: flex;
  gap: 10px;
  flex: 1;
  align-items: center;
}

.skel-spec-card__major {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}

.skel-spec-card__major-trait {
  width: calc(32px * var(--spec-scale, 1.1));
  height: calc(32px * var(--spec-scale, 1.1));
  border-radius: 4px;
}

.skel-spec-card__minor {
  width: calc(26px * var(--spec-scale, 1.1));
  height: calc(26px * var(--spec-scale, 1.1));
}

.skel-spec-card__line {
  width: 16px;
  height: 1px;
  background: #1a2744;
  flex-shrink: 0;
}

/* ── Equipment skeleton ──────────────────────────────────────────────────── */
.skel-equip {
  display: flex;
  gap: 16px;
}

.skel-equip__col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skel-equip__col--art {
  flex: 0.8;
  display: flex;
  align-items: center;
  justify-content: center;
}

.skel-equip__slot {
  display: flex;
  gap: 8px;
  align-items: center;
}

.skel-equip__slot-icon {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  flex-shrink: 0;
}

.skel-equip__slot-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.skel-equip__art {
  width: 100%;
  height: 180px;
  border-radius: 8px;
}

.skel-equip__stat-row {
  display: flex;
  justify-content: space-between;
}

.skel-equip__trinket-grid {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.skel-equip__trinket {
  width: 40px;
  height: 40px;
  border-radius: 6px;
}

/* ── Detail panel skeleton ───────────────────────────────────────────────── */
.skel-detail__header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.skel-detail__icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  flex-shrink: 0;
}

.skel-detail__text-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.skel-detail__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}

.skel-detail__fact-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.skel-detail__fact-icon {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ── Toolbar profession dropdown skeleton ────────────────────────────────── */
.skel-dropdown {
  height: 32px;
  border-radius: 6px;
  width: 100%;
}
```

- [ ] **Step 2: Add import to `styles.css`**

In `src/renderer/styles.css`, add at the end:

```css
@import "./styles/skeleton.css";
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/skeleton.css src/renderer/styles.css
git commit -m "feat: add skeleton loading CSS with pulse animation"
```

---

### Task 2: Create skeleton JS module with HTML templates

**Files:**
- Create: `src/renderer/modules/skeleton.js`
- Create: `tests/unit/renderer/skeleton.test.js`

- [ ] **Step 1: Write tests for `skeleton.js`**

```js
"use strict";

const { skeletonTemplates, injectSkeleton } = require("../../../src/renderer/modules/skeleton");

describe("skeletonTemplates", () => {
  test("exports templates for all five panels", () => {
    expect(skeletonTemplates).toHaveProperty("skills");
    expect(skeletonTemplates).toHaveProperty("specs");
    expect(skeletonTemplates).toHaveProperty("equipment");
    expect(skeletonTemplates).toHaveProperty("detail");
    expect(skeletonTemplates).toHaveProperty("dropdown");
  });

  test("each template is a non-empty string containing skel class", () => {
    for (const [key, html] of Object.entries(skeletonTemplates)) {
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain("skel");
    }
  });

  test("skills template contains weapon and mechanic groups", () => {
    expect(skeletonTemplates.skills).toContain("skel-skills__group");
    expect(skeletonTemplates.skills).toContain("skel-skills__sep");
  });

  test("specs template contains 3 spec cards with hex emblems", () => {
    const matches = skeletonTemplates.specs.match(/skel-spec-card__emblem/g);
    expect(matches).toHaveLength(3);
    expect(skeletonTemplates.specs).toContain("skel-hex");
  });

  test("specs template has major (square) and minor (hex) traits", () => {
    expect(skeletonTemplates.specs).toContain("skel-spec-card__major-trait");
    expect(skeletonTemplates.specs).toContain("skel-spec-card__minor");
  });

  test("equipment template contains 3-column layout", () => {
    expect(skeletonTemplates.equipment).toContain("skel-equip__col--art");
    expect(skeletonTemplates.equipment).toContain("skel-equip__slot-icon");
    expect(skeletonTemplates.equipment).toContain("skel-equip__trinket");
  });

  test("detail template has icon+text fact rows", () => {
    expect(skeletonTemplates.detail).toContain("skel-detail__fact-row");
    expect(skeletonTemplates.detail).toContain("skel-detail__fact-icon");
  });
});

describe("injectSkeleton", () => {
  test("sets innerHTML of element to the named template", () => {
    const el = { innerHTML: "" };
    injectSkeleton(el, "skills");
    expect(el.innerHTML).toBe(skeletonTemplates.skills);
  });

  test("does nothing if element is null", () => {
    expect(() => injectSkeleton(null, "skills")).not.toThrow();
  });

  test("does nothing if template name is unknown", () => {
    const el = { innerHTML: "existing" };
    injectSkeleton(el, "nonexistent");
    expect(el.innerHTML).toBe("existing");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=skeleton`
Expected: FAIL — module not found

- [ ] **Step 3: Create `skeleton.js` with HTML templates**

```js
// ── Skeleton HTML templates ─────────────────────────────────────────────────
// Each template mirrors the real panel structure with pulsing placeholder shapes.
// The 150ms animation-delay on .skel prevents flashes on warm-cache loads.

function slot(extraClass = "", delay = "") {
  const d = delay ? ` skel-d${delay}` : "";
  return `<div class="skel skel-skills__slot${extraClass}${d}"></div>`;
}

function specCard(delayOffset) {
  const d = (n) => { const v = (delayOffset + n) % 6; return v === 0 ? "" : ` skel-d${v}`; };
  const majorCol = (base) => `
    <div class="skel-spec-card__major">
      <div class="skel skel-spec-card__major-trait${d(base)}"></div>
      <div class="skel skel-spec-card__major-trait${d(base + 1)}"></div>
      <div class="skel skel-spec-card__major-trait${d(base + 2)}"></div>
    </div>`;
  const minor = (n) => `
    <div class="skel skel-hex skel-spec-card__minor${d(n)}"></div>`;
  return `
  <div class="skel-spec-card">
    <div class="skel skel-hex skel-spec-card__emblem${d(0)}"></div>
    <div class="skel-spec-card__traits">
      <div class="skel-spec-card__line"></div>
      ${majorCol(1)}
      <div class="skel-spec-card__line"></div>
      ${minor(2)}
      <div class="skel-spec-card__line"></div>
      ${majorCol(3)}
      <div class="skel-spec-card__line"></div>
      ${minor(4)}
      <div class="skel-spec-card__line"></div>
      ${majorCol(5)}
    </div>
  </div>`;
}

function equipSlot(delay) {
  const d = delay ? ` skel-d${delay}` : "";
  const d2 = delay ? ` skel-d${Math.min(delay + 1, 5)}` : " skel-d1";
  return `
  <div class="skel-equip__slot">
    <div class="skel skel-equip__slot-icon${d}"></div>
    <div class="skel-equip__slot-lines">
      <div class="skel${d}" style="height:8px;width:60%"></div>
      <div class="skel${d2}" style="height:7px;width:40%"></div>
    </div>
  </div>`;
}

const skeletonTemplates = {
  skills: `
<div class="skel-skills">
  <div class="skel-skills__group">
    ${slot("", "")}${slot("", "1")}${slot("", "2")}${slot("", "3")}${slot("", "4")}
  </div>
  <div class="skel-skills__sep"></div>
  <div class="skel-skills__group">
    ${slot("", "")}${slot("", "1")}${slot("", "2")}${slot("", "3")}${slot("", "4")}
  </div>
  <div class="skel-skills__sep"></div>
  <div class="skel-skills__group">
    ${slot("", "")}${slot("", "1")}${slot("", "2")}${slot("", "3")}
  </div>
</div>`,

  specs: `
<div class="skel-specs">
  ${specCard(0)}
  ${specCard(1)}
  ${specCard(2)}
</div>`,

  equipment: `
<div class="skel-equip">
  <div class="skel-equip__col">
    <div class="skel skel-d1" style="height:8px;width:50px"></div>
    ${equipSlot(1)}${equipSlot(2)}${equipSlot(3)}${equipSlot(4)}${equipSlot(5)}${equipSlot(1)}
  </div>
  <div class="skel-equip__col--art">
    <div class="skel skel-equip__art skel-d2"></div>
  </div>
  <div class="skel-equip__col">
    <div class="skel skel-d2" style="height:8px;width:60px"></div>
    <div class="skel-equip__stat-row"><div class="skel skel-d2" style="height:8px;width:45%"></div><div class="skel skel-d3" style="height:8px;width:25%"></div></div>
    <div class="skel-equip__stat-row"><div class="skel skel-d3" style="height:8px;width:50%"></div><div class="skel skel-d4" style="height:8px;width:20%"></div></div>
    <div class="skel-equip__stat-row"><div class="skel skel-d4" style="height:8px;width:40%"></div><div class="skel skel-d5" style="height:8px;width:22%"></div></div>
    <div class="skel-equip__stat-row"><div class="skel" style="height:8px;width:48%"></div><div class="skel skel-d1" style="height:8px;width:18%"></div></div>
    <div class="skel-equip__stat-row"><div class="skel skel-d1" style="height:8px;width:42%"></div><div class="skel skel-d2" style="height:8px;width:24%"></div></div>
    <div class="skel-equip__trinket-grid">
      <div class="skel skel-equip__trinket skel-d3"></div>
      <div class="skel skel-equip__trinket skel-d4"></div>
      <div class="skel skel-equip__trinket skel-d5"></div>
      <div class="skel skel-equip__trinket skel-d1"></div>
    </div>
    <div class="skel-equip__trinket-grid">
      <div class="skel skel-equip__trinket skel-d2"></div>
      <div class="skel skel-equip__trinket skel-d3"></div>
      <div class="skel skel-equip__trinket skel-d4"></div>
    </div>
  </div>
</div>`,

  detail: `
<div>
  <div class="skel-detail__header">
    <div class="skel skel-detail__icon"></div>
    <div class="skel-detail__text-group">
      <div class="skel skel-d1" style="height:12px;width:70%"></div>
      <div class="skel skel-d2" style="height:10px;width:40%"></div>
    </div>
  </div>
  <div class="skel-detail__section">
    <div class="skel skel-d1" style="height:8px;width:50%"></div>
    <div class="skel skel-d2" style="height:8px;width:90%"></div>
    <div class="skel skel-d3" style="height:8px;width:75%"></div>
  </div>
  <div class="skel-detail__section">
    <div class="skel skel-d2" style="height:8px;width:35%"></div>
    <div class="skel-detail__fact-row"><div class="skel skel-detail__fact-icon skel-d3"></div><div class="skel skel-d3" style="height:8px;width:70%"></div></div>
    <div class="skel-detail__fact-row"><div class="skel skel-detail__fact-icon skel-d4"></div><div class="skel skel-d4" style="height:8px;width:55%"></div></div>
    <div class="skel-detail__fact-row"><div class="skel skel-detail__fact-icon skel-d5"></div><div class="skel skel-d5" style="height:8px;width:65%"></div></div>
    <div class="skel-detail__fact-row"><div class="skel skel-detail__fact-icon skel-d1"></div><div class="skel skel-d1" style="height:8px;width:50%"></div></div>
  </div>
</div>`,

  dropdown: `<div class="skel skel-dropdown"></div>`,
};

function injectSkeleton(el, templateName) {
  if (!el) return;
  const html = skeletonTemplates[templateName];
  if (!html) return;
  el.innerHTML = html;
}

export { skeletonTemplates, injectSkeleton };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=skeleton`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/skeleton.js tests/unit/renderer/skeleton.test.js
git commit -m "feat: add skeleton loading JS module with templates and tests"
```

---

## Chunk 2: HTML Static Skeletons + Integration

### Task 3: Pre-populate static skeletons in HTML

**Files:**
- Modify: `src/renderer/index.html` (lines 85, 112, 121, 129, 136)

> **Note:** The root `index.html` is a build artifact — do not edit it manually. The build process propagates changes from `src/renderer/index.html`.

The skeleton module generates HTML from JS helper functions, so for the static HTML in `index.html`, use the same output. The simplest approach: run `node -e "console.log(require('./src/renderer/modules/skeleton').skeletonTemplates.skills)"` etc. to get the exact HTML, then paste into each host element.

- [ ] **Step 1: Add skeleton HTML to `#professionSelect` in `src/renderer/index.html`**

Replace the empty `<div id="professionSelect"></div>` (line 85) with:

```html
<div id="professionSelect"><div class="skel skel-dropdown"></div></div>
```

- [ ] **Step 2: Add skeleton HTML to `#skillsHost`**

Replace the empty `<div id="skillsHost" class="skills-host"></div>` (line 112) with `#skillsHost` containing the skills skeleton template output.

Run: `node -e "console.log(require('./src/renderer/modules/skeleton').skeletonTemplates.skills)"` and paste the output inside the div.

- [ ] **Step 3: Add skeleton HTML to `#specializationsHost`**

Replace the empty `<div id="specializationsHost" class="specializations-host"></div>` (line 121) with `#specializationsHost` containing the specs skeleton template output.

Run: `node -e "console.log(require('./src/renderer/modules/skeleton').skeletonTemplates.specs)"` and paste the output inside the div.

- [ ] **Step 4: Add skeleton HTML to `#detailHost`**

Replace the empty `<div id="detailHost" class="detail-host"></div>` (line 129) with `#detailHost` containing the detail skeleton template output.

Run: `node -e "console.log(require('./src/renderer/modules/skeleton').skeletonTemplates.detail)"` and paste the output inside the div.

- [ ] **Step 5: Add skeleton HTML to `#equipmentPanel`**

Replace the empty `<div id="equipmentPanel"></div>` (line 136) with `#equipmentPanel` containing the equipment skeleton template output.

Run: `node -e "console.log(require('./src/renderer/modules/skeleton').skeletonTemplates.equipment)"` and paste the output inside the div.

- [ ] **Step 6: Run tests to verify nothing broke**

Run: `npm test`
Expected: All 754+ tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/index.html
git commit -m "feat: add static skeleton placeholders to HTML for instant first paint"
```

---

### Task 4: Wire `injectSkeleton` into `renderer.js`

**Files:**
- Modify: `src/renderer/renderer.js` (lines 347, 575-630)

- [ ] **Step 1: Import skeleton module at top of renderer.js**

Add near the other module imports at the top of `src/renderer/renderer.js`:

```js
import { injectSkeleton } from "./modules/skeleton.js";
```

- [ ] **Step 2: Inject skeletons before profession catalog fetch in `setProfession()`**

In `src/renderer/renderer.js`, in the `setProfession` function (line 347), add skeleton injection before the `getCatalog` call:

```js
async function setProfession(professionId, options = {}) {
  const selected = String(professionId || "");
  if (!selected) return;

  // Show skeleton placeholders while catalog loads
  injectSkeleton(el.skillsHost, "skills");
  injectSkeleton(el.specializationsHost, "specs");
  injectSkeleton(el.equipmentPanel, "equipment");
  injectSkeleton(el.detailHost, "detail");

  const catalog = await getCatalog(selected, state.editor.gameMode || "pve");
  // ... rest unchanged
```

- [ ] **Step 3: Inject skeletons before game mode toggle catalog fetch**

In the game mode toggle handler (~line 586), add skeleton injection **inside** the `if (state.editor.profession)` block, before the `getCatalog` call:

```js
        if (state.editor.profession) {
          // Show skeleton placeholders while catalog loads
          injectSkeleton(el.skillsHost, "skills");
          injectSkeleton(el.specializationsHost, "specs");
          injectSkeleton(el.equipmentPanel, "equipment");
          injectSkeleton(el.detailHost, "detail");

          const catalog = await getCatalog(state.editor.profession, mode);
          // ... rest unchanged
```

> **Note:** The `dropdown` skeleton is only used for the static first paint in `index.html`. The profession dropdown is populated once at init and does not reload on profession/mode changes, so `injectSkeleton(el, "dropdown")` is not called here.

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/renderer.js
git commit -m "feat: inject skeleton placeholders before data fetches"
```

---

### Task 5: Manual verification

- [ ] **Step 1: Run the app and verify first-launch skeletons**

Run: `npm start`

On launch, the skill bar, specializations, equipment, detail panel, and profession dropdown should show pulsing skeleton placeholders that smoothly fade in and then get replaced by real content when data arrives.

- [ ] **Step 2: Verify profession switch skeletons**

Switch professions using the dropdown. Panels should briefly show skeletons while the new catalog loads (or not show at all if the catalog is cached — the 150ms delay prevents flashes).

- [ ] **Step 3: Verify game mode toggle skeletons**

Toggle between PvE and WvW. Same behavior as profession switch.

- [ ] **Step 4: Run full test suite one final time**

Run: `npm test`
Expected: All tests PASS
