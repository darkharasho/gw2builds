# Guild Wars 2 profession mechanics reference for a build app

This version is the **actual-F-skill-name** pass.

It is meant for apps that need to model:
- profession mechanic slots (`F1-F5`)
- the skill name shown in each slot
- the most relevant API skill id(s) when that slot maps to a concrete skill
- whether pressing the F skill directly changes the visible skill bar

## Important modeling notes

GW2 profession mechanics are weird little goblins.

Not every profession has a single fixed `F1-F5` payload:
- some `F` slots are fixed skills with stable ids
- some `F` slots depend on weapon, pet, legend, or utility loadout
- some `F` slots are **entry skills** into a transformed bar, so the visible `F` skill has one id, but the *newly loaded* `1-5` bar contains a separate set of skills and ids
- some skills show **multiple API ids** on the wiki/API side because of split variants, transformed variants, inherited shatter copies, or historical/current indexing

For app work, the safest rule is:
- treat the **button in the F slot** as one skill reference
- treat any form/tome/shroud/forge/bar replacement as a **second-layer bar state**

## Primary lookup pattern

For any skill id listed below, you can hydrate full data from:
- `https://api.guildwars2.com/v2/skills/<id>`

When multiple ids are shown, store them as an array and decide which one you surface based on your game mode / current variant logic.

---

## Elementalist

### Core

| Slot | Skill | API id(s) | Skill-bar interaction |
|---|---:|---:|---|
| F1 | Fire Attunement | `5492` | Rebuilds weapon skills `1-5` for fire attunement |
| F2 | Water Attunement | `5493` | Rebuilds weapon skills `1-5` for water attunement |
| F3 | Air Attunement | `5494` | Rebuilds weapon skills `1-5` for air attunement |
| F4 | Earth Attunement | `5495` | Rebuilds weapon skills `1-5` for earth attunement |

### Tempest

| Slot | Skill | API id(s) | Skill-bar interaction |
|---|---:|---:|---|
| F5 while in fire | Overload Fire | `29706` | Uses current fire attunement state; does not replace the bar |
| F5 while in water | Overload Water | `29415` | Uses current water attunement state; does not replace the bar |
| F5 while in air | Overload Air | `29719` | Uses current air attunement state; does not replace the bar |
| F5 while in earth | Overload Earth | `29618` | Uses current earth attunement state; does not replace the bar |

### Weaver
n/a as fixed extra F-skill ids. Weaver keeps attunement logic but changes how `1-5` are assembled. The important mechanic is that the **attunement state changes the weapon bar composition**, not that a new fixed F button is added.

### Catalyst
Catalyst adds **Deploy Jade Sphere** on `F5`, but the exact skill depends on current attunement.

Model this as:
- `F5 = Deploy Jade Sphere (<attunement>)`
- pressing it **does not replace the full bar**, but creates attunement-specific field/boon behavior
- keep it as an attunement-keyed mechanic, not a single hard-coded id

### Evoker
Use live API-first resolution. I did not have a reliable skill-id source for all Evoker profession slots in this pass.

---

## Guardian

### Core

| Slot | Skill | API id(s) | Skill-bar interaction |
|---|---:|---:|---|
| F1 | Virtue of Justice | `9115` | No full bar replacement |
| F2 | Virtue of Resolve | `9120`, `9250` | No full bar replacement |
| F3 | Virtue of Courage | `9118`, `9268` | No full bar replacement |

### Dragonhunter

| Slot | Skill | API id(s) | Skill-bar interaction |
|---|---:|---:|---|
| F1 | Spear of Justice | `29887` | No full bar replacement; creates tether / reactivation sequence |
| F2 | Wings of Resolve | `30225`* | No full bar replacement; movement/heal skill |
| F3 | Shield of Courage | `30039`, `30029` | No full bar replacement; temporary frontal shield |

\* The Wings of Resolve wiki discussion explicitly notes multiple ids depending on trait state; store it as variant-sensitive.

### Firebrand

These are **entry skills**. Pressing them replaces weapon skills `1-5` with tome pages.

