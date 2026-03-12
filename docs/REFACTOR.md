# GW2Builds Renderer Refactor Plan

## Problem

Three files carry almost the entire application:

| File | Lines | Concern |
|------|-------|---------|
| `src/renderer/renderer.js` | 5,092 | All UI, all business logic, all constants |
| `src/renderer/styles.css` | 2,545 | All styles (single flat file) |
| `src/main/gw2Data.js` | 1,026 | All GW2 API fetching and normalization |

These files are hard to navigate, reason about, and test in isolation.

---

## Goals

1. **Separation of concerns** — each file owns one domain
2. **Testability** — extracted modules can be tested directly (no `__testOnly` hack)
3. **Navigability** — find relevant code in < 5 seconds
4. **No regressions** — all existing tests must pass after refactoring
5. **No behavior changes** — purely structural

---

## Module System Strategy

The renderer runs in Electron's browser process via Vite (loaded as `type="module"`).
Tests run in Node.js via Jest (CommonJS `require()`).

**Approach:** Write all renderer modules as ES modules (native `export`). Configure Jest
with Babel transform for renderer source files, converting ESM to CJS at test time.

### Build system changes
- Add `@babel/core`, `@babel/preset-env`, `babel-jest` to devDependencies
- Add `babel.config.cjs` targeting `{ node: "current" }` (tests only, no browser polyfills)
- Add Jest `transform` rule matching `src/renderer/**/*.js`
- `src/main/` stays CommonJS — no changes to those tests

---

## Phase 1 — Renderer Module Extraction

### Target structure

```
src/renderer/
├── renderer.js              ← thin entry point: imports, init(), wireEvents()
└── modules/
    ├── constants.js         ← pure data: CDN URLs, weapon/food/utility arrays,
    │                           slot weights, stat combos, armor icons, boon icons
    ├── state.js             ← global state object + createEmptyEditor()
    ├── utils.js             ← pure utility functions with no DOM or state deps
    ├── custom-select.js     ← .cselect dropdown component (render + events)
    ├── editor.js            ← build editor business logic (serialize, enforce
    │                           consistency, import/export, dirty tracking)
    ├── skills.js            ← skill bar: weapon skills, F-skills, mechanic slots,
    │                           Antiquary, Revenant legends, Ranger pets
    ├── equipment.js         ← equipment panel UI, slot pickers, stats computation
    ├── specializations.js   ← spec selection dropdowns + trait grid
    ├── detail-panel.js      ← hover preview tooltip + skill/trait card rendering
    └── render-pages.js      ← page-level render functions (auth, onboarding,
                                build list, editor form, setup gate)
```

### Module ownership map

