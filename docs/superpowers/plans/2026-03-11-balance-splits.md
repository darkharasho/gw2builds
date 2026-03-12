# Balance Splits (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `lib/gw2-balance-splits/` package that tracks WvW balance splits for GW2 skills/traits, integrate it into the catalog layer so the renderer receives mode-appropriate facts, and show a "WvW split" badge on the detail panel.

**Architecture:** Standalone library with a JSON registry (`splits.json`) and three stateless lookup functions. Catalog integration at `mapSkill()`, `traits.map()`, and `weaponSkills` mapping — the renderer stays mode-unaware. Wiki scraper seeds the registry via SMW → wikitext → HTML fallback.

**Tech Stack:** Node.js, Jest, cheerio (HTML parsing)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `lib/gw2-balance-splits/index.js` | Public API: `getSkillSplit`, `getTraitSplit`, `hasSplit` |
| `lib/gw2-balance-splits/data/splits.json` | Registry of WvW fact overrides, keyed by skill/trait ID |
| `lib/gw2-balance-splits/scripts/seed.js` | Wiki scraper: discovers split skills/traits, extracts WvW facts |
| `tests/unit/balance-splits.test.js` | Unit tests for package API + splits.json schema validation |
| `tests/unit/catalog-splits.test.js` | Integration tests for catalog split application |
| `tests/unit/scraper-parsing.test.js` | Isolation tests for scraper parsing/mapping functions |
| `src/main/gw2Data/catalog.js` | Modified: apply splits in mapSkill, traits.map, weaponSkills |
| `src/renderer/modules/detail-panel.js` | Modified: show "WvW split" badge |
| `src/renderer/styles/layout.css` | Modified: badge styling |

---

## Chunk 1: Package API + Tests

### Task 1: Create package structure and empty registry

**Files:**
- Create: `lib/gw2-balance-splits/index.js`
- Create: `lib/gw2-balance-splits/data/splits.json`

- [ ] **Step 1: Create the empty `splits.json` registry**

```json
{
  "version": 1,
  "updatedAt": "2026-03-11T00:00:00Z",
  "skills": {},
  "traits": {}
}
```

Save to `lib/gw2-balance-splits/data/splits.json`.

- [ ] **Step 2: Create the package API (`index.js`)**

```js
const splits = require("./data/splits.json");

function getSkillSplit(skillId, gameMode) {
  if (gameMode === "pve") return null;
  return splits.skills?.[String(skillId)]?.modes?.[gameMode] || null;
}

function getTraitSplit(traitId, gameMode) {
  if (gameMode === "pve") return null;
  return splits.traits?.[String(traitId)]?.modes?.[gameMode] || null;
}

function hasSplit(entityType, id) {
  const bucket = entityType === "trait" ? splits.traits : splits.skills;
  return Boolean(bucket?.[String(id)]);
}

module.exports = { getSkillSplit, getTraitSplit, hasSplit, splits };
```

Save to `lib/gw2-balance-splits/index.js`.

- [ ] **Step 3: Commit**

```bash
git add lib/gw2-balance-splits/index.js lib/gw2-balance-splits/data/splits.json
git commit -m "feat: create gw2-balance-splits package with empty registry"
```

### Task 2: Unit tests for the package API

**Files:**
- Create: `tests/unit/balance-splits.test.js`
- Modify: `lib/gw2-balance-splits/index.js` (only if tests reveal issues)

- [ ] **Step 1: Write failing tests**

Create `tests/unit/balance-splits.test.js`. The tests mock `splits.json` via `jest.mock` to provide controlled test data. Test cases:

