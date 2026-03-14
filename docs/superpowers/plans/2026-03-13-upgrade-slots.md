# Upgrade Slots Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-slot rune, sigil, and infusion selection to the equipment panel with inline sub-slot buttons, GW2 API data fetching, and stat calculation contributions.

**Architecture:** Curated item ID lists in constants.js feed into a new `getUpgradeCatalog()` function in catalog.js that fetches item details from the GW2 API. The renderer stores upgrade selections as item ID strings in `runes`, `sigils`, and `infusions` sub-objects on equipment state. Inline 24px sub-slot buttons on each equipment row open the existing `openSlotPicker()` with the fetched item data.

**Tech Stack:** Vanilla JS DOM rendering, Electron IPC, GW2 API v2

**Spec:** `docs/superpowers/specs/2026-03-13-upgrade-slots-design.md`

---

## Chunk 1: Data Layer — State, API Fetch

### Task 1: Extend Equipment State Model

**Files:**
- Modify: `src/renderer/modules/state.js:42-57`

- [ ] **Step 1: Add runes, sigils, and infusions to `createEmptyEditor()`**

Replace the `equipment` block in `createEmptyEditor()` (lines 42-57) with:

```javascript
    equipment: {
      statPackage: "",
      relic: "",
      food: "",
      utility: "",
      slots: {
        head: "", shoulders: "", chest: "", hands: "", legs: "", feet: "",
        mainhand1: "", offhand1: "", mainhand2: "", offhand2: "",
        back: "", amulet: "", ring1: "", ring2: "", accessory1: "", accessory2: "",
        breather: "", aquatic1: "", aquatic2: "",
      },
      weapons: {
        mainhand1: "", offhand1: "", mainhand2: "", offhand2: "", aquatic1: "", aquatic2: "",
      },
      runes: {
        head: "", shoulders: "", chest: "", hands: "", legs: "", feet: "",
        breather: "",
      },
      sigils: {
        mainhand1: ["", ""], offhand1: [""],
        mainhand2: ["", ""], offhand2: [""],
        aquatic1: ["", ""], aquatic2: ["", ""],
      },
      infusions: {
        head: "", shoulders: "", chest: "", hands: "", legs: "", feet: "",
        mainhand1: "", offhand1: "", mainhand2: "", offhand2: "",
        back: "", amulet: "", ring1: "", ring2: "", accessory1: "", accessory2: "",
        breather: "", aquatic1: "", aquatic2: "",
      },
    },
```

Note: `runeSet` is removed. The old free-text field is deprecated per spec.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/state.js
git commit -m "feat: extend equipment state with runes, sigils, and infusions"
```

---

### Task 2: Add GW2 API Fetch for Upgrade Items

**Files:**
- Modify: `src/main/gw2Data/catalog.js`
- Modify: `src/main/gw2Data/index.js`
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

- [ ] **Step 1: Add `getUpgradeCatalog()` to catalog.js**

Add at the bottom of `catalog.js`, before `module.exports`:

```javascript
// ---------------------------------------------------------------------------
// Upgrade items (runes, sigils, infusions) — fetched by curated ID lists
// ---------------------------------------------------------------------------

let _upgradeCatalogCache = null;
let _upgradeCatalogPromise = null;

async function getUpgradeCatalog(lang = "en") {
  if (_upgradeCatalogCache) return _upgradeCatalogCache;
  if (_upgradeCatalogPromise) return _upgradeCatalogPromise;

  _upgradeCatalogPromise = (async () => {
    // Import IDs from renderer constants would create a cross-process dep;
    // instead, receive them as args or duplicate. We fetch all three lists
    // in parallel for speed.
    const { RUNE_ITEM_IDS, SIGIL_ITEM_IDS, INFUSION_ITEM_IDS } = require("./upgradeIds");

    const [runeItems, sigilItems, infusionItems] = await Promise.all([
      fetchGw2ByIds("items", RUNE_ITEM_IDS, lang),
      fetchGw2ByIds("items", SIGIL_ITEM_IDS, lang),
      fetchGw2ByIds("items", INFUSION_ITEM_IDS, lang),
    ]);

    const mapItem = (item) => ({
      id: item.id,
      name: item.name || "",
      icon: item.icon || "",
      description: item.description || "",
      bonuses: item.details?.bonuses || [],
      infixUpgrade: item.details?.infix_upgrade || null,
    });

    const catalog = {
      runes: runeItems.map(mapItem).sort((a, b) => a.name.localeCompare(b.name)),
      sigils: sigilItems.map(mapItem).sort((a, b) => a.name.localeCompare(b.name)),
      infusions: infusionItems.map(mapItem).sort((a, b) => a.name.localeCompare(b.name)),
    };

    // Build lookup maps by ID
    catalog.runeById = new Map(catalog.runes.map((r) => [r.id, r]));
    catalog.sigilById = new Map(catalog.sigils.map((s) => [s.id, s]));
    catalog.infusionById = new Map(catalog.infusions.map((i) => [i.id, i]));

    _upgradeCatalogCache = catalog;
    return catalog;
  })();

  try {
    return await _upgradeCatalogPromise;
  } finally {
    _upgradeCatalogPromise = null;
  }
}
```

- [ ] **Step 2: Create `src/main/gw2Data/upgradeIds.js`**

This file holds the ID arrays for the main process (avoids cross-process import from renderer constants):

```javascript
// Curated upgrade item IDs for GW2 API fetching.
// These mirror the lists in src/renderer/modules/constants.js — keep in sync.