| Function | Current location | Target module |
|----------|-----------------|---------------|
| `_RW`, `_WK`, `GW2_WEAPONS`, `GW2_FOOD`, `GW2_UTILITY` | renderer.js:1029 | constants.js |
| `STAT_COMBOS`, `SLOT_WEIGHTS`, `EQUIP_*` | renderer.js:969 | constants.js |
| `PROFESSION_WEIGHT`, `LEGENDARY_ARMOR_ICONS` | renderer.js:1076 | constants.js |
| `GW2_RELICS`, `PROFESSION_CONCEPT_ART` | renderer.js:1110 | constants.js |
| `WEAPON_STRENGTH_MIDPOINT` | renderer.js:1054 | constants.js |
| `CONDUIT_F2_BY_SWAP` | renderer.js:961 | constants.js |
| `BOON_CONDITION_ICONS`, `BUFF_FACT_TYPES` | renderer.js:4950 | constants.js |
| `PROFESSION_BASE_HP` | renderer.js:2362 | constants.js |
| `ANTIQUARY_OFFENSIVE/DEFENSIVE_ARTIFACTS` | renderer.js:2637 | constants.js |
| `RANGER_PET_FAMILY_SKILLS` | renderer.js:2702 | constants.js |
| `state` object, `el` object | renderer.js:5 | state.js |
| `createEmptyEditor()` | renderer.js:4861 | state.js |
| `escapeHtml()` | renderer.js:5074 | utils.js |
| `formatDate()`, `formatPagesStatus()`, `tierLabel()` | renderer.js:4906 | utils.js |
| `matchesBuildQuery()` | renderer.js:4847 | utils.js |
| `parseWeaponSlotNum()` | renderer.js:2532 | utils.js |
| `parseTags()` | renderer.js:4766 | utils.js |
| `normalizeText()`, `decodeHtmlEntities()` | renderer.js:5051 | utils.js |
| `delay()` | renderer.js:5064 | utils.js |
| `makeButton()` | renderer.js:4814 | utils.js |
| `simplifyTrait()`, `simplifySkill()` | renderer.js:4742 | utils.js |
| `renderCustomSelect()`, `toggleCustomSelect()` | renderer.js:4180 | custom-select.js |
| `resetCustomSelectMenuPosition()` | renderer.js:4335 | custom-select.js |
| `closeCustomSelect()` | renderer.js:4344 | custom-select.js |
| `makeCustomSelectValueNode/IconNode()` | renderer.js:4254 | custom-select.js |
| `getSelectAnchorRect()` | renderer.js:4290 | custom-select.js |
| `enforceEditorConsistency()` | renderer.js:437 | editor.js |
| `chooseTraitId()`, `chooseSkillId()` | renderer.js:601 | editor.js |
| `createDefaultSpecializationSelections()` | renderer.js:392 | editor.js |
| `createDefaultSkillSelections()` | renderer.js:427 | editor.js |
| `createSpecializationSelection()` | renderer.js:415 | editor.js |
| `markEditorChanged()`, `captureEditorBaseline()` | renderer.js:4359 | editor.js |
| `computeEditorSignature()` | renderer.js:4375 | editor.js |
| `parseBuildImportPayload()` | renderer.js:4413 | editor.js |
| `resolveImportedProfession()` | renderer.js:4480 | editor.js |
| `normalizeImportedSpecializations()` | renderer.js:4489 | editor.js |
| `normalizeImportedSkills()`, `extractSkillId()` | renderer.js:4502 | editor.js |
| `serializeEditorToBuild()` | renderer.js:4641 | editor.js |
| `resolveLoadedBuildProfession()` | renderer.js:4631 | editor.js |
| `loadBuildIntoEditor()` | renderer.js:4538 | editor.js |
| `confirmDiscardDirty()` | renderer.js:4354 | editor.js |
| `buildMechanicSlotsForRender()` | renderer.js:2782 | skills.js |
| `buildRevenantEliteByProfSlot()` | renderer.js:73 | skills.js |
| `getSkillOptionsByType()` | renderer.js:4095 | skills.js |
| `getEquippedWeaponSkills()` | renderer.js:2537 | skills.js |
| `renderSkills()` | renderer.js:3127 | skills.js |
| `makeSkillSlot()` | renderer.js:2374 | skills.js |
| `openLegendPicker()` | renderer.js:3638 | skills.js |
| `openPetPicker()` | renderer.js:3663 | skills.js |
| `syncRevenantSkillsFromLegend()` | renderer.js:3684 | skills.js |
| `getAntiquaryArtifactPools()` | renderer.js:2654 | skills.js |
| `isAntiquaryProlificPlundererActive()` | renderer.js:2662 | skills.js |
| `randomizeAntiquaryArtifacts()` | renderer.js:2672 | skills.js |
| `resolveSkillSlotType()` | renderer.js:4162 | skills.js |
| `filterSkillList()` | renderer.js:4168 | skills.js |
| `computeSlotStats()`, `computeEquipmentStats()` | renderer.js:1216 | equipment.js |
| `openSlotPicker()`, `closeSlotPicker()` | renderer.js:1294 | equipment.js |
| `renderEquipmentPanel()` | renderer.js:1407 | equipment.js |
| `updateHealthOrb()` | renderer.js:1397 | equipment.js |
| `renderSpecializations()` | renderer.js:2101 | specializations.js |
| `getMajorTraitsByTier()` | renderer.js:4080 | specializations.js |
| `makeTraitButton()` | renderer.js:3778 | specializations.js |
| `drawSpecConnector()` | renderer.js:2307 | specializations.js |
| `renderDetailPanel()` | renderer.js:3709 | detail-panel.js |
| `buildSkillCard()` | renderer.js:3918 | detail-panel.js |
| `resolveEntityFacts()` | renderer.js:3860 | detail-panel.js |
| `getHoverMetaLine()` | renderer.js:3995 | detail-panel.js |
| `showHoverPreview()`, `hideHoverPreview()` | renderer.js:3946 | detail-panel.js |
| `bindHoverPreview()` | renderer.js:3812 | detail-panel.js |
| `positionHoverPreview()` | renderer.js:4016 | detail-panel.js |
| `formatFact()`, `formatFactHtml()` | renderer.js:4921 | detail-panel.js |
| `formatBuffConditionText()` | renderer.js:4913 | detail-panel.js |
| `selectDetail()` | renderer.js:4042 | detail-panel.js |
| `render()`, `renderAuth()`, `renderOnboarding()` | renderer.js:623 | render-pages.js |
| `renderBuildList()` | renderer.js:901 | render-pages.js |
| `renderEditor()`, `renderEditorForm()` | renderer.js:2014 | render-pages.js |
| `renderEditorMeta()` | renderer.js:2056 | render-pages.js |
| `renderSetupGate()`, `renderTargetPicker()` | renderer.js:759 | render-pages.js |
| `runPagesBuildPoll()`, `setPublishStatus()` | renderer.js:4773 | render-pages.js |