```js
// Mock splits.json BEFORE requiring the module
jest.mock("../../lib/gw2-balance-splits/data/splits.json", () => ({
  version: 1,
  updatedAt: "2026-03-11T00:00:00Z",
  skills: {
    "1234": {
      name: "Test Skill",
      modes: {
        wvw: {
          facts: [
            { type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 }
          ]
        }
      }
    }
  },
  traits: {
    "5678": {
      name: "Test Trait",
      modes: {
        wvw: {
          facts: [
            { type: "Buff", text: "Might", status: "Might", duration: 5, apply_count: 2 }
          ]
        }
      }
    }
  }
}));

const { getSkillSplit, getTraitSplit, hasSplit } = require("../../lib/gw2-balance-splits");

describe("gw2-balance-splits", () => {
  describe("getSkillSplit", () => {
    test("returns null for pve mode", () => {
      expect(getSkillSplit(1234, "pve")).toBeNull();
    });

    test("returns split entry for known wvw skill", () => {
      const result = getSkillSplit(1234, "wvw");
      expect(result).not.toBeNull();
      expect(result.facts).toHaveLength(1);
      expect(result.facts[0].type).toBe("Damage");
      expect(result.facts[0].dmg_multiplier).toBe(0.5);
    });

    test("returns null for skill with no split", () => {
      expect(getSkillSplit(9999, "wvw")).toBeNull();
    });

    test("accepts numeric or string skill ID", () => {
      expect(getSkillSplit("1234", "wvw")).not.toBeNull();
      expect(getSkillSplit(1234, "wvw")).not.toBeNull();
    });
  });

  describe("getTraitSplit", () => {
    test("returns null for pve mode", () => {
      expect(getTraitSplit(5678, "pve")).toBeNull();
    });

    test("returns split entry for known wvw trait", () => {
      const result = getTraitSplit(5678, "wvw");
      expect(result).not.toBeNull();
      expect(result.facts).toHaveLength(1);
      expect(result.facts[0].type).toBe("Buff");
    });

    test("returns null for trait with no split", () => {
      expect(getTraitSplit(9999, "wvw")).toBeNull();
    });
  });

  describe("hasSplit", () => {
    test("returns true for skill with split", () => {
      expect(hasSplit("skill", 1234)).toBe(true);
    });

    test("returns false for skill without split", () => {
      expect(hasSplit("skill", 9999)).toBe(false);
    });

    test("returns true for trait with split", () => {
      expect(hasSplit("trait", 5678)).toBe(true);
    });

    test("returns false for trait without split", () => {
      expect(hasSplit("trait", 9999)).toBe(false);
    });
  });
});

// Schema validation for splits.json (uses the real file, not the mock)
describe("splits.json schema validation", () => {
  const realSplits = JSON.parse(
    require("fs").readFileSync(
      require("path").join(__dirname, "../../lib/gw2-balance-splits/data/splits.json"),
      "utf-8"
    )
  );

  test("has required top-level fields", () => {
    expect(realSplits).toHaveProperty("version");
    expect(realSplits).toHaveProperty("updatedAt");
    expect(realSplits).toHaveProperty("skills");
    expect(realSplits).toHaveProperty("traits");
    expect(typeof realSplits.version).toBe("number");
    expect(typeof realSplits.updatedAt).toBe("string");
    expect(typeof realSplits.skills).toBe("object");
    expect(typeof realSplits.traits).toBe("object");
  });

  test("skill entries have valid structure", () => {
    for (const [id, entry] of Object.entries(realSplits.skills)) {
      expect(id).toMatch(/^\d+$/);
      expect(entry).toHaveProperty("name");
      expect(entry).toHaveProperty("modes");
      expect(entry.modes).toHaveProperty("wvw");
      expect(Array.isArray(entry.modes.wvw.facts)).toBe(true);
      expect(entry.modes.wvw.facts.length).toBeGreaterThan(0);
      for (const fact of entry.modes.wvw.facts) {
        expect(fact).toHaveProperty("type");
        expect(typeof fact.type).toBe("string");
      }
    }
  });

  test("trait entries have valid structure", () => {
    for (const [id, entry] of Object.entries(realSplits.traits)) {
      expect(id).toMatch(/^\d+$/);
      expect(entry).toHaveProperty("name");
      expect(entry).toHaveProperty("modes");
      expect(entry.modes).toHaveProperty("wvw");
      expect(Array.isArray(entry.modes.wvw.facts)).toBe(true);
      expect(entry.modes.wvw.facts.length).toBeGreaterThan(0);
      for (const fact of entry.modes.wvw.facts) {
        expect(fact).toHaveProperty("type");
        expect(typeof fact.type).toBe("string");
      }
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx jest tests/unit/balance-splits.test.js --verbose`
Expected: All 10 tests PASS (the module already exists from Task 1).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/balance-splits.test.js
git commit -m "test: add unit tests for gw2-balance-splits package API"
```

---

## Chunk 2: Wiki Scraper

### Task 3: Create wiki scraper seed script

**Files:**
- Create: `lib/gw2-balance-splits/scripts/seed.js`

This is a runnable Node.js script (not imported by the app at runtime). It discovers which GW2 skills/traits have balance splits and extracts WvW-specific fact values from the GW2 wiki, then writes `splits.json`.

**Important context:**
- The GW2 wiki uses Semantic MediaWiki (SMW) and MediaWiki APIs
- Skills with balance splits have split sections on their wiki pages
- The GW2 API (`/v2/skills?ids=...`) provides PvE facts (used for cross-reference)
- GW2 API fact types: `Damage` (dmg_multiplier, hit_count), `Buff` (status, duration, apply_count), `Number` (value), `Recharge` (value), `Distance` (distance), `Duration` (duration), `ComboField` (field_type), `ComboFinisher` (finisher_type, percent), `NoData` (used as section headers), `Time` (duration), `Radius` (distance), `Range` (value), `Percent` (percent), `PrefixedBuff` (status, duration, apply_count, prefix)

- [ ] **Step 1: Create the scraper script**

```js
#!/usr/bin/env node
/**
 * seed.js — Build splits.json by scraping the GW2 Wiki for balance-split data.
 *
 * Fallback chain per skill/trait (most reliable → least):
 *   1. SMW (Semantic MediaWiki) query
 *   2. Wikitext template parsing
 *   3. HTML scraping
 *
 * Usage: node lib/gw2-balance-splits/scripts/seed.js
 *
 * Dependencies: cheerio (npm install cheerio)
 */

const path = require("path");
const fs = require("fs/promises");

// Lazy-load cheerio — only needed for HTML fallback
let cheerio;
function getCheerio() {
  if (!cheerio) cheerio = require("cheerio");
  return cheerio;
}

