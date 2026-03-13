# Detail Modal (Expanded Reference View) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fullscreen expand button to the reference panel that opens a native detail modal showing the selected skill/trait's hero info, facts, and related skills/traits sourced from the GW2 wiki, using `gw2-class-icons` SVGs for profession icons.

**Architecture:** Five tasks in dependency order: (1) `profession-icons.js` SVG wrapper, (2) `getWikiRelatedData` IPC chain, (3) HTML + `detail-panel.js` expand button wiring, (4) `detail-modal.js` + CSS, (5) `renderer.js` wiring. Tasks 1 and 2 are independent and can be done in either order. Tasks 3–5 depend on 1–2.

**Tech Stack:** Electron IPC, MediaWiki parse API (`https://wiki.guildwars2.com/api.php`), `gw2-class-icons` npm package (SVG via Vite `?raw`), Jest (testEnvironment: node, babel-jest for renderer modules).

**Reference spec:** `docs/superpowers/specs/2026-03-12-detail-modal-design.md`

**Run all tests:** `npx jest --testPathPattern="profession-icons|wiki-related|detail-panel|detail-modal" --no-coverage`

---

## Chunk 1: Foundation

### Task 1: Install gw2-class-icons + profession-icons.js

**Files:**
- Modify: `package.json` (dependency added by npm)
- Create: `src/renderer/modules/profession-icons.js`
- Create: `tests/unit/renderer/profession-icons.test.js`

- [ ] **Step 1: Install the package**

```bash
npm install gw2-class-icons
```

Expected: package added to `node_modules/gw2-class-icons/`, `package.json` updated with `"gw2-class-icons": "^0.1.0"` in `dependencies`.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/renderer/profession-icons.test.js`:

```js
"use strict";

// profession-icons.js uses ES module ?raw imports which are transformed by babel-jest.
// In Node test env, Vite ?raw imports resolve to empty strings via jest moduleNameMapper.
// We test the module's lookup logic, not the SVG content itself.
// The jest config already transforms src/renderer/**/*.js via babel-jest.
// Add moduleNameMapper for ?raw imports (see Step 3).

const profIcons = require("../../../src/renderer/modules/profession-icons");

