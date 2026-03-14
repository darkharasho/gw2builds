# Underwater Mode Design

## Summary

Add a land/water toggle to the build panel that switches the skills panel to show underwater skills, swaps weapon bar to aquatic weapons, adjusts stat calculations for underwater equipment, and handles profession-specific underwater restrictions. Underwater skill selections are saved as part of the build.

## Build Model Changes

Add `underwaterSkills` to the build schema in `normalizeBuild()`, using the same `{heal, utility, elite}` skill-ref object format as the existing `skills` field:

```js
underwaterSkills: {
  heal: normalizeSkillRef(skills.heal),        // { id, name, icon, description, slot, type, specialization } or null
  utility: [normalizeSkillRef(...), ...],       // array of 3 skill refs
  elite: normalizeSkillRef(skills.elite),       // skill ref or null
}
```

- Persisted in `builds.json` via `normalizeBuild()` — add `underwaterSkills: normalizeSkills(input.underwaterSkills)` to the return object (after line 104 in buildStore.js)
- Schema version remains at 2 — no migration needed since `normalizeSkills(undefined)` gracefully produces `{heal: null, utility: [null, null, null], elite: null}` for existing builds
- The land/water toggle state (`underwaterMode`) is **not** persisted — always defaults to land on open

## Editor State Changes

Add to the editor UI state (transient, not saved):

```js
underwaterMode: false,
underwaterSkills: {
  healId: 0,
  utilityIds: [0, 0, 0],
  eliteId: 0,
}
```

`underwaterMode` lives alongside `activeWeaponSet`, `activeKit`, `activeAttunement`. Defaults to `false` (land view) when opening any build.

`underwaterSkills` uses the same `{healId, utilityIds, eliteId}` ID format as the existing `editor.skills`, populated from the build model on load and serialized back on save.

Both fields must be added to `createEmptyEditor()` in `state.js` (after line 81), since this function defines the canonical editor shape and is used as a fallback in `computeEditorSignature()`, `parseBuildImportPayload()`, and elsewhere.

## Skill Catalog Changes

### Capture `flags` in `mapSkill()`

The GW2 API `/v2/skills` endpoint includes a `flags` array on each skill. Skills that cannot be used underwater have `"NoUnderwater"` in this array. Currently `mapSkill()` does not capture `flags`.

Add to the mapped skill object in `catalog.js`:

```js
flags: Array.isArray(skill.flags) ? skill.flags : []
```

### Filter skills by underwater validity

`getSkillOptionsByType()` gains awareness of underwater mode. When `underwaterMode` is true, skills with `flags.includes("NoUnderwater")` are excluded from heal/utility/elite pickers.

## Toggle UI

Segmented pill toggle in the skills panel header area:

- Two segments: **Land** (default/active) and **Water**
- Land/water icons alongside labels
- Clicking toggles `state.editor.underwaterMode` and re-renders the skills panel + stat panel

## Skills Panel Behavior (Water Mode)

When `underwaterMode === true`:

### Heal / Utility / Elite Bar
- Reads from `editor.underwaterSkills` instead of `editor.skills`
- Picker filters out skills with `NoUnderwater` flag
- Skill assignments write to `underwaterSkills`

### Weapon Bar
- Shows aquatic weapon skills (from `equipment.weapons.aquatic1` / `aquatic2`) instead of land weapon sets
- `getEquippedWeaponSkills()` resolves skills for the equipped aquatic weapon type (harpoon, trident) instead of land mainhand/offhand
- Weapon set swap button switches between aquatic weapon 1 and aquatic weapon 2
- `activeWeaponSet` logic reused — value 1 = aquatic1, value 2 = aquatic2

### Ranger Pets
- Pet display shows `selectedPets.aquatic1` / `aquatic2` instead of `terrestrial1` / `terrestrial2`
- Pet picker filters to pets where `type` is `"Aquatic"` or `"Amphibious"` (using existing `aquaticFamilies` set in skills.js)
- `activePetSlot` switches to `"aquatic1"` / `"aquatic2"`

### Mechanist (Engineer, Specialization 70)
- All F1-F5 mech command skills replaced with a single F4 skill: **Mech Support: Depth Charges** (skill ID 63210)
- Other F slots hidden or empty

### Revenant Legends
- **Legendary Dragon Stance (Glint/Herald)**: dimmed and unselectable in legend picker
- **Legendary Renegade Stance (Kalla)**: dimmed and unselectable in legend picker
- If the user has Glint or Kalla selected when switching to water mode, the legend selection should be visually indicated as invalid

## Stat Computation (Water Mode)

All three stat functions read `state.editor.underwaterMode` from global state (consistent with existing pattern of reading from `state.editor`). When underwater mode is true, the `UNDERWATER_SLOTS` exclusion set changes:

- **Land mode** (current behavior): excludes `breather`, `aquatic1`, `aquatic2`
- **Water mode**: excludes `head`, `mainhand1`, `offhand1`, `mainhand2`, `offhand2` — and includes `breather`, `aquatic1`, `aquatic2` instead

Implementation: define a `LAND_ONLY_SLOTS` constant (`new Set(["head", "mainhand1", "offhand1", "mainhand2", "offhand2"])`) and select the appropriate exclusion set based on `underwaterMode`.