const WIKI_API = "https://wiki.guildwars2.com/api.php";
const GW2_API = "https://api.guildwars2.com/v2";
const OUTPUT_PATH = path.join(__dirname, "..", "data", "splits.json");

// Rate-limit: 1 request per 200ms to be kind to the wiki
const RATE_LIMIT_MS = 200;
let lastRequestTime = 0;
async function rateLimitedFetch(url) {
  const now = Date.now();
  const wait = Math.max(0, lastRequestTime + RATE_LIMIT_MS - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestTime = Date.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res;
}

// ── Discovery: find all skills/traits with balance splits ──

async function discoverSplitPages() {
  // Try SMW query first: pages in Category:Skills with split mechanics
  const smwUrl = `${WIKI_API}?action=ask&query=[[Category:Skills with split mechanics]]|?Has game mode|limit=500&format=json`;
  try {
    const res = await rateLimitedFetch(smwUrl);
    const data = await res.json();
    if (data.query?.results && Object.keys(data.query.results).length > 0) {
      console.log(`[SMW] Found ${Object.keys(data.query.results).length} split pages`);
      return Object.keys(data.query.results);
    }
  } catch (err) {
    console.log(`[SMW] Discovery failed: ${err.message}`);
  }

  // Fallback: Category members API
  const pages = [];
  let cmcontinue = "";
  do {
    const url = `${WIKI_API}?action=query&list=categorymembers&cmtitle=Category:Skills_with_split_mechanics&cmlimit=500&format=json${cmcontinue ? `&cmcontinue=${cmcontinue}` : ""}`;
    const res = await rateLimitedFetch(url);
    const data = await res.json();
    for (const member of data.query?.categorymembers || []) {
      pages.push(member.title);
    }
    cmcontinue = data.continue?.cmcontinue || "";
  } while (cmcontinue);

  console.log(`[Category] Found ${pages.length} split pages`);
  return pages;
}

// ── Extraction: try each fallback method ──

// Method A: SMW structured data
async function extractViaSMW(pageName) {
  const query = `[[${pageName}]]|?Has skill id|?Has WvW damage multiplier|?Has WvW duration|?Has WvW fact`;
  const url = `${WIKI_API}?action=ask&query=${encodeURIComponent(query)}&format=json`;
  try {
    const res = await rateLimitedFetch(url);
    const data = await res.json();
    const results = data.query?.results;
    if (!results) return null;
    const entry = Object.values(results)[0];
    if (!entry?.printouts) return null;

    const skillId = entry.printouts["Has skill id"]?.[0];
    const facts = entry.printouts["Has WvW fact"];
    if (!skillId || !facts || facts.length === 0) return null;

    // SMW doesn't reliably distinguish skill vs trait; default to "skill".
    // The wikitext/HTML fallbacks detect type from template names.
    return { id: Number(skillId), type: "skill", facts: facts.map(parseSMWFact).filter(Boolean) };
  } catch {
    return null;
  }
}

function parseSMWFact(raw) {
  // SMW facts come as structured objects — map to GW2 API fact format
  if (!raw || typeof raw !== "object") return null;
  return raw; // Pass through if already in API format; adjust based on actual SMW schema
}

// Method B: Wikitext template parsing
async function extractViaWikitext(pageName) {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageName)}&prop=wikitext&format=json`;
  try {
    const res = await rateLimitedFetch(url);
    const data = await res.json();
    const wikitext = data.parse?.wikitext?.["*"];
    if (!wikitext) return null;

    // Look for skill ID in the infobox template
    const idMatch = wikitext.match(/\|\s*id\s*=\s*(\d+)/);
    const skillId = idMatch ? Number(idMatch[1]) : null;
    if (!skillId) return null;

    // Determine entity type from template name
    const isTraitMatch = wikitext.match(/\{\{trait infobox/i);
    const entityType = isTraitMatch ? "trait" : "skill";

    // Look for split sections — the wiki uses {{split|...}} templates
    const splitPattern = /\{\{split\|([^}]+)\}\}/gi;
    const splits = [];
    let match;
    while ((match = splitPattern.exec(wikitext)) !== null) {
      splits.push(match[1]);
    }

    // Also look for WvW-specific parameters in the skill infobox
    // Format: | wvw damage = 0.5 | wvw coefficient = 0.8 etc.
    const wvwParams = {};
    const wvwParamPattern = /\|\s*(?:wvw|competitive)\s+(\w[\w\s]*?)\s*=\s*([^\n|]+)/gi;
    while ((match = wvwParamPattern.exec(wikitext)) !== null) {
      wvwParams[match[1].trim().toLowerCase()] = match[2].trim();
    }

    if (splits.length === 0 && Object.keys(wvwParams).length === 0) return null;

    const facts = mapWikitextToFacts(wvwParams, splits);
    if (facts.length === 0) return null;

    return { id: skillId, type: entityType, facts };
  } catch {
    return null;
  }
}

// Map wikitext field names → GW2 API fact objects
function mapWikitextToFacts(params, splitSections) {
  const facts = [];

  // Damage coefficient
  if (params.damage || params.coefficient) {
    const coeff = parseFloat(params.damage || params.coefficient);
    if (!isNaN(coeff)) {
      facts.push({
        type: "Damage",
        text: "Damage",
        dmg_multiplier: coeff,
        hit_count: parseInt(params["hit count"] || params.hits || "1", 10) || 1,
      });
    }
  }

  // Duration (for buffs/conditions)
  if (params.duration) {
    const dur = parseFloat(params.duration);
    if (!isNaN(dur)) {
      facts.push({ type: "Duration", text: "Duration", duration: dur });
    }
  }

  // Recharge
  if (params.recharge || params.cooldown) {
    const cd = parseFloat(params.recharge || params.cooldown);
    if (!isNaN(cd)) {
      facts.push({ type: "Recharge", text: "Recharge", value: cd });
    }
  }

  // Healing
  if (params.healing) {
    const heal = parseFloat(params.healing);
    if (!isNaN(heal)) {
      facts.push({ type: "AttributeAdjust", text: "Healing", value: heal });
    }
  }

  // Parse split section text for additional facts
  for (const section of splitSections) {
    const parts = section.split("|").map((s) => s.trim());
    for (const part of parts) {
      const kvMatch = part.match(/^(\w[\w\s]*?)\s*[:=]\s*(.+)$/);
      if (kvMatch) {
        const key = kvMatch[1].toLowerCase();
        const val = kvMatch[2];
        if (key === "damage" && !isNaN(parseFloat(val))) {
          facts.push({ type: "Damage", text: "Damage", dmg_multiplier: parseFloat(val), hit_count: 1 });
        }
      }
    }
  }

  return facts;
}

// Method C: HTML scraping (least reliable)
async function extractViaHTML(pageName) {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageName)}&prop=text&format=json`;
  try {
    const res = await rateLimitedFetch(url);
    const data = await res.json();
    const html = data.parse?.text?.["*"];
    if (!html) return null;

    const $ = getCheerio().load(html);

    // Look for skill ID in the page content
    const idText = $(".infobox .id, .skill-id").first().text();
    const idMatch = idText.match(/\d+/);
    const skillId = idMatch ? Number(idMatch[0]) : null;

    // Look for the split/competitive section
    const splitSection = $(".mw-headline:contains('Competitive'), .mw-headline:contains('WvW'), .mw-headline:contains('Split')")
      .closest("h2, h3")
      .nextUntil("h2, h3");

    if (splitSection.length === 0 && !skillId) return null;

    // Extract fact-like data from tooltip tables in the split section
    const facts = [];
    splitSection.find("dl dd, .skill-fact, .fact-row").each((_i, el) => {
      const text = $(el).text().trim();
      const dmgMatch = text.match(/Damage:\s*([\d.]+)/i);
      if (dmgMatch) {
        facts.push({ type: "Damage", text: "Damage", dmg_multiplier: parseFloat(dmgMatch[1]), hit_count: 1 });
      }
      const durMatch = text.match(/Duration:\s*([\d.]+)/i);
      if (durMatch) {
        facts.push({ type: "Duration", text: "Duration", duration: parseFloat(durMatch[1]) });
      }
    });

    if (facts.length === 0 || !skillId) return null;

    // Detect entity type from page structure
    const isTrait = $(".infobox-header:contains('Trait')").length > 0
      || $("th:contains('Trait type')").length > 0;
    return { id: skillId, type: isTrait ? "trait" : "skill", facts };
  } catch {
    return null;
  }
}

