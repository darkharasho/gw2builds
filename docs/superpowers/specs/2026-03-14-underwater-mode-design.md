# Underwater Mode Design

## Summary

Add a land/water toggle to the build panel that switches the skills panel to show underwater skills, swaps weapon bar to aquatic weapons, adjusts stat calculations for underwater equipment, and handles profession-specific underwater restrictions. Underwater skill selections are saved as part of the build.

## Build Model Changes

Add `underwaterSkills` to the build schema:

```js
underwaterSkills: {
  healId: 0,
  utilityIds: [0, 0, 0],
  eliteId: 0
}
```

- Persisted in `builds.json` via `normalizeBuild()`
- Schema version bump — existing builds migrate with zeroed underwater skills
- The land/water toggle state (`underwaterMode`) is **not** persisted — always defaults to land on open

## Editor State Changes

Add to editor UI state (transient, not saved):

```js
underwaterMode: false
```

Lives alongside `activeWeaponSet`, `activeKit`, `activeAttunement`. Defaults to `false` (land view) when opening any build.

## Skill Catalog Changes

### Capture `flags` in `mapSkill()`

The GW2 API `/v2/skills` endpoint includes a `flags` array on each skill. Skills that cannot be used underwater have `"NoUnderwater"` in this array. Currently `mapSkill()` does not capture `flags`.

Add to the mapped skill object:

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
- Weapon set swap button switches between aquatic weapon 1 and aquatic weapon 2
- `activeWeaponSet` logic reused — value 1 = aquatic1, value 2 = aquatic2

### Ranger Pets
- Pet display shows `selectedPets.aquatic1` / `aquatic2` instead of `terrestrial1` / `terrestrial2`
- Pet picker filters to pets with `type === "Aquatic"` only
- `activePetSlot` switches to `"aquatic1"` / `"aquatic2"`

### Mechanist (Engineer, Specialization 70)
- All F1-F5 mech command skills replaced with a single F4 skill: **Mech Support: Depth Charges** (skill ID 63210)
- Other F slots hidden or empty

### Revenant Legends
- **Legendary Dragon Stance (Glint/Herald)**: dimmed and unselectable in legend picker
- **Legendary Renegade Stance (Kalla)**: dimmed and unselectable in legend picker
- If the user has Glint or Kalla selected when switching to water mode, the legend selection should be visually indicated as invalid

## Stat Computation (Water Mode)

`computeEquipmentStats()` receives the underwater mode flag. When true:

| Land Slot | Replaced By | Notes |
|-----------|-------------|-------|
| Head (armor) | Breather | Stats, rune, infusion |
| Mainhand1 / Offhand1 | Aquatic1 | Stats, sigils (2), infusion |
| Mainhand2 / Offhand2 | Aquatic2 | Stats, sigils (2), infusion |

All other slots (shoulders, chest, hands, legs, feet, trinkets, relic, food, utility) remain unchanged.

Weapon strength midpoint values for aquatic weapons (harpoon gun, spear, trident) must be present in `WEAPON_STRENGTH_MIDPOINT`.

## Underwater Restrictions Summary

### API-Driven (automatic via `NoUnderwater` flag)
- Individual skills flagged by the GW2 API (e.g., Conjure Fiery Greatsword, Hallowed Ground, Chronomancer Wells)

### Hardcoded Overrides
| Restriction | Details |
|-------------|---------|
| Mechanist F-skills | F1-F5 → single F4 Depth Charges (63210) |
| Ranger pets | Aquatic pets only |
| Revenant Glint legend | Dimmed + unselectable |
| Revenant Kalla legend | Dimmed + unselectable |

## Edge Cases

- **Switching to water with NoUnderwater skills equipped**: If a land skill assigned to an underwater slot has `NoUnderwater`, the slot shows as empty (skill ID 0). The user must pick a valid replacement.
- **Switching to water with Glint/Kalla selected**: Legend shown as invalid (dimmed). User must swap to a valid legend to see correct underwater skills.
- **Empty underwater skills**: Default state for all builds. Underwater heal/utility/elite all show empty slots until the user picks skills in water mode.
- **Build serialization**: `underwaterSkills` always saved regardless of whether the user has toggled to water mode.

## Files Affected

| File | Change |
|------|--------|
| `src/main/buildStore.js` | Add `underwaterSkills` to schema, normalize, migrate |
| `src/main/gw2Data/catalog.js` | Capture `flags` in `mapSkill()` |
| `src/renderer/modules/state.js` | Add `underwaterMode` to editor template |
| `src/renderer/modules/skills.js` | Toggle UI, underwater skill rendering, profession overrides |
| `src/renderer/modules/stats.js` | Underwater slot substitution in `computeEquipmentStats()` |
| `src/renderer/modules/editor.js` | `underwaterSkills` in serialization/consistency |
| `src/renderer/modules/constants.js` | Mechanist Depth Charges ID, blocked legend IDs, aquatic weapon strengths |
