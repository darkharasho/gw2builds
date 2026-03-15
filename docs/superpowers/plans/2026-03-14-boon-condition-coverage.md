# Boon & Condition Coverage Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display boon and condition coverage icons above the utility skill bar, computed from all skills and traits in the current build.

**Architecture:** A new `boon-coverage.js` module computes coverage data from skill/trait facts. The `renderSkills()` function in `skills.js` calls this and renders two icon rows (boons + conditions) above the utility group inside a new flex-column wrapper. New constants define boon/condition name sets and display ordering.

**Tech Stack:** Vanilla JS (ES modules), CSS, Jest for tests

---

## Chunk 1: Constants and Computation Module

### Task 1: Add boon/condition constants

**Files:**
- Modify: `src/renderer/modules/constants.js:451` (after `BUFF_FACT_TYPES`)

- [ ] **Step 1: Add the new constants after `BUFF_FACT_TYPES` (line 451)**

```js
export const BOON_NAMES = new Set([
  "Aegis", "Alacrity", "Fury", "Might", "Protection", "Quickness",
  "Regeneration", "Resistance", "Resolution", "Stability", "Swiftness", "Vigor",
]);

export const CONDITION_NAMES = new Set([
  "Bleeding", "Blind", "Blinded", "Burning", "Chill", "Chilled",
  "Confusion", "Cripple", "Crippled", "Fear", "Immobile", "Immobilize", "Immobilized",
  "Poison", "Poisoned", "Slow", "Taunt", "Torment",
  "Vulnerability", "Weakness",
]);

export const CONDITION_NAME_NORMALIZE = {
  Blind: "Blinded", Chill: "Chilled", Cripple: "Crippled",
  Immobilize: "Immobile", Immobilized: "Immobile", Poison: "Poisoned",
};

export const BOON_DISPLAY_ORDER = [
  "Aegis", "Alacrity", "Fury", "Might", "Protection", "Quickness",
  "Regeneration", "Resistance", "Resolution", "Stability", "Swiftness", "Vigor",
];
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/constants.js
git commit -m "feat: add boon/condition name constants and display order"
```

---

### Task 2: Write failing tests for `computeBoonCoverage`

**Files:**
- Create: `tests/unit/renderer/boon-coverage.test.js`

- [ ] **Step 1: Write the test file**