// ── Cross-reference with GW2 API ──

async function fetchGw2ApiFacts(ids) {
  // Batch fetch skill data from the GW2 API for cross-reference
  const batches = [];
  for (let i = 0; i < ids.length; i += 200) {
    batches.push(ids.slice(i, i + 200));
  }
  const results = new Map();
  for (const batch of batches) {
    try {
      const res = await rateLimitedFetch(`${GW2_API}/skills?ids=${batch.join(",")}&lang=en`);
      const data = await res.json();
      for (const skill of data) {
        results.set(skill.id, skill);
      }
    } catch (err) {
      console.warn(`[GW2 API] Failed to fetch batch: ${err.message}`);
    }
  }
  return results;
}

// ── Validation ──

const VALID_FACT_TYPES = new Set([
  "Damage", "Buff", "Number", "Recharge", "Distance", "Duration",
  "ComboField", "ComboFinisher", "NoData", "Time", "Radius",
  "Range", "Percent", "PrefixedBuff", "AttributeAdjust", "Unblockable",
  "StunBreak", "HealingAdjust",
]);

function validateSplitEntry(entry) {
  if (!entry || !Array.isArray(entry.facts) || entry.facts.length === 0) return false;
  return entry.facts.every((f) => f.type && VALID_FACT_TYPES.has(f.type));
}

// ── Main ──