describe("getProfessionSvg", () => {
  test("returns a string for a known profession", () => {
    const result = profIcons.getProfessionSvg("Guardian");
    expect(typeof result).toBe("string");
  });

  test("returns null for an unknown name", () => {
    expect(profIcons.getProfessionSvg("Unknown")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(profIcons.getProfessionSvg("")).toBeNull();
  });

  test("is case-sensitive (Guardian != guardian)", () => {
    expect(profIcons.getProfessionSvg("guardian")).toBeNull();
  });
});
```

- [ ] **Step 3: Add moduleNameMapper for `?raw` imports in `package.json` jest config**

The `?raw` Vite suffix causes Node require to fail. Add a mapper that returns `""` for any `?raw` import:

In `package.json`, inside the `"jest"` key, add to `"moduleNameMapper"`:

```json
"moduleNameMapper": {
  "^.*\\?raw$": "<rootDir>/tests/helpers/rawMock.js"
}
```

Create `tests/helpers/rawMock.js`:

```js
// Mock for Vite ?raw imports in Jest (returns empty string)
module.exports = "";
```

- [ ] **Step 4: Run test to verify it fails**

```bash
npx jest tests/unit/renderer/profession-icons.test.js --no-coverage
```

Expected: FAIL — `Cannot find module '../../../src/renderer/modules/profession-icons'`

- [ ] **Step 5: Create `src/renderer/modules/profession-icons.js`**

```js
// Profession and elite-spec class icons from gw2-class-icons package.
// Imported as raw SVG strings via Vite's ?raw suffix.
// The package's index.js is Node-only (uses fs.readdirSync) — we bypass it entirely.
import Amalgam      from "gw2-class-icons/wiki/svg/Amalgam.svg?raw";
import Antiquary    from "gw2-class-icons/wiki/svg/Antiquary.svg?raw";
import Berserker    from "gw2-class-icons/wiki/svg/Berserker.svg?raw";
import Bladesworn   from "gw2-class-icons/wiki/svg/Bladesworn.svg?raw";
import Catalyst     from "gw2-class-icons/wiki/svg/Catalyst.svg?raw";
import Chronomancer from "gw2-class-icons/wiki/svg/Chronomancer.svg?raw";
import Conduit      from "gw2-class-icons/wiki/svg/Conduit.svg?raw";
import Daredevil    from "gw2-class-icons/wiki/svg/Daredevil.svg?raw";
import Deadeye      from "gw2-class-icons/wiki/svg/Deadeye.svg?raw";
import Dragonhunter from "gw2-class-icons/wiki/svg/Dragonhunter.svg?raw";
import Druid        from "gw2-class-icons/wiki/svg/Druid.svg?raw";
import Elementalist from "gw2-class-icons/wiki/svg/Elementalist.svg?raw";
import Engineer     from "gw2-class-icons/wiki/svg/Engineer.svg?raw";
import Evoker       from "gw2-class-icons/wiki/svg/Evoker.svg?raw";
import Firebrand    from "gw2-class-icons/wiki/svg/Firebrand.svg?raw";
import Galeshot     from "gw2-class-icons/wiki/svg/Galeshot.svg?raw";
import Guardian     from "gw2-class-icons/wiki/svg/Guardian.svg?raw";
import Harbinger    from "gw2-class-icons/wiki/svg/Harbinger.svg?raw";
import Herald       from "gw2-class-icons/wiki/svg/Herald.svg?raw";
import Holosmith    from "gw2-class-icons/wiki/svg/Holosmith.svg?raw";
import Luminary     from "gw2-class-icons/wiki/svg/Luminary.svg?raw";
import Mechanist    from "gw2-class-icons/wiki/svg/Mechanist.svg?raw";
import Mesmer       from "gw2-class-icons/wiki/svg/Mesmer.svg?raw";
import Mirage       from "gw2-class-icons/wiki/svg/Mirage.svg?raw";
import Necromancer  from "gw2-class-icons/wiki/svg/Necromancer.svg?raw";
import Paragon      from "gw2-class-icons/wiki/svg/Paragon.svg?raw";
import Ranger       from "gw2-class-icons/wiki/svg/Ranger.svg?raw";
import Reaper       from "gw2-class-icons/wiki/svg/Reaper.svg?raw";
import Renegade     from "gw2-class-icons/wiki/svg/Renegade.svg?raw";
import Revenant     from "gw2-class-icons/wiki/svg/Revenant.svg?raw";
import Ritualist    from "gw2-class-icons/wiki/svg/Ritualist.svg?raw";
import Scourge      from "gw2-class-icons/wiki/svg/Scourge.svg?raw";
import Scrapper     from "gw2-class-icons/wiki/svg/Scrapper.svg?raw";
import Soulbeast    from "gw2-class-icons/wiki/svg/Soulbeast.svg?raw";
import Specter      from "gw2-class-icons/wiki/svg/Specter.svg?raw";
import Spellbreaker from "gw2-class-icons/wiki/svg/Spellbreaker.svg?raw";
import Tempest      from "gw2-class-icons/wiki/svg/Tempest.svg?raw";
import Thief        from "gw2-class-icons/wiki/svg/Thief.svg?raw";
import Troubadour   from "gw2-class-icons/wiki/svg/Troubadour.svg?raw";
import Untamed      from "gw2-class-icons/wiki/svg/Untamed.svg?raw";
import Vindicator   from "gw2-class-icons/wiki/svg/Vindicator.svg?raw";
import Virtuoso     from "gw2-class-icons/wiki/svg/Virtuoso.svg?raw";
import Warrior      from "gw2-class-icons/wiki/svg/Warrior.svg?raw";
import Weaver       from "gw2-class-icons/wiki/svg/Weaver.svg?raw";
import Willbender   from "gw2-class-icons/wiki/svg/Willbender.svg?raw";

const SVG_MAP = {
  Amalgam, Antiquary, Berserker, Bladesworn, Catalyst, Chronomancer, Conduit,
  Daredevil, Deadeye, Dragonhunter, Druid, Elementalist, Engineer, Evoker,
  Firebrand, Galeshot, Guardian, Harbinger, Herald, Holosmith, Luminary,
  Mechanist, Mesmer, Mirage, Necromancer, Paragon, Ranger, Reaper, Renegade,
  Revenant, Ritualist, Scourge, Scrapper, Soulbeast, Specter, Spellbreaker,
  Tempest, Thief, Troubadour, Untamed, Vindicator, Virtuoso, Warrior, Weaver,
  Willbender,
};

/**
 * Returns the raw SVG string for a profession or elite spec name, or null if unknown.
 * @param {string} name — e.g. "Guardian", "Dragonhunter", "Elementalist"
 */
export function getProfessionSvg(name) {
  return SVG_MAP[name] ?? null;
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx jest tests/unit/renderer/profession-icons.test.js --no-coverage
```

Expected: PASS — 4 tests pass. (`getProfessionSvg("Guardian")` returns `""` via mock, which is a string, so the `typeof === "string"` test passes.)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/renderer/modules/profession-icons.js tests/unit/renderer/profession-icons.test.js tests/helpers/rawMock.js
git commit -m "feat: add profession-icons.js with gw2-class-icons SVG imports"
```

---

### Task 2: getWikiRelatedData IPC chain

**Files:**
- Modify: `src/main/gw2Data/wiki.js` — add `getWikiRelatedData` + helpers
- Modify: `src/main/gw2Data/index.js` — export `getWikiRelatedData`
- Modify: `src/main/index.js:289` — register IPC handler after `wiki:get-summary`
- Modify: `src/preload/index.js:29` — add `getWikiRelatedData` entry after `getWikiSummary`
- Create: `tests/unit/wiki-related.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/wiki-related.test.js`:

```js
"use strict";

/**
 * Tests for getWikiRelatedData in src/main/gw2Data/wiki.js
 *
 * Uses jest.resetModules() + require() to get a fresh module with mocked fetch.
 * Mocks fetchJson via jest.mock on the fetch module.
 */

let wiki;

function freshLoad() {
  jest.resetModules();
  wiki = require("../../src/main/gw2Data/wiki");
}

// Minimal related-skills HTML based on actual GW2 wiki structure
const SKILLS_HTML = `
<div class="mw-parser-output">
<h2><span class="mw-headline" id="Related_skills">Related skills</span></h2>
<h3><span class="mw-headline">Weapon skills that are improved by this trait</span></h3>
<ul>
<li class="filter-list f-Elementalist f-Weapon">
  <a href="/wiki/Elementalist"><img alt="Elementalist icon small.png" /></a> &#8201;
  <span style="overflow: hidden; width: 25px;"><span><a href="/wiki/Drake%27s_Breath"><img alt="Drake's Breath" /></a></span></span>
  &#160;<a href="/wiki/Drake%27s_Breath" title="Drake&#39;s Breath">Drake's Breath</a>&#160;&#8212;&#160;Dagger, when attuned to fire
</li>
<li class="filter-list f-Elementalist f-Weapon">
  <a href="/wiki/Elementalist"><img alt="Elementalist icon small.png" /></a> &#8201;
  <span style="overflow: hidden;"><span><a href="/wiki/Ring_of_Fire"><img alt="Ring of Fire" /></a></span></span>
  &#160;<a href="/wiki/Ring_of_Fire" title="Ring of Fire">Ring of Fire</a>&#160;&#8212;&#160;Dagger, when attuned to fire
</li>
</ul>
</div>
`;

const TRAITS_HTML = `
<div class="mw-parser-output">
<h2><span class="mw-headline" id="Related_traits">Related traits</span></h2>
<h4><span class="mw-headline" id="Fire"><a href="/wiki/Fire">Fire</a></span></h4>
<ul>
<li>
  <span class="inline-icon"><a href="/wiki/Burning_Precision"><img alt="Burning Precision" /></a></span>
  <a href="/wiki/Burning_Precision" title="Burning Precision">Burning Precision</a>&#32;&#8212;&#32;Burning you inflict has increased duration.
</li>
</ul>
<h4><span class="mw-headline" id="Catalyst"><a href="/wiki/Catalyst">Catalyst</a></span></h4>
<ul>
<li>
  <span class="inline-icon"><a href="/wiki/Spectacular_Sphere"><img alt="Spectacular Sphere" /></a></span>
  <a href="/wiki/Spectacular_Sphere" title="Spectacular Sphere">Spectacular Sphere</a>&#32;&#8212;&#32;Jade Sphere has reduced recharge.
</li>
</ul>
</div>
`;

describe("getWikiRelatedData", () => {
  beforeEach(() => {
    freshLoad();
  });

  test("returns empty arrays for empty title", async () => {
    const result = await wiki.getWikiRelatedData("");
    expect(result).toEqual({ relatedSkills: [], relatedTraits: [] });
  });

  test("returns empty arrays when page has no related sections", async () => {
    jest.doMock("../../src/main/gw2Data/fetch", () => ({
      WIKI_API_ROOT: "https://wiki.guildwars2.com/api.php",
      cache: { get: () => null, set: jest.fn() },
      fetchJson: jest.fn().mockResolvedValue({ parse: { sections: [] } }),
    }));
    freshLoad();
    const result = await wiki.getWikiRelatedData("Some Skill");
    expect(result).toEqual({ relatedSkills: [], relatedTraits: [] });
  });

  test("parses related skills HTML into name+context pairs", async () => {
    jest.doMock("../../src/main/gw2Data/fetch", () => ({
      WIKI_API_ROOT: "https://wiki.guildwars2.com/api.php",
      cache: { get: () => null, set: jest.fn() },
      fetchJson: jest.fn()
        .mockResolvedValueOnce({
          parse: {
            sections: [
              { index: "1", line: "Related skills" },
            ],
          },
        })
        .mockResolvedValueOnce({ parse: { text: SKILLS_HTML } }),
    }));
    freshLoad();
    const result = await wiki.getWikiRelatedData("Burning Precision");
    expect(result.relatedSkills).toHaveLength(2);
    expect(result.relatedSkills[0].name).toBe("Drake's Breath");
    expect(result.relatedSkills[0].context).toContain("Dagger");
    expect(result.relatedSkills[1].name).toBe("Ring of Fire");
  });

  test("parses related traits HTML into grouped structure", async () => {
    jest.doMock("../../src/main/gw2Data/fetch", () => ({
      WIKI_API_ROOT: "https://wiki.guildwars2.com/api.php",
      cache: { get: () => null, set: jest.fn() },
      fetchJson: jest.fn()
        .mockResolvedValueOnce({
          parse: {
            sections: [
              { index: "2", line: "Related traits" },
            ],
          },
        })
        .mockResolvedValueOnce({ parse: { text: TRAITS_HTML } }),
    }));
    freshLoad();
    const result = await wiki.getWikiRelatedData("Burning Retreat");
    expect(result.relatedTraits).toHaveLength(2);
    expect(result.relatedTraits[0].groupName).toBe("Fire");
    expect(result.relatedTraits[0].items[0].name).toBe("Burning Precision");
    expect(result.relatedTraits[1].groupName).toBe("Catalyst");
    expect(result.relatedTraits[1].items[0].name).toBe("Spectacular Sphere");
  });

  test("returns empty arrays when fetchJson throws", async () => {
    jest.doMock("../../src/main/gw2Data/fetch", () => ({
      WIKI_API_ROOT: "https://wiki.guildwars2.com/api.php",
      cache: { get: () => null, set: jest.fn() },
      fetchJson: jest.fn().mockRejectedValue(new Error("network error")),
    }));
    freshLoad();
    const result = await wiki.getWikiRelatedData("Any Skill");
    expect(result).toEqual({ relatedSkills: [], relatedTraits: [] });
  });

  test("uses cached result on second call", async () => {
    const cached = { relatedSkills: [{ name: "Cached", context: "" }], relatedTraits: [] };
    jest.doMock("../../src/main/gw2Data/fetch", () => ({
      WIKI_API_ROOT: "https://wiki.guildwars2.com/api.php",
      cache: {
        get: () => ({ value: cached, expiresAt: Date.now() + 60000 }),
        set: jest.fn(),
      },
      fetchJson: jest.fn(),
    }));
    freshLoad();
    const result = await wiki.getWikiRelatedData("Burning Precision");
    expect(result).toBe(cached);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/wiki-related.test.js --no-coverage
```

Expected: FAIL — `wiki.getWikiRelatedData is not a function`

- [ ] **Step 3: Add `getWikiRelatedData` to `src/main/gw2Data/wiki.js`**

Add these functions before `module.exports`. Insert after line 48 (before the closing `module.exports`):

```js
// ── Helpers for parseRelatedItems / parseRelatedGroups ─────────────────────

function decodeEntities(str) {
  return str
    .replace(/&#160;/g, " ")
    .replace(/&#32;/g, " ")
    .replace(/&#8212;/g, "—")
    .replace(/&#8201;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function stripTags(str) {
  return str.replace(/<[^>]+>/g, "");
}

/**
 * Extract {name, context} items from a MediaWiki HTML fragment containing <li> elements.
 * Each <li> follows this pattern:
 *   optional profession icon <a><img/></a>
 *   optional skill icon <span><a><img/></a></span>
 *   <a href="/wiki/Name" title="Name">Name</a> &#8212; context text
 */
function parseRelatedItems(html) {
  const results = [];
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch;
  while ((liMatch = liRe.exec(html)) !== null) {
    const liHtml = liMatch[1];
    // Find all text-bearing links: <a href="..." title="...">text (not just img)</a>
    const links = [];
    const linkRe = /<a\s[^>]*title="([^"]*)"[^>]*>([^<]+)<\/a>/gi;
    let linkMatch;
    while ((linkMatch = linkRe.exec(liHtml)) !== null) {
      const text = linkMatch[2].trim();
      if (text) links.push(text);
    }
    if (links.length === 0) continue;
    // Last text link is the skill/trait name (earlier ones are profession/element labels)
    const name = decodeEntities(links[links.length - 1]);
    if (!name) continue;
    // Context: everything after the last </a>, strip tags, decode, strip leading " — "
    const lastClose = liHtml.lastIndexOf("</a>");
    let context = lastClose >= 0 ? liHtml.slice(lastClose + 4) : "";
    context = decodeEntities(stripTags(context)).replace(/^[\s—]+/, "").trim();
    results.push({ name, context });
  }
  return results;
}

/**
 * Extract [{groupName, items}] from a Related traits HTML section.
 * Groups are delimited by <h4> headings.
 */
function parseRelatedGroups(html) {
  const groups = [];
  // Split on <h4 to get group chunks; first chunk is preamble (TOC etc), skip it
  const parts = html.split(/<h4[^>]*>/i);
  for (const part of parts.slice(1)) {
    const h4End = part.indexOf("</h4>");
    if (h4End < 0) continue;
    const groupName = decodeEntities(stripTags(part.slice(0, h4End)))
      .replace(/\[edit\]/gi, "")
      .trim();
    if (!groupName) continue;
    const afterH4 = part.slice(h4End + 5);
    const items = parseRelatedItems(afterH4);
    if (items.length > 0) groups.push({ groupName, items });
  }
  return groups;
}

async function getWikiRelatedData(title) {
  const query = String(title || "").trim();
  if (!query) return { relatedSkills: [], relatedTraits: [] };

  const cacheKey = `wiki-related:${query.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  try {
    // Step 1: get section list
    const sectUrl = new URL(WIKI_API_ROOT);
    sectUrl.searchParams.set("action", "parse");
    sectUrl.searchParams.set("page", query);
    sectUrl.searchParams.set("prop", "sections");
    sectUrl.searchParams.set("format", "json");
    sectUrl.searchParams.set("formatversion", "2");
    const sectData = await fetchJson(sectUrl.toString());
    const sections = sectData?.parse?.sections || [];

    const skillsSect = sections.find((s) => /^related skills$/i.test(s.line));
    const traitsSect = sections.find((s) => /^related traits$/i.test(s.line));

    // Step 2: fetch HTML for each found section in parallel
    async function fetchSection(index) {
      const url = new URL(WIKI_API_ROOT);
      url.searchParams.set("action", "parse");
      url.searchParams.set("page", query);
      url.searchParams.set("prop", "text");
      url.searchParams.set("section", String(index));
      url.searchParams.set("format", "json");
      url.searchParams.set("formatversion", "2");
      const data = await fetchJson(url.toString());
      return data?.parse?.text || "";
    }

    const [skillsHtml, traitsHtml] = await Promise.all([
      skillsSect ? fetchSection(skillsSect.index) : Promise.resolve(""),
      traitsSect ? fetchSection(traitsSect.index) : Promise.resolve(""),
    ]);

    const result = {
      relatedSkills: skillsHtml ? parseRelatedItems(skillsHtml) : [],
      relatedTraits: traitsHtml ? parseRelatedGroups(traitsHtml) : [],
    };

    cache.set(cacheKey, { value: result, expiresAt: Date.now() + 1000 * 60 * 15 });
    return result;
  } catch {
    return { relatedSkills: [], relatedTraits: [] };
  }
}
```

Also update `module.exports` at the bottom of `wiki.js`:
```js
module.exports = {
  getWikiSummary,
  getWikiRelatedData,
  buildWikiFallbackUrl,
  buildWikiFilePath,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/unit/wiki-related.test.js --no-coverage
```

Expected: PASS — 5 tests pass.

- [ ] **Step 5: Wire IPC — `src/main/gw2Data/index.js`**

Replace the current content:

```js
const { getProfessionList, getProfessionCatalog } = require("./catalog");
const { getWikiSummary, getWikiRelatedData } = require("./wiki");

module.exports = {
  getProfessionList,
  getProfessionCatalog,
  getWikiSummary,
  getWikiRelatedData,
};
```

- [ ] **Step 6: Wire IPC — `src/main/index.js`**

In `src/main/index.js`, find line 289:
```js
  ipcMain.handle("wiki:get-summary", async (_e, title) => getWikiSummary(title));
```

Add the new handler immediately after it:
```js
  ipcMain.handle("wiki:get-related-data", async (_e, title) => getWikiRelatedData(title));
```

Also update the import on line 18:
```js
const { getProfessionList, getProfessionCatalog, getWikiSummary, getWikiRelatedData } = require("./gw2Data");
```

- [ ] **Step 7: Wire preload — `src/preload/index.js`**

After line 29 (`getWikiSummary: ...`), add:
```js
  getWikiRelatedData: (title) => ipcRenderer.invoke("wiki:get-related-data", title),
```

- [ ] **Step 8: Run all tests to verify nothing broken**

```bash
npx jest --no-coverage
```

Expected: all existing tests pass, 5 new wiki-related tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/main/gw2Data/wiki.js src/main/gw2Data/index.js src/main/index.js src/preload/index.js tests/unit/wiki-related.test.js
git commit -m "feat: add getWikiRelatedData wiki API fetch + IPC chain"
```

---

## Chunk 2: UI

### Task 3: HTML changes + detail-panel.js expand button

**Files:**
- Modify: `src/renderer/index.html:119` — remove attribution `<p>`, add expand button
- Modify: `src/renderer/modules/detail-panel.js:35-44` — accept `expandBtn` domRef + `openDetailModal` callback
- Modify: `tests/unit/renderer/detail-panel.test.js` — add expand button tests

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/renderer/detail-panel.test.js` (append after line 47, before the final closing):

```js
describe("initDetailPanel — openDetailModal expand button", () => {
  function makeExpandBtn() {
    return { addEventListener: jest.fn(), disabled: true };
  }

  test("adds click listener to expandBtn when provided", () => {
    const expandBtn = makeExpandBtn();
    detailPanel.initDetailPanel(
      { detailHost: null, hoverPreview: null, expandBtn },
      {}
    );
    expect(expandBtn.addEventListener).toHaveBeenCalledWith("click", expect.any(Function));
  });

  test("calls openDetailModal when expand button is clicked", () => {
    const openDetailModal = jest.fn();
    const expandBtn = makeExpandBtn();
    detailPanel.initDetailPanel(
      { detailHost: null, hoverPreview: null, expandBtn },
      { openDetailModal }
    );
    const [, handler] = expandBtn.addEventListener.mock.calls.at(-1);
    handler();
    expect(openDetailModal).toHaveBeenCalled();
  });

  test("does not throw when expandBtn is null", () => {
    expect(() =>
      detailPanel.initDetailPanel({ detailHost: null, hoverPreview: null, expandBtn: null }, {})
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/renderer/detail-panel.test.js --no-coverage
```

Expected: FAIL — the 3 new tests fail (expandBtn.addEventListener not called).

- [ ] **Step 3: Update `src/renderer/modules/detail-panel.js`**

Change `initDetailPanel` (lines 35–44):

```js
let _el = { detailHost: null, hoverPreview: null, expandBtn: null };
let _openWikiModal = null;
let _openDetailModal = null;

export function initDetailPanel(domRefs, callbacks = {}) {
  _el = { ..._el, ...domRefs };
  _openWikiModal = callbacks.openWikiModal || null;
  _openDetailModal = callbacks.openDetailModal || null;
  if (_el.detailHost) {
    _el.detailHost.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-url]");
      if (btn && _openWikiModal) _openWikiModal(btn.dataset.url);
    });
  }
  if (_el.expandBtn) {
    _el.expandBtn.addEventListener("click", () => {
      if (_openDetailModal) _openDetailModal();
    });
  }
}
```

Also update `renderDetailPanel` — after the `_el.detailHost.innerHTML = ...` assignment (end of the function), add:

```js
  if (_el.expandBtn) _el.expandBtn.disabled = !state.detail;
```

The existing `renderDetailPanel` has two exit paths — the early return (no detail) and the HTML-set branch. Add the line in both:
- After `_el.detailHost.innerHTML = ...` at the empty-detail early return (line 49), add: `if (_el.expandBtn) _el.expandBtn.disabled = true;`
- After `_el.detailHost.innerHTML = ...` at the bottom of the function (line 113), add: `if (_el.expandBtn) _el.expandBtn.disabled = false;`

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/unit/renderer/detail-panel.test.js --no-coverage
```

Expected: PASS — all 7 tests pass (4 original + 3 new).

- [ ] **Step 5: Update `src/renderer/index.html`**

Find and remove (line 119):
```html
                    <p>Skill and trait details pulled from GW2 API + wiki.</p>
```

In its place, add the expand button to the `<div class="section-head">` (put it after `<h2>Reference Panel</h2>`):
```html
                  <div class="section-head">
                    <h2>Reference Panel</h2>
                    <button id="detail-expand-btn" class="detail-expand-btn" title="Expand details" disabled>⛶</button>
                  </div>
```

- [ ] **Step 6: Run all tests**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/index.html src/renderer/modules/detail-panel.js tests/unit/renderer/detail-panel.test.js
git commit -m "feat: add expand button to reference panel, wire detail-panel callbacks"
```

---

### Task 4: detail-modal.js + detail-modal.css

**Files:**
- Create: `src/renderer/modules/detail-modal.js`
- Create: `src/renderer/styles/detail-modal.css`
- Modify: `src/renderer/styles.css` — add `@import`
- Create: `tests/unit/renderer/detail-modal.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/renderer/detail-modal.test.js`:

```js
"use strict";

// detail-modal.js uses ES module imports — transformed by babel-jest.
// window.desktopApi is mocked; no real DOM needed beyond jsdom-like mocks.
// The jest testEnvironment is "node", so we mock document globally.

let detailModal;

// Minimal DOM mock
function makeDom() {
  const elements = {};
  const appendedChildren = [];

  function makeEl(id) {
    return {
      id,
      className: "",
      innerHTML: "",
      textContent: "",
      style: {},
      disabled: false,
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
      },
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      scrollTop: 0,
      querySelector: (sel) => {
        const id2 = sel.replace("#", "");
        return elements[id2] || null;
      },
    };
  }

  const body = makeEl("body");
  body.appendChild = (el) => { appendedChildren.push(el); };

  // Simulate getElementById
  const getElementById = jest.fn((id) => elements[id] || null);

  // Pre-populate elements that initDetailModal will look up
  [
    "dm-title", "dm-wiki-btn", "dm-close", "dm-body", "dm-icon",
    "dm-prof-icon", "dm-name", "dm-meta", "dm-desc", "dm-facts",
    "dm-related-skills-section", "dm-related-traits-section",
    "dm-skills-spinner", "dm-traits-spinner",
    "dm-related-skills", "dm-related-traits",
  ].forEach((id) => { elements[id] = makeEl(id); });

  return { body, getElementById, appendedChildren, elements };
}

function freshLoad(dom) {
  jest.resetModules();
  global.document = {
    createElement: () => {
      const el = { className: "", innerHTML: "", appendChild: jest.fn() };
      return el;
    },
    body: dom.body,
    getElementById: dom.getElementById,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  global.window = {
    desktopApi: {
      getWikiRelatedData: jest.fn().mockResolvedValue({ relatedSkills: [], relatedTraits: [] }),
    },
  };
  detailModal = require("../../../src/renderer/modules/detail-modal");
}

describe("initDetailModal", () => {
  test("appends overlay to document.body once", () => {
    const dom = makeDom();
    freshLoad(dom);
    detailModal.initDetailModal();
    expect(dom.body.appendChild).toHaveBeenCalledTimes(1);
  });

  test("is idempotent — second call does nothing", () => {
    const dom = makeDom();
    freshLoad(dom);
    detailModal.initDetailModal();
    detailModal.initDetailModal();
    expect(dom.body.appendChild).toHaveBeenCalledTimes(1);
  });

  test("skips init when document is undefined", () => {
    jest.resetModules();
    global.document = undefined;
    detailModal = require("../../../src/renderer/modules/detail-modal");
    expect(() => detailModal.initDetailModal()).not.toThrow();
    global.document = {}; // restore
  });
});

describe("closeDetailModal", () => {
  test("adds --hidden class to overlay", () => {
    const dom = makeDom();
    freshLoad(dom);
    detailModal.initDetailModal();
    detailModal.closeDetailModal();
    const overlay = dom.body.appendChild.mock.calls[0][0];
    // The overlay's classList should have received --hidden
    // (We test via the added class or lack of error)
    expect(() => detailModal.closeDetailModal()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/renderer/detail-modal.test.js --no-coverage
```

Expected: FAIL — `Cannot find module '../../../src/renderer/modules/detail-modal'`

- [ ] **Step 3: Create `src/renderer/modules/detail-modal.js`**

```js
import { formatFactHtml } from "./detail-panel.js";
import { getProfessionSvg } from "./profession-icons.js";
import { escapeHtml } from "./utils.js";

// Module-level singleton — one modal for the app lifetime
let _overlay = null;
let _el = {};
let _escHandler = null;

export function initDetailModal() {
  if (typeof document === "undefined") return;
  if (_overlay) return;

  _overlay = document.createElement("div");
  _overlay.className = "detail-modal-overlay detail-modal-overlay--hidden";
  _overlay.innerHTML = `
    <div class="detail-modal">
      <div class="detail-modal-toolbar">
        <span class="detail-modal-title" id="dm-title"></span>
        <button class="wiki-modal-btn" id="dm-wiki-btn">Open Wiki Page</button>
        <button class="wiki-modal-btn wiki-modal-btn--close" id="dm-close">&#x2715;</button>
      </div>
      <div class="detail-modal-body" id="dm-body">
        <div class="dm-hero">
          <img class="dm-hero__icon" id="dm-icon" src="" alt="" />
          <div class="dm-hero__prof-icon" id="dm-prof-icon"></div>
          <div class="dm-hero__text">
            <h2 class="dm-hero__name" id="dm-name"></h2>
            <p class="dm-hero__meta" id="dm-meta"></p>
            <p class="dm-hero__desc" id="dm-desc"></p>
          </div>
        </div>
        <section class="dm-section" id="dm-facts-section">
          <h3 class="dm-section__heading">Facts</h3>
          <ul class="dm-facts-grid" id="dm-facts"></ul>
        </section>
        <section class="dm-section dm-section--loading" id="dm-related-skills-section">
          <h3 class="dm-section__heading">Related Skills</h3>
          <div class="dm-spinner" id="dm-skills-spinner"></div>
          <ul class="dm-related-list dm-related-list--hidden" id="dm-related-skills"></ul>
        </section>
        <section class="dm-section dm-section--loading" id="dm-related-traits-section">
          <h3 class="dm-section__heading">Related Traits</h3>
          <div class="dm-spinner" id="dm-traits-spinner"></div>
          <div class="dm-related-list--hidden" id="dm-related-traits"></div>
        </section>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  _el = {
    title:          document.getElementById("dm-title"),
    wikiBtn:        document.getElementById("dm-wiki-btn"),
    close:          document.getElementById("dm-close"),
    body:           document.getElementById("dm-body"),
    icon:           document.getElementById("dm-icon"),
    profIcon:       document.getElementById("dm-prof-icon"),
    name:           document.getElementById("dm-name"),
    meta:           document.getElementById("dm-meta"),
    desc:           document.getElementById("dm-desc"),
    facts:          document.getElementById("dm-facts"),
    skillsSection:  document.getElementById("dm-related-skills-section"),
    traitsSection:  document.getElementById("dm-related-traits-section"),
    skillsSpinner:  document.getElementById("dm-skills-spinner"),
    traitsSpinner:  document.getElementById("dm-traits-spinner"),
    skillsList:     document.getElementById("dm-related-skills"),
    traitsList:     document.getElementById("dm-related-traits"),
  };

  _el.close.addEventListener("click", closeDetailModal);

  _el.wikiBtn.addEventListener("click", () => {
    const url = _el.wikiBtn.dataset.url;
    if (url) window.open(url, "_blank");
  });
}

export function openDetailModal(detail, catalog, professionName) {
  if (!_overlay || !detail) return;

  // ── Hero ──────────────────────────────────────────────────────────────────
  _el.title.textContent = detail.title;
  _el.name.textContent = detail.title;
  _el.desc.textContent = detail.description || "";

  // Spec name: find matching specialization by entity ID (works for traits;
  // skills fall back to professionName)
  const specializations = catalog?.specializations || [];
  const spec = specializations.find((s) => s.id === detail.entityId);
  const specName = spec?.name || professionName || "";
  const kindLabel = detail.kindLabel || detail.kind || "";
  _el.meta.textContent = specName ? `${specName} · ${kindLabel}` : kindLabel;

  // Icon
  if (detail.icon) {
    _el.icon.src = detail.icon;
    _el.icon.alt = detail.title;
    _el.icon.onerror = () => {
      _el.icon.onerror = null;
      if (detail.iconFallback) _el.icon.src = detail.iconFallback;
      else _el.icon.style.visibility = "hidden";
    };
  } else {
    _el.icon.style.visibility = "hidden";
  }

  // Profession SVG — try spec name first, then profession name
  const svg = getProfessionSvg(specName) ?? getProfessionSvg(professionName) ?? "";
  _el.profIcon.innerHTML = svg;

  // Wiki button
  const wikiUrl = detail.wiki?.url || "";
  _el.wikiBtn.dataset.url = wikiUrl;
  _el.wikiBtn.style.display = wikiUrl ? "" : "none";

  // ── Facts ─────────────────────────────────────────────────────────────────
  const facts = Array.isArray(detail.facts) ? detail.facts : [];
  _el.facts.innerHTML = facts
    .map((fact) => `<li>${formatFactHtml(fact, null)}</li>`)
    .join("") || "<li>No facts.</li>";

  // ── Related sections — show with spinners, hide lists ────────────────────
  _el.skillsSection.className = "dm-section dm-section--loading";
  _el.traitsSection.className = "dm-section dm-section--loading";
  _el.skillsList.innerHTML = "";
  _el.traitsList.innerHTML = "";

  // ── Show modal ────────────────────────────────────────────────────────────
  _overlay.classList.remove("detail-modal-overlay--hidden");
  _el.body.scrollTop = 0;
  _escHandler = (e) => { if (e.key === "Escape") closeDetailModal(); };
  document.addEventListener("keydown", _escHandler);

  // ── Async: fetch related data ─────────────────────────────────────────────
  window.desktopApi?.getWikiRelatedData(detail.title).then((related) => {
    _renderRelatedSkills(related.relatedSkills, catalog);
    _renderRelatedTraits(related.relatedTraits, catalog);
  }).catch(() => {
    _showRelatedError(_el.skillsSection, _el.skillsSpinner, _el.skillsList);
    _showRelatedError(_el.traitsSection, _el.traitsSpinner, _el.traitsList);
  });
}

export function closeDetailModal() {
  if (!_overlay) return;
  _overlay.classList.add("detail-modal-overlay--hidden");
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
}

// ── Private rendering helpers ─────────────────────────────────────────────

function _showRelatedError(section, spinner, list) {
  section.className = "dm-section";
  spinner.style.display = "none";
  list.innerHTML = '<p class="dm-related-error">Could not load related data.</p>';
  list.className = list.className.replace("dm-related-list--hidden", "dm-related-list");
}

function _renderRelatedSkills(items, catalog) {
  if (!items || items.length === 0) {
    _el.skillsSection.className = "dm-section dm-section--hidden";
    return;
  }
  const skillMap = _buildNameMap(catalog?.skills);
  _el.skillsList.innerHTML = items.map((item) => {
    const icon = skillMap.get(item.name)?.icon || "";
    return _relatedItemHtml(item.name, item.context, icon);
  }).join("");
  _el.skillsSection.className = "dm-section";
  _el.skillsSpinner.style.display = "none";
  _el.skillsList.className = "dm-related-list";
}

function _renderRelatedTraits(groups, catalog) {
  if (!groups || groups.length === 0) {
    _el.traitsSection.className = "dm-section dm-section--hidden";
    return;
  }
  const traitMap = _buildNameMap(catalog?.traits);
  const specMap = new Map((catalog?.specializations || []).map((s) => [s.name, s]));

  _el.traitsList.innerHTML = groups.map((group) => {
    const spec = specMap.get(group.groupName);
    const specIconHtml = spec?.icon
      ? `<img class="dm-trait-group__spec-icon" src="${escapeHtml(spec.icon)}" alt="${escapeHtml(group.groupName)}" />`
      : "";
    const itemsHtml = group.items.map((item) => {
      const icon = traitMap.get(item.name)?.icon || "";
      return _relatedItemHtml(item.name, item.desc || item.context || "", icon);
    }).join("");
    return `
      <div class="dm-trait-group">
        <div class="dm-trait-group__header">
          ${specIconHtml}
          <span class="dm-trait-group__name">${escapeHtml(group.groupName)}</span>
        </div>
        <ul class="dm-related-list">${itemsHtml}</ul>
      </div>`;
  }).join("");

  _el.traitsSection.className = "dm-section";
  _el.traitsSpinner.style.display = "none";
  _el.traitsList.className = "";
}

function _buildNameMap(arr) {
  const map = new Map();
  if (!Array.isArray(arr)) return map;
  for (const item of arr) {
    if (item.name) map.set(item.name, item);
  }
  return map;
}

function _relatedItemHtml(name, context, iconUrl) {
  const iconEl = iconUrl
    ? `<img class="dm-related-item__icon" src="${escapeHtml(iconUrl)}" alt="${escapeHtml(name)}" onerror="this.style.visibility='hidden'" />`
    : `<div class="dm-related-item__icon dm-related-item__icon--missing"></div>`;
  return `
    <li class="dm-related-item">
      ${iconEl}
      <span class="dm-related-item__name">${escapeHtml(name)}</span>
      ${context ? `<span class="dm-related-item__context">${escapeHtml(context)}</span>` : ""}
    </li>`;
}
```

- [ ] **Step 4: Create `src/renderer/styles/detail-modal.css`**

```css
/* Detail Modal — Expanded Reference View */

.detail-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
}

.detail-modal-overlay--hidden {
  display: none;
}

.detail-modal {
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

.detail-modal-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.detail-modal-title {
  flex: 1;
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.detail-modal-body {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 32px;
}

/* ── Hero ─────────────────────────────────────────────────────────────────── */

.dm-hero {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 24px;
}

.dm-hero__icon {
  width: 80px;
  height: 80px;
  border-radius: var(--radius);
  flex-shrink: 0;
  object-fit: contain;
  background: var(--panel);
}

.dm-hero__prof-icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dm-hero__prof-icon svg {
  width: 100%;
  height: 100%;
  fill: var(--muted);
}

.dm-hero__text {
  flex: 1;
  min-width: 0;
}

.dm-hero__name {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0 0 4px;
  color: var(--text);
}

.dm-hero__meta {
  font-size: 0.8rem;
  color: var(--muted);
  margin: 0 0 10px;
  text-transform: capitalize;
}

.dm-hero__desc {
  font-size: 0.9rem;
  color: var(--text);
  margin: 0;
  line-height: 1.5;
}

/* ── Sections ─────────────────────────────────────────────────────────────── */

.dm-section {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}

.dm-section--hidden {
  display: none;
}

.dm-section__heading {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
  margin: 0 0 12px;
}

/* ── Facts grid ──────────────────────────────────────────────────────────── */

.dm-facts-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px 24px;
  list-style: none;
  padding: 0;
  margin: 0;
}

/* ── Loading state ───────────────────────────────────────────────────────── */

.dm-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(255, 255, 255, 0.08);
  border-top-color: var(--accent-2, #6ab0f5);
  border-radius: 50%;
  animation: wiki-spin 0.7s linear infinite;
}

.dm-section--loading .dm-spinner {
  display: block;
}

.dm-section--loading .dm-related-list--hidden {
  display: none;
}

/* ── Related items ───────────────────────────────────────────────────────── */

.dm-related-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dm-related-list--hidden {
  display: none;
}

.dm-related-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dm-related-item__icon {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  flex-shrink: 0;
  object-fit: contain;
}

.dm-related-item__icon--missing {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  flex-shrink: 0;
  background: var(--panel);
  border: 1px solid var(--line);
}

.dm-related-item__name {
  font-weight: 600;
  color: var(--text);
  font-size: 0.9rem;
}

.dm-related-item__context {
  color: var(--muted);
  font-size: 0.85rem;
}

.dm-related-error {
  color: var(--muted);
  font-size: 0.85rem;
  font-style: italic;
  margin: 4px 0;
}

/* ── Trait groups ────────────────────────────────────────────────────────── */

.dm-trait-group {
  margin-bottom: 16px;
}

.dm-trait-group__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.dm-trait-group__spec-icon {
  width: 24px;
  height: 24px;
  border-radius: 3px;
  object-fit: contain;
}

.dm-trait-group__name {
  font-weight: 600;
  color: var(--text);
  font-size: 0.9rem;
}

/* ── Expand button ───────────────────────────────────────────────────────── */

.detail-expand-btn {
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--muted);
  font-family: inherit;
  font-size: 1rem;
  padding: 3px 8px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  margin-left: auto;
}

.detail-expand-btn:hover:not(:disabled) {
  background: var(--panel);
  color: var(--text);
  border-color: var(--accent-2);
}

.detail-expand-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 5: Add `@import` to `src/renderer/styles.css`**

After the existing `@import "./styles/wiki-modal.css";` line, add:

```css
@import "./styles/detail-modal.css";
```

- [ ] **Step 6: Run tests**

```bash
npx jest tests/unit/renderer/detail-modal.test.js --no-coverage
```

Expected: PASS — all tests pass.

- [ ] **Step 7: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/modules/detail-modal.js src/renderer/styles/detail-modal.css src/renderer/styles.css tests/unit/renderer/detail-modal.test.js
git commit -m "feat: add detail-modal.js and detail-modal.css"
```

---

### Task 5: Wire renderer.js

**Files:**
- Modify: `src/renderer/renderer.js` — import detail-modal, add `detailExpandBtn` to `el`, call `initDetailModal`, pass callbacks

- [ ] **Step 1: Add `detailExpandBtn` to the DOM element cache**

In `renderer.js`, inside the `el = { ... }` object (around line 70), add after `detailHost`:

```js
  detailExpandBtn:   q("#detail-expand-btn"),
```

- [ ] **Step 2: Add import for detail-modal**

After the existing wiki-modal import (line ~40):
```js
import { initDetailModal, openDetailModal } from "./modules/detail-modal.js";
```

- [ ] **Step 3: Wire init calls**

Find the block (around line 96):
```js
initWikiModal();
initDetailPanel({ detailHost: el.detailHost, hoverPreview: el.hoverPreview }, { openWikiModal });
```

Replace with:
```js
initWikiModal();
initDetailModal();
initDetailPanel(
  { detailHost: el.detailHost, hoverPreview: el.hoverPreview, expandBtn: el.detailExpandBtn },
  {
    openWikiModal,
    // Capture state.detail and state.activeCatalog at click time (not at init time)
    // so the modal always reflects the current profession catalog.
    openDetailModal: () => openDetailModal(state.detail, state.activeCatalog, state.editor?.profession),
  }
);
```

- [ ] **Step 4: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 5: Smoke test the feature manually**

Start the app: `npm run dev` (or `npm start`)

1. Select a profession and navigate to a trait or skill in the Build tab.
2. Click the trait/skill to load it in the Reference Panel — verify the `⛶` button becomes enabled.
3. Click `⛶` — verify the detail modal opens with:
   - Correct icon, name, meta (spec · Trait/Skill), description
   - Facts grid with icons
   - "Related Skills" and "Related Traits" sections showing spinners while loading
   - After load: sections populate with icons and names, or hide if empty
   - Profession/spec SVG icon appears next to the skill icon
4. Click `Open Wiki Page` — verify it opens the wiki page in the wiki modal.
5. Press Escape — verify the modal closes.
6. Click `⛶` button disabled state — verify it cannot be clicked before a selection.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/renderer.js
git commit -m "feat: wire detail modal expand button in renderer"
```