| Slot | Skill | API id(s) | Skill-bar interaction |
|---|---:|---:|---|
| F1 | Tome of Justice | `44364`, `68647` | Replaces `1-5` with Tome of Justice chapters |
| F2 | Tome of Resolve | `41780`, `45023`, `68648`, `68649` | Replaces `1-5` with Tome of Resolve chapters |
| F3 | Tome of Courage | `42259`, `42371`, `68650`, `68646` | Replaces `1-5` with Tome of Courage chapters |

### Willbender

| Slot | Skill | API id(s) | Skill-bar interaction |
|---|---:|---:|---|
| F1 | Rushing Justice | `62668` | No full bar replacement |
| F2 | Flowing Resolve | variant-sensitive | No full bar replacement |
| F3 | Crashing Courage | variant-sensitive | No full bar replacement |

### Luminary

| Slot | Skill | API id(s) | Skill-bar interaction |
|---|---:|---:|---|
| F1 | Radiant Justice | `78837` | No full bar replacement |
| F2 | Radiant Resolve | variant-sensitive | No full bar replacement |
| F3 | Radiant Courage | variant-sensitive | No full bar replacement |
| F5 | Enter Radiant Forge | variant-sensitive | **Replaces `1-5`** with radiant weapon skills |

---

## Warrior

Warrior is not a fixed-skill profession mechanic in the usual sense.

### Core
- `F1` is the current **burst skill** for the equipped weapon.
- Do **not** model warrior as a single hard-coded `F1` skill.

Verified examples:

| Slot | Skill | API id(s) | Source state |
|---|---:|---:|---|
| F1 | Arcing Slice | dynamic by weapon | greatsword burst |
| F1 | Earthshaker | dynamic by weapon | hammer burst |
| F1 | Combustive Shot | dynamic by weapon | longbow burst |

### Berserker
- Adds berserk / primal burst state.
- Model as stateful burst replacement, not fixed ids only.

### Spellbreaker
- Adds extra profession actions like Full Counter.
- Keep separate from base weapon-burst lookup.

### Bladesworn
- Adds alternate state / Dragon Trigger / gunsaber logic.
- Treat as full alternate-mode modeling problem.

### Paragon
Use live API-first resolution.

---

## Engineer

Engineer is the other giant goblin.

### Core
- `F1-F5` are **tool-belt skills derived from slots `6-0`**.
- There is **no single universal engineer F1/F2/F3/F4/F5 list**.

Example mappings from the profession mechanic page:
- `Elixir H -> Toss Elixir H`
- `Med Kit -> Bandage Self`
- `A.E.D. -> Static Shock`
- `Healing Turret -> Regenerating Mist`

Model this as:
- user equips heal/utility/elite skill
- app resolves corresponding tool-belt skill
- app renders that tool-belt skill in the correct F slot

### Scrapper / Holosmith / Mechanist / Amalgam
These elite specs override or partially replace the core tool-belt model. Mechanist especially should be treated as command-slot-driven rather than standard tool-belt mirroring.

---

## Ranger

Ranger profession mechanics are partly pet-driven and partly command-driven.

### Core
The truly important app rule is:
- one slot is pet attack/command flow
- one slot is the **pet family/species skill**
- other slots handle pet control / swap state

The pet **species skill** is where the meaningful dynamic id explosion happens.

Example from pet data:
- Armor Fish species skill: `Stunning Rush` (pet skill; species-specific)

### Druid
- `F5 = Celestial Avatar` entry skill
- pressing it replaces the active bar with celestial avatar skills

### Soulbeast
- merge / beastmode changes profession slots and pet-driven skills
- model as pet-merge state, not one static skill list

### Untamed
- unleash toggles flip ranger/pet state and skill payloads
- also stateful rather than fixed

### Galeshot
Use live API-first resolution.

---

## Thief

### Core

| Slot | Skill | API id(s) | Skill-bar interaction |
|---|---:|---:|---|
| F1 | Steal | `13014`, `13109` | No full bar replacement; grants a stolen skill bundle based on target |

### Daredevil
- keeps steal framework; dodge/mechanic changes are not a new fixed F entry in the way tomes/shroud are

### Deadeye

| Slot | Skill | API id(s) | Skill-bar interaction |
|---|---:|---:|---|
| F1 | Deadeye's Mark | `43390` | No full bar replacement; changes target-marking / stolen-skill behavior |

