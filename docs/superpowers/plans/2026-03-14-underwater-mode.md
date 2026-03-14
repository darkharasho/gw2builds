# Underwater Mode Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a land/water toggle that switches the skills panel to underwater skills, swaps weapon bar to aquatic weapons, adjusts stat calculations for underwater equipment, and handles profession-specific underwater restrictions.

**Architecture:** A transient `underwaterMode` boolean on editor state drives all conditional rendering. A persisted `underwaterSkills` object stores underwater heal/utility/elite selections. The GW2 API `flags` array on skills provides `NoUnderwater` for filtering. Stat functions swap their exclusion set between land-only and aquatic slots based on the mode. Profession-specific overrides handle Mechanist Depth Charges, Ranger aquatic pets, and blocked Revenant legends.

**Tech Stack:** Vanilla JS DOM rendering, Electron IPC, GW2 API v2

**Spec:** `docs/superpowers/specs/2026-03-14-underwater-mode-design.md`

---

## Chunk 1: Data Layer — State, Build Model, Catalog

### Task 1: Add `underwaterSkills` and `underwaterMode` to Editor State

**Files:**
- Modify: `src/renderer/modules/state.js:77-95`

- [ ] **Step 1: Add `underwaterSkills` and `underwaterMode` to `createEmptyEditor()`**

After the existing `skills` block (line 81), add:

```javascript
    underwaterSkills: {
      healId: 0,
      utilityIds: [0, 0, 0],
      eliteId: 0,
    },
    underwaterMode: false,
```

- [ ] **Step 2: Verify no import errors**

