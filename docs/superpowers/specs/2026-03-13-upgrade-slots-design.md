# Upgrade Slots Design: Runes, Sigils & Infusions

## Summary

Add per-slot rune, sigil, and infusion selection to the equipment panel. Upgrade item IDs are maintained in `constants.js` (matching the existing pattern for relics/food/utility), with icon and description data fetched from the GW2 API at catalog load time. Upgrade slots appear as inline sub-slot buttons on each equipment row, reusing the existing `openSlotPicker()` with richer item data.

## Slot Mapping

| Equipment Type              | Upgrade Slots                                                |
|-----------------------------|--------------------------------------------------------------|
| Armor (6 pieces)            | 1 Rune + 1 Infusion each                                    |
| Weapons (land, 4 slots)     | 1-2 Sigils + 1 Infusion each (two-handed = 2 sigils, one-handed = 1) |
| Back                        | 1 Infusion                                                   |
| Amulet                      | 1 Enrichment (treated as infusion for simplicity)            |
| Rings (2)                   | 1 Infusion each (simplified from GW2's 3 per ring)          |
| Accessories (2)             | 1 Infusion each (simplified from GW2's 2 per accessory)     |
| Underwater armor (breather) | 1 Rune + 1 Infusion                                         |
| Underwater weapons (2)      | 1-2 Sigils + 1 Infusion each (same dynamic logic)           |

**Simplification note:** GW2's actual infusion slot counts vary (rings have 3, accessories have 2, amulets use enrichments). We simplify to 1 infusion per trinket piece for UI clarity. This means the stat panel will under-count infusion stats for trinkets, but infusion stacking is rarely important for build planning. This can be expanded later if needed.

## Data Layer

### GW2 API Integration

Maintain curated lists of item IDs in `constants.js` for:

- **Superior Runes** (~100 items)
- **Superior Sigils** (~50 items)
- **Stat Infusions** — both PvE (+5 Power, +9 Agony Resistance, etc.) and WvW (+5 Power/+5 Concentration, etc.)

At catalog load time, fetch item details from `/v2/items?ids=<comma-separated IDs>` via the existing `fetchGw2ByIds()` helper (which chunks at 180 IDs per batch). Cache alongside existing profession data. Expose to renderer via IPC using the same pattern as profession catalogs.

Each item record needs: `id`, `name`, `icon`, `description`, and stat bonuses (parsed from `details.infix_upgrade`).

This matches the existing pattern: relics, food, and utility items all have hardcoded ID lists in `constants.js` with display data. The difference is that upgrade items will fetch richer data (icons, descriptions) from the API rather than hardcoding everything.

### State Model

Extend `state.editor.equipment`:

```javascript
equipment: {
  // existing
  slots: { head: "", shoulders: "", chest: "", hands: "", legs: "", feet: "", ... },
  weapons: { mainhand1: "", offhand1: "", mainhand2: "", offhand2: "", aquatic1: "", aquatic2: "" },
  relic: "",
  food: "",
  utility: "",

  // new
  runes: {
    head: "", shoulders: "", chest: "", hands: "", legs: "", feet: "",
    breather: ""
  },
  sigils: {
    mainhand1: ["", ""],   // [sigil1, sigil2] — sigil2 only used for two-handed weapons
    offhand1: [""],        // [sigil1] — one-handed only ever has 1
    mainhand2: ["", ""],
    offhand2: [""],
    aquatic1: ["", ""],    // aquatic weapons are always two-handed
    aquatic2: ["", ""]
  },
  infusions: {
    // armor
    head: "", shoulders: "", chest: "", hands: "", legs: "", feet: "",
    // weapons
    mainhand1: "", offhand1: "", mainhand2: "", offhand2: "",
    // trinkets
    back: "", amulet: "", ring1: "", ring2: "", accessory1: "", accessory2: "",
    // underwater
    breather: "", aquatic1: "", aquatic2: ""
  }
}
```

Values are stored as GW2 item ID strings (e.g. `"24836"`). Empty string means no upgrade selected.

**Sigil arrays:** Mainhand and aquatic slots use `["", ""]` arrays to support two-handed weapons which get 2 sigil slots. Offhand slots use `[""]` (always 1 sigil). The UI dynamically shows 1 or 2 sigil sub-slots based on the selected weapon type. When a two-handed weapon is swapped to one-handed, `sigils[key][1]` is cleared.

### Deprecation

The existing `runeSet` text field is removed in favor of the per-slot `runes` object. Old builds with a `runeSet` value are silently dropped on load — no migration to per-slot runes is attempted, since the old field was free-text with no item ID.

### Sigil Array Normalization

When importing or loading builds, `parseBuildImportPayload()` must normalize sigil values to the correct array shape:
- Mainhand/aquatic slots: ensure 2-element array `["", ""]`
- Offhand slots: ensure 1-element array `[""]`
- Missing or malformed values default to empty arrays of the correct length.

## UI Layer

### Inline Sub-Slots

Small 24px square buttons appear on the right side of each equipment row:

- **Armor:** `[icon] [stat combo] ............. [R] [I]`
- **Weapons (two-handed):** `[weapon btn] [stat btn] ... [S1] [S2] [I]`
- **Weapons (one-handed):** `[weapon btn] [stat btn] ... [S] [I]`
- **Trinkets:** `[icon] [stat combo] ............. [I]`
- **Underwater armor:** `[icon] [stat combo] ... [R] [I]`
- **Underwater weapons:** same as land weapons

### Color Coding

Visual differentiation by upgrade type:
- **Runes**: amber/gold — `rgba(180, 120, 40, ...)`
- **Sigils**: blue — `rgba(40, 120, 180, ...)`
- **Infusions**: purple — `rgba(120, 60, 180, ...)`

### States

- **Empty**: dim border, letter placeholder (R, S, or I), low opacity
- **Filled**: brighter border, item icon from API data, full opacity

### Interaction

Clicking a sub-slot opens `openSlotPicker()` with the relevant upgrade item list. The picker shows:
- Item icon
- Item name (label)
- Item description as subtitle (e.g. "(6): +175 Power" for runes, "50% Chance on Critical: ..." for sigils)

### Hover Preview

Hovering a filled upgrade sub-slot shows the detail panel (same as existing stat/weapon previews) with:
- Item icon and name
- Full item description (rune set bonuses, sigil proc text, infusion stats)

### Dynamic Sigil Count

Weapon rows dynamically show 1 or 2 sigil sub-slots based on weapon type:
- Two-handed weapon selected: 2 sigil slots (reads `sigils[key][0]` and `sigils[key][1]`)
- One-handed weapon selected: 1 sigil slot (reads `sigils[key][0]`)
- No weapon selected: 1 sigil slot (default)

When a two-handed weapon is swapped to one-handed, `sigils[key][1]` is cleared automatically. The existing `enforceEditorConsistency()` in `editor.js` must also be updated to clear sigils and infusions when weapons are removed or swapped.

### Section Header Buttons

Each section gets "Fill All [type]" buttons alongside existing controls:

| Section   | Buttons                                              |
|-----------|------------------------------------------------------|
| Armor     | Fill All (stats), Fill Runes, Fill Infusions, Clear  |
| Weapons   | Fill All (stats), Fill Sigils, Fill Infusions, Clear |
| Trinkets  | Fill All (stats), Fill Infusions, Clear              |
| Underwater| Same pattern as their land counterparts              |

"Clear" resets stats AND all upgrades for that section.

"Clear All Equipment" also clears all runes, sigils, and infusions (update existing `clearAllBtn` handler).

### PvP Mode

In sPvP mode, upgrade slots are hidden — PvP uses a separate amulet stat system with no rune/sigil/infusion customization.

## Serialization

Build JSON includes new fields:

```json
{
  "equipment": {
    "slots": { "head": "Berserker's" },
    "weapons": { "mainhand1": "greatsword" },
    "runes": { "head": "24836" },
    "sigils": { "mainhand1": ["24615", "24868"] },
    "infusions": { "head": "49432", "mainhand1": "49432" },
    "relic": "Relic of the Thief",
    "food": "...",
    "utility": "..."
  }
}
```

Backward compatible: old builds without `runes`/`sigils`/`infusions` load with empty defaults.

### Editor Functions to Update

The following functions in `editor.js` must be updated to include the three new sub-objects:

- `computeEditorSignature()` — include `runes`, `sigils`, `infusions` so unsaved-changes detection works
- `serializeEditorToBuild()` — serialize new fields to build JSON
- `loadBuildIntoEditor()` — deserialize new fields from build JSON (with empty defaults for old builds)
- `parseBuildImportPayload()` — handle imported builds with/without upgrade data

## Stat Calculations

**Infusions:** Stats from infusions (e.g. +5 Power) are added into `computeEquipmentStats()`. This requires looking up the infusion item ID against the fetched API data and reading `details.infix_upgrade.attributes`.

**Runes:** Rune set bonuses that grant flat stats (e.g. Scholar 6-piece: +175 Power) are added to `computeEquipmentStats()` when all 6 armor rune slots contain the same rune ID. Partial set bonuses (2-piece, 4-piece) are not calculated — only the full 6-piece stat bonus is applied, as partial bonuses are primarily proc effects rather than stats.

## Files Affected

- `src/main/gw2Data/catalog.js` — add API fetch for upgrade item details (batched `/v2/items?ids=...`)
- `src/main/gw2Data/fetch.js` — possibly add new fetch helpers for batched item requests
- `src/renderer/modules/constants.js` — add curated item ID lists for runes/sigils/infusions, remove `runeSet` references
- `src/renderer/modules/equipment.js` — add inline sub-slots, fill buttons, upgrade picker integration, update clear handlers
- `src/renderer/styles/equipment.css` — add sub-slot styling (color-coded states)
- `src/renderer/modules/state.js` — extend default equipment state with `runes`, `sigils`, `infusions`
- `src/renderer/modules/stats.js` — add infusion + rune stat contributions to `computeEquipmentStats()`
- `src/renderer/modules/editor.js` — update signature, serialization, deserialization, and import parsing
- `src/renderer/modules/detail-panel.js` — add hover preview for upgrade items