### Specter

| Slot | Skill | API id(s) | Skill-bar interaction |
|---|---:|---:|---|
| F1 | Siphon | `63067` | No full bar replacement; ally/enemy targeting changes result |

### Antiquary
Use live API-first resolution.

---

## Mesmer

### Core

| Slot | Skill | API id(s) | Skill-bar interaction |
|---|---:|---:|---|
| F1 | Mind Wrack | `10191`, `49068` | No full bar replacement |
| F2 | Cry of Frustration | `10190` | No full bar replacement |
| F3 | Diversion | `10287` | No full bar replacement |
| F4 | Distortion | `10192` | No full bar replacement |

### Chronomancer
Shatters are replaced, but the important app rule is still: these are **shatter-slot replacements**, not bar replacements.

Verified example:
- `F1 = Split Second` -> `56930`, `56925`

### Mirage
- keeps shatter buttons but interacts with cloak / ambush behavior
- no full bar replacement from F slots

### Virtuoso

Verified example:
- `F4 = Bladesong Distortion` -> `68273`

Model virtuoso as **blade-stock shatters** rather than clone-count shatters.

### Troubadour
Use live API-first resolution.

---

## Necromancer

### Core

The F-skill is primarily the **entry** into shroud.

| Slot | Skill | API id(s) | Skill-bar interaction |
|---|---:|---:|---|
| F1 | Death Shroud | `10574` | **Replaces `1-5`** with shroud skills |
| Exit | End Death Shroud | `10585` | Returns normal bar |

Once in shroud, the loaded bar includes skills such as:
- `Life Blast` -> `10554`
- `Dark Path` -> `10604`
- `Dark Pursuit` -> `56916`
- `Doom` -> `10588`
- `Life Transfer` -> `10594`

### Reaper
- `F1` becomes Reaper's Shroud entry
- pressing it replaces `1-5` with reaper shroud skills
- treat as separate shroud-bar state

### Scourge
Scourge is unusual because it abandons the standard shroud entry pattern and instead uses **shade / manifest-sand-shade style profession slots**. Treat scourge as a fixed-slot mechanic profession, but I did not verify all current ids in this pass.

### Harbinger

| Slot | Skill | API id(s) | Skill-bar interaction |
|---|---:|---:|---|
| F1 | Harbinger Shroud | `62567` | **Replaces `1-5`** with harbinger shroud skills |

### Ritualist
Use live API-first resolution.

---

## Revenant

Revenant is legend-driven and should not be flattened into a fixed universal F-bar table.

### Core
Legend swap changes the right side of the skill bar rather than working like classic fixed F skills.

Verified legend entry skills:
- `Legendary Dwarf Stance`
- `Legendary Demon Stance`
- `Legendary Centaur Stance`

Your app should model:
- legend A equipped
- legend B equipped
- active legend
- legend-specific heal/utility/elite package loaded into `6-0`

### Herald / Renegade / Vindicator / Conduit
All continue the legend/state-heavy approach. Use live profession + legend resolution rather than assuming fixed static F ids for all slots.

---

## Practical implementation advice

### Safe schema

```json
{
  "profession": "Guardian",
  "elite_spec": "Firebrand",
  "f_skills": [
    {
      "slot": "F1",
      "name": "Tome of Justice",
      "api_ids": [44364, 68647],
      "interaction": "replaces_weapon_bar",
      "replacement_bar": "tome_of_justice"
    }
  ]
}
```

### Interaction types that are actually useful in code

Use one of these buckets:
- `fixed`
- `dynamic_by_weapon`
- `dynamic_by_pet`
- `dynamic_by_legend`
- `dynamic_by_utility_loadout`
- `entry_replaces_weapon_bar`
- `entry_replaces_shroud_bar`
- `stateful_no_full_bar_replace`

That classification is much more useful than trying to pretend every profession is just “five buttons with ids.”

## Sources used for this pass

- GW2 Wiki skill pages and profession-mechanic pages
- GW2 Wiki snippets exposing API ids for individual skills
- GW2 API skill endpoint format: `https://api.guildwars2.com/v2/skills/<id>`