const RUNE_ITEM_IDS = [
  24687, 24691, 24694, 24697, 24700, 24703, 24706, 24709, 24712, 24714,
  24717, 24720, 24723, 24726, 24729, 24732, 24735, 24738, 24741, 24744,
  24747, 24750, 24753, 24756, 24759, 24762, 24765, 24768, 24771, 24774,
  24777, 24780, 24783, 24786, 24789, 24792, 24795, 24798, 24801, 24804,
  24807, 24810, 24813, 24816, 24819, 24822, 24825, 24828, 24831, 24834,
  24836, 44950, 44951, 44956, 67339, 67341, 67342, 67344, 67345, 67346,
  68436, 68437, 68438, 68439, 68440, 69531, 70600, 71425, 72339, 72412,
  72693, 72852, 73398, 74115, 74326, 74978, 75480, 76166, 77694, 78012,
  79400, 80399, 83338, 83502, 84171, 85396, 91154, 91220, 91268, 91344,
  91394, 91444, 91534, 91582, 91610, 91656, 91740, 91758, 91804, 91886,
  91928, 91971, 100849,
];

const SIGIL_ITEM_IDS = [
  24548, 24551, 24554, 24557, 24560, 24563, 24566, 24569, 24572, 24575,
  24578, 24580, 24583, 24586, 24589, 24592, 24595, 24598, 24601, 24605,
  24607, 24609, 24612, 24615, 24618, 24621, 24624, 24627, 24630, 24632,
  24634, 24636, 24639, 24641, 24643, 24645, 24647, 24649, 24651, 24653,
  24655, 24657, 24659, 24661, 24663, 24665, 24667, 24669, 44944, 44946,
  44947, 44948, 44950, 67340, 67343, 68435, 69527, 70593, 72090, 72339,
  74326, 75654, 76774, 77505, 78556, 80205, 81683, 82780, 84127, 85350,
  91105, 91148, 91184, 91234, 91276, 91328, 91370, 91426, 91466, 91506,
  91546, 91586, 91626, 91668, 91714, 91756, 91798, 91846, 91896, 91940,
  100458,
];

const INFUSION_ITEM_IDS = [
  49424, 49425, 49426, 49427, 49428, 49429, 49430, 49431, 49432,
  93432, 93433, 93434, 93435, 93436, 93437, 93438, 93439, 93440,
  93441, 93442, 93443, 93444, 93445, 93446, 93447, 93448, 93449,
  93450, 93451, 93452, 93453, 93454, 93455, 93456, 93457, 93458,
  93459, 93460, 93461, 93462, 93463, 93464, 93465, 93466, 93467,
  93468, 93469, 93470, 93471, 93472, 93473, 93474, 93475, 93476,
];

module.exports = { RUNE_ITEM_IDS, SIGIL_ITEM_IDS, INFUSION_ITEM_IDS };
```

- [ ] **Step 3: Export `getUpgradeCatalog` from index.js**

In `src/main/gw2Data/index.js`, add:

```javascript
const { getProfessionList, getProfessionCatalog } = require("./catalog");
const { getUpgradeCatalog } = require("./catalog");  // add this import
const { getWikiSummary, getWikiRelatedData } = require("./wiki");

module.exports = {
  getProfessionList,
  getProfessionCatalog,
  getUpgradeCatalog,  // add this export
  getWikiSummary,
  getWikiRelatedData,
};
```

Wait — `getUpgradeCatalog` comes from `catalog.js`, so the existing import line can be extended. Update the first line:

```javascript
const { getProfessionList, getProfessionCatalog, getUpgradeCatalog } = require("./catalog");
```

And add `getUpgradeCatalog` to the exports.

- [ ] **Step 4: Register IPC handler in main/index.js**

Find the existing IPC handlers (around line 292) and add:

```javascript
  ipcMain.handle("gw2:get-upgrade-catalog", async () => getUpgradeCatalog("en"));
```

Update the require to include `getUpgradeCatalog`:

```javascript
const { getProfessionList, getProfessionCatalog, getUpgradeCatalog, getWikiSummary, getWikiRelatedData } = require("./gw2Data");
```

- [ ] **Step 5: Add preload bridge method**

In `src/preload/index.js`, add after the `getProfessionCatalog` line:

```javascript
  getUpgradeCatalog: () => ipcRenderer.invoke("gw2:get-upgrade-catalog"),
```

- [ ] **Step 6: Export `getUpgradeCatalog` from catalog.js module.exports**

Update the `module.exports` at the bottom of `catalog.js`:

```javascript
module.exports = {
  getProfessionList,
  getProfessionCatalog,
  getUpgradeCatalog,
  applyBalanceSplit,
};
```

- [ ] **Step 7: Commit**

```bash
git add src/main/gw2Data/catalog.js src/main/gw2Data/upgradeIds.js src/main/gw2Data/index.js src/main/index.js src/preload/index.js
git commit -m "feat: add GW2 API fetch pipeline for upgrade items (runes, sigils, infusions)"
```

---

### Task 3: Load Upgrade Catalog in Renderer

**Files:**
- Modify: `src/renderer/modules/state.js`
- Modify: `src/renderer/renderer.js` (or wherever `setProfession` / catalog loading happens)

The upgrade catalog is profession-independent, so it should be loaded once at app start and stored on `state`.

- [ ] **Step 1: Add `upgradeCatalog` to state**

In `src/renderer/modules/state.js`, add to the `state` object (after `activeCatalog: null`):

```javascript
  upgradeCatalog: null,  // { runes, sigils, infusions, runeById, sigilById, infusionById }
