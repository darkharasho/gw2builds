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

### Script behavior:
- First discovers which skills/traits have splits (via category pages or SMW queries)
- Iterates each split skill, trying fallback chain to extract WvW facts
- Cross-references with the GW2 API (`/v2/skills?ids=...`) to get base PvE facts for comparison
- Outputs `splits.json`
- Logs which extraction method succeeded for each skill (for debugging)
- Idempotent — can re-run to refresh data

### Dependencies:
- Built-in `fetch` (Node 18+)
- `cheerio` for HTML fallback parsing
- No other heavy dependencies

## Integration with GW2Builds

### Catalog layer (`src/main/gw2Data/catalog.js`)

Balance splits are applied during catalog construction, inside `getProfessionCatalog()`:

1. Import the splits API: `const { getSkillSplit, getTraitSplit } = require("../../lib/gw2-balance-splits")`
2. In `mapSkill()`, after all existing overrides, check for a split:
   ```js
   if (gameMode !== "pve") {
     const split = getSkillSplit(skill.id, gameMode);
     if (split?.facts) {
       mapped.facts = split.facts;
       mapped.hasSplit = true;
     }
   }
   ```
3. Same pattern for traits in the trait mapping loop
4. The `hasSplit` flag lets the renderer show a visual indicator

### Why this layer:
- Fits the existing override pattern (`KNOWN_SKILL_FACTS_OVERRIDES` already swaps fact arrays here)
- Catalog cache is already keyed by `${professionId}_${gameMode}` (Phase 1)
- Renderer stays mode-unaware — it just renders whatever facts the catalog provides

### Renderer changes

**No changes to fact rendering logic.** The catalog arrives with correct facts for the mode. `resolveEntityFacts()` and the detail panel work unchanged.

**One addition:** When `entity.hasSplit === true`, the detail panel shows a subtle "WvW split" badge on the skill/trait card. This tells the user the values shown differ from PvE.

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

## Future Extraction

When extracting to a standalone package:
1. Move `lib/gw2-balance-splits/` to its own repo
2. Add `package.json` with name `gw2-balance-splits`
3. Publish to npm
4. In GW2Builds: `npm install gw2-balance-splits`, change `require` path
5. Public API is identical — no consumer code changes