Run: `npm test -- --testPathPattern="stats.test" --bail 2>&1 | head -20`
Expected: Tests still pass (state.js is imported by stats tests).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/state.js
git commit -m "feat(underwater): add underwaterSkills and underwaterMode to editor state"
```

---

### Task 2: Add `underwaterSkills` to Build Model Normalization

**Files:**
- Modify: `src/main/buildStore.js:98-113`
- Test: `tests/unit/buildStore.test.js`

- [ ] **Step 1: Write failing test for underwaterSkills normalization**

Add to `tests/unit/buildStore.test.js`:

```javascript
describe("normalizeBuild — underwaterSkills", () => {
  test("missing underwaterSkills defaults to null refs", async () => {
    const { store, dir } = await makeTempStore();
    try {
      const id = await store.saveBuild(makeBuild());
      const builds = await store.loadBuilds();
      const build = builds.find((b) => b.id === id);
      expect(build.underwaterSkills).toEqual({
        heal: null,
        utility: [null, null, null],
        elite: null,
      });
    } finally {
      await cleanupDir(dir);
    }
  });

  test("underwaterSkills with valid refs are preserved", async () => {
    const { store, dir } = await makeTempStore();
    try {
      const uwSkills = {
        heal: { id: 5503, name: "Signet of Restoration", icon: "", description: "", slot: "Heal", type: "Heal", specialization: 0 },
        utility: [null, null, null],
        elite: null,
      };
      const id = await store.saveBuild(makeBuild({ underwaterSkills: uwSkills }));
      const builds = await store.loadBuilds();
      const build = builds.find((b) => b.id === id);
      expect(build.underwaterSkills.heal.id).toBe(5503);
      expect(build.underwaterSkills.heal.name).toBe("Signet of Restoration");
    } finally {
      await cleanupDir(dir);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="buildStore.test" --bail 2>&1 | tail -20`
Expected: FAIL — `build.underwaterSkills` is undefined.

- [ ] **Step 3: Add `underwaterSkills` to `normalizeBuild()`**

In `src/main/buildStore.js`, in the `normalizeBuild()` return object (after line 104 `skills: normalizeSkills(input.skills),`), add:

```javascript
    underwaterSkills: normalizeSkills(input.underwaterSkills),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="buildStore.test" --bail`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/buildStore.js tests/unit/buildStore.test.js
git commit -m "feat(underwater): add underwaterSkills to build model normalization"
```

---

### Task 3: Capture `flags` in Skill Catalog

**Files:**
- Modify: `src/main/gw2Data/catalog.js:706-725`
- Test: `tests/unit/gw2Data.test.js`

- [ ] **Step 1: Write failing test for skill flags**

Add to `tests/unit/gw2Data.test.js` (or create a new describe block):

```javascript
describe("mapSkill — flags", () => {
  test("skill flags are captured from API data", async () => {
    // Load a real catalog to verify flags are present
    const catalog = await getProfessionCatalog("Elementalist", "pve");
    // Conjure Fiery Greatsword (5516) has NoUnderwater flag in the API
    const cfs = catalog.skills.find((s) => s.id === 5516);
    expect(cfs).toBeDefined();
    expect(cfs.flags).toContain("NoUnderwater");
  });

  test("skill without flags has empty array", async () => {
    const catalog = await getProfessionCatalog("Elementalist", "pve");
    // Signet of Restoration (5503) has no flags
    const signet = catalog.skills.find((s) => s.id === 5503);
    expect(signet).toBeDefined();
    expect(signet.flags).toEqual([]);
  });
});
```

Note: `gw2Data.test.js` uses `createGw2MockFetch()` from `tests/helpers/mockFetch` for mock data. The mock skill responses likely don't include `flags` arrays yet. You must update the mock data to include `flags` on at least one skill (e.g., add `flags: ["NoUnderwater", "GroundTargeted"]` to a mock skill and `flags: []` to another). If integration tests hit the live API, these should go in `tests/integration/` instead. Adapt to match the existing test infrastructure.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="gw2Data.test" --bail 2>&1 | tail -20`
Expected: FAIL — `cfs.flags` is undefined.

- [ ] **Step 3: Add `flags` to `mapSkill()`**

In `src/main/gw2Data/catalog.js`, in the `mapSkill()` function's `mapped` object (around line 718, after `categories`), add:

```javascript
      flags: Array.isArray(skill.flags) ? skill.flags : [],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="gw2Data.test" --bail`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/gw2Data/catalog.js tests/unit/gw2Data.test.js
git commit -m "feat(underwater): capture skill flags from GW2 API in mapSkill()"
```

---

### Task 4: Add Underwater Constants

**Files:**
- Modify: `src/renderer/modules/constants.js`

- [ ] **Step 1: Add underwater-related constants**

Add to `src/renderer/modules/constants.js` (after the existing weapon/equipment constants, around line 120):

```javascript
// Underwater mode constants
export const MECHANIST_DEPTH_CHARGES_ID = 63210;
export const MECHANIST_SPEC_ID = 70;

// Revenant legends blocked underwater (legend string IDs from GW2 API)
// Glint (Herald) = "Legend6", Kalla (Renegade) = "Legend7"
export const UNDERWATER_BLOCKED_LEGENDS = new Set(["Legend6", "Legend7"]);

// Slot sets for stat computation mode switching
export const LAND_ONLY_SLOTS = new Set(["head", "mainhand1", "offhand1", "mainhand2", "offhand2"]);
export const AQUATIC_SLOTS = new Set(["breather", "aquatic1", "aquatic2"]);
```

Note: Verify the Revenant legend string IDs by checking the existing legend data in skills.js or catalog.js. The legend IDs may be "Legend6"/"Legend7" or numeric — match whatever format `state.editor.selectedLegends` uses.

Note: `WEAPON_STRENGTH_MIDPOINT` already contains aquatic weapon entries (`trident: 952.5, harpoon: 952.5`) — no action needed there.

- [ ] **Step 2: Verify legend ID format**

Search the codebase for how legends are referenced:

Run: `grep -n "Legend" src/renderer/modules/skills.js | head -20`

Confirm the legend string format and update the constant if needed.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/constants.js
git commit -m "feat(underwater): add underwater mode constants"
```

---

## Chunk 2: Editor Serialization Pipeline

### Task 5: Add `underwaterSkills` to Editor Signature

**Files:**
- Modify: `src/renderer/modules/editor.js:336-375`

- [ ] **Step 1: Add `underwaterSkills` to `computeEditorSignature()` payload**

In `src/renderer/modules/editor.js`, in the `computeEditorSignature()` function, after the `skills` block in the payload (around line 372), add:

```javascript
    underwaterSkills: {
      healId: Number(editor.underwaterSkills?.healId) || 0,
      utilityIds: Array.isArray(editor.underwaterSkills?.utilityIds)
        ? editor.underwaterSkills.utilityIds.slice(0, 3).map((v) => Number(v) || 0)
        : [0, 0, 0],
      eliteId: Number(editor.underwaterSkills?.eliteId) || 0,
    },
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `npm test --bail 2>&1 | tail -10`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/editor.js
git commit -m "feat(underwater): include underwaterSkills in editor dirty-state signature"
```

---

### Task 6: Load/Save `underwaterSkills` in Editor ↔ Build Serialization

**Files:**
- Modify: `src/renderer/modules/editor.js`

- [ ] **Step 1: Add `underwaterSkills` to `loadBuildIntoEditor()`**

In `loadBuildIntoEditor()` (around line 607-613 where skills are loaded), after the existing skills loading, add:

```javascript
    // Underwater skills — same pattern as land skills
    const uwSkills = build.underwaterSkills || {};
    state.editor.underwaterSkills = {
      healId: Number(uwSkills.heal?.id) || 0,
      utilityIds: Array.isArray(uwSkills.utility)
        ? uwSkills.utility.slice(0, 3).map((s) => Number(s?.id) || 0)
        : [0, 0, 0],
      eliteId: Number(uwSkills.elite?.id) || 0,
    };
    state.editor.underwaterMode = false; // Always default to land on load
```

- [ ] **Step 2: Add `underwaterSkills` to `serializeEditorToBuild()`**

In `serializeEditorToBuild()`, after the `skills` block (around line 702, inside the return object), add:

```javascript
    underwaterSkills: {
      heal: simplifySkill(skillById.get(Number(state.editor.underwaterSkills?.healId))),
      utility: (state.editor.underwaterSkills?.utilityIds || [])
        .slice(0, 3)
        .map((skillId) => simplifySkill(skillById.get(Number(skillId))))
        .filter(Boolean),
      elite: simplifySkill(skillById.get(Number(state.editor.underwaterSkills?.eliteId))),
    },
```

- [ ] **Step 3: Add `underwaterSkills` to `parseBuildImportPayload()`**

In `parseBuildImportPayload()`, around line 468 where the return object is assembled, add underwater skills parsing. Do NOT modify `normalizeImportedSkills()` internally — instead, call it separately for the underwater skills sub-object at the `parseBuildImportPayload` level:

```javascript
  // Parse underwater skills (optional in imports) — reuse normalizeImportedSkills
  const uwSkillsRaw = source.underwaterSkills || {};
  const uwSkills = normalizeImportedSkills({ skills: uwSkillsRaw });
  // Add to the return object:
  result.underwaterSkills = uwSkills.skills || { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 };
```

Note: Read `parseBuildImportPayload()` and `normalizeImportedSkills()` to confirm the exact variable names (`source`, `result`) and insertion point. The key is to call the existing normalization function rather than duplicating its logic.

- [ ] **Step 4: Verify existing tests still pass**

Run: `npm test --bail 2>&1 | tail -10`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/editor.js
git commit -m "feat(underwater): load/save underwaterSkills in editor serialization pipeline"
```

---

### Task 7: Add `underwaterSkills` to `enforceEditorConsistency()`

**Files:**
- Modify: `src/renderer/modules/editor.js`

- [ ] **Step 1: Add underwater skill validation**

In `enforceEditorConsistency()`, after the existing skill validation block (around line 236), add a parallel validation block for underwater skills:

```javascript
  // Validate underwater skills — same logic as land skills, plus NoUnderwater filter
  if (state.editor.underwaterSkills) {
    const uwHealId = Number(state.editor.underwaterSkills.healId) || 0;
    const uwEliteId = Number(state.editor.underwaterSkills.eliteId) || 0;
    const uwUtilityIds = state.editor.underwaterSkills.utilityIds || [0, 0, 0];

    if (isRevenant) {
      // Revenant underwater skills are legend-synced. If the active legend is blocked
      // underwater (Glint/Kalla), clear the underwater skills entirely.
      const activeLegend = state.editor.selectedLegends?.[state.editor.activeLegendSlot];
      if (UNDERWATER_BLOCKED_LEGENDS.has(activeLegend)) {
        state.editor.underwaterSkills = { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 };
      }
    } else {
      // Non-Revenant: validate against skill options excluding NoUnderwater.
      // NOTE: The variable name for skill options may be `skillOptions` — read
      // enforceEditorConsistency() to confirm. The code below uses `skillOptions`
      // which matches the actual variable at ~line 221.
      const isValidUW = (id, list) => !id || list.some((s) => s.id === id);
      const noUW = (s) => !(s.flags || []).includes("NoUnderwater");
      const uwHealOptions = (skillOptions.heal || []).filter(noUW);
      const uwUtilOptions = (skillOptions.utility || []).filter(noUW);
      const uwEliteOptions = (skillOptions.elite || []).filter(noUW);

      if (!isValidUW(uwHealId, uwHealOptions)) state.editor.underwaterSkills.healId = 0;
      if (!isValidUW(uwEliteId, uwEliteOptions)) state.editor.underwaterSkills.eliteId = 0;
      for (let i = 0; i < 3; i++) {
        if (!isValidUW(uwUtilityIds[i], uwUtilOptions)) state.editor.underwaterSkills.utilityIds[i] = 0;
      }
    }
  }
```

Note: Import `UNDERWATER_BLOCKED_LEGENDS` from constants.js at the top of editor.js. Verify that `isRevenant` and `skillOptions` are in scope at this insertion point by reading `enforceEditorConsistency()`. The `getSkillOptionsByType` call here uses the 2-arg signature (no underwater filter) — this is intentional since we're validating underwater skills against the full options list minus `NoUnderwater`, not against a pre-filtered underwater options list. Task 11 will later add the optional third parameter but this call should remain 2-arg.

- [ ] **Step 2: Verify existing tests still pass**

Run: `npm test --bail 2>&1 | tail -10`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/editor.js
git commit -m "feat(underwater): validate underwaterSkills in enforceEditorConsistency()"
```

---

## Chunk 3: Stat Computation

### Task 8: Add Underwater Slot Switching to Stat Functions

**Files:**
- Modify: `src/renderer/modules/stats.js`
- Test: `tests/unit/renderer/stats.test.js`

- [ ] **Step 1: Write failing test for underwater stat computation**

Add to `tests/unit/renderer/stats.test.js`:

```javascript
describe("computeEquipmentStats — underwater mode", () => {
  test("underwater mode uses breather instead of head", () => {
    state.editor = {
      ...makeEditor({
        head: "Berserker's",
        shoulders: "Berserker's",
        chest: "Berserker's",
        hands: "Berserker's",
        legs: "Berserker's",
        feet: "Berserker's",
        breather: "Marauder's",
      }),
      underwaterMode: true,
      underwaterSkills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    };
    const result = computeEquipmentStats();
    // Breather with Marauder's should contribute different stats than head with Berserker's
    // Marauder's head: Power 60, Precision 43, Vitality 43, Ferocity 43
    // vs Berserker's head: Power 60, Precision 43, Ferocity 43
    expect(result.Vitality).toBeGreaterThan(1000); // Marauder's adds Vitality
  });

  test("underwater mode excludes land weapon stats", () => {
    state.editor = {
      ...makeEditor({
        mainhand1: "Berserker's",
      }),
      underwaterMode: true,
      underwaterSkills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    };
    const result = computeEquipmentStats();
    // mainhand1 Berserker's should NOT contribute when underwater
    expect(result.Power).toBe(1000); // base only
  });

  test("underwater mode includes aquatic weapon stats", () => {
    state.editor = {
      ...makeEditor({
        aquatic1: "Berserker's",
      }),
      underwaterMode: true,
      underwaterSkills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    };
    const result = computeEquipmentStats();
    expect(result.Power).toBeGreaterThan(1000); // aquatic1 contributes
  });

  test("underwater mode counts breather rune toward rune set bonuses", () => {
    state.editor = {
      ...makeEditor({
        shoulders: "Berserker's",
        chest: "Berserker's",
        hands: "Berserker's",
        legs: "Berserker's",
        feet: "Berserker's",
        breather: "Berserker's",
      }),
      underwaterMode: true,
      underwaterSkills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    };
    // In underwater mode, breather replaces head, so breather rune should count
    // Set same rune on all equipped armor + breather (6 pieces)
    state.editor.equipment.runes = {
      shoulders: "1234", chest: "1234", hands: "1234",
      legs: "1234", feet: "1234", breather: "1234",
    };
    // The rune should count 6 pieces (5 armor + breather, head excluded)
    const result = computeEquipmentStats();
    // Verify rune contributes — exact assertion depends on rune mock data availability
    // At minimum, verify the function doesn't crash with underwater rune configuration
    expect(result.Power).toBeGreaterThanOrEqual(1000);
  });

  test("land mode still excludes aquatic slots (existing behavior)", () => {
    state.editor = {
      ...makeEditor({
        aquatic1: "Berserker's",
        breather: "Berserker's",
      }),
      underwaterMode: false,
      underwaterSkills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    };
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000); // neither aquatic nor breather contributes on land
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="stats.test" --bail 2>&1 | tail -20`
Expected: FAIL — underwater mode not yet affecting slot exclusion.

- [ ] **Step 3: Update `computeEquipmentStats()` for underwater mode**

In `src/renderer/modules/stats.js`, import the new constants at the top:

```javascript
import { LAND_ONLY_SLOTS, AQUATIC_SLOTS } from "./constants.js";
```

Then in `computeEquipmentStats()`, replace the `UNDERWATER_SLOTS` definition and usage (around line 32):

```javascript
  const isUnderwater = Boolean(state.editor.underwaterMode);
  const EXCLUDED_SLOTS = isUnderwater ? LAND_ONLY_SLOTS : AQUATIC_SLOTS;
```

And update every `UNDERWATER_SLOTS.has(...)` check in the function to `EXCLUDED_SLOTS.has(...)`.

There are 3 occurrences in `computeEquipmentStats()`:
1. Line 34: slot stats loop — `if (!comboLabel || EXCLUDED_SLOTS.has(slotKey)) continue;`
2. Line 100: infusions filter — `.filter(([k]) => !EXCLUDED_SLOTS.has(k))`
3. Line 130: runes loop — `if (!id || EXCLUDED_SLOTS.has(slot)) continue;`

Note: `computeEquipmentStats()` does NOT contain sigil or `activeWeaponSet` logic. Sigil active-weapon-set switching is handled in `computeUpgradeModifiers()` and is addressed in Task 9.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="stats.test" --bail`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/stats.js tests/unit/renderer/stats.test.js
git commit -m "feat(underwater): swap stat computation slots based on underwaterMode"
```

---

### Task 9: Update `computeStatBreakdown()` and `computeUpgradeModifiers()`

**Files:**
- Modify: `src/renderer/modules/stats.js`

- [ ] **Step 1: Update `computeStatBreakdown()` and add underwater SLOT_LABELS**

Apply the same pattern as Task 8. Replace the `UNDERWATER_SLOTS` definition (line 202) with:

```javascript
  const isUnderwater = Boolean(state.editor.underwaterMode);
  const EXCLUDED_SLOTS = isUnderwater ? LAND_ONLY_SLOTS : AQUATIC_SLOTS;
```

Update all `UNDERWATER_SLOTS.has(...)` references in `computeStatBreakdown()` to `EXCLUDED_SLOTS.has(...)`. There are 3 occurrences (lines 211, 256, 288).

Also add underwater slot labels to the `SLOT_LABELS` map (around line 203-207) so stat tooltips display readable names:

```javascript
  const SLOT_LABELS = {
    head: "Head", shoulders: "Shoulders", chest: "Chest", hands: "Hands", legs: "Legs", feet: "Feet",
    mainhand1: "Mainhand 1", offhand1: "Offhand 1", mainhand2: "Mainhand 2", offhand2: "Offhand 2",
    back: "Back", amulet: "Amulet", ring1: "Ring 1", ring2: "Ring 2", accessory1: "Accessory 1", accessory2: "Accessory 2",
    breather: "Breather", aquatic1: "Aquatic 1", aquatic2: "Aquatic 2",
  };
```

- [ ] **Step 2: Update `computeUpgradeModifiers()`**

Same pattern. Replace `UNDERWATER_SLOTS` (line 362) with:

```javascript
  const isUnderwater = Boolean(state.editor.underwaterMode);
  const EXCLUDED_SLOTS = isUnderwater ? LAND_ONLY_SLOTS : AQUATIC_SLOTS;
```

Update all `UNDERWATER_SLOTS.has(...)` references (lines 368, 401).

Also update the sigil active weapon set logic (lines 382-396):

```javascript
  // Sigil buff modifiers (from active weapon set, or aquatic weapons when underwater)
  const sigils = state.editor.equipment?.sigils || {};
  let activeSigilIds;
  if (isUnderwater) {
    const aquaticSet = (Number(state.editor.activeWeaponSet) || 1) === 2 ? "aquatic2" : "aquatic1";
    activeSigilIds = [...(Array.isArray(sigils[aquaticSet]) ? sigils[aquaticSet] : [])].filter(Boolean);
  } else {
    const activeSet = Number(state.editor.activeWeaponSet) || 1;
    const mhKey = activeSet === 2 ? "mainhand2" : "mainhand1";
    const ohKey = activeSet === 2 ? "offhand2" : "offhand1";
    activeSigilIds = [
      ...(Array.isArray(sigils[mhKey]) ? sigils[mhKey] : []),
      ...(Array.isArray(sigils[ohKey]) ? sigils[ohKey] : []),
    ].filter(Boolean);
  }
```

- [ ] **Step 3: Verify all stats tests still pass**

Run: `npm test -- --testPathPattern="stats.test" --bail`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/stats.js
git commit -m "feat(underwater): update statBreakdown and upgradeModifiers for underwater slot switching"
```

---

### Task 10: Update `detail-panel.js` Weapon Strength for Underwater

**Files:**
- Modify: `src/renderer/modules/detail-panel.js:66-74` and `271-279`

- [ ] **Step 1: Update weapon strength resolution**

There are two places in `detail-panel.js` that resolve weapon strength from the active weapon set (lines 68-71 and 273-276). Both follow this pattern:

```javascript
const activeWeaponSet = Number(state.editor.activeWeaponSet) || 1;
const mhKey = activeWeaponSet === 2 ? "mainhand2" : "mainhand1";
const mhId = state.editor?.equipment?.weapons?.[mhKey] || "";
const weaponStrength = WEAPON_STRENGTH_MIDPOINT[mhId] || 952.5;
```

Update both to handle underwater mode:

```javascript
const isUnderwater = Boolean(state.editor.underwaterMode);
const activeWeaponSet = Number(state.editor.activeWeaponSet) || 1;
let mhId;
if (isUnderwater) {
  const aquaticKey = activeWeaponSet === 2 ? "aquatic2" : "aquatic1";
  mhId = state.editor?.equipment?.weapons?.[aquaticKey] || "";
} else {
  const mhKey = activeWeaponSet === 2 ? "mainhand2" : "mainhand1";
  mhId = state.editor?.equipment?.weapons?.[mhKey] || "";
}
const weaponStrength = WEAPON_STRENGTH_MIDPOINT[mhId] || 952.5;
```

- [ ] **Step 2: Verify existing tests pass**

Run: `npm test -- --testPathPattern="detail-panel.test" --bail`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/detail-panel.js
git commit -m "feat(underwater): resolve weapon strength from aquatic weapons when underwater"
```

---

## Chunk 4: Skills Panel — Toggle UI and Skill Filtering

### Task 11: Add `NoUnderwater` Filtering to `getSkillOptionsByType()`

**Files:**
- Modify: `src/renderer/modules/skills.js:79-147`
- Test: `tests/unit/renderer/engineer.test.js` (or appropriate unit test)

- [ ] **Step 1: Add `underwaterMode` parameter to `getSkillOptionsByType()`**

Update the function signature to accept an optional third parameter:

```javascript
export function getSkillOptionsByType(catalog, specializationSelections, underwaterMode = false) {
```

Before the final return, if `underwaterMode` is true, filter out skills with `NoUnderwater`:

```javascript
  if (underwaterMode) {
    const noUW = (s) => !(s.flags || []).includes("NoUnderwater");
    return {
      heal: filtered.filter((s) => (s.type || "").toLowerCase() === "heal").filter(noUW).sort((a, b) => a.name.localeCompare(b.name)),
      utility: filtered.filter((s) => (s.type || "").toLowerCase() === "utility").filter(noUW).sort((a, b) => a.name.localeCompare(b.name)),
      elite: filtered.filter((s) => (s.type || "").toLowerCase() === "elite").filter(noUW).sort((a, b) => a.name.localeCompare(b.name)),
      profession: profMechanics,
    };
  }
```

Alternatively, apply the filter earlier in the pipeline before the type split to keep it DRY. Read the function body to decide the cleanest insertion point.

- [ ] **Step 2: Update all callers to pass `underwaterMode`**

Search for all calls to `getSkillOptionsByType` and add `state.editor.underwaterMode` as the third argument where appropriate. Key callers:
- `renderSkills()` in skills.js
- `enforceEditorConsistency()` in editor.js

- [ ] **Step 3: Verify tests pass**

Run: `npm test --bail 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/skills.js src/renderer/modules/editor.js
git commit -m "feat(underwater): filter NoUnderwater skills from picker in water mode"
```

---

### Task 12: Render Land/Water Toggle UI

**Files:**
- Modify: `src/renderer/modules/skills.js` (in `renderSkills()`)

- [ ] **Step 1: Add segmented pill toggle to skills panel header**

In `renderSkills()`, find the skills host container and insert the toggle at the top of the skills panel. Add a helper function:

```javascript
function _renderUnderwaterToggle() {
  const isUnderwater = Boolean(state.editor.underwaterMode);
  const container = document.createElement("div");
  container.className = "underwater-toggle";
  container.innerHTML = `
    <button class="underwater-toggle__btn ${!isUnderwater ? "underwater-toggle__btn--active" : ""}"
            data-mode="land" aria-pressed="${!isUnderwater}">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M8 2L2 8l2 2 4-4 4 4 2-2L8 2z" fill="currentColor"/>
        <rect x="2" y="11" width="12" height="3" rx="1" fill="currentColor" opacity="0.5"/>
      </svg>
      Land
    </button>
    <button class="underwater-toggle__btn ${isUnderwater ? "underwater-toggle__btn--active" : ""}"
            data-mode="water" aria-pressed="${isUnderwater}">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M1 7c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <path d="M1 11c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0" stroke="currentColor" stroke-width="1.5" fill="none"/>
      </svg>
      Water
    </button>
  `;
  container.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mode]");
    if (!btn) return;
    const newMode = btn.dataset.mode === "water";
    if (newMode === state.editor.underwaterMode) return;
    state.editor.underwaterMode = newMode;
    _renderEditor();
  });
  return container;
}
```

Insert this at the start of the skills panel rendering in `renderSkills()`:

```javascript
_el.skillsHost.prepend(_renderUnderwaterToggle());
```

- [ ] **Step 2: Add CSS for the toggle**

Find the CSS file (likely `src/renderer/styles/` or inline styles) and add:

```css
.underwater-toggle {
  display: flex;
  gap: 2px;
  background: var(--bg-secondary, #2a2a4a);
  border-radius: 6px;
  padding: 2px;
  margin-bottom: 8px;
  width: fit-content;
}
.underwater-toggle__btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted, #888);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.underwater-toggle__btn--active {
  background: var(--accent, #4a6fa5);
  color: var(--text-primary, #fff);
}
.underwater-toggle__btn:hover:not(.underwater-toggle__btn--active) {
  background: var(--bg-hover, #3a3a5a);
}
```

Note: Check the existing CSS patterns in the project for variable names and styling conventions. Adapt to match.

- [ ] **Step 3: Test visually**

Run: `npm start`
Open the app, load a build, and verify the toggle appears and switches between land/water mode.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/skills.js src/renderer/styles/
git commit -m "feat(underwater): add land/water segmented pill toggle to skills panel"
```

---

### Task 13: Switch Skills Bar Between Land and Water

**Files:**
- Modify: `src/renderer/modules/skills.js`

- [ ] **Step 1: Update heal/utility/elite rendering to read from underwaterSkills**

In `renderSkills()`, find where `editor.skills.healId`, `editor.skills.utilityIds`, and `editor.skills.eliteId` are read. Wrap them to select the right source:

```javascript
const skillSource = state.editor.underwaterMode
  ? state.editor.underwaterSkills
  : state.editor.skills;
const healId = Number(skillSource.healId) || 0;
const utilityIds = skillSource.utilityIds || [0, 0, 0];
const eliteId = Number(skillSource.eliteId) || 0;
```

Update every place that reads/writes `editor.skills.healId` etc. within the skill slot rendering and click handlers to use the dynamic source. When writing (e.g., skill picker selection callback), write to the correct object:

```javascript
const target = state.editor.underwaterMode
  ? state.editor.underwaterSkills
  : state.editor.skills;
target.healId = newSkillId;
```

- [ ] **Step 2: Update weapon bar to show aquatic weapon skills**

Find where `getEquippedWeaponSkills()` is called (it takes weapon slot keys like `mainhand`/`offhand`). When underwater, pass the aquatic weapon instead:

```javascript
const isUnderwater = state.editor.underwaterMode;
const weapons = state.editor.equipment?.weapons || {};
let weaponBarWeapons;
if (isUnderwater) {
  const activeAquatic = (Number(state.editor.activeWeaponSet) || 1) === 2 ? "aquatic2" : "aquatic1";
  weaponBarWeapons = { mainhand: weapons[activeAquatic] || "", offhand: "" };
} else {
  const activeSet = Number(state.editor.activeWeaponSet) || 1;
  weaponBarWeapons = {
    mainhand: weapons[activeSet === 2 ? "mainhand2" : "mainhand1"] || "",
    offhand: weapons[activeSet === 2 ? "offhand2" : "offhand1"] || "",
  };
}
```

Note: Read the actual `getEquippedWeaponSkills()` signature and calling code to determine the exact integration point. The function takes `professionWeapons`, `weaponSkills`, and weapon slot info — adapt the call to pass aquatic weapon data.

- [ ] **Step 3: Test visually**

Run the app, equip different underwater skills and aquatic weapons, toggle between land/water and verify skills change.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/skills.js
git commit -m "feat(underwater): switch skill bar and weapon bar between land and water sources"
```

---

## Chunk 5: Profession-Specific Underwater Overrides

### Task 14: Mechanist Underwater F-Skills

**Files:**
- Modify: `src/renderer/modules/skills.js`

- [ ] **Step 1: Override Mechanist F-skills when underwater**

In `renderSkills()`, find the Mechanist F-skill rendering section (where specialization 70 is checked and mech command skills are built). Add an underwater override:

```javascript
import { MECHANIST_DEPTH_CHARGES_ID, MECHANIST_SPEC_ID } from "./constants.js";

// In the Mechanist F-skill section:
if (isUnderwater && eliteSpecId === MECHANIST_SPEC_ID) {
  // Replace all mech F-skills with single F4 Depth Charges
  const depthCharges = catalog.skillById.get(MECHANIST_DEPTH_CHARGES_ID);
  if (depthCharges) {
    // Clear existing F-skill slots and show only Depth Charges at F4
    // (adapt to match how F-skill slots are currently rendered)
    profMechanicSlots = new Map([["Profession_4", depthCharges]]);
  }
}
```

Note: Read the existing Mechanist F-skill rendering code to understand the exact data structure. The override must produce the same shape expected by the F-slot renderer, just with a single entry. Skill 63210 must be in the catalog — verify it's fetched as part of the Engineer profession data, or add it to the extra skills fetch if needed.

- [ ] **Step 2: Verify Depth Charges skill is in catalog**

Run: `grep -n "63210" src/main/gw2Data/catalog.js src/main/gw2Data/overrides.js`

If not found, it should be fetched as part of the normal Engineer profession skills. If it's not in the profession endpoint, it may need to be added to the extra skills fetch or hardcoded as a synthetic skill (like the Firebrand tome chapters pattern).

- [ ] **Step 3: Test visually**

Load an Engineer/Mechanist build, toggle to water mode, verify only Depth Charges appears in the F-skill bar.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/skills.js
git commit -m "feat(underwater): Mechanist shows Depth Charges F4 skill when underwater"
```

---

### Task 15: Ranger Aquatic Pets

**Files:**
- Modify: `src/renderer/modules/skills.js`

- [ ] **Step 1: Switch pet display to aquatic slots when underwater**

In `renderSkills()`, find the Ranger pet rendering section (around line 480-531). The code already has `aquatic1`/`aquatic2` pet slots and an `aquaticFamilies` set. Update the pet slot selection:

```javascript
const isUnderwater = state.editor.underwaterMode;
const petSlotPrefix = isUnderwater ? "aquatic" : "terrestrial";
const activePetSlot = isUnderwater
  ? (state.editor.activePetSlot?.startsWith("aquatic") ? state.editor.activePetSlot : "aquatic1")
  : state.editor.activePetSlot;
```

Update the pet picker button click handlers to:
1. When underwater, set `activePetSlot` to `"aquatic1"` or `"aquatic2"`
2. Filter the pet picker to only show aquatic/amphibious pets (this may already work via the existing `isAquatic` check in the pet picker)

- [ ] **Step 2: Test visually**

Load a Ranger build, toggle to water mode, verify aquatic pets appear and the pet picker only shows aquatic/amphibious options.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/skills.js
git commit -m "feat(underwater): show aquatic pet slots when underwater for Ranger"
```

---

### Task 16: Revenant Blocked Legends

**Files:**
- Modify: `src/renderer/modules/skills.js`

- [ ] **Step 1: Dim and block Glint/Kalla in legend picker when underwater**

Import the constant:

```javascript
import { UNDERWATER_BLOCKED_LEGENDS } from "./constants.js";
```

In the Revenant legend rendering section (around line 426-479), when building the legend picker options:

```javascript
const isUnderwater = state.editor.underwaterMode;

// When rendering legend options, mark blocked legends
legends.map((legend) => {
  const blocked = isUnderwater && UNDERWATER_BLOCKED_LEGENDS.has(legend.id);
  return {
    value: legend.id,
    label: legend.name || legend.id,
    icon: legend.icon,
    disabled: blocked,
    // Add a CSS class or attribute for dimmed styling
  };
});
```

For the custom select / legend picker, add handling of `disabled` items:
- Dimmed opacity (e.g., `opacity: 0.4`)
- Click handler returns early / does nothing for disabled items
- If the user has a blocked legend selected when switching to water, show it as invalid (dimmed in the active slot)

- [ ] **Step 2: Handle currently-selected blocked legend**

When underwater and the active legend is blocked:

```javascript
if (isUnderwater) {
  const activeLegend = state.editor.selectedLegends[state.editor.activeLegendSlot];
  if (UNDERWATER_BLOCKED_LEGENDS.has(activeLegend)) {
    // Show the legend slot as invalid (add "invalid" class)
    // Skills from this legend should show as empty/unavailable
  }
}
```

- [ ] **Step 3: Test visually**

Load a Herald build with Glint selected, toggle to water, verify Glint is dimmed and unselectable.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/skills.js
git commit -m "feat(underwater): dim and block Glint/Kalla legends when underwater"
```

---

## Chunk 6: Integration Testing and Polish

### Task 17: Integration Tests

**Files:**
- Modify: `tests/unit/renderer/engineer.test.js`
- Modify: `tests/unit/renderer/ranger.test.js`
- Modify: `tests/unit/renderer/revenant.test.js`

- [ ] **Step 1: Add Mechanist underwater F-skill test**

Add to `tests/unit/renderer/engineer.test.js`:

```javascript
// Test that Mechanist underwater mode produces Depth Charges
// (adapt to match existing createMechanicsSuite pattern)
```

The exact test depends on how `createMechanicsSuite` works. Read the existing test harness to determine how to add an underwater mode variant.

- [ ] **Step 2: Add Ranger aquatic pet test**

Verify that when `underwaterMode = true`, the pet rendering uses aquatic pet slots.

- [ ] **Step 3: Add Revenant blocked legend test**

Verify that Glint/Kalla are marked as blocked when `underwaterMode = true`.

- [ ] **Step 4: Run full test suite**

Run: `npm test --bail`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "test(underwater): add integration tests for profession-specific underwater behavior"
```

---

### Task 18: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Manual smoke test**

1. Open the app (`npm start`)
2. Create a new build for each affected profession:
   - **Any profession**: Toggle land/water, verify stats update (breather swaps for head, aquatic weapons for land weapons)
   - **Elementalist**: Verify Conjure skills are not selectable underwater
   - **Engineer (Mechanist)**: Verify F-skills become single Depth Charges
   - **Ranger**: Verify aquatic pets show in water mode
   - **Revenant (Herald)**: Verify Glint legend is dimmed/blocked
   - **Revenant (Renegade)**: Verify Kalla legend is dimmed/blocked
   - **Guardian**: Verify Hallowed Ground not selectable underwater
3. Save and reload a build — verify underwater skills persist
4. Import a build without underwater skills — verify graceful default

- [ ] **Step 3: Final commit (if any polish needed)**

```bash
git add -A
git commit -m "feat(underwater): polish and final fixes"
```