async function main() {
  console.log("=== GW2 Balance Splits Seeder ===\n");

  // Step 1: Discover pages with balance splits
  const pages = await discoverSplitPages();
  if (pages.length === 0) {
    console.log("No split pages found. Writing empty registry.");
    await writeOutput({}, {});
    return;
  }

  // Step 2: Extract WvW facts for each page using fallback chain
  const skills = {};
  const traits = {};
  const methods = { smw: 0, wikitext: 0, html: 0, failed: 0 };

  for (const page of pages) {
    let result = null;
    let method = "";

    // Try A: SMW
    result = await extractViaSMW(page);
    if (result && validateSplitEntry(result)) {
      method = "smw";
    } else {
      // Try B: Wikitext
      result = await extractViaWikitext(page);
      if (result && validateSplitEntry(result)) {
        method = "wikitext";
      } else {
        // Try C: HTML
        result = await extractViaHTML(page);
        if (result && validateSplitEntry(result)) {
          method = "html";
        }
      }
    }

    if (result && method) {
      methods[method]++;
      const bucket = result.type === "trait" ? traits : skills;
      bucket[String(result.id)] = {
        name: page.replace(/_/g, " "),
        modes: { wvw: { facts: result.facts } },
      };
      console.log(`  ✓ ${page} (id=${result.id}, method=${method})`);
    } else {
      methods.failed++;
      console.log(`  ✗ ${page} (no extraction method succeeded)`);
    }
  }

  // Step 3: Write output
  await writeOutput(skills, traits);

  console.log(`\n=== Done ===`);
  console.log(`Skills: ${Object.keys(skills).length}, Traits: ${Object.keys(traits).length}`);
  console.log(`Methods: SMW=${methods.smw}, Wikitext=${methods.wikitext}, HTML=${methods.html}, Failed=${methods.failed}`);
}