```

- [ ] **Step 2: Fetch upgrade catalog at startup**

Find where the app initializes (in `renderer.js` or the init flow). Add an early call:

```javascript
window.desktopApi.getUpgradeCatalog().then((catalog) => {
  state.upgradeCatalog = catalog;
}).catch((err) => {
  console.warn("Failed to load upgrade catalog:", err);
});
```

This runs in the background — the equipment panel gracefully handles `upgradeCatalog` being null by not showing upgrade sub-slots until data arrives.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/state.js src/renderer/renderer.js
git commit -m "feat: load upgrade catalog at app startup"
```

---

## Chunk 2: Serialization & Editor Updates

### Task 4: Update Editor Serialization Functions

**Files:**
- Modify: `src/renderer/modules/editor.js:309-346` (computeEditorSignature)
- Modify: `src/renderer/modules/editor.js:581-681` (serializeEditorToBuild)
- Modify: `src/renderer/modules/editor.js:477-558` (loadBuildIntoEditor)
- Modify: `src/renderer/modules/editor.js:352-418` (parseBuildImportPayload)
- Modify: `src/renderer/modules/editor.js:94-256` (enforceEditorConsistency)

- [ ] **Step 1: Add sigil normalization helper**

Add near the top of `editor.js` (after the imports):

```javascript
// Normalize sigil array to correct shape for a given slot key.
function normalizeSigilArray(value, slotKey) {
  const isOffhand = slotKey.startsWith("offhand");
  const expectedLen = isOffhand ? 1 : 2;
  if (!Array.isArray(value)) return Array(expectedLen).fill("");
  const arr = value.slice(0, expectedLen).map((v) => String(v || ""));
  while (arr.length < expectedLen) arr.push("");
  return arr;
}
```

- [ ] **Step 2: Update `computeEditorSignature()`**

In the `payload.equipment` object (around line 328), remove `runeSet` and add the new fields:

```javascript
    equipment: {
      statPackage: String(editor.equipment?.statPackage || ""),
      relic: String(editor.equipment?.relic || ""),
      food: String(editor.equipment?.food || ""),
      utility: String(editor.equipment?.utility || ""),
      slots: editor.equipment?.slots || {},
      weapons: editor.equipment?.weapons || {},
      runes: editor.equipment?.runes || {},
      sigils: editor.equipment?.sigils || {},
      infusions: editor.equipment?.infusions || {},
    },
```

- [ ] **Step 3: Update `parseBuildImportPayload()`**

In the returned `equipment` object (around line 378), remove `runeSet` and add:

```javascript
      runes: {
        head: String(source.equipment?.runes?.head || ""),
        shoulders: String(source.equipment?.runes?.shoulders || ""),
        chest: String(source.equipment?.runes?.chest || ""),
        hands: String(source.equipment?.runes?.hands || ""),
        legs: String(source.equipment?.runes?.legs || ""),
        feet: String(source.equipment?.runes?.feet || ""),
        breather: String(source.equipment?.runes?.breather || ""),
      },
      sigils: {
        mainhand1: normalizeSigilArray(source.equipment?.sigils?.mainhand1, "mainhand1"),
        offhand1: normalizeSigilArray(source.equipment?.sigils?.offhand1, "offhand1"),
        mainhand2: normalizeSigilArray(source.equipment?.sigils?.mainhand2, "mainhand2"),
        offhand2: normalizeSigilArray(source.equipment?.sigils?.offhand2, "offhand2"),
        aquatic1: normalizeSigilArray(source.equipment?.sigils?.aquatic1, "aquatic1"),
        aquatic2: normalizeSigilArray(source.equipment?.sigils?.aquatic2, "aquatic2"),
      },
      infusions: {
        head: String(source.equipment?.infusions?.head || ""),
        shoulders: String(source.equipment?.infusions?.shoulders || ""),
        chest: String(source.equipment?.infusions?.chest || ""),
        hands: String(source.equipment?.infusions?.hands || ""),
        legs: String(source.equipment?.infusions?.legs || ""),
        feet: String(source.equipment?.infusions?.feet || ""),
        mainhand1: String(source.equipment?.infusions?.mainhand1 || ""),
        offhand1: String(source.equipment?.infusions?.offhand1 || ""),
        mainhand2: String(source.equipment?.infusions?.mainhand2 || ""),
        offhand2: String(source.equipment?.infusions?.offhand2 || ""),
        back: String(source.equipment?.infusions?.back || ""),
        amulet: String(source.equipment?.infusions?.amulet || ""),
        ring1: String(source.equipment?.infusions?.ring1 || ""),
        ring2: String(source.equipment?.infusions?.ring2 || ""),
        accessory1: String(source.equipment?.infusions?.accessory1 || ""),
        accessory2: String(source.equipment?.infusions?.accessory2 || ""),
        breather: String(source.equipment?.infusions?.breather || ""),
        aquatic1: String(source.equipment?.infusions?.aquatic1 || ""),
        aquatic2: String(source.equipment?.infusions?.aquatic2 || ""),
      },
```

- [ ] **Step 4: Update `loadBuildIntoEditor()`**