```js
"use strict";

const { computeBoonCoverage } = require("../../../src/renderer/modules/boon-coverage");

function makeCatalog(overrides = {}) {
  return {
    skillById: overrides.skillById || new Map(),
    traitById: overrides.traitById || new Map(),
    weaponSkillById: overrides.weaponSkillById || new Map(),
    professionWeapons: overrides.professionWeapons || {},
    ...overrides,
  };
}

function makeEditor(overrides = {}) {
  return {
    skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    specializations: [],
    equipment: { weapons: {} },
    underwaterMode: false,
    ...overrides,
  };
}

function makeSkill(id, name, facts = [], extra = {}) {
  return { id, name, description: "", facts, type: "Utility", ...extra };
}

function makeTrait(id, name, facts = [], extra = {}) {
  return { id, name, description: "", facts, ...extra };
}

function buffFact(status, duration = 0, applyCount = 0) {
  return { type: "Buff", status, duration, apply_count: applyCount };
}

describe("computeBoonCoverage", () => {
  test("returns empty arrays when no skills or traits have buff facts", () => {
    const catalog = makeCatalog();
    const editor = makeEditor();
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toEqual([]);
    expect(result.conditions).toEqual([]);
  });

  test("extracts boon from a heal skill", () => {
    const skill = makeSkill(100, "Healing Breeze", [buffFact("Regeneration", 5)]);
    const catalog = makeCatalog({ skillById: new Map([[100, skill]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [0, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].name).toBe("Regeneration");
    expect(result.boons[0].sources).toHaveLength(1);
    expect(result.boons[0].sources[0]).toMatchObject({ type: "skill", name: "Healing Breeze" });
  });

  test("extracts condition from a utility skill", () => {
    const skill = makeSkill(200, "Torch Throw", [buffFact("Burning", 3, 2)]);
    const catalog = makeCatalog({ skillById: new Map([[200, skill]]) });
    const editor = makeEditor({ skills: { healId: 0, utilityIds: [200, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0].name).toBe("Burning");
    expect(result.conditions[0].sources[0]).toMatchObject({ stacks: 2, duration: 3 });
  });

  test("normalizes condition name variants", () => {
    const skill = makeSkill(300, "Blind Throw", [buffFact("Blind", 4)]);
    const catalog = makeCatalog({ skillById: new Map([[300, skill]]) });
    const editor = makeEditor({ skills: { healId: 0, utilityIds: [300, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0].name).toBe("Blinded");
  });

  test("groups multiple sources for the same boon", () => {
    const s1 = makeSkill(100, "Skill A", [buffFact("Might", 6, 3)]);
    const s2 = makeSkill(200, "Skill B", [buffFact("Might", 8, 1)]);
    const catalog = makeCatalog({ skillById: new Map([[100, s1], [200, s2]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [200, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].name).toBe("Might");
    expect(result.boons[0].sources).toHaveLength(2);
  });

  test("extracts boons from weapon skills passed as third argument", () => {
    const ws = makeSkill(400, "Sword Strike", [buffFact("Might", 4, 1)]);
    const catalog = makeCatalog();
    const editor = makeEditor();
    const result = computeBoonCoverage(catalog, editor, [ws, null, null, null, null]);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].name).toBe("Might");
    expect(result.boons[0].sources[0]).toMatchObject({ type: "skill", name: "Sword Strike" });
  });

  test("extracts boons from selected traits", () => {
    const trait = makeTrait(500, "Radiant Power", [buffFact("Fury", 3)]);
    const catalog = makeCatalog({ traitById: new Map([[500, trait]]) });
    const editor = makeEditor({
      specializations: [{ specializationId: 42, majorChoices: { 1: 500, 2: 0, 3: 0 } }],
    });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].sources[0]).toMatchObject({ type: "trait", name: "Radiant Power" });
  });

  test("follows flipSkill one level deep", () => {
    const flip = makeSkill(101, "Flip Skill", [buffFact("Might", 5, 2)]);
    const base = makeSkill(100, "Base Skill", [], { flipSkill: 101 });
    const catalog = makeCatalog({ skillById: new Map([[100, base], [101, flip]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [0, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].sources[0].name).toBe("Flip Skill");
  });

  test("does not follow flipSkill beyond one level", () => {
    const flip2 = makeSkill(102, "Double Flip", [buffFact("Fury", 3)]);
    const flip1 = makeSkill(101, "Flip Skill", [buffFact("Might", 5)], { flipSkill: 102 });
    const base = makeSkill(100, "Base Skill", [], { flipSkill: 101 });
    const catalog = makeCatalog({ skillById: new Map([[100, base], [101, flip1], [102, flip2]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [0, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    // Should have Might from flip1, but NOT Fury from flip2
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].name).toBe("Might");
  });

  test("marks ally-only boons when all sources have ally description", () => {
    const skill = makeSkill(100, "Grant Allies Might", [buffFact("Might", 5, 3)], {
      description: "Grant nearby allies might.",
    });
    const catalog = makeCatalog({ skillById: new Map([[100, skill]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [0, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons[0].allyOnly).toBe(true);
  });

  test("marks boon as self when any source lacks ally description", () => {
    const s1 = makeSkill(100, "Self Might", [buffFact("Might", 5)], { description: "Gain might." });
    const s2 = makeSkill(200, "Ally Might", [buffFact("Might", 5)], { description: "Grant allies might." });
    const catalog = makeCatalog({ skillById: new Map([[100, s1], [200, s2]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [200, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons[0].allyOnly).toBe(false);
  });

  test("boons are sorted in GW2 display order", () => {
    const s1 = makeSkill(100, "S1", [buffFact("Vigor", 3)]);
    const s2 = makeSkill(200, "S2", [buffFact("Aegis", 3)]);
    const s3 = makeSkill(300, "S3", [buffFact("Might", 3)]);
    const catalog = makeCatalog({ skillById: new Map([[100, s1], [200, s2], [300, s3]]) });
    const editor = makeEditor({ skills: { healId: 0, utilityIds: [100, 200, 300], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons.map((b) => b.name)).toEqual(["Aegis", "Might", "Vigor"]);
  });

  test("conditions are sorted alphabetically", () => {
    const s1 = makeSkill(100, "S1", [buffFact("Vulnerability", 3)]);
    const s2 = makeSkill(200, "S2", [buffFact("Bleeding", 3)]);
    const catalog = makeCatalog({ skillById: new Map([[100, s1], [200, s2]]) });
    const editor = makeEditor({ skills: { healId: 0, utilityIds: [100, 200, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.conditions.map((c) => c.name)).toEqual(["Bleeding", "Vulnerability"]);
  });

  test("includes icon URL from BOON_CONDITION_ICONS", () => {
    const skill = makeSkill(100, "Might Skill", [buffFact("Might", 5)]);
    const catalog = makeCatalog({ skillById: new Map([[100, skill]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [0, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons[0].icon).toContain("render.guildwars2.com");
  });

  test("ignores non-buff fact types", () => {
    const skill = makeSkill(100, "Damage Skill", [
      { type: "Damage", value: 500 },
      { type: "Duration", value: 10 },
    ]);
    const catalog = makeCatalog({ skillById: new Map([[100, skill]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [0, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toEqual([]);
    expect(result.conditions).toEqual([]);
  });

  test("handles ApplyBuffCondition and PrefixedBuff fact types", () => {
    const skill = makeSkill(100, "Multi", [
      { type: "ApplyBuffCondition", status: "Burning", duration: 3, apply_count: 1 },
      { type: "PrefixedBuff", status: "Might", duration: 5, apply_count: 2 },
    ]);
    const catalog = makeCatalog({ skillById: new Map([[100, skill]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [0, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(1);
    expect(result.conditions).toHaveLength(1);
  });

  test("extracts boons from profession mechanic skills (F1-F5)", () => {
    const mechSkill = makeSkill(600, "F1 Virtue", [buffFact("Aegis", 3)], {
      type: "Profession", slot: "Profession_1", specialization: 0,
    });
    const catalog = makeCatalog({
      skillById: new Map([[600, mechSkill]]),
      skills: [mechSkill],
    });
    const editor = makeEditor();
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].name).toBe("Aegis");
    expect(result.boons[0].sources[0]).toMatchObject({ type: "skill", name: "F1 Virtue" });
  });

  test("skips profession mechanics requiring unselected elite spec", () => {
    const mechSkill = makeSkill(700, "Elite F1", [buffFact("Quickness", 5)], {
      type: "Profession", slot: "Profession_1", specialization: 27,
    });
    const catalog = makeCatalog({
      skillById: new Map([[700, mechSkill]]),
      skills: [mechSkill],
    });
    const editor = makeEditor({ specializations: [] });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toEqual([]);
  });

  test("handles missing or zero apply_count and duration gracefully", () => {
    const skill = makeSkill(100, "Passive Skill", [{ type: "Buff", status: "Might" }]);
    const catalog = makeCatalog({ skillById: new Map([[100, skill]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [0, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].sources[0]).toMatchObject({ stacks: 0, duration: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/renderer/boon-coverage.test.js --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Commit**

```bash
git add tests/unit/renderer/boon-coverage.test.js
git commit -m "test: add failing tests for computeBoonCoverage"
```

---

### Task 3: Implement `computeBoonCoverage`

**Files:**
- Create: `src/renderer/modules/boon-coverage.js`

- [ ] **Step 1: Create the module**

```js
import {
  BOON_NAMES, CONDITION_NAMES, CONDITION_NAME_NORMALIZE,
  BOON_DISPLAY_ORDER, BUFF_FACT_TYPES, BOON_CONDITION_ICONS,
} from "./constants.js";