async function writeOutput(skills, traits) {
  const output = {
    version: 1,
    updatedAt: new Date().toISOString(),
    skills: skills || {},
    traits: traits || {},
  };
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${OUTPUT_PATH}`);
}

// Export for testing (no-op when run as a script)
module.exports = { mapWikitextToFacts, validateSplitEntry };

// Only run when executed directly (not when require()'d by tests)
if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
```

Save to `lib/gw2-balance-splits/scripts/seed.js`.

- [ ] **Step 2: Install cheerio dependency**

```bash
npm install --save-dev cheerio
```

- [ ] **Step 3: Verify the script runs without crashing (dry run)**

Run: `node lib/gw2-balance-splits/scripts/seed.js`
Expected: Script runs, discovers pages (or finds none on first run), writes `splits.json`. No crash.

- [ ] **Step 4: Commit**

```bash
git add lib/gw2-balance-splits/scripts/seed.js package.json package-lock.json
git commit -m "feat: add wiki scraper for balance split discovery"
```

### Task 3b: Scraper parsing function isolation tests

**Files:**
- Create: `tests/unit/scraper-parsing.test.js`
- Modify: `lib/gw2-balance-splits/scripts/seed.js` (export parsing functions for testability)

The spec requires testing parsing/mapping functions in isolation with fixture data. To make `mapWikitextToFacts` testable, export it from `seed.js`.

Note: `seed.js` already exports `mapWikitextToFacts` and `validateSplitEntry` via `module.exports` and guards `main()` behind `require.main === module` (see Task 3 Step 1), so tests can safely `require()` it.

- [ ] **Step 1: Write parsing isolation tests**

Create `tests/unit/scraper-parsing.test.js`:

```js
const { mapWikitextToFacts, validateSplitEntry } = require("../../lib/gw2-balance-splits/scripts/seed");

describe("seed.js parsing functions", () => {
  describe("mapWikitextToFacts", () => {
    test("extracts damage coefficient", () => {
      const facts = mapWikitextToFacts({ damage: "0.8" }, []);
      expect(facts).toHaveLength(1);
      expect(facts[0]).toEqual({
        type: "Damage",
        text: "Damage",
        dmg_multiplier: 0.8,
        hit_count: 1,
      });
    });

    test("extracts damage with hit count", () => {
      const facts = mapWikitextToFacts({ damage: "0.5", "hit count": "3" }, []);
      expect(facts[0].hit_count).toBe(3);
    });

    test("extracts duration", () => {
      const facts = mapWikitextToFacts({ duration: "10" }, []);
      expect(facts).toHaveLength(1);
      expect(facts[0]).toEqual({ type: "Duration", text: "Duration", duration: 10 });
    });

    test("extracts recharge/cooldown", () => {
      const facts = mapWikitextToFacts({ recharge: "25" }, []);
      expect(facts[0]).toEqual({ type: "Recharge", text: "Recharge", value: 25 });
    });

    test("extracts healing", () => {
      const facts = mapWikitextToFacts({ healing: "300" }, []);
      expect(facts[0]).toEqual({ type: "AttributeAdjust", text: "Healing", value: 300 });
    });

    test("returns empty array for no WvW params", () => {
      expect(mapWikitextToFacts({}, [])).toEqual([]);
    });

    test("extracts damage from split sections", () => {
      const facts = mapWikitextToFacts({}, ["damage: 0.6"]);
      expect(facts).toHaveLength(1);
      expect(facts[0].dmg_multiplier).toBe(0.6);
    });

    test("ignores non-numeric values", () => {
      const facts = mapWikitextToFacts({ damage: "varies" }, []);
      expect(facts).toEqual([]);
    });
  });

  describe("validateSplitEntry", () => {
    test("valid entry with known fact types", () => {
      expect(validateSplitEntry({
        facts: [{ type: "Damage" }, { type: "Buff" }]
      })).toBe(true);
    });

    test("rejects null entry", () => {
      expect(validateSplitEntry(null)).toBe(false);
    });

    test("rejects empty facts array", () => {
      expect(validateSplitEntry({ facts: [] })).toBe(false);
    });

    test("rejects entry with unknown fact type", () => {
      expect(validateSplitEntry({ facts: [{ type: "FakeType" }] })).toBe(false);
    });

    test("rejects entry with missing type", () => {
      expect(validateSplitEntry({ facts: [{ text: "Damage" }] })).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest tests/unit/scraper-parsing.test.js --verbose`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/scraper-parsing.test.js
git commit -m "test: add isolation tests for scraper parsing functions"
```

---

## Chunk 3: Catalog Integration

### Task 4: Apply balance splits in catalog.js

**Files:**
- Modify: `src/main/gw2Data/catalog.js:1-2` (add import)
- Modify: `src/main/gw2Data/catalog.js:405` (mapSkill facts override)
- Modify: `src/main/gw2Data/catalog.js:580` (trait facts override)
- Modify: `src/main/gw2Data/catalog.js:618` (weaponSkill facts override)
- Modify: `src/main/gw2Data/catalog.js` (export `applyBalanceSplit` helper for testing)
- Create: `tests/unit/catalog-splits.test.js`

**Context:** `mapSkill()` is a closure inside `getProfessionCatalog()`, so `gameMode` is in scope via closure (it's a parameter of the enclosing function at line 58). The traits are mapped via an anonymous `traits.map()` at line 567. The weapon skills are mapped at line 609. All three places already produce a `facts` property.

To make the split logic testable without mocking the entire catalog pipeline, we extract a small helper `applyBalanceSplit(mapped, entityType, gameMode)` at module scope in catalog.js and export it. The three mapping sites call this helper. Tests import and exercise it directly — this tests the actual production code path.

- [ ] **Step 1: Write the failing integration test**

Create `tests/unit/catalog-splits.test.js`:

```js
/**
 * Integration tests for balance splits applied during catalog construction.
 *
 * These tests import and exercise the actual applyBalanceSplit function from
 * catalog.js, which is the same function called by mapSkill(), traits.map(),
 * and weaponSkills mapping during catalog construction.
 */

// Mock the balance-splits module that catalog.js imports
jest.mock("../../lib/gw2-balance-splits", () => ({
  getSkillSplit: (id, mode) => {
    if (mode === "pve") return null;
    const splits = {
      "1234": { facts: [{ type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 }] },
    };
    return splits[String(id)] || null;
  },
  getTraitSplit: (id, mode) => {
    if (mode === "pve") return null;
    const splits = {
      "5678": { facts: [{ type: "Buff", text: "Might", status: "Might", duration: 5, apply_count: 2 }] },
    };
    return splits[String(id)] || null;
  },
}));

// Mock fetch module (required by catalog.js at import time)
jest.mock("../../src/main/gw2Data/fetch", () => ({
  GW2_API_ROOT: "https://api.guildwars2.com/v2",
  fetchCachedJson: jest.fn(),
  fetchGw2ByIds: jest.fn().mockResolvedValue([]),
  dedupeNumbers: (arr) => [...new Set(arr)],
}));

// Mock overrides module (required by catalog.js at import time)
jest.mock("../../src/main/gw2Data/overrides", () => ({
  KNOWN_SKILL_DESCRIPTION_OVERRIDES: new Map(),
  KNOWN_SKILL_FACTS_OVERRIDES: new Map(),
  KNOWN_SKILL_SPEC_OVERRIDES: new Map(),
  KNOWN_SKILL_SLOT_OVERRIDES: new Map(),
  PHOTON_FORGE_SKILL_ID: 0, PHOTON_FORGE_BUNDLE: [],
  RADIANT_FORGE_SKILL_ID: 0, RADIANT_FORGE_BUNDLE: [], RADIANT_FORGE_FLIP_SKILLS: [],
  DEATH_SHROUD_SKILL_ID: 0, DEATH_SHROUD_BUNDLE: [], DEATH_SHROUD_FLIP_SKILLS: [],
  LICH_FORM_SKILL_ID: 0, LICH_FORM_BUNDLE: [], LICH_FORM_FLIP_SKILLS: [],
  SHADOW_SHROUD_SKILL_ID: 0, SHADOW_SHROUD_BUNDLE: [],
  FIREBRAND_TOME_CHAPTERS: new Map(),
  GUNSABER_SKILL_ID: 0, GUNSABER_BUNDLE: [], GUNSABER_BUNDLE_SKILLS: [],
  DRAGON_TRIGGER_SKILL_ID: 0, DRAGON_TRIGGER_BUNDLE: [], DRAGON_TRIGGER_BUNDLE_SKILLS: [],
  ELIXIR_TOOLBELT_OVERRIDES: new Map(),
  LEGEND_FLIP_OVERRIDES: new Map(),
}));

const { applyBalanceSplit } = require("../../src/main/gw2Data/catalog");

describe("Catalog balance splits integration", () => {
  describe("skill splits", () => {
    test("overrides facts for WvW skill with split", () => {
      const mapped = { id: 1234, facts: [{ type: "Damage", dmg_multiplier: 1.0 }] };
      applyBalanceSplit(mapped, "skill", "wvw");
      expect(mapped.facts[0].dmg_multiplier).toBe(0.5);
      expect(mapped.hasSplit).toBe(true);
    });

    test("does not override facts for PvE mode", () => {
      const mapped = { id: 1234, facts: [{ type: "Damage", dmg_multiplier: 1.0 }] };
      applyBalanceSplit(mapped, "skill", "pve");
      expect(mapped.facts[0].dmg_multiplier).toBe(1.0);
      expect(mapped.hasSplit).toBeUndefined();
    });

    test("does not override skill without split", () => {
      const mapped = { id: 9999, facts: [{ type: "Damage", dmg_multiplier: 1.0 }] };
      applyBalanceSplit(mapped, "skill", "wvw");
      expect(mapped.facts[0].dmg_multiplier).toBe(1.0);
      expect(mapped.hasSplit).toBeUndefined();
    });
  });

  describe("trait splits", () => {
    test("overrides facts for WvW trait with split", () => {
      const mapped = { id: 5678, facts: [{ type: "Number", value: 10 }] };
      applyBalanceSplit(mapped, "trait", "wvw");
      expect(mapped.facts[0].type).toBe("Buff");
      expect(mapped.hasSplit).toBe(true);
    });

    test("does not override facts for PvE mode", () => {
      const mapped = { id: 5678, facts: [{ type: "Number", value: 10 }] };
      applyBalanceSplit(mapped, "trait", "pve");
      expect(mapped.facts[0].type).toBe("Number");
      expect(mapped.hasSplit).toBeUndefined();
    });

    test("does not override trait without split", () => {
      const mapped = { id: 9999, facts: [{ type: "Number", value: 10 }] };
      applyBalanceSplit(mapped, "trait", "wvw");
      expect(mapped.facts[0].type).toBe("Number");
      expect(mapped.hasSplit).toBeUndefined();
    });
  });

  describe("weapon skill splits", () => {
    test("weapon skills use skill split lookup", () => {
      const mapped = { id: 1234, facts: [{ type: "Damage", dmg_multiplier: 1.0 }] };
      applyBalanceSplit(mapped, "skill", "wvw");
      expect(mapped.facts[0].dmg_multiplier).toBe(0.5);
      expect(mapped.hasSplit).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests — they should fail (applyBalanceSplit not exported yet)**

Run: `npx jest tests/unit/catalog-splits.test.js --verbose`
Expected: FAIL — `applyBalanceSplit` is not a function.

- [ ] **Step 3: Add the import and helper to catalog.js**

At the top of `src/main/gw2Data/catalog.js`, after the existing imports (after line 35), add:

```js
const { getSkillSplit, getTraitSplit } = require("../../lib/gw2-balance-splits");
```

Then, add the `applyBalanceSplit` helper at module scope (after the import, before `getProfessionList`):

```js
/**
 * Apply WvW balance split override to a mapped skill or trait object (mutates in place).
 * Called from mapSkill(), traits.map(), and weaponSkills mapping.
 * @param {object} mapped - The mapped entity object (must have `id` and `facts`)
 * @param {"skill"|"trait"} entityType - Whether this is a skill or trait
 * @param {string} gameMode - "pve" or "wvw"
 */
function applyBalanceSplit(mapped, entityType, gameMode) {
  if (gameMode === "pve") return;
  const splitFn = entityType === "trait" ? getTraitSplit : getSkillSplit;
  const split = splitFn(mapped.id, gameMode);
  if (split?.facts) {
    mapped.facts = split.facts;
    mapped.hasSplit = true;
  }
}
```

And add it to the `module.exports` at the bottom of the file (line 628-630):
```js
module.exports = {
  getProfessionList,
  getProfessionCatalog,
  applyBalanceSplit,
};
```

- [ ] **Step 4: Apply splits in mapSkill() (line 405)**

In `src/main/gw2Data/catalog.js`, the `mapSkill()` function returns an object at lines 391-417. Change `return {` to `const mapped = {`, change the closing `};` to `};`, then add after it:

```js
    applyBalanceSplit(mapped, "skill", gameMode);
    return mapped;
```

- [ ] **Step 5: Apply splits in traits.map() (line 580)**

In `src/main/gw2Data/catalog.js`, the trait mapping at line 567-592 is an anonymous `traits.map()` call. Each trait object is returned inline. Modify the mapping to apply the split override.

Replace lines 567-592 — the `traits: traits.map(...)` block. Change the trait lambda to capture the mapped object:

Change the trait lambda from returning the object literal directly `traits.map((trait) => ({...}))` to building a `mapped` object, calling the helper, and returning:

```js
    traits: traits.map((trait) => {
      const mapped = {
        // ... all existing properties unchanged ...
      };
      applyBalanceSplit(mapped, "trait", gameMode);
      return mapped;
    }),
```

The property list inside `mapped` is identical to the existing object literal — just wrapped in `const mapped = { ... };` instead of being returned directly.

- [ ] **Step 6: Apply splits in weaponSkills mapping (line 618)**

In `src/main/gw2Data/catalog.js`, the weapon skills are mapped at lines 609-620. Same pattern — wrap in `const mapped = { ... };`, call helper, return:

```js
    weaponSkills: weaponSkillsRaw.map((skill) => {
      const mapped = {
        // ... all existing properties unchanged ...
      };
      applyBalanceSplit(mapped, "skill", gameMode);
      return mapped;
    }),
```

- [ ] **Step 7: Run existing tests to verify no breakage**

Run: `npx jest --verbose`
Expected: All tests pass (existing tests + new split tests). The 3 pre-existing Scrapper/Function Gyro failures (72103) are known and unrelated.

- [ ] **Step 8: Commit**

```bash
git add src/main/gw2Data/catalog.js tests/unit/catalog-splits.test.js
git commit -m "feat: integrate balance splits into catalog skill/trait/weapon mapping"
```

---

## Chunk 4: Renderer Badge + Styling

### Task 5: Add "WvW split" badge to detail panel and hover preview

**Files:**
- Modify: `src/renderer/modules/detail-panel.js:63-64` (pinned panel badge)
- Modify: `src/renderer/modules/detail-panel.js:210-211` (hover card badge)
- Modify: `src/renderer/modules/detail-panel.js:319-328` (pass hasSplit through selectDetail)
- Modify: `src/renderer/styles/layout.css` (badge styling)

**Context:**
- `renderDetailPanel()` (lines 14-83): The pinned detail card. `detail.title` is rendered at line 63. The badge should appear next to the kind label (`detail.kindLabel` at line 64).
- `buildSkillCard()` (lines 191-217): The hover preview card. `skill.name` is rendered at line 210. Badge should appear next to the meta line at line 211.
- `selectDetail()` (lines 317-342): Creates the detail object. `hasSplit` must be copied from the entity.
- Both rendering paths receive the full entity object, so `entity.hasSplit` is available.

- [ ] **Step 1: Add hasSplit to selectDetail()**

In `src/renderer/modules/detail-panel.js`, at line 328 (inside the `selectDetail` function), the detail object is built. Add `hasSplit`:

After line 327 (`wiki: { loading: true, summary: "", url: "" },`), add:
```js
    hasSplit: Boolean(entity.hasSplit),
```

- [ ] **Step 2: Add badge to renderDetailPanel()**

In `src/renderer/modules/detail-panel.js`, at line 64, the kind label is rendered:
```js
            <p>${escapeHtml(detail.kindLabel)}</p>
```

Change to:
```js
            <p>${escapeHtml(detail.kindLabel)}${detail.hasSplit ? ' <span class="split-badge">WvW split</span>' : ''}</p>
```

- [ ] **Step 3: Add badge to buildSkillCard()**

In `src/renderer/modules/detail-panel.js`, at line 211, the meta line is rendered:
```js
        <p class="hover-preview__meta">${escapeHtml(meta)}</p>
```

Change to:
```js
        <p class="hover-preview__meta">${escapeHtml(meta)}${skill.hasSplit ? ' <span class="split-badge">WvW split</span>' : ''}</p>
```

- [ ] **Step 4: Add badge CSS**

In `src/renderer/styles/layout.css`, add the badge styles (at the end of the file, or near the `.detail-card` / `.hover-preview` section):

```css
/* WvW balance split badge */
.split-badge {
  display: inline-block;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 1px 5px;
  border-radius: 3px;
  background: #3a5a3a;
  color: #8fc98f;
  margin-left: 6px;
  vertical-align: middle;
}
```

- [ ] **Step 5: Verify visually**

Run the app: `npm run dev`
- Select a build, switch to WvW mode
- If any skills/traits in `splits.json` have entries, their detail panel and hover preview should show the "WvW split" badge
- If `splits.json` is empty, no badges appear (correct behavior — no splits to show)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/detail-panel.js src/renderer/styles/layout.css
git commit -m "feat: add WvW split badge to detail panel and hover preview"
```

---

## Chunk 5: Final Verification

### Task 6: End-to-end verification and cleanup

- [ ] **Step 1: Run full test suite**

Run: `npx jest --verbose`
Expected: All new tests pass. Pre-existing Scrapper failures (3) are the only known failures.

- [ ] **Step 2: Verify app starts and modes work**

Run: `npm run dev`
1. App loads with PvE mode (default)
2. Switch to WvW — catalog re-fetches, toggle updates
3. Switch back to PvE — cached catalog used, toggle updates
4. Open a skill detail panel — no badge in PvE mode
5. Switch to WvW with same skill — badge appears if skill has a split entry in `splits.json`
6. Hover preview also shows/hides badge appropriately
7. Save and reload a WvW build — mode persists, badge state correct

- [ ] **Step 3: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: Phase 2 balance splits cleanup"
```