In the `equipment` block (around line 485), remove `runeSet` and add the same three new blocks as above. Use the same `normalizeSigilArray` helper for sigils:

```javascript
      runes: {
        head: String(build.equipment?.runes?.head || ""),
        shoulders: String(build.equipment?.runes?.shoulders || ""),
        chest: String(build.equipment?.runes?.chest || ""),
        hands: String(build.equipment?.runes?.hands || ""),
        legs: String(build.equipment?.runes?.legs || ""),
        feet: String(build.equipment?.runes?.feet || ""),
        breather: String(build.equipment?.runes?.breather || ""),
      },
      sigils: {
        mainhand1: normalizeSigilArray(build.equipment?.sigils?.mainhand1, "mainhand1"),
        offhand1: normalizeSigilArray(build.equipment?.sigils?.offhand1, "offhand1"),
        mainhand2: normalizeSigilArray(build.equipment?.sigils?.mainhand2, "mainhand2"),
        offhand2: normalizeSigilArray(build.equipment?.sigils?.offhand2, "offhand2"),
        aquatic1: normalizeSigilArray(build.equipment?.sigils?.aquatic1, "aquatic1"),
        aquatic2: normalizeSigilArray(build.equipment?.sigils?.aquatic2, "aquatic2"),
      },
      infusions: {
        head: String(build.equipment?.infusions?.head || ""),
        shoulders: String(build.equipment?.infusions?.shoulders || ""),
        chest: String(build.equipment?.infusions?.chest || ""),
        hands: String(build.equipment?.infusions?.hands || ""),
        legs: String(build.equipment?.infusions?.legs || ""),
        feet: String(build.equipment?.infusions?.feet || ""),
        mainhand1: String(build.equipment?.infusions?.mainhand1 || ""),
        offhand1: String(build.equipment?.infusions?.offhand1 || ""),
        mainhand2: String(build.equipment?.infusions?.mainhand2 || ""),
        offhand2: String(build.equipment?.infusions?.offhand2 || ""),
        back: String(build.equipment?.infusions?.back || ""),
        amulet: String(build.equipment?.infusions?.amulet || ""),
        ring1: String(build.equipment?.infusions?.ring1 || ""),
        ring2: String(build.equipment?.infusions?.ring2 || ""),
        accessory1: String(build.equipment?.infusions?.accessory1 || ""),
        accessory2: String(build.equipment?.infusions?.accessory2 || ""),
        breather: String(build.equipment?.infusions?.breather || ""),
        aquatic1: String(build.equipment?.infusions?.aquatic1 || ""),
        aquatic2: String(build.equipment?.infusions?.aquatic2 || ""),
      },
```

- [ ] **Step 5: Update `serializeEditorToBuild()`**

In the `equipment` block (around line 627), remove `runeSet` and add:

```javascript
      runes: { ...state.editor.equipment.runes },
      sigils: {
        mainhand1: [...(state.editor.equipment.sigils?.mainhand1 || ["", ""])],
        offhand1: [...(state.editor.equipment.sigils?.offhand1 || [""])],
        mainhand2: [...(state.editor.equipment.sigils?.mainhand2 || ["", ""])],
        offhand2: [...(state.editor.equipment.sigils?.offhand2 || [""])],
        aquatic1: [...(state.editor.equipment.sigils?.aquatic1 || ["", ""])],
        aquatic2: [...(state.editor.equipment.sigils?.aquatic2 || ["", ""])],
      },
      infusions: { ...state.editor.equipment.infusions },
```

- [ ] **Step 6: Update `enforceEditorConsistency()` to clear upgrades on weapon removal**

In the weapon-clearing loop (around line 238-255), when a weapon is cleared, also clear its sigils and infusion:

```javascript
      if (!valid) {
        equip.weapons[key] = "";
        if (equip.slots?.[key] !== undefined) equip.slots[key] = "";
        // Clear associated upgrades
        if (equip.sigils?.[key]) {
          equip.sigils[key] = key.startsWith("offhand") ? [""] : ["", ""];
        }
        if (equip.infusions?.[key] !== undefined) equip.infusions[key] = "";
      }
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/editor.js
git commit -m "feat: update editor serialization for rune/sigil/infusion upgrade slots"
```

---

## Chunk 3: UI — Inline Sub-Slots and CSS

### Task 5: Add Upgrade Sub-Slot CSS

**Files:**
- Modify: `src/renderer/styles/equipment.css`

- [ ] **Step 1: Add upgrade sub-slot styles**

Append to the end of `equipment.css`:

```css
/* Upgrade sub-slots (rune / sigil / infusion) */
.equip-upgrade-slots {
  display: flex;
  gap: 3px;
  margin-left: auto;
  flex-shrink: 0;
}

.equip-upgrade-btn {
  width: 24px;
  height: 24px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 10px;
  border: 1px solid;
  background: transparent;
  padding: 0;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  overflow: hidden;
}

.equip-upgrade-btn img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* Rune — amber/gold */
.equip-upgrade-btn--rune {
  border-color: rgba(180, 120, 40, 0.25);
  background: rgba(180, 120, 40, 0.06);
  color: rgba(220, 170, 80, 0.4);
}
.equip-upgrade-btn--rune:hover {
  border-color: rgba(180, 120, 40, 0.6);
  background: rgba(180, 120, 40, 0.15);
  box-shadow: 0 0 6px rgba(180, 120, 40, 0.2);
}
.equip-upgrade-btn--rune.equip-upgrade-btn--filled {
  border-color: rgba(180, 120, 40, 0.5);
  background: rgba(180, 120, 40, 0.12);
}

/* Sigil — blue */
.equip-upgrade-btn--sigil {
  border-color: rgba(40, 120, 180, 0.25);
  background: rgba(40, 120, 180, 0.06);
  color: rgba(80, 170, 240, 0.4);
}
.equip-upgrade-btn--sigil:hover {
  border-color: rgba(40, 120, 180, 0.6);
  background: rgba(40, 120, 180, 0.15);
  box-shadow: 0 0 6px rgba(40, 120, 180, 0.2);
}
.equip-upgrade-btn--sigil.equip-upgrade-btn--filled {
  border-color: rgba(40, 120, 180, 0.5);
  background: rgba(40, 120, 180, 0.12);
}

/* Infusion — purple */
.equip-upgrade-btn--infusion {
  border-color: rgba(120, 60, 180, 0.25);
  background: rgba(120, 60, 180, 0.06);
  color: rgba(180, 120, 240, 0.4);
}
.equip-upgrade-btn--infusion:hover {
  border-color: rgba(120, 60, 180, 0.6);
  background: rgba(120, 60, 180, 0.15);
  box-shadow: 0 0 6px rgba(120, 60, 180, 0.2);
}
.equip-upgrade-btn--infusion.equip-upgrade-btn--filled {
  border-color: rgba(120, 60, 180, 0.5);
  background: rgba(120, 60, 180, 0.12);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles/equipment.css
git commit -m "feat: add CSS for upgrade sub-slot buttons (rune/sigil/infusion color coding)"
```

---

### Task 6: Add Inline Upgrade Sub-Slots to Equipment Rows

**Files:**
- Modify: `src/renderer/modules/equipment.js`

This is the main UI task. Add a helper function `makeUpgradeSlots()` that creates the inline sub-slot buttons, then integrate it into `makeSlot()`, `makeWeaponSlot()`, and the trinket rendering.

- [ ] **Step 1: Add upgrade slot helper function**

Add after the `closeSlotPicker` / `openSlotPicker` functions (around line 139), before `renderEquipmentPanel`:

```javascript
// Build picker items list from upgrade catalog data
function getUpgradePickerItems(type) {
  const catalog = state.upgradeCatalog;
  if (!catalog) return [{ value: "", label: "— Loading… —", subtitle: "Upgrade data not yet loaded" }];
  const items = catalog[type] || [];
  return [
    { value: "", label: "— None —" },
    ...items.map((item) => ({
      value: String(item.id),
      label: type === "runes"
        ? item.name.replace(/^Superior Rune of (the )?/, "")
        : type === "sigils"
          ? item.name.replace(/^Superior Sigil of (the )?/, "")
          : item.name,
      subtitle: item.description ? item.description.slice(0, 80) : "",
      icon: item.icon,
      _fullName: item.name,
    })),
  ];
}

// Create upgrade sub-slot buttons for a given equipment slot
function makeUpgradeBtn(type, slotKey, currentValue, onSelect) {
  const catalog = state.upgradeCatalog;
  const btn = document.createElement("button");
  btn.type = "button";
  const typeClass = type === "runes" ? "rune" : type === "sigils" ? "sigil" : "infusion";
  const letter = type === "runes" ? "R" : type === "sigils" ? "S" : "I";
  btn.className = `equip-upgrade-btn equip-upgrade-btn--${typeClass}` + (currentValue ? " equip-upgrade-btn--filled" : "");

  if (currentValue && catalog) {
    const lookupMap = type === "runes" ? catalog.runeById : type === "sigils" ? catalog.sigilById : catalog.infusionById;
    const itemDef = lookupMap?.get(Number(currentValue));
    if (itemDef?.icon) {
      const img = document.createElement("img");
      img.src = itemDef.icon;
      img.alt = itemDef.name;
      img.draggable = false;
      img.addEventListener("error", () => { img.remove(); btn.textContent = letter; });
      btn.append(img);
    } else {
      btn.textContent = letter;
    }
  } else {
    btn.textContent = letter;
  }

  const pickerType = type === "runes" ? "runes" : type === "sigils" ? "sigils" : "infusions";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openSlotPicker(btn, currentValue, onSelect, {
      items: getUpgradePickerItems(pickerType),
      searchPlaceholder: `Search ${pickerType}…`,
    });
  });

  // Hover preview
  bindHoverPreview(btn, `equip-${typeClass}`, () => {
    if (!currentValue || !catalog) return null;
    const lookupMap = type === "runes" ? catalog.runeById : type === "sigils" ? catalog.sigilById : catalog.infusionById;
    const itemDef = lookupMap?.get(Number(currentValue));
    if (!itemDef) return null;
    return { name: itemDef.name, icon: itemDef.icon, description: itemDef.description || "" };
  });

  return btn;
}
```

- [ ] **Step 2: Integrate upgrade sub-slots into `makeSlot()` (armor + trinkets)**

Inside `makeSlot()` (around line 161), after the `info.append(labelEl, valueEl)` and `wrapper.append(icon, info)` lines, add upgrade buttons before the return:

```javascript
    // Upgrade sub-slots
    const upgradeContainer = document.createElement("div");
    upgradeContainer.className = "equip-upgrade-slots";

    // Rune (armor + breather only)
    const isArmorSlot = ["head", "shoulders", "chest", "hands", "legs", "feet", "breather"].includes(slotDef.key);
    if (isArmorSlot) {
      const runeVal = equip.runes?.[slotDef.key] || "";
      upgradeContainer.append(makeUpgradeBtn("runes", slotDef.key, runeVal, (newVal) => {
        if (!equip.runes) equip.runes = {};
        equip.runes[slotDef.key] = newVal || "";
        _markEditorChanged();
        renderEquipmentPanel();
      }));
    }

    // Infusion (all slots that have infusion entries)
    if (equip.infusions && slotDef.key in (equip.infusions || {})) {
      const infVal = equip.infusions[slotDef.key] || "";
      upgradeContainer.append(makeUpgradeBtn("infusions", slotDef.key, infVal, (newVal) => {
        equip.infusions[slotDef.key] = newVal || "";
        _markEditorChanged();
        renderEquipmentPanel();
      }));
    }

    if (upgradeContainer.children.length > 0) {
      wrapper.append(upgradeContainer);
    }
```

- [ ] **Step 3: Integrate upgrade sub-slots into `makeWeaponSlot()`**

Inside `makeWeaponSlot()`, before the `return wrapper;` line (around line 355), add:

```javascript
    // Upgrade sub-slots for weapons
    if (!lockedByTwoHanded) {
      const upgradeContainer = document.createElement("div");
      upgradeContainer.className = "equip-upgrade-slots";

      // Determine sigil count: two-handed = 2, one-handed/empty = 1
      const weaponId = weapons[slotDef.key] || "";
      const wDef = GW2_WEAPONS_BY_ID.get(weaponId);
      const isTwoHanded = wDef?.hand === "two" || (
        !slotDef.key.startsWith("offhand") &&
        (state.activeCatalog?.professionWeapons?.[weaponId]?.flags || []).includes("TwoHand")
      );
      // Aquatic weapons are always two-handed; offhand always 1
      const isAquaticSlot = slotDef.key.startsWith("aquatic");
      const sigilCount = slotDef.key.startsWith("offhand") ? 1 : (isAquaticSlot || isTwoHanded ? 2 : 1);
      const sigilArr = equip.sigils?.[slotDef.key] || [];

      for (let i = 0; i < sigilCount; i++) {
        const sigilVal = String(sigilArr[i] || "");
        upgradeContainer.append(makeUpgradeBtn("sigils", slotDef.key, sigilVal, (newVal) => {
          if (!equip.sigils) equip.sigils = {};
          if (!Array.isArray(equip.sigils[slotDef.key])) {
            equip.sigils[slotDef.key] = slotDef.key.startsWith("offhand") ? [""] : ["", ""];
          }
          equip.sigils[slotDef.key][i] = newVal || "";
          _markEditorChanged();
          renderEquipmentPanel();
        }));
      }

      // Infusion
      const infVal = equip.infusions?.[slotDef.key] || "";
      upgradeContainer.append(makeUpgradeBtn("infusions", slotDef.key, infVal, (newVal) => {
        if (!equip.infusions) equip.infusions = {};
        equip.infusions[slotDef.key] = newVal || "";
        _markEditorChanged();
        renderEquipmentPanel();
      }));

      wrapper.append(upgradeContainer);
    }
```

- [ ] **Step 4: Clear second sigil when two-handed swaps to one-handed**

In the weapon selection handler (around line 330-343), after the two-handed offhand clearing logic, add:

```javascript
            // Clear second sigil on the mainhand when swapping to one-handed
            if (!newFlags.includes("TwoHand") && equip.sigils?.[slotDef.key]) {
              equip.sigils[slotDef.key][1] = "";
            }
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/equipment.js
git commit -m "feat: add inline upgrade sub-slots to armor, weapon, and trinket rows"
```

---

### Task 7: Add Fill All Buttons for Upgrades

**Files:**
- Modify: `src/renderer/modules/equipment.js`

- [ ] **Step 1: Update `makeSection()` to support upgrade fill buttons**

Modify `makeSection()` to accept additional fill button configs. Add after the existing `fillBtn` logic:

The approach: pass `upgradeFills` array to `makeSection()`, each with `{ label, type, keys }`.

Update the armor section creation (around line 436-443):

```javascript
  const armorSection = makeSection("Armor", {
    fillSlotKeys: armorKeys,
    onClear: () => {
      for (const key of armorKeys) {
        equip.slots[key] = "";
        if (equip.runes) equip.runes[key] = "";
        if (equip.infusions) equip.infusions[key] = "";
      }
    },
    upgradeFills: [
      { label: "Fill Runes", type: "runes", keys: armorKeys },
      { label: "Fill Infusions", type: "infusions", keys: armorKeys },
    ],
  });
```

Update the weapon section (around line 447-458):

```javascript
  const weaponSection = makeSection("Weapons", {
    onClear: () => {
      for (const key of weaponKeys) {
        equip.slots[key] = "";
        equip.weapons[key] = "";
        if (equip.sigils?.[key]) equip.sigils[key] = key.startsWith("offhand") ? [""] : ["", ""];
        if (equip.infusions) equip.infusions[key] = "";
      }
    },
    upgradeFills: [
      { label: "Fill Sigils", type: "sigils", keys: weaponKeys },
      { label: "Fill Infusions", type: "infusions", keys: weaponKeys },
    ],
  });
```