### `computeEquipmentStats()`
| Land Slot | Replaced By | Notes |
|-----------|-------------|-------|
| Head (armor) | Breather | Stats, rune, infusion |
| Mainhand1 / Offhand1 | Aquatic1 | Stats, sigils (2), infusion |
| Mainhand2 / Offhand2 | Aquatic2 | Stats, sigils (2), infusion |

All other slots (shoulders, chest, hands, legs, feet, trinkets, relic, food, utility) remain unchanged.

### `computeStatBreakdown()`
Same slot substitution for per-source stat attribution tooltips.

### `computeUpgradeModifiers()`
Same slot substitution for rune/sigil/infusion percentage modifiers. Additionally, sigil reading logic (which currently selects sigils from the active weapon set via `mainhand1/offhand1` or `mainhand2/offhand2`) must read from `aquatic1`/`aquatic2` when underwater.

### Weapon Strength
Weapon strength midpoint values for aquatic weapons (harpoon gun, trident) must be present in `WEAPON_STRENGTH_MIDPOINT`. Note: spear is a terrestrial two-handed weapon (reworked from aquatic), not an aquatic weapon.

## Editor Serialization Pipeline

### `loadBuildIntoEditor()`
When loading a build, populate `editor.underwaterSkills` from `build.underwaterSkills`:
- Map each skill ref's `.id` to the editor's `{healId, utilityIds, eliteId}` format
- Same pattern as existing `editor.skills` population from `build.skills`

### `serializeEditorToBuild()`
Serialize `editor.underwaterSkills` back to the build model:
- Look up each ID in `catalog.skillById` and call `simplifySkill()` to produce skill-ref objects
- Same pattern as existing `skills` serialization (lines 686-701)

### `computeEditorSignature()`
Include `underwaterSkills` in the dirty-state fingerprint payload:
```js
underwaterSkills: {
  healId: Number(editor.underwaterSkills?.healId) || 0,
  utilityIds: [...],
  eliteId: Number(editor.underwaterSkills?.eliteId) || 0,
}
```
This ensures changes to underwater skills mark the editor as dirty and trigger "unsaved changes" warnings.

### `enforceEditorConsistency()`
Validate `underwaterSkills` the same way `skills` are validated:
- Prune skills that are no longer valid for current specializations
- When checking underwater skills, also exclude skills with `NoUnderwater` flag
- For Revenant: underwater skills follow the same legend-synced pattern (`syncRevenantSkillsFromLegend()`) but applied to `underwaterSkills` — if the active legend is blocked underwater (Glint/Kalla), underwater skills should be cleared

### `parseBuildImportPayload()`
If imported build JSON contains `underwaterSkills`, parse and populate. If absent, default to empty (null refs). Underwater skills are optional in imports for backwards compatibility.

## Underwater Restrictions Summary

### API-Driven (automatic via `NoUnderwater` flag)
- Individual skills flagged by the GW2 API (e.g., Conjure Fiery Greatsword, Hallowed Ground, Chronomancer Wells)

### Hardcoded Overrides
| Restriction | Details |
|-------------|---------|
| Mechanist F-skills | F1-F5 → single F4 Depth Charges (63210) |
| Ranger pets | Aquatic/Amphibious pets only (existing `aquaticFamilies` set) |
| Revenant Glint legend | Dimmed + unselectable |
| Revenant Kalla legend | Dimmed + unselectable |

## Edge Cases

- **Switching to water with NoUnderwater skills equipped**: If a land skill assigned to an underwater slot has `NoUnderwater`, the slot shows as empty (skill ID 0). The user must pick a valid replacement.
- **Switching to water with Glint/Kalla selected**: Legend shown as invalid (dimmed). User must swap to a valid legend to see correct underwater skills.
- **Empty underwater skills**: Default state for all builds. Underwater heal/utility/elite all show empty slots until the user picks skills in water mode.
- **Build serialization**: `underwaterSkills` always saved regardless of whether the user has toggled to water mode.
- **Build import without underwater skills**: Gracefully defaults to empty/null underwater skills.

## Files Affected

| File | Change |
|------|--------|
| `src/main/buildStore.js` | Add `underwaterSkills` to schema via `normalizeSkills()`, migrate existing builds |
| `src/main/gw2Data/catalog.js` | Capture `flags` in `mapSkill()` |
| `src/renderer/modules/state.js` | Add `underwaterMode` and `underwaterSkills` to editor template |
| `src/renderer/modules/skills.js` | Toggle UI, underwater skill rendering, profession overrides, weapon skill resolution for aquatic weapons |
| `src/renderer/modules/stats.js` | Underwater slot substitution in `computeEquipmentStats()`, `computeStatBreakdown()`, and `computeUpgradeModifiers()` |
| `src/renderer/modules/editor.js` | `underwaterSkills` in `serializeEditorToBuild()`, `loadBuildIntoEditor()`, `computeEditorSignature()`, `enforceEditorConsistency()`, `parseBuildImportPayload()` |
| `src/renderer/modules/constants.js` | Mechanist Depth Charges ID, blocked legend IDs, aquatic weapon strength midpoints |
| `tests/` | Update existing tests for `getSkillOptionsByType`, add underwater mode tests |