---

## Phase 2 — CSS Refactoring

### Target structure

```
src/renderer/
├── styles.css               ← redirects: @import './styles/index.css'
└── styles/
    ├── index.css            ← master import list
    ├── base.css             ← CSS variables, reset, typography
    ├── layout.css           ← app shell, nav, pages, subnav
    ├── titlebar.css         ← titlebar, workspace menu, window controls
    ├── components/
    │   ├── buttons.css      ← .btn variants, icon buttons
    │   ├── custom-select.css ← .cselect, .cselect-menu (position:fixed)
    │   ├── skill-slot.css   ← .skill-slot, weapon bar, mechanic bar
    │   ├── equipment.css    ← equipment panel, slot pickers, health orb
    │   ├── specializations.css ← spec panel, trait grid, connectors
    │   ├── detail-panel.css ← hover preview, skill/trait cards, facts
    │   └── build-list.css   ← library, build cards, search
    └── animations.css       ← @keyframes, transitions
```

---

## Phase 3 — gw2Data.js Refactoring

### Target structure

```
src/main/gw2Data/
├── index.js                 ← public API: getProfessionList, getProfessionCatalog, getWikiSummary
├── fetch.js                 ← fetchCachedJson, fetchGw2ByIds, chunk, dedupeNumbers
├── overrides.js             ← KNOWN_SKILL_SPEC_OVERRIDES, KNOWN_SKILL_SLOT_OVERRIDES,
│                               LEGEND_FLIP_OVERRIDES, PHOTON_FORGE_BUNDLE, etc.
├── mapSkill.js              ← mapSkill(), transformBundleBySpec()
└── catalog.js               ← getProfessionCatalog() orchestration + result assembly
```

Existing `src/main/gw2Data.js` becomes a re-export shim for backward compatibility
during the transition (one line: `module.exports = require('./gw2Data/index')`).

---

## Test Strategy

### What changes
- Integration harness (`tests/integration/professions/harness.js`): replace
  `require('renderer').__testOnly.buildMechanicSlotsForRender` with
  `require('src/renderer/modules/skills').buildMechanicSlotsForRender`