const ALLY_PATTERNS = /\b(allies|ally)\b/i;

function normalizeName(status) {
  return CONDITION_NAME_NORMALIZE[status] || status;
}

function isAllyDescription(description) {
  return ALLY_PATTERNS.test(description || "");
}

function extractBuffFacts(entity, sourceType) {
  const results = [];
  const facts = entity.facts || [];
  const isAlly = isAllyDescription(entity.description);
  for (const fact of facts) {
    if (!BUFF_FACT_TYPES.has(fact.type)) continue;
    const rawStatus = fact.status;
    if (!rawStatus) continue;
    const name = normalizeName(rawStatus);
    if (!BOON_NAMES.has(name) && !CONDITION_NAMES.has(name)) continue;
    results.push({
      name,
      sourceType,
      sourceName: entity.name || "",
      stacks: fact.apply_count || 0,
      duration: fact.duration || 0,
      isAlly,
    });
  }
  return results;
}

function collectSkillIds(editor, catalog) {
  const ids = new Set();
  const skills = editor.skills || {};
  if (skills.healId) ids.add(Number(skills.healId));
  if (skills.eliteId) ids.add(Number(skills.eliteId));
  for (const uid of skills.utilityIds || []) {
    if (uid) ids.add(Number(uid));
  }
  // Profession mechanic skill IDs (F1-F5) — resolve from catalog profession skills
  const profSkills = catalog?.skills || [];
  const selectedSpecIds = new Set(
    (editor.specializations || []).map((s) => Number(s?.specializationId) || 0).filter(Boolean)
  );
  for (const s of profSkills) {
    if ((s.type || "").toLowerCase() !== "profession") continue;
    const reqSpec = Number(s.specialization) || 0;
    if (reqSpec && !selectedSpecIds.has(reqSpec)) continue;
    if (/^Profession_[1-5]$/.test(s.slot || "")) ids.add(s.id);
  }
  return ids;
}

