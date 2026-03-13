# Balance Splits Package Design (Phase 2)

## Overview

A self-contained library (`lib/gw2-balance-splits/`) that tracks which GW2 skills and traits have PvE vs WvW balance splits, stores the WvW-specific fact overrides, and exposes a simple API for consumers to resolve mode-appropriate facts. Lives as a subdirectory now; extracted to a standalone public npm package later.

## Data Model

**Core file:** `lib/gw2-balance-splits/data/splits.json`

```json
{
  "version": 1,
  "updatedAt": "2026-03-11T00:00:00Z",
  "skills": {
    "1234": {
      "name": "Example Skill",
      "modes": {
        "wvw": {
          "facts": [
            { "type": "Damage", "text": "Damage", "dmg_multiplier": 0.8, "hit_count": 1, "icon": "..." },
            { "type": "Buff", "text": "Might", "status": "Might", "duration": 5, "apply_count": 3 }
          ]
        }
      }
    }
  },
  "traits": {
    "5678": {
      "name": "Example Trait",
      "modes": {
        "wvw": {
          "facts": [...]
        }
      }
    }
  }
}
```

**Key decisions:**
- PvE is the API default — only WvW overrides are stored (keeps data small)
- Full `facts` array replacement per mode (no partial patches or index-based diffs)
- Skills and traits are separate top-level keys
- Keyed by string ID for JSON compatibility
- `name` stored for human readability when editing
- `version` field for future format migrations

## Package API

**`lib/gw2-balance-splits/index.js`:**

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

Three focused functions, stateless, no side effects. When extracted to its own repo, the interface stays identical — just change the `require` path to the npm package name.

## File Tree

```
lib/gw2-balance-splits/
  index.js              # Public API
  data/
    splits.json         # The registry (committed, version-controlled)
  scripts/
    seed.js             # Wiki scraper (C → B → A fallback)
```

## Wiki Scraper

**Entry point:** `lib/gw2-balance-splits/scripts/seed.js`

A Node.js script that builds `splits.json` by discovering all skills/traits with balance splits and extracting their WvW fact values.

### Fallback chain (most reliable → least reliable):

1. **SMW (Semantic MediaWiki) query** — The GW2 wiki uses Semantic MediaWiki. Query for all skill pages that have split properties (e.g., `[[Has game mode::WvW]]`). If the wiki exposes structured fact data via `ask.php`, parse directly into our facts format.

2. **Wikitext parsing** — Use the MediaWiki API (`api.php?action=parse&prop=wikitext`) to get raw template markup. Parse `{{skill infobox}}` and `{{split}}` templates to extract WvW-specific values. Map template fields to GW2 API fact types.

3. **HTML scraping** — Fetch rendered wiki pages, parse the "Game mode" or "Split" sections from the DOM. Extract fact values from tooltip tables. Most fragile but always available.

### Fallback strategy:
- The script tries SMW first. "Success" means the query returns at least one result with parseable split data. If the query returns zero results or the endpoint is unavailable, fall through to wikitext.
- Wikitext "success" means the template fields can be mapped to at least one GW2 API fact type. The mapping is defined in a lookup table within the script (e.g., wiki `damage` field → `{ type: "Damage", dmg_multiplier: value }`).
- HTML is the final fallback — always attempted if the prior two fail for a given skill.
- Per-skill fallback: each skill independently tries C → B → A. One skill using SMW and another using HTML in the same run is fine.

### Script behavior:
- First discovers which skills/traits have splits (via category pages or SMW queries)
- Iterates each split skill, trying fallback chain to extract WvW facts
- Cross-references with the GW2 API (`/v2/skills?ids=...`) to get base PvE facts for comparison
- Validates output: each split entry must have a non-empty `facts` array with valid `type` fields matching the GW2 API fact schema
- Outputs `splits.json`
- Logs which extraction method succeeded for each skill (for debugging)
- Idempotent — can re-run to refresh data

### Dependencies:
- Built-in `fetch` (Node 18+)
- `cheerio` for HTML fallback parsing
- No other heavy dependencies

## Integration with AxiForge

### Catalog layer (`src/main/gw2Data/catalog.js`)

Balance splits are applied during catalog construction, inside `getProfessionCatalog()`:

1. Import the splits API: `const { getSkillSplit, getTraitSplit } = require("../../lib/gw2-balance-splits")`
2. In `mapSkill()`, after all existing overrides, check for a split. Note: `mapSkill` is a closure defined inside `getProfessionCatalog()`, so `gameMode` is in scope via closure — do not extract `mapSkill` to module scope without passing `gameMode` explicitly.
   ```js
   // At end of mapSkill(), before returning the mapped object:
   if (gameMode !== "pve") {
     const split = getSkillSplit(skill.id, gameMode);
     if (split?.facts) {
       mapped.facts = split.facts;
       mapped.hasSplit = true;  // new field on the return shape
     }
   }
   ```
3. In the `weaponSkills` mapping block (separate from `mapSkill`, ~lines 609-620), apply the same split check. Weapon skills can have balance splits (e.g., different damage coefficients in WvW).
4. In the anonymous `traits.map()` block (~lines 557-592) — note: there is no `mapTrait()` function and no existing trait facts override pattern. Add the split check inline:
   ```js
   // Inside the traits.map() lambda, after building the trait object:
   if (gameMode !== "pve") {
     const split = getTraitSplit(trait.id, gameMode);
     if (split?.facts) {
       mapped.facts = split.facts;
       mapped.hasSplit = true;
     }
   }
   ```
5. The `hasSplit` flag (boolean, present only when `true`; `undefined` otherwise) lets the renderer show a visual indicator.

### Why this layer:
- Fits the existing skill override pattern (`KNOWN_SKILL_FACTS_OVERRIDES` already swaps fact arrays in `mapSkill`). Traits have no equivalent override mechanism yet — this spec adds one.
- Catalog cache is already keyed by `${professionId}_${gameMode}` (Phase 1)
- Renderer stays mode-unaware — it just renders whatever facts the catalog provides

### Renderer changes

**No changes to fact rendering logic.** The catalog arrives with correct facts for the mode. `resolveEntityFacts()` and the detail panel work unchanged.

**"WvW split" badge:** When `entity.hasSplit === true`, show a subtle badge on both:
- The pinned detail panel (`renderDetailPanel()`, lines 56-82 in `detail-panel.js`)
- The hover preview card (`buildSkillCard()`, lines 191-217 in `detail-panel.js`)

Both rendering paths already receive the full entity object, so `hasSplit` is available without plumbing changes.

### What doesn't change:
- Renderer catalog caching (already mode-aware)
- IPC signatures (gameMode already threaded through)
- Skill selection logic (facts aren't consulted for filtering)
- Build serialization (gameMode already serialized)

## Edge Cases

- **Skill not in registry:** No override applied; API default (PvE) facts shown for all modes. This is correct — most skills have identical balance across modes.
- **PvE mode:** `getSkillSplit` returns `null` immediately; no lookup performed.
- **Empty splits.json:** Package returns `null` for all lookups. App works identically to Phase 1.
- **Malformed split entry:** If `facts` array is missing or empty, skip the override (keep API default).
- **Registry update:** Re-run `seed.js`, commit updated `splits.json`. No code changes needed.

## Testing

### Package API (`lib/gw2-balance-splits/index.js`)
Unit tests with a mock `splits.json`:
- `getSkillSplit` returns `null` for PvE mode
- `getSkillSplit` returns the split entry for a known WvW skill
- `getSkillSplit` returns `null` for a skill with no split
- `getTraitSplit` same pattern
- `hasSplit` returns `true`/`false` correctly

### Catalog integration (`src/main/gw2Data/catalog.js`)
Integration tests verifying:
- Skills with splits get overridden facts when `gameMode === "wvw"`
- Skills with splits keep API facts when `gameMode === "pve"`
- Skills without splits are unaffected regardless of mode
- `hasSplit` flag is present on overridden skills, absent on others
- Same for traits and weapon skills

### Scraper (`scripts/seed.js`)
- Difficult to unit test (external wiki dependency). Test the parsing/mapping functions in isolation by feeding them sample wikitext/HTML fixtures.
- Validate `splits.json` schema with a simple script or test that checks structure.

## Future Extraction

When extracting to a standalone package:
1. Move `lib/gw2-balance-splits/` to its own repo
2. Add `package.json` with name `gw2-balance-splits`
3. Publish to npm
4. In AxiForge: `npm install gw2-balance-splits`, change `require` path
5. Public API is identical — no consumer code changes