- Unit renderer tests (`tests/unit/renderer/`): import from module files directly
- `tests/unit/renderer/resolveEntityFacts.test.js`: import from `detail-panel.js`
- `mechanicsSuite.js`: import skills/editor functions from modules

### What stays the same
- All `tests/unit/` tests for main-process code (`gw2Data`, `buildStore`, etc.)
- All `tests/integration/professions/*.test.js` test logic (only import paths change)
- All assertion expectations

### Jest configuration additions
```json
"transform": {
  "^.+/src/renderer/.+\\.js$": ["babel-jest", {}]
},
"transformIgnorePatterns": [
  "/node_modules/",
  "/src/main/"
]
```

```js
// babel.config.cjs
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
};
```

---

## Execution Checklist

### Phase 0 — Build system
- [x] Create module directories
- [x] Install Babel deps (`@babel/core`, `@babel/preset-env`, `babel-jest`)
- [x] Add `babel.config.cjs` targeting `{ node: "current" }`
- [x] Update Jest `transform` config for `src/renderer/**/*.js`
- [x] Verify existing tests still pass

### Phase 1 — Renderer modules (in dependency order)
- [x] `constants.js` — no deps, pure data
- [x] `state.js` — imports constants
- [x] `utils.js` — imports constants, no DOM/state deps
- [x] `stats.js` — shared stats computation (breaks potential circular dep between equipment + detail-panel)
- [x] `custom-select.js` — imports utils, state
- [x] `detail-panel.js` — imports constants, utils, state
- [x] `specializations.js` — imports constants, utils, state, detail-panel
- [x] `skills.js` — imports constants, utils, state, detail-panel
- [x] `equipment.js` — imports constants, utils, state, custom-select, detail-panel, stats
- [x] `editor.js` — imports constants, utils, state, skills
- [x] `render-pages.js` — imports all above
- [x] Slim `renderer.js` to thin entry point (~340 lines)

### Phase 2 — Tests
- [x] Update `harness.js` import paths (direct imports from `modules/skills`)
- [x] Update `mechanicsSuite.js` import paths (direct imports from `modules/skills`)
- [x] Update `resolveEntityFacts.test.js` (import from `modules/detail-panel` + `modules/state`)
- [x] Run full suite — 630 tests pass, 0 failures

### Phase 3 — CSS
- [x] Create `styles/` subdirectory with 10 component files
  - `base.css`, `layout.css`, `buttons.css`, `forms.css`, `custom-select.css`
  - `cards.css`, `specializations.css`, `skills.css`, `detail-panel.css`, `equipment.css`
- [x] `styles.css` replaced with `@import` entry point (11 lines)
- [ ] Verify no visual regressions (manual)

### Phase 4 — gw2Data.js
- [x] Create `gw2Data/` subdirectory with 5 submodules
  - `fetch.js` — HTTP layer, cache, `fetchJson`, `fetchCachedJson`, `fetchGw2ByIds`, `chunk`, `dedupeNumbers`
  - `overrides.js` — all static override maps (`KNOWN_SKILL_*`, bundle constants, `FIREBRAND_TOME_CHAPTERS`, `FACT_ICONS`, etc.)
  - `wiki.js` — `getWikiSummary`, `buildWikiFallbackUrl`, `buildWikiFilePath`
  - `catalog.js` — `getProfessionList`, `getProfessionCatalog` (imports overrides; `mapSkill` stays as inner function)
  - `index.js` — re-exports public API
- [x] `gw2Data.js` reduced to 1-line re-export shim
- [x] Run gw2Data unit tests — all pass

---

## Anti-patterns to avoid

- **No behavior changes** — this is structural only
- **No new abstractions** — move code as-is; refine later
- **No premature optimization** — state sharing via import references, not prop-drilling refactors
- **`__testOnly` shim** kept in `renderer.js` for any future backward compat needs, but all tests now import directly from modules
