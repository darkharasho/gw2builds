# Boon & Condition Coverage Design

## Summary

Display boon and condition coverage icons above the heal/utility/elite skill group in the skill bar. The system scans all skills (weapon, heal, utility, elite, profession mechanics, flip/chain variants) and selected traits for boon/condition output, then renders two rows of icons — boons on top, conditions below — with hover tooltips showing the source breakdown. Ally-only boons/conditions are marked with a small blue badge.

## Layout

Two rows inserted above the utility skill group (between the profession mechanics bar and the heal/utility/elite slots):

```
[F1] [F2] [F3]                    [Might][Fury][Quickness↑][Regen][Swiftness]   ← boons row
[⇄][W1][W2][W3][W4][W5]  (orb)   [Burning][Bleeding][Vulnerability↑]           ← conditions row
                                   [Heal] [U1] [U2] [U3] [Elite]               ← existing utility row
```

- Boons row on top, conditions row below
- Rows are hidden when empty (no boons or no conditions found)
- Icons are 22×22px using images from the existing `BOON_CONDITION_ICONS` map in constants.js
- Ally-only boons/conditions get a small blue circle badge (10px) in the top-right corner
- If a boon/condition has both self and ally sources, it shows as self (no badge)

## Boon/Condition Ordering

Boons follow standard GW2 buff bar order: Aegis, Alacrity, Fury, Might, Protection, Quickness, Regeneration, Resistance, Resolution, Stability, Swiftness, Vigor.

Conditions follow alphabetical order: Bleeding, Blinded, Burning, Chilled, Confusion, Crippled, Fear, Immobile, Poisoned, Slow, Taunt, Torment, Vulnerability, Weakness.

## Data Sources

All of the following are scanned for boon/condition output:

1. **Weapon skills** — both weapon sets (active + inactive), resolved from current weapon selections
2. **Heal / Utility / Elite skills** — from `editor.skills.{healId, utilityIds, eliteId}`
3. **Profession mechanics (F1–F5)** — resolved profession skill slots
4. **Flip/chain skills** — if a skill has a `flipSkill` property, the flip target is also scanned
5. **Selected traits** — from `editor.specializations[].majorChoices`, resolved via `catalog.traitById`

For each source, extract facts where:
- `fact.type` is in `BUFF_FACT_TYPES` (`"Buff"`, `"ApplyBuffCondition"`, `"PrefixedBuff"`)
- `fact.status` matches a known boon or condition name (accounting for API spelling variants like "Blind"/"Blinded", "Chill"/"Chilled" etc. — normalize to canonical display name for grouping)

Flip skill traversal is single-level only — if skill A has `flipSkill` → B, scan B but do not follow B's `flipSkill` further.

## Self vs Ally Detection

The GW2 API buff facts do not have a reliable `target` field for self vs ally detection. Instead, use the skill/trait `description` text to infer targeting:

- If the description contains phrases like "Grant allies", "nearby allies gain", "to allies" → ally-applied
- Otherwise → assume self-applied (conservative default)
- A boon/condition is marked "ally-only" if **all** sources for it are ally-targeted
- If **any** source is self-targeted, the icon shows as self (no badge)

The matching uses a simple keyword check on the description string. This is a heuristic — edge cases will default to "self" which is the safer assumption.

## Tooltip

On hover, show a tooltip listing all sources for that boon/condition:

```
┌─────────────────────────────────────┐
│ Might                               │
│─────────────────────────────────────│
│ [Skill]  Mantra of Potence   3×, 6s│
│ [Trait]  Radiant Power       1×, 8s│
│ [Skill]  Signet of Wrath    5×, 10s│
└─────────────────────────────────────┘
```

Each row shows:
- **Source type tag** — `[Skill]` (blue) or `[Trait]` (orange)
- **Source name** — skill or trait name
- **Stacks × Duration** — from `fact.apply_count` and `fact.duration`. If `apply_count` is 0 or absent, omit the stacks display. If `duration` is 0 or absent (e.g. passive traits), show "passive" instead of a duration.

## Computation

Create a new module `src/renderer/modules/boon-coverage.js` with:

### `computeBoonCoverage(catalog, editor)`

Collects all skill IDs and trait IDs from the current build state, extracts buff facts, and returns a structured result:

```js
{
  boons: [
    {
      name: "Might",
      icon: "https://render.guildwars2.com/...",
      allyOnly: false,
      sources: [
        { type: "skill", name: "Mantra of Potence", stacks: 3, duration: 6 },
        { type: "trait", name: "Radiant Power", stacks: 1, duration: 8 },
      ]
    },
    // ...
  ],
  conditions: [
    // same shape
  ]
}
```