Update the trinket section (around line 668-674):

```javascript
  const trinketSection = makeSection("Trinkets", {
    fillSlotKeys: allTrinketKeys,
    onClear: () => {
      for (const key of allTrinketKeys) {
        equip.slots[key] = "";
        if (equip.infusions) equip.infusions[key] = "";
      }
      equip.relic = "";
    },
    upgradeFills: [
      { label: "Fill Infusions", type: "infusions", keys: allTrinketKeys },
    ],
  });
```

- [ ] **Step 2: Implement upgrade fill buttons in `makeSection()`**

Inside `makeSection()`, after the existing `fillBtn` block (around line 382), add:

```javascript
    if (upgradeFills && upgradeFills.length) {
      for (const fill of upgradeFills) {
        const uBtn = document.createElement("button");
        uBtn.type = "button";
        uBtn.className = "equip-fill-btn";
        uBtn.textContent = fill.label;
        uBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const pickerType = fill.type;
          openSlotPicker(uBtn, "", (newVal) => {
            if (newVal === "") return;
            for (const key of fill.keys) {
              if (pickerType === "sigils") {
                if (!equip.sigils) equip.sigils = {};
                if (!Array.isArray(equip.sigils[key])) {
                  equip.sigils[key] = key.startsWith("offhand") ? [""] : ["", ""];
                }
                equip.sigils[key][0] = newVal;
              } else if (pickerType === "runes") {
                if (!equip.runes) equip.runes = {};
                equip.runes[key] = newVal;
              } else {
                if (!equip.infusions) equip.infusions = {};
                equip.infusions[key] = newVal;
              }
            }
            _markEditorChanged();
            renderEquipmentPanel();
          }, {
            items: getUpgradePickerItems(pickerType),
            searchPlaceholder: `Search ${pickerType}…`,
          });
        });
        btnGroup.append(uBtn);
      }
    }
```

Update the `makeSection` function signature to destructure `upgradeFills`:

```javascript
  function makeSection(title, { fillSlotKeys, onClear, upgradeFills } = {}) {
```

- [ ] **Step 3: Update Clear All Equipment handler**

Update the `clearAllBtn` handler (around line 425-433) to also clear upgrades:

```javascript
  clearAllBtn.addEventListener("click", () => {
    for (const key of Object.keys(equip.slots)) equip.slots[key] = "";
    for (const key of Object.keys(equip.weapons)) equip.weapons[key] = "";
    if (equip.runes) for (const key of Object.keys(equip.runes)) equip.runes[key] = "";
    if (equip.sigils) {
      for (const key of Object.keys(equip.sigils)) {
        equip.sigils[key] = key.startsWith("offhand") ? [""] : ["", ""];
      }
    }
    if (equip.infusions) for (const key of Object.keys(equip.infusions)) equip.infusions[key] = "";
    equip.relic = "";
    equip.food = "";
    equip.utility = "";
    _markEditorChanged();
    renderEquipmentPanel();
  });
```

- [ ] **Step 4: Update underwater section clear handler**

Update the underwater section clear (around line 696-703):

```javascript
  const underwaterSection = makeSection("Underwater", {
    onClear: () => {
      for (const key of underwaterKeys) {
        equip.slots[key] = "";
        if (equip.weapons[key] !== undefined) equip.weapons[key] = "";
        if (equip.runes?.[key] !== undefined) equip.runes[key] = "";
        if (equip.sigils?.[key]) equip.sigils[key] = ["", ""];
        if (equip.infusions?.[key] !== undefined) equip.infusions[key] = "";
      }
    },
    upgradeFills: [
      { label: "Fill Infusions", type: "infusions", keys: underwaterKeys },
    ],
  });
```

- [ ] **Step 5: Remove the old Upgrades section (runeSet text input)**

Delete the "Upgrades" section that renders the `runeSet` text input (around lines 601-608):

```javascript
  // DELETE these lines:
  const upgradesSection = makeSection("Upgrades", {
    onClear: () => { equip.runeSet = ""; },
  });
  upgradesSection.append(
    makeTextInput("Rune", equip.runeSet, "Rune of the Scholar", (v) => { equip.runeSet = v; _markEditorChanged(); }),
  );
  rightCol.append(upgradesSection);
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/equipment.js
git commit -m "feat: add fill-all buttons for runes, sigils, and infusions"
```

---

## Chunk 4: Stat Calculations & Final Polish

### Task 8: Add Infusion and Rune Stat Contributions

**Files:**
- Modify: `src/renderer/modules/stats.js`

- [ ] **Step 1: Update `computeEquipmentStats()` to include infusion stats**

After the food stat block (around line 74), add:

```javascript
  // Infusion stat contributions
  const infusions = state.editor.equipment?.infusions || {};
  const upgradeCatalog = state.upgradeCatalog;
  if (upgradeCatalog) {
    for (const infusionId of Object.values(infusions)) {
      if (!infusionId) continue;
      const infDef = upgradeCatalog.infusionById?.get(Number(infusionId));
      if (!infDef?.infixUpgrade?.attributes) continue;
      for (const attr of infDef.infixUpgrade.attributes) {
        const statKey = attr.attribute === "ConditionDamage" ? "ConditionDamage"
          : attr.attribute === "HealingPower" ? "HealingPower"
          : attr.attribute;
        if (totals[statKey] !== undefined) {
          totals[statKey] += attr.modifier || 0;
        }
      }
    }

    // Rune 6-piece set bonus stat contribution
    const runes = state.editor.equipment?.runes || {};
    const armorRuneKeys = ["head", "shoulders", "chest", "hands", "legs", "feet"];
    const armorRuneIds = armorRuneKeys.map((k) => runes[k] || "").filter(Boolean);
    if (armorRuneIds.length === 6) {
      const allSame = armorRuneIds.every((id) => id === armorRuneIds[0]);
      if (allSame) {
        const runeDef = upgradeCatalog.runeById?.get(Number(armorRuneIds[0]));
        if (runeDef?.infixUpgrade?.attributes) {
          for (const attr of runeDef.infixUpgrade.attributes) {
            const statKey = attr.attribute === "ConditionDamage" ? "ConditionDamage"
              : attr.attribute === "HealingPower" ? "HealingPower"
              : attr.attribute;
            if (totals[statKey] !== undefined) {
              totals[statKey] += attr.modifier || 0;
            }
          }
        }
      }
    }
  }
```

- [ ] **Step 2: Add `state` import if not already present**

The file already imports `state` — verify it's there (line 2: `import { state } from "./state.js";`). No change needed.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/stats.js
git commit -m "feat: add infusion and rune set bonus stat contributions to equipment stats"
```

---

### Task 9: Add Hover Preview Support for Upgrade Items

**Files:**
- Modify: `src/renderer/modules/detail-panel.js:334-353` (getHoverMetaLine)

- [ ] **Step 1: Add upgrade hover kinds to `getHoverMetaLine()`**

In `getHoverMetaLine()` (around line 345), after the `equip-relic` case, add:

```javascript
  if (kind === "equip-rune") return "Rune";
  if (kind === "equip-sigil") return "Sigil";
  if (kind === "equip-infusion") return "Infusion";
```

The `showHoverPreview()` function and `buildSkillCard()` already handle generic entities with `name`, `icon`, and `description` — no other changes needed.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/detail-panel.js
git commit -m "feat: add hover preview support for rune/sigil/infusion upgrade items"
```

---

### Task 10: Hide Upgrade Slots in PvP Mode

**Files:**
- Modify: `src/renderer/modules/equipment.js`

- [ ] **Step 1: Skip upgrade sub-slots when gameMode is pvp**

In the `makeUpgradeBtn()` function, add an early return at the top:

```javascript
  // PvP mode has no rune/sigil/infusion customization
  if (state.editor.gameMode === "pvp") return null;
```

Then in `makeSlot()` and `makeWeaponSlot()`, guard the append with a null check:

```javascript
  // Where makeUpgradeBtn is called, check for null:
  const runeBtn = makeUpgradeBtn(...);
  if (runeBtn) upgradeContainer.append(runeBtn);
```

Similarly, skip the upgrade fill buttons in `makeSection()` when in PvP mode.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/equipment.js
git commit -m "feat: hide upgrade slots in PvP mode"
```

---

### Task 11: Remove runeSet References

**Files:**
- Modify: `src/renderer/modules/constants.js` (if any `runeSet` references)
- Modify: `src/renderer/modules/equipment.js` (already done in Task 8 Step 5)

- [ ] **Step 1: Search for remaining `runeSet` references**

Run: `grep -rn "runeSet" src/`

Remove or update any remaining references. Key locations:
- `constants.js` — unlikely, but check
- `editor.js` — already updated in Task 4 (remove from `computeEditorSignature`, `parseBuildImportPayload`, `loadBuildIntoEditor`, `serializeEditorToBuild`)
- `equipment.js` — already removed in Task 7 Step 5
- `state.js` — already updated in Task 1

- [ ] **Step 2: Commit any remaining cleanup**

```bash
git add -A
git commit -m "chore: remove remaining runeSet references"
```

---

### Task 12: Manual Testing Checklist

No code changes — this is a verification task.

- [ ] **Step 1: Launch the app and verify upgrade catalog loads**

Open DevTools console, check `state.upgradeCatalog` is populated with runes/sigils/infusions arrays.

- [ ] **Step 2: Test armor rune selection**

Click the "R" button on a Helm slot. Verify the picker opens with a searchable list of runes. Select a rune. Verify the button updates to show the rune icon.

- [ ] **Step 3: Test Fill Runes**

Click "Fill Runes" on the Armor section header. Select a rune. Verify all 6 armor slots now show that rune.

- [ ] **Step 4: Test weapon sigil selection**

Select a Greatsword (two-handed) in Mainhand 1. Verify 2 sigil buttons appear. Select a one-handed Sword. Verify only 1 sigil button appears and the second sigil was cleared.

- [ ] **Step 5: Test trinket infusions**

Click the "I" button on a Ring slot. Verify the picker shows infusions. Select one. Verify it appears.

- [ ] **Step 6: Test Clear All Equipment**

Click "Clear All Equipment". Verify all stats, weapons, runes, sigils, and infusions are cleared.

- [ ] **Step 7: Test stat panel updates**

Select 6 identical runes on all armor pieces. Verify the Attributes panel reflects the rune set bonus stats. Add an infusion. Verify its stat contribution appears.

- [ ] **Step 8: Test save/load round-trip**

Save a build with upgrades. Reload it. Verify all rune/sigil/infusion selections persist correctly.

- [ ] **Step 9: Test backward compatibility**

Load an old build (without upgrade data). Verify it loads cleanly with empty upgrade slots.