function collectTraitIds(editor) {
  const ids = new Set();
  for (const spec of editor.specializations || []) {
    const choices = spec?.majorChoices || {};
    for (const tier of [1, 2, 3]) {
      const traitId = Number(choices[tier]) || 0;
      if (traitId) ids.add(traitId);
    }
  }
  return ids;
}

export function computeBoonCoverage(catalog, editor, weaponSkills = []) {
  if (!catalog) return { boons: [], conditions: [] };

  const allFacts = [];

  // Collect from weapon skills (passed in by caller, already resolved)
  for (const ws of weaponSkills) {
    if (!ws) continue;
    allFacts.push(...extractBuffFacts(ws, "skill"));
    if (ws.flipSkill) {
      const flip = catalog.skillById?.get(ws.flipSkill) || catalog.weaponSkillById?.get(ws.flipSkill);
      if (flip) allFacts.push(...extractBuffFacts(flip, "skill"));
    }
  }

  // Collect from skills (heal, utility, elite, profession mechanics)
  const skillIds = collectSkillIds(editor, catalog);
  for (const id of skillIds) {
    const skill = catalog.skillById?.get(id);
    if (!skill) continue;
    allFacts.push(...extractBuffFacts(skill, "skill"));
    // Follow flipSkill one level
    if (skill.flipSkill) {
      const flip = catalog.skillById?.get(skill.flipSkill);
      if (flip) allFacts.push(...extractBuffFacts(flip, "skill"));
    }
  }

  // Collect from traits
  const traitIds = collectTraitIds(editor);
  for (const id of traitIds) {
    const trait = catalog.traitById?.get(id);
    if (!trait) continue;
    allFacts.push(...extractBuffFacts(trait, "trait"));
  }

  // Group by name (already normalized in extractBuffFacts)
  const grouped = new Map();
  for (const f of allFacts) {
    if (!grouped.has(f.name)) {
      grouped.set(f.name, { sources: [], hasAnySelf: false });
    }
    const entry = grouped.get(f.name);
    entry.sources.push({
      type: f.sourceType,
      name: f.sourceName,
      stacks: f.stacks,
      duration: f.duration,
    });
    if (!f.isAlly) entry.hasAnySelf = true;
  }

  // Build output arrays
  const boons = [];
  const conditions = [];
  for (const [name, data] of grouped) {
    const entry = {
      name,
      icon: BOON_CONDITION_ICONS[name] || "",
      allyOnly: !data.hasAnySelf,
      sources: data.sources,
    };
    if (BOON_NAMES.has(name)) {
      boons.push(entry);
    } else {
      conditions.push(entry);
    }
  }

  // Sort boons by GW2 display order, conditions alphabetically
  const boonOrder = new Map(BOON_DISPLAY_ORDER.map((b, i) => [b, i]));
  boons.sort((a, b) => (boonOrder.get(a.name) ?? 99) - (boonOrder.get(b.name) ?? 99));
  conditions.sort((a, b) => a.name.localeCompare(b.name));

  return { boons, conditions };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx jest tests/unit/renderer/boon-coverage.test.js --no-coverage`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/boon-coverage.js
git commit -m "feat: implement computeBoonCoverage module"
```

---

## Chunk 2: CSS Styles and Rendering Integration

### Task 4: Add CSS styles for boon coverage

**Files:**
- Modify: `src/renderer/styles/skills.css` (append at end of file)

- [ ] **Step 1: Append the boon coverage styles**

```css
/* Boon & Condition Coverage */
.skills-bar__util-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.boon-coverage {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.boon-coverage__boons,
.boon-coverage__conditions {
  display: flex;
  gap: 3px;
  align-items: center;
}

.boon-coverage__icon {
  position: relative;
  width: 22px;
  height: 22px;
  border-radius: 3px;
  background: rgba(2, 8, 16, 0.5);
  border: 1px solid rgba(180, 180, 180, 0.25);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.boon-coverage__icon:hover {
  border-color: rgba(255, 220, 100, 0.7);
  box-shadow: 0 0 6px rgba(255, 200, 50, 0.3);
}

.boon-coverage__icon img {
  width: 18px;
  height: 18px;
  border-radius: 2px;
  display: block;
}

.boon-coverage__ally-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(100, 180, 255, 0.9);
  display: grid;
  place-items: center;
  font-size: 6px;
  color: #fff;
  line-height: 1;
  pointer-events: none;
}

.boon-coverage__tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(12, 18, 32, 0.96);
  border: 1px solid rgba(100, 140, 200, 0.3);
  border-radius: 6px;
  padding: 8px 12px;
  min-width: 200px;
  max-width: 320px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  z-index: 100;
  pointer-events: none;
  white-space: nowrap;
}

.boon-coverage__tooltip-title {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  margin-bottom: 5px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(100, 140, 200, 0.15);
}

.boon-coverage__tooltip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 11px;
}

.boon-coverage__tooltip-tag {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
}

.boon-coverage__tooltip-tag--skill {
  color: rgba(100, 180, 255, 0.9);
  background: rgba(100, 180, 255, 0.15);
}

.boon-coverage__tooltip-tag--trait {
  color: rgba(255, 180, 80, 0.9);
  background: rgba(255, 180, 80, 0.15);
}

.boon-coverage__tooltip-name {
  color: rgba(220, 220, 240, 0.9);
}

.boon-coverage__tooltip-detail {
  color: rgba(180, 200, 230, 0.5);
  margin-left: auto;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles/skills.css
git commit -m "feat: add boon coverage CSS styles"
```

---

### Task 5: Integrate rendering into `skills.js`

**Files:**
- Modify: `src/renderer/modules/skills.js:1` (add import)
- Modify: `src/renderer/modules/skills.js:1562-1572` (wrap utility group with coverage)

- [ ] **Step 1: Add import at top of skills.js**

Add after the existing `import { computeEquipmentStats } from "./stats.js";` line (line 17):

```js
import { computeBoonCoverage } from "./boon-coverage.js";
```

- [ ] **Step 2: Add the rendering helper function**

Add between the `_renderUnderwaterToggle()` function and the `renderSkills()` function declaration (insert just before the `export function renderSkills()` line at line 1002). This function creates the boon/condition coverage DOM from the computed data:

```js
function _renderBoonCoverage(catalog, editor, weaponSkills = []) {
  const coverage = computeBoonCoverage(catalog, editor, weaponSkills);
  const hasBoons = coverage.boons.length > 0;
  const hasConditions = coverage.conditions.length > 0;
  if (!hasBoons && !hasConditions) return null;

  const container = document.createElement("div");
  container.className = "boon-coverage";

  function makeIconRow(items, className) {
    if (items.length === 0) return null;
    const row = document.createElement("div");
    row.className = className;
    for (const item of items) {
      const icon = document.createElement("div");
      icon.className = "boon-coverage__icon";

      const img = document.createElement("img");
      img.src = item.icon;
      img.alt = item.name;
      img.width = 18;
      img.height = 18;
      icon.append(img);

      if (item.allyOnly) {
        const badge = document.createElement("div");
        badge.className = "boon-coverage__ally-badge";
        badge.textContent = "⇧";
        icon.append(badge);
      }

      // Tooltip on hover
      icon.addEventListener("mouseenter", () => {
        const tooltip = document.createElement("div");
        tooltip.className = "boon-coverage__tooltip";

        const title = document.createElement("div");
        title.className = "boon-coverage__tooltip-title";
        title.textContent = item.name;
        tooltip.append(title);

        for (const src of item.sources) {
          const row = document.createElement("div");
          row.className = "boon-coverage__tooltip-row";

          const tag = document.createElement("span");
          tag.className = `boon-coverage__tooltip-tag boon-coverage__tooltip-tag--${src.type}`;
          tag.textContent = src.type === "skill" ? "Skill" : "Trait";
          row.append(tag);

          const name = document.createElement("span");
          name.className = "boon-coverage__tooltip-name";
          name.textContent = src.name;
          row.append(name);

          const detail = document.createElement("span");
          detail.className = "boon-coverage__tooltip-detail";
          if (src.duration > 0) {
            const parts = [];
            if (src.stacks > 0) parts.push(`${src.stacks}×`);
            parts.push(`${src.duration}s`);
            detail.textContent = parts.join(" ");
          } else {
            detail.textContent = "passive";
          }
          row.append(detail);

          tooltip.append(row);
        }

        icon.append(tooltip);
      });

      icon.addEventListener("mouseleave", () => {
        const tooltip = icon.querySelector(".boon-coverage__tooltip");
        if (tooltip) tooltip.remove();
      });

      row.append(icon);
    }
    return row;
  }

  const boonRow = makeIconRow(coverage.boons, "boon-coverage__boons");
  const condRow = makeIconRow(coverage.conditions, "boon-coverage__conditions");
  if (boonRow) container.append(boonRow);
  if (condRow) container.append(condRow);

  return container;
}
```

- [ ] **Step 3: Modify `renderSkills()` to use the wrapper**

Replace the final assembly at the end of `renderSkills()` (around lines 1562–1572). Change:

```js
  bar.append(weaponCol, orbCol, utilityGroup);
```

to:

```js
  const utilCol = document.createElement("div");
  utilCol.className = "skills-bar__util-col";
  const coverageEl = _renderBoonCoverage(catalog, state.editor, weaponSkills);
  if (coverageEl) utilCol.append(coverageEl);
  utilCol.append(utilityGroup);
  bar.append(weaponCol, orbCol, utilCol);
```

- [ ] **Step 4: Run all tests to verify nothing is broken**

Run: `npx jest --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/skills.js
git commit -m "feat: render boon/condition coverage above utility skills"
```

---

### Task 6: Manual verification

- [ ] **Step 1: Start the app and verify the feature**

Run: `npm start`

Verify:
1. Open a build with skills that grant boons (e.g. Guardian with Might-granting skills)
2. Boon icons appear above the heal/utility/elite row
3. Condition icons appear below the boon row
4. Hovering an icon shows the tooltip with source breakdown
5. Ally-only boons show the blue badge
6. Changing skills/traits updates the coverage icons
7. Empty rows are hidden when no boons/conditions found

- [ ] **Step 2: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests PASS

- [ ] **Step 3: Final commit if any adjustments were needed**