The function:
1. Gathers all skill IDs from the build — weapon skills from both weapon sets (and for Elementalist, all four attunement variants per weapon set), heal/utility/elite, profession mechanics (F1–F5)
2. For each skill, also includes its `flipSkill` target if present (single level only)
3. Gathers all selected trait IDs from specialization major choices
4. Looks up each skill/trait in the catalog, extracts facts matching `BUFF_FACT_TYPES`
5. Groups by boon/condition name, classifies as boon or condition using a known-boons set
6. Determines ally-only status per boon/condition
7. Returns sorted arrays (boons in GW2 order, conditions alphabetical)

### Recalculation Triggers

`computeBoonCoverage()` is called during `renderSkills()` — the same function that already re-renders on any skill, trait, specialization, weapon, legend, or attunement change. No new event wiring needed.

## Rendering

### In `skills.js`

In the `renderSkills()` function, after building the utility group and before appending it to the bar:

1. Call `computeBoonCoverage(catalog, state.editor)`
2. Create a container div (`.boon-coverage`) with two child rows (`.boon-coverage__boons`, `.boon-coverage__conditions`)
3. For each boon/condition, render a 22×22 icon with the image from `BOON_CONDITION_ICONS`
4. If ally-only, append a small badge element
5. Attach mouseenter/mouseleave handlers for tooltip
6. Wrap the boon-coverage container and the existing `utilityGroup` in a new flex-column wrapper (`.skills-bar__util-col`), since `utilityGroup` is a flex row and cannot have the coverage rows prepended directly. The wrapper becomes the element appended to the bar in place of `utilityGroup`:
   ```
   .skills-bar__util-col (flex column)
     ├── .boon-coverage (boons row + conditions row)
     └── .skill-group--utilities (existing heal/util/elite row)
   ```

### In `skills.css`

New styles for:
- `.skills-bar__util-col` — flex column wrapper for coverage + utility group
- `.boon-coverage` — flex column container with small gap
- `.boon-coverage__boons`, `.boon-coverage__conditions` — flex row with 3px gap
- `.boon-coverage__icon` — 22×22px, border-radius 3px, with subtle background tint
- `.boon-coverage__icon img` — 18×18px icon image
- `.boon-coverage__ally-badge` — 10px blue circle, absolute positioned top-right
- `.boon-coverage__tooltip` — dark panel with source list, positioned above the icon

## Constants

Add to `constants.js`:

```js
export const BOON_NAMES = new Set([
  "Aegis", "Alacrity", "Fury", "Might", "Protection", "Quickness",
  "Regeneration", "Resistance", "Resolution", "Stability", "Swiftness", "Vigor"
]);

export const CONDITION_NAMES = new Set([
  "Bleeding", "Blind", "Blinded", "Burning", "Chill", "Chilled",
  "Confusion", "Cripple", "Crippled", "Fear", "Immobile", "Immobilize", "Immobilized",
  "Poison", "Poisoned", "Slow", "Taunt", "Torment",
  "Vulnerability", "Weakness"
]);

// Maps API spelling variants to canonical display names for grouping
export const CONDITION_NAME_NORMALIZE = {
  "Blind": "Blinded", "Chill": "Chilled", "Cripple": "Crippled",
  "Immobilize": "Immobile", "Immobilized": "Immobile", "Poison": "Poisoned",
};

export const BOON_DISPLAY_ORDER = [
  "Aegis", "Alacrity", "Fury", "Might", "Protection", "Quickness",
  "Regeneration", "Resistance", "Resolution", "Stability", "Swiftness", "Vigor"
];
```

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/modules/boon-coverage.js` | **New** — `computeBoonCoverage()` function |
| `src/renderer/modules/skills.js` | Import and call `computeBoonCoverage()`, render coverage rows above utility group |
| `src/renderer/modules/constants.js` | Add `BOON_NAMES`, `CONDITION_NAMES`, `BOON_DISPLAY_ORDER` |
| `src/renderer/styles/skills.css` | Add `.boon-coverage*` styles |

## Edge Cases

- **No boons/conditions** — rows are hidden, no empty state shown
- **Revenant legends** — scan skills from both active and inactive legend slots
- **Engineer kits** — scan the equipped kit skill, not individual kit weapon skills (those aren't selectable)
- **Attunement skills** — scan weapon skills for all attunements, not just the active one
- **Underwater mode** — when underwater toggle is active, scan underwater skills instead of land skills
- **WvW splits** — use base facts (not WvW-split facts) since this is a general coverage indicator
