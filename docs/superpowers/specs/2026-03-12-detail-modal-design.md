# Detail Modal (Expanded Reference View) Design

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reference panel's attribution text with a fullscreen expand button that opens a native detail modal showing the complete skill/trait record — hero header, facts, and related skills/traits sourced from the GW2 wiki — with profession icons from the `gw2-class-icons` npm package.

**Architecture:** A new `detail-modal.js` module (mirrors `wiki-modal.js` in structure) renders an app-styled, scrollable overlay from in-memory catalog data plus an async wiki related-data fetch. A `profession-icons.js` utility wraps `gw2-class-icons` SVG imports via Vite `?raw` (bypassing the package's Node-only API entirely). The wiki fetch (`getWikiRelatedData`) is added to `src/main/gw2Data/wiki.js` and exposed via a new IPC handler and preload bridge entry.

**Tech Stack:** Electron IPC, MediaWiki parse API, `gw2-class-icons` npm package (SVG via Vite `?raw`), vanilla JS/HTML/CSS (no framework).

---

## File Structure

**Create:**
- `src/renderer/modules/profession-icons.js` — static SVG imports from `gw2-class-icons`, exports `getProfessionSvg(name): string|null`
- `src/renderer/modules/detail-modal.js` — fullscreen detail modal (init, open, close, render)
- `src/renderer/styles/detail-modal.css` — all styles for the modal

**Modify:**
- `package.json` — add `gw2-class-icons` dependency
- `src/main/gw2Data/wiki.js` — add `getWikiRelatedData(title)`
- `src/main/gw2Data/index.js` — export `getWikiRelatedData`
- `src/main/index.js` — import + register `wiki:get-related-data` IPC handler
- `src/preload/index.js` — expose `getWikiRelatedData` on `desktopApi`
- `src/renderer/index.html` — remove attribution `<p>`, add `#detail-expand-btn` to `.section-head`
- `src/renderer/modules/detail-panel.js` — accept `openDetailModal` callback + `expandBtn` domRef; enable/disable button on render
- `src/renderer/renderer.js` — init detail modal, pass `openDetailModal` callback and `expandBtn` domRef to `initDetailPanel`
- `src/renderer/styles.css` — `@import` detail-modal.css

---

## Detailed Design

### 1. `gw2-class-icons` + `profession-icons.js`

Install: `npm i gw2-class-icons`

The package ships SVG files at `gw2-class-icons/wiki/svg/{Name}.svg`. Vite can import these as raw strings with the `?raw` suffix. **The package's `index.js` uses `fs.readdirSync` (Node-only) and cannot be imported in the renderer.** `profession-icons.js` bypasses the package API entirely and imports SVG files directly via Vite static asset resolution:

```js
// src/renderer/modules/profession-icons.js
// Import all SVGs from gw2-class-icons/wiki/svg/ as raw strings via Vite ?raw
import Amalgam       from 'gw2-class-icons/wiki/svg/Amalgam.svg?raw';
import Antiquary     from 'gw2-class-icons/wiki/svg/Antiquary.svg?raw';
import Berserker     from 'gw2-class-icons/wiki/svg/Berserker.svg?raw';
import Bladesworn    from 'gw2-class-icons/wiki/svg/Bladesworn.svg?raw';
import Catalyst      from 'gw2-class-icons/wiki/svg/Catalyst.svg?raw';
import Chronomancer  from 'gw2-class-icons/wiki/svg/Chronomancer.svg?raw';
import Conduit       from 'gw2-class-icons/wiki/svg/Conduit.svg?raw';
import Daredevil     from 'gw2-class-icons/wiki/svg/Daredevil.svg?raw';
import Deadeye       from 'gw2-class-icons/wiki/svg/Deadeye.svg?raw';
import Dragonhunter  from 'gw2-class-icons/wiki/svg/Dragonhunter.svg?raw';
import Druid         from 'gw2-class-icons/wiki/svg/Druid.svg?raw';
import Elementalist  from 'gw2-class-icons/wiki/svg/Elementalist.svg?raw';
import Engineer      from 'gw2-class-icons/wiki/svg/Engineer.svg?raw';
import Evoker        from 'gw2-class-icons/wiki/svg/Evoker.svg?raw';
import Firebrand     from 'gw2-class-icons/wiki/svg/Firebrand.svg?raw';
import Guardian      from 'gw2-class-icons/wiki/svg/Guardian.svg?raw';
import Harbinger     from 'gw2-class-icons/wiki/svg/Harbinger.svg?raw';
import Herald        from 'gw2-class-icons/wiki/svg/Herald.svg?raw';
import Holosmith     from 'gw2-class-icons/wiki/svg/Holosmith.svg?raw';
import Mechanist     from 'gw2-class-icons/wiki/svg/Mechanist.svg?raw';
import Mesmer        from 'gw2-class-icons/wiki/svg/Mesmer.svg?raw';
import Mirage        from 'gw2-class-icons/wiki/svg/Mirage.svg?raw';
import Necromancer   from 'gw2-class-icons/wiki/svg/Necromancer.svg?raw';
import Ranger        from 'gw2-class-icons/wiki/svg/Ranger.svg?raw';
import Reaper        from 'gw2-class-icons/wiki/svg/Reaper.svg?raw';
import Renegade      from 'gw2-class-icons/wiki/svg/Renegade.svg?raw';
import Revenant      from 'gw2-class-icons/wiki/svg/Revenant.svg?raw';
import Ritualist     from 'gw2-class-icons/wiki/svg/Ritualist.svg?raw';
import Scourge       from 'gw2-class-icons/wiki/svg/Scourge.svg?raw';
import Scrapper      from 'gw2-class-icons/wiki/svg/Scrapper.svg?raw';
import Soulbeast     from 'gw2-class-icons/wiki/svg/Soulbeast.svg?raw';
import Specter       from 'gw2-class-icons/wiki/svg/Specter.svg?raw';
import Spellbreaker  from 'gw2-class-icons/wiki/svg/Spellbreaker.svg?raw';
import Tempest       from 'gw2-class-icons/wiki/svg/Tempest.svg?raw';
import Thief         from 'gw2-class-icons/wiki/svg/Thief.svg?raw';
import Untamed       from 'gw2-class-icons/wiki/svg/Untamed.svg?raw';
import Vindicator    from 'gw2-class-icons/wiki/svg/Vindicator.svg?raw';
import Virtuoso      from 'gw2-class-icons/wiki/svg/Virtuoso.svg?raw';
import Warrior       from 'gw2-class-icons/wiki/svg/Warrior.svg?raw';
import Weaver        from 'gw2-class-icons/wiki/svg/Weaver.svg?raw';
import Willbender    from 'gw2-class-icons/wiki/svg/Willbender.svg?raw';

// Note: some names in the package (e.g. Antiquary.old, Luminary.old, Paragon, Gale, Galeshot,
// Troubadour, Luminary) may not have SVG files. Import only confirmed SVGs.
// After `npm i`, verify with: ls node_modules/gw2-class-icons/wiki/svg/

const SVG_MAP = {
  Amalgam, Antiquary, Berserker, Bladesworn, Catalyst, Chronomancer, Conduit,
  Daredevil, Deadeye, Dragonhunter, Druid, Elementalist, Engineer, Evoker,
  Firebrand, Guardian, Harbinger, Herald, Holosmith, Mechanist, Mesmer, Mirage,
  Necromancer, Ranger, Reaper, Renegade, Revenant, Ritualist, Scourge, Scrapper,
  Soulbeast, Specter, Spellbreaker, Tempest, Thief, Untamed, Vindicator, Virtuoso,
  Warrior, Weaver, Willbender,
};

export function getProfessionSvg(name) {
  return SVG_MAP[name] ?? null;
}
```

Usage: inject into an element with `el.innerHTML = getProfessionSvg("Guardian") ?? ""`.

The name passed in is `state.editor.profession` (e.g. `"Guardian"`) or a spec name (e.g. `"Dragonhunter"`) resolved from `catalog.specializations` by spec ID.

---

### 2. `wiki:get-related-data` IPC handler

Added to `src/main/gw2Data/wiki.js`. Uses the same `WIKI_API_ROOT`, `cache`, and `fetchJson` as `getWikiSummary`. Exported from `gw2Data/index.js`, registered in `main/index.js` as `ipcMain.handle("wiki:get-related-data", async (_e, title) => getWikiRelatedData(title))`, and exposed in `preload/index.js` as `getWikiRelatedData: (title) => ipcRenderer.invoke("wiki:get-related-data", title)`.

**Algorithm:**

```
getWikiRelatedData(title):
  1. GET ?action=parse&page={title}&prop=sections&format=json&formatversion=2
  2. Find sections where line matches /^related skills$/i or /^related traits$/i
  3. For each found section:
     GET ?action=parse&page={title}&prop=text&section={index}&format=json&formatversion=2
     (response: { parse: { text: "<html string>" } })
  4. Parse HTML strings (see below)
  5. Return { relatedSkills: [...], relatedTraits: [...] }
  6. Cache under key `wiki-related:{title.toLowerCase()}` for 15 minutes
```

**Actual wiki HTML structure (verified against `Burning_Precision` and `Burning_Retreat`):**

*Related skills section* — contains `<h3>` sub-headings (e.g. "Weapon skills that are improved by this trait") followed by `<ul>` lists. Each `<li>` has this structure:
```html
<li class="filter-list ...">
  <a href="/wiki/Profession"><img alt="Profession icon small.png" .../></a> &#8201;
  <span style="overflow: hidden; ..."><span ...><a href="/wiki/Skill_Name"><img alt="Skill Name" .../></a></span></span>
  &#160;<a href="/wiki/Skill_Name" title="Skill Name">Skill Name</a>&#160;&#8212; Dagger, when attuned to fire
</li>
```

*Related traits section* — contains `<h4>` group headers (spec/element names, e.g. "Fire", "Catalyst") followed by `<ul>` lists. Each `<li>` has:
```html
<li>
  <span class="inline-icon"><a href="/wiki/Trait_Name"><img alt="Trait Name" .../></a></span>
  <a href="/wiki/Trait_Name" title="Trait Name">Trait Name</a>&#32;&#8212; description text with <a>links</a>.
</li>
```

**HTML parsing approach (regex, no DOM):**

For Related skills — extract all `<li>` text links (ignoring image-only links):
```js
// Match the last <a href="/wiki/...">Name</a> before the em-dash in each <li>
const liPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
const namePattern = /<a href="\/wiki\/[^"]*" title="([^"]*)">[^<]+<\/a>/gi;
// For each <li>: collect all name-pattern matches, take the last one as the skill name
// Context = text after the last </a>, strip HTML tags, strip leading &#8212; / — / &#160;
```

For Related traits — split on `<h4>` boundaries first, then apply the same name pattern to each group's `<li>` elements:
```js
// Split html on <h4>...</h4> to get group names and their following content
// Group name: text content of <h4> (strip all HTML tags)
// Items in each group: same <li> pattern as skills
```

Strip HTML tags from context/desc: `str.replace(/<[^>]+>/g, "")` then decode `&#160;` → `" "`, `&#8212;` → `"—"`, `&#32;` → `" "`, `&#8201;` → `" "`.

**Error handling:** Any fetch or parse error returns `{ relatedSkills: [], relatedTraits: [] }` (never throws to the renderer).

---

### 3. Reference Panel HTML change (`index.html`)

Remove:
```html
<p>Skill and trait details pulled from GW2 API + wiki.</p>
```

Add inside `.section-head` (right side):
```html
<button id="detail-expand-btn" class="detail-expand-btn" title="Expand details" disabled>⛶</button>
```

The button is `disabled` by default. When enabled, hover shows the same `.wiki-modal-btn` style.

---

### 4. `detail-panel.js` changes

`initDetailPanel(domRefs, callbacks)` already accepts a `callbacks` object. Additions:

1. Store `callbacks.openDetailModal` as `_openDetailModal`.
2. Store `domRefs.expandBtn` (the `#detail-expand-btn` element, passed in from renderer) as `_expandBtn`. The button is NOT inside `detailHost` — it's in `.section-head` — so it **must** come from `domRefs`, not from a query inside `detailHost`.
3. Add a click listener on `_expandBtn` that calls `_openDetailModal()`. The callback will read `state.detail` and `state.activeCatalog` at call time (see Section 8).
4. In `renderDetailPanel()`, after setting content: `if (_expandBtn) _expandBtn.disabled = !state.detail`.

No changes to `selectDetail` or fact rendering logic.

---

### 5. `detail-modal.js`

Module-level singleton, same init-guard pattern as `wiki-modal.js`.

**`initDetailModal()`** — creates the overlay DOM once, appended to `document.body`:

```html
<div class="detail-modal-overlay detail-modal-overlay--hidden">
  <div class="detail-modal">

    <!-- Toolbar -->
    <div class="detail-modal-toolbar">
      <span class="detail-modal-title" id="dm-title"></span>
      <button class="wiki-modal-btn" id="dm-wiki-btn">Open Wiki Page</button>
      <button class="wiki-modal-btn wiki-modal-btn--close" id="dm-close">&#x2715;</button>
    </div>

    <!-- Scrollable body -->
    <div class="detail-modal-body" id="dm-body">

      <!-- Hero -->
      <div class="dm-hero">
        <img class="dm-hero__icon" id="dm-icon" src="" alt="" />
        <div class="dm-hero__prof-icon" id="dm-prof-icon"></div>
        <div class="dm-hero__text">
          <h2 class="dm-hero__name" id="dm-name"></h2>
          <p class="dm-hero__meta" id="dm-meta"></p>
          <p class="dm-hero__desc" id="dm-desc"></p>
        </div>
      </div>

      <!-- Facts -->
      <section class="dm-section" id="dm-facts-section">
        <h3 class="dm-section__heading">Facts</h3>
        <ul class="dm-facts-grid" id="dm-facts"></ul>
      </section>

      <!-- Related Skills — visible on open, spinner shown while loading -->
      <section class="dm-section dm-section--loading" id="dm-related-skills-section">
        <h3 class="dm-section__heading">Related Skills</h3>
        <div class="dm-spinner" id="dm-skills-spinner"></div>
        <ul class="dm-related-list dm-related-list--hidden" id="dm-related-skills"></ul>
      </section>

      <!-- Related Traits — visible on open, spinner shown while loading -->
      <section class="dm-section dm-section--loading" id="dm-related-traits-section">
        <h3 class="dm-section__heading">Related Traits</h3>
        <div class="dm-spinner" id="dm-traits-spinner"></div>
        <div class="dm-related-list--hidden" id="dm-related-traits"></div>
      </section>

    </div>
  </div>
</div>
```

Loading state: `dm-section--loading` shows the section (so the heading + spinner are visible), spinner is shown, list is hidden. On data load: remove `dm-section--loading`, hide spinner, show list. If section has no data: add `dm-section--hidden` to hide entirely. If wiki fetch fails: hide spinner, show an inline error message string in the list element.

**`openDetailModal(detail, catalog)`** — receives current `state.detail` and `state.activeCatalog` at the moment the button is clicked:

1. **Hero population:**
   - `#dm-icon`: `src = detail.icon`, `onerror` handler for `detail.iconFallback`
   - `#dm-name`: `detail.title`
   - `#dm-meta`: spec name (resolved by finding `catalog.specializations.find(s => s.id === detail.entityId)?.name || detail.kind`) + " · " + `detail.kind`
   - `#dm-desc`: `detail.description` (the in-game description text, not wiki summary)
   - `#dm-prof-icon`: `innerHTML = getProfessionSvg(specName) ?? getProfessionSvg(state.editor.profession) ?? ""`
   - `#dm-title` (toolbar): `detail.title`
2. **Facts:** `#dm-facts.innerHTML = detail.facts.map(f => formatFactHtml(f, dmgStats)).join("")`. `dmgStats` can be passed from state or omitted (pass `null`; `formatFactHtml` handles it).
3. **Wiki button:** `#dm-wiki-btn` href → `detail.wiki.url` (the wiki URL lives at `detail.wiki.url`, not `detail.wikiUrl`).
4. Scroll `#dm-body` to top.
5. Show modal, register Escape handler.
6. Async: `window.desktopApi.getWikiRelatedData(detail.title)` → on resolve, render related items (see Section 6), hide spinners, show lists, mark sections done.

**`closeDetailModal()`** — add `--hidden`, remove Escape handler.

---

### 6. Related items rendering

**Related Skills list item:**
```html
<li class="dm-related-item">
  <img class="dm-related-item__icon" src="{icon}" alt="{name}" onerror="this.style.visibility='hidden'" />
  <span class="dm-related-item__name">{name}</span>
  <span class="dm-related-item__context">{context}</span>
</li>
```

Icon resolution: build `Map<string, {icon}>` from `catalog.skills` (flat array, keyed by `skill.name`). If not found or empty icon, use `<div class="dm-related-item__icon dm-related-item__icon--missing"></div>` instead of `<img>`.

**Related Traits grouped:**
```html
<div class="dm-trait-group">
  <div class="dm-trait-group__header">
    <img class="dm-trait-group__spec-icon" src="{spec.icon}" alt="{groupName}" />
    <span class="dm-trait-group__name">{groupName}</span>
  </div>
  <ul class="dm-related-list">
    <li class="dm-related-item">...</li>
  </ul>
</div>
```

Spec icon resolution: look up `groupName` in `catalog.specializations` (the array field, not `catalog.specs`):
```js
const spec = catalog.specializations.find(s => s.name === groupName);
const specIcon = spec?.icon ?? "";
```
If no match (e.g. attunement groups like "Fire", "Water" which are not specializations), render the group header without an icon.

Trait icon resolution: build `Map<string, {icon}>` from `catalog.traits` keyed by `trait.name`.

---

### 7. `detail-modal.css`

Uses app CSS variables (`--panel`, `--panel-2`, `--line`, `--muted`, `--text`, `--accent-2`, `--danger`, `--radius`).

Key rules:
- `.detail-modal-overlay`: same as `.wiki-modal-overlay` (fixed, inset 0, dark backdrop)
- `.detail-modal`: same as `.wiki-modal` (fixed, inset 24px, flex column)
- `.detail-modal-toolbar`: same as `.wiki-modal-toolbar`
- `.detail-modal-body`: `flex: 1 1 0; min-height: 0; overflow-y: auto; padding: 24px 32px`
- `.dm-hero`: flex row, gap 20px, align-items flex-start, margin-bottom 24px
- `.dm-hero__icon`: 80px × 80px, border-radius var(--radius), flex-shrink 0
- `.dm-hero__prof-icon`: 40px × 40px, flex-shrink 0; SVG inside gets `fill: var(--muted)`
- `.dm-hero__name`: font-size 1.5rem, font-weight 700
- `.dm-hero__meta`: font-size 0.8rem, color var(--muted), margin-top 2px
- `.dm-facts-grid`: display grid, grid-template-columns repeat(2, 1fr), gap 4px 24px
- `.dm-section`: margin-top 28px, padding-top 20px, border-top 1px solid var(--line)
- `.dm-section--hidden`: display none
- `.dm-section--loading .dm-spinner`: display block (spinner visible)
- `.dm-section--loading .dm-related-list`: display none (list hidden)
- `.dm-related-list--hidden`: display none (used on list/container before data loads)
- `.dm-section__heading`: font-size 0.75rem, font-weight 700, text-transform uppercase, letter-spacing 0.1em, color var(--muted), margin-bottom 12px
- `.dm-related-list`: list-style none, padding 0, margin 0, display flex, flex-direction column, gap 6px
- `.dm-related-item`: display flex, align-items center, gap 10px
- `.dm-related-item__icon`: 32px × 32px, border-radius 4px, flex-shrink 0
- `.dm-related-item__icon--missing`: 32px × 32px, border-radius 4px, background var(--panel), border 1px solid var(--line)
- `.dm-related-item__name`: font-weight 600, color var(--text)
- `.dm-related-item__context`: color var(--muted), font-size 0.85rem
- `.dm-trait-group`: margin-bottom 16px
- `.dm-trait-group__header`: display flex, align-items center, gap 8px, margin-bottom 8px
- `.dm-trait-group__spec-icon`: 24px × 24px
- `.dm-trait-group__name`: font-weight 600, color var(--text)
- `.dm-spinner`: 24px × 24px, border 2px solid rgba(255,255,255,0.08), border-top-color var(--accent-2), border-radius 50%, animation wiki-spin 0.7s linear infinite (reuse existing keyframe)
- `.detail-expand-btn`: same border/padding/font as `.wiki-modal-btn`; `&:disabled { opacity: 0.4; cursor: not-allowed; }`

---

### 8. `renderer.js` wiring

```js
import { initDetailModal, openDetailModal } from "./modules/detail-modal.js";

// in init():
initDetailModal();
initDetailPanel(
  { detailHost: el.detailHost, hoverPreview: el.hoverPreview, expandBtn: el.detailExpandBtn },
  {
    openWikiModal,
    // Capture state.detail and state.activeCatalog at click time, not at init time
    openDetailModal: () => openDetailModal(state.detail, state.activeCatalog),
  }
);
```

`state.activeCatalog` is the catalog stored in renderer state after `gw2:get-profession-catalog` resolves. Capturing it at click time (not at `initDetailPanel` call time) ensures the modal always sees the current catalog after profession changes. `getProfessionSvg` is imported in `detail-modal.js` directly (not passed through renderer).

---

### Data contract

`openDetailModal(detail, catalog)` receives:
- `detail` — the existing `state.detail` shape:
  `{ kind, entityId, title, icon, iconFallback, description, facts, hasSplit, wiki: { loading, summary, url } }`
  Note: wiki URL is at `detail.wiki.url`, NOT `detail.wikiUrl`.
- `catalog` — `state.activeCatalog` shape (from catalog.js):
  `{ skills: [...], traits: [...], specializations: [...], ... }`
  Key fields used: `catalog.skills[].name`, `catalog.skills[].icon`, `catalog.traits[].name`, `catalog.traits[].icon`, `catalog.specializations[].id`, `catalog.specializations[].name`, `catalog.specializations[].icon`

---

### Error / empty states

- Wiki fetch fails: hide spinner, show `<p class="dm-related-error">Could not load related data.</p>` inside the section body; keep section visible.
- No related skills/traits in wiki response (empty array): add `dm-section--hidden` to that section.
- Icon not found in catalog: render `.dm-related-item__icon--missing` placeholder div.
- Spec icon not found in `catalog.specializations` (e.g. attunement-based groups "Fire", "Water"): render group header without icon.
- No profession SVG match: `dm-hero__prof-icon` collapses to zero size (no fallback needed).
- Modal opened before any detail selected: button is disabled — this state cannot occur.

---

### Testing

- **`getWikiRelatedData`** (unit, Node): mock `fetchJson`. Test 1: page with "Related skills" section → assert returned `relatedSkills` array contains `{ name, context }` entries. Test 2: page with "Related traits" section → assert `relatedTraits` array has groups with `groupName` and `items`. Test 3: fetch throws → returns `{ relatedSkills: [], relatedTraits: [] }`. Test 4: section not found → returns empty arrays.
- **`profession-icons.js`** (unit): assert `getProfessionSvg("Guardian")` returns a non-empty string containing `<svg`, `getProfessionSvg("Unknown")` returns null.
- **`detail-modal.js`** (unit, jsdom): mock DOM + `window.desktopApi`. Assert `initDetailModal` appends overlay. Assert `openDetailModal` sets `#dm-name`, `#dm-desc`, `#dm-title`. Assert `closeDetailModal` adds `--hidden` and removes Escape handler.
- **Existing tests**: `initDetailPanel` callback-injection tests in `tests/unit/renderer/detail-panel.test.js` remain green with the added `expandBtn` domRef (use `expandBtn: null` in test fixtures, guarded by null check in implementation).
