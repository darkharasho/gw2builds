import { state } from "./state.js";
import {
  CONDUIT_F2_BY_SWAP,
  WEAPON_STRENGTH_MIDPOINT,
  ANTIQUARY_OFFENSIVE_ARTIFACTS,
  ANTIQUARY_DEFENSIVE_ARTIFACTS,
  ANTIQUARY_PROLIFIC_PLUNDERER_TRAIT_ID,
  RANGER_PET_FAMILY_SKILLS,
  PROFESSION_BASE_HP,
} from "./constants.js";
import { escapeHtml, parseWeaponSlotNum } from "./utils.js";
import { bindHoverPreview, selectDetail, buildSkillCard, showHoverPreview } from "./detail-panel.js";
import { computeEquipmentStats } from "./stats.js";
import { renderCustomSelect } from "./custom-select.js";

// DOM refs injected by the entry point via initSkills() to keep this module
// importable in Node.js test environments (no document.querySelector at module scope).
let _el = { skillsHost: null };
export function initSkills(domRefs) {
  _el = { ..._el, ...domRefs };
}

// Callback injection to avoid circular deps with render-pages.js
let _renderEditor = () => {};
let _markEditorChanged = () => {};
let _enforceEditorConsistency = () => {};
let _openSlotPicker = () => {};
export function initSkillsCallbacks({ renderEditor, markEditorChanged, enforceEditorConsistency, openSlotPicker }) {
  _renderEditor = renderEditor;
  _markEditorChanged = markEditorChanged;
  _enforceEditorConsistency = enforceEditorConsistency;
  _openSlotPicker = openSlotPicker;
}

// Matches GW2 API profession mechanic slot names ("Profession_1" … "Profession_5").
const PROFESSION_SLOT_RE = /^Profession_\d/;

export function buildRevenantEliteByProfSlot(eliteFixedSkills, eliteSpecId, isAllianceLegendActive, skillById) {
  const eliteByProfSlot = new Map((eliteFixedSkills || []).map((s) => [s.slot, s]));
  // Vindicator + Legendary Alliance should always expose Alliance Tactics at F3.
  // Keep this as a defensive fallback in case upstream skill selection misses 62729.
  if (Number(eliteSpecId) === 69 && isAllianceLegendActive) {
    const allianceTactics = skillById?.get(62729);
    if (allianceTactics) eliteByProfSlot.set("Profession_3", allianceTactics);
  }
  return eliteByProfSlot;
}

export function getSkillOptionsByType(catalog, specializationSelections) {
  const selectedSpecIds = new Set(
    (specializationSelections || [])
      .map((entry) => Number(entry?.specializationId) || 0)
      .filter(Boolean)
  );

  const allSkills = Array.isArray(catalog.skills) ? catalog.skills : [];

  // Build a set of flip_skill IDs — in-combat replacement skills (e.g. "Detonate Turret",
  // "Steal Time") that are flip targets and should not appear as base equippable skills.
  const flipSkillIds = new Set(allSkills.flatMap((s) => s.flipSkill ? [s.flipSkill] : []));

  const filtered = allSkills.filter((skill) => {
    if (flipSkillIds.has(skill.id)) return false;
    const lockSpec = Number(skill.specialization) || 0;
    return !lockSpec || selectedSpecIds.has(lockSpec);
  });

  // Profession mechanic skills (F1–F5): slot is "Profession_1" ... "Profession_5"
  // Include unspecced ones plus those locked to a selected spec.
  // Exclude "Exit" / "Leave" variants (e.g. "Exit Reaper's Shroud", "Leave Beastmode") — these are
  // the toggle-off skill IDs that appear as bundleSkills children, not standalone F-slot entries.
  const exitLeavePattern = /^(Exit|Leave)\b/i;
  const profMechanics = allSkills
    .filter((skill) => PROFESSION_SLOT_RE.test(skill.slot || ""))
    .filter((skill) => !exitLeavePattern.test(skill.name || ""))
    // Exclude flip targets unless they are explicitly in the profession endpoint.
    // Using inProfessionEndpoint (not flipParentIds) as the gate because mutual flip pairs
    // like Deadeye's Mark (43390) ↔ Steal Time would both pass a flipParentIds check, yet
    // "Steal Time" is a transient post-activation state that must not show as a permanent slot.
    .filter((skill) => !flipSkillIds.has(skill.id) || skill.inProfessionEndpoint)
    // Exclude skills that are not tied to any profession.
    .filter((skill) => (skill.professions || []).length > 0)
    // Thief: unspecialized Profession_2+ entries are transient stolen-result outcomes, not
    // permanent profession mechanics. Keep only slot-bound elite mechanics (Specter/Antiquary).
    .filter((skill) => {
      if (catalog?.profession?.id !== "Thief") return true;
      const match = /^Profession_(\d+)$/.exec(skill.slot || "");
      const slotNum = match ? Number(match[1]) : 0;
      if (slotNum <= 1) return true;
      return (Number(skill.specialization) || 0) > 0;
    })
    .filter((skill) => {
      const lockSpec = Number(skill.specialization) || 0;
      return !lockSpec || selectedSpecIds.has(lockSpec);
    })
    .sort((a, b) => {
      const na = parseInt((a.slot || "").replace("Profession_", ""), 10) || 0;
      const nb = parseInt((b.slot || "").replace("Profession_", ""), 10) || 0;
      return na - nb;
    });

  return {
    heal: filtered
      .filter((skill) => (skill.type || "").toLowerCase() === "heal")
      .sort((a, b) => a.name.localeCompare(b.name)),
    utility: filtered
      .filter((skill) => (skill.type || "").toLowerCase() === "utility")
      .sort((a, b) => a.name.localeCompare(b.name)),
    elite: filtered
      .filter((skill) => (skill.type || "").toLowerCase() === "elite")
      .sort((a, b) => a.name.localeCompare(b.name)),
    profession: profMechanics,
  };
}

export function resolveSkillSlotType(slot) {
  if (slot.key === "healId") return "heal";
  if (slot.key === "eliteId") return "elite";
  return "utility";
}

export function filterSkillList(list, query, selectedId) {
  const source = Array.isArray(list) ? list : [];
  if (!query) return source;
  const normalized = String(query || "").toLowerCase();
  const selected = source.find((skill) => Number(skill.id) === Number(selectedId)) || null;
  const filtered = source.filter((skill) => String(skill.name || "").toLowerCase().includes(normalized));
  if (selected && !filtered.some((skill) => Number(skill.id) === Number(selected.id))) {
    filtered.unshift(selected);
  }
  return filtered;
}

export function getEquippedWeaponSkills(catalog, weapons, activeAttunement = "", activeAttunement2 = "", isWeaver = false) {
  const profWeapons = catalog?.professionWeapons || {};
  const weaponSkillById = catalog?.weaponSkillById || new Map();
  const slots = [null, null, null, null, null];

  const mhId = (weapons.mainhand || "").toLowerCase();
  const ohId = (weapons.offhand || "").toLowerCase();
  const mhData = profWeapons[mhId];
  const isTwoHanded = mhData?.flags?.includes("TwoHand") ?? false;

  // Collect all refs to determine available attunements
  const allRefs = [
    ...(mhData?.skills || []),
    ...(!isTwoHanded && ohId ? (profWeapons[ohId]?.skills || []) : []),
  ];
  const availableAttunements = [...new Set(allRefs.map((r) => r.attunement).filter(Boolean))];
  // Pick the effective primary attunement: prefer the stored one, fall back to first available
  const effectiveAttunement = availableAttunements.includes(activeAttunement)
    ? activeAttunement
    : (availableAttunements[0] || "");

  // For Weaver: effective secondary attunement. May equal primary (single-attunement mode).
  const effectiveAttunement2 = isWeaver
    ? (availableAttunements.includes(activeAttunement2)
        ? activeAttunement2
        : effectiveAttunement)
    : "";

  const att1 = effectiveAttunement.toLowerCase();
  const att2 = effectiveAttunement2.toLowerCase();

  function matchesAttunement(ref, slotNum) {
    if (isWeaver) {
      const refAtt = (ref.attunement || "").toLowerCase();
      // Slots 1-2: mainhand attunement
      if (slotNum >= 1 && slotNum <= 2) return !refAtt || refAtt === att1;
      // Slots 4-5: offhand attunement
      if (slotNum >= 4 && slotNum <= 5) return !refAtt || refAtt === att2;
      // Slot 3: in single-attunement mode (att1 === att2) fall through to the normal weapon
      // slot-3 skill; in dual-attunement mode it is handled by the separate dual-attack loop.
      if (slotNum === 3) return att1 === att2 && (!refAtt || refAtt === att1);
      return false;
    }
    if (!ref.attunement) return true;
    return ref.attunement === effectiveAttunement;
  }

  if (mhData) {
    for (const ref of mhData.skills) {
      const n = parseWeaponSlotNum(ref.slot);
      if (!matchesAttunement(ref, n)) continue;
      if (n >= 1 && n <= 5) {
        const skill = weaponSkillById.get(ref.id);
        if (skill && !slots[n - 1]) {
          // Skip dual-attack skills (dualWield set) for non-Weaver builds, and also for
          // Weaver slot 3 in single-attunement mode (dual-attack has its own separate loop).
          if (skill.dualWield && (!isWeaver || n === 3)) continue;
          slots[n - 1] = skill;
        }
      }
    }
  }
  if (!isTwoHanded && ohId) {
    const ohData = profWeapons[ohId];
    if (ohData) {
      for (const ref of ohData.skills) {
        const n = parseWeaponSlotNum(ref.slot);
        if (!matchesAttunement(ref, n)) continue;
        if (n >= 4 && n <= 5) {
          const skill = weaponSkillById.get(ref.id);
          if (skill && !slots[n - 1]) slots[n - 1] = skill;
        }
      }
    }
  }

  // Weaver slot 3: Dual Attack — only when the two attunements differ. Skills live in
  // weaponSkillById (fetched via profession.weapons). Match by weaponType and the pair of
  // attunements (order-independent). Same-element mode is handled by matchesAttunement above.
  if (isWeaver && mhId && att1 && att2 && att1 !== att2) {
    for (const skill of weaponSkillById.values()) {
      if (!skill.dualWield) continue;
      if ((skill.slot || "") !== "Weapon_3") continue;
      if ((skill.weaponType || "").toLowerCase() !== mhId) continue;
      const sa = (skill.attunement || "").toLowerCase();
      const sd = skill.dualWield.toLowerCase();
      if ((sa === att1 && sd === att2) || (sa === att2 && sd === att1)) {
        slots[2] = skill;
        break;
      }
    }
  }

  return slots;
}

// Returns the offensive and defensive artifact pools for Antiquary's Skritt Swipe.
// Currently the pools are fixed; hook is here for future trait-based modifications.
export function getAntiquaryArtifactPools(_catalog, _editor) {
  return {
    offensivePool: [...ANTIQUARY_OFFENSIVE_ARTIFACTS],
    defensivePool: [...ANTIQUARY_DEFENSIVE_ARTIFACTS],
  };
}

// Returns true if Prolific Plunderer (trait 2346) is selected for the Antiquary specialization.
export function isAntiquaryProlificPlundererActive(editor) {
  const antiquaryEntry = (editor.specializations || [])
    .find((s) => Number(s.specializationId) === 77);
  return Object.values(antiquaryEntry?.majorChoices || {})
    .some((id) => Number(id) === ANTIQUARY_PROLIFIC_PLUNDERER_TRAIT_ID);
}

// Randomly picks one offensive artifact for F2, one defensive for F3, and (when Prolific
// Plunderer is active) an additional artifact from the combined pool for F4.
// Stores the result in editor.antiquaryArtifacts. Call when the play badge is clicked.
export function randomizeAntiquaryArtifacts(catalog, editor) {
  const { offensivePool, defensivePool } = getAntiquaryArtifactPools(catalog, editor);
  const f2Id = offensivePool[Math.floor(Math.random() * offensivePool.length)];
  let f3Id = defensivePool[Math.floor(Math.random() * defensivePool.length)];
  // Zephyrite Sun Crystal canonical ID 76733 is the F2 API variant;
  // when drawn into any non-F2 slot, substitute the F3-slot variant (78309).
  if (f3Id === 76733) f3Id = 78309;

  let f4Id = 0;
  if (isAntiquaryProlificPlundererActive(editor)) {
    // F4 draws from the combined pool, excluding the canonical IDs already in F2/F3.
    const f3Canonical = f3Id === 78309 ? 76733 : f3Id;
    const combined = [...ANTIQUARY_OFFENSIVE_ARTIFACTS, ...ANTIQUARY_DEFENSIVE_ARTIFACTS]
      .filter((id) => id !== f2Id && id !== f3Canonical);
    const pick = combined[Math.floor(Math.random() * combined.length)];
    f4Id = (pick === 76733) ? 78309 : pick;
  }

  editor.antiquaryArtifacts = { f2: f2Id, f3: f3Id, f4: f4Id };
}

export function buildMechanicSlotsForRender({
  catalog,
  options,
  editor,
  utilitySelection,
  equippedWeapons,
  mhKey,
  ohKey,
  activeAttunement,
  activeKit,
}) {
  const nextOptions = options;
  const isToolbelt = catalog.skills.some((s) => s.toolbeltSkill > 0);

  let mechSlots;
  const eliteSpecEntry = (editor.specializations || [])
    .find((e) => catalog.specializationById.get(Number(e?.specializationId))?.elite);
  const eliteSpecId = Number(eliteSpecEntry?.specializationId) || 0;
  const isWeaver = eliteSpecId === 56;
  // Ranger and all Ranger elite specs (Druid/Soulbeast/Untamed) use catalog.pets.
  const isRanger = Array.isArray(catalog.pets) && catalog.pets.length > 0;

  // Collect elite spec's static profession mechanic skills (type "Profession", not "Toolbelt").
  // Deduplicate by slot: some skills have multiple contextual variants at the same slot
  // (e.g. Scrapper's "Function Gyro" has 3 toggle-phase variants, Mechanist's F4 has
  // "Crash Down / Mech Support / Recall Mech"). Keep only the first occurrence per slot.
  const eliteSpecOptionsRaw = (nextOptions.profession || []).filter((s) =>
    Number(s.specialization) === eliteSpecId && (s.type || "").toLowerCase() !== "toolbelt"
  );
  const seenSlot = new Set();
  const eliteSpecOptions = eliteSpecOptionsRaw.filter((s) => {
    if (seenSlot.has(s.slot)) return false;
    seenSlot.add(s.slot);
    return true;
  });

  // "Locked" placeholder slots indicate player-selectable morph slots (Amalgam F2–F4).
  // All other unique slots are fixed static mechanics.
  const morphSlotSkills = eliteSpecOptions.filter((s) => s.name.toLowerCase() === "locked");
  const eliteFixedSkills = eliteSpecOptions.filter((s) => s.name.toLowerCase() !== "locked");

  // Mechanist (spec 70) is the only toolbelt engineer whose F1-F3 are trait-gated mech commands
  // rather than toolbelt skills. Detect explicitly by spec ID to avoid false positives from
  // trait skills that may be incorrectly tagged as Profession_1 for other engineer elite specs.
  const eliteOverridesToolbelt = isToolbelt && eliteSpecId === 70;
  const isSelectablePool = isToolbelt && morphSlotSkills.length > 0;

  if (eliteOverridesToolbelt) {
    // Mechanist: F1-F3 are trait-gated mech commands; F4 is Crash Down/Recall toggle.
    // For each tier slot (Profession_1/2/3), use the skill granted by the selected major trait.
    // Fall back to the first available skill in that slot if no trait is selected.
    const mechSpecEntry = (editor.specializations || [])
      .find((e) => Number(e?.specializationId) === eliteSpecId);
    const mechMajorChoices = mechSpecEntry?.majorChoices || {};
    const selectedMajorTraitIds = new Set(Object.values(mechMajorChoices).map(Number).filter(Boolean));

    mechSlots = [];
    for (const tier of [1, 2, 3]) {
      const slot = `Profession_${tier}`;
      const traitsForTier = catalog.traits.filter(
        (t) => t.specialization === eliteSpecId && t.tier === tier
      );
      const selectedTrait = traitsForTier.find((t) => selectedMajorTraitIds.has(t.id));
      let skill = null;
      let mechIconOverride = "";
      if (selectedTrait) {
        const skillId = selectedTrait.traitSkillIds[0];
        skill = catalog.skillById.get(skillId) || null;
        // If skill is missing or has no icon, use the icon embedded in the trait data
        if (skillId && (!skill || !skill.icon)) {
          mechIconOverride = (selectedTrait.traitSkillIcons || {})[skillId] || "";
        }
      }
      if (!skill) {
        // Try skills tagged with the elite spec first, then any unspecced Profession_N skill
        skill = eliteSpecOptions.find((s) => s.slot === slot)
          || (nextOptions.profession || []).find((s) => s.slot === slot)
          || null;
      }
      mechSlots.push({ skill, sourceId: 0, isStatic: true, isSelectable: false, mechIconOverride });
    }
    // F4: Crash Down (first Profession_4 entry)
    const f4 = eliteFixedSkills.find((s) => s.slot === "Profession_4");
    if (f4) mechSlots.push({ skill: f4, sourceId: 0, isStatic: true, isSelectable: false });
  } else if (isSelectablePool) {
    // Amalgam: F1 = heal toolbelt; F2–F4 = "Locked" morph slots (player-selectable); F5 = Evolve
    const healSrc = catalog.skillById.get(Number(editor.skills?.healId) || 0);
    const healToolbelt = healSrc?.toolbeltSkill ? (catalog.skillById.get(healSrc.toolbeltSkill) || null) : null;
    const morphIds = Array.isArray(editor.morphSkillIds)
      ? editor.morphSkillIds.map(Number) : [0, 0, 0];

    mechSlots = [
      { skill: healToolbelt, sourceId: Number(editor.skills?.healId) || 0, isStatic: false, isSelectable: false },
      ...morphSlotSkills.map((lockedSkill, morphIndex) => ({
        // Show the selected morph skill if one is chosen; fall back to "Locked" placeholder
        skill: morphIds[morphIndex] ? (catalog.skillById.get(morphIds[morphIndex]) || lockedSkill) : lockedSkill,
        sourceId: morphIds[morphIndex] || 0,
        isStatic: false,
        isSelectable: true,
        morphIndex,
      })),
    ];
    // Append fixed elite skills (Evolve at Profession_5)
    for (const skill of eliteFixedSkills) {
      mechSlots.push({ skill, sourceId: 0, isStatic: true, isSelectable: false });
    }
  } else if (isToolbelt) {
    // Base Engineer / Scrapper / Holosmith: F1–F4 from toolbelt, optional elite F5
    const toolbeltSourceIds = [
      Number(editor.skills?.healId) || 0,
      Number(utilitySelection[0]) || 0,
      Number(utilitySelection[1]) || 0,
      Number(utilitySelection[2]) || 0,
    ];
    mechSlots = toolbeltSourceIds.map((id) => {
      const src = catalog.skillById.get(id);
      const fskill = src?.toolbeltSkill ? (catalog.skillById.get(src.toolbeltSkill) || null) : null;
      return { skill: fskill, sourceId: id, sourceSkill: src || null, isStatic: false, isSelectable: false };
    });
    // Fixed F5 from elite spec (Scrapper → Function Gyro, Holosmith → Photon Forge)
    const staticF5 = eliteFixedSkills.find((s) => s.slot === "Profession_5");
    if (staticF5) mechSlots.push({ skill: staticF5, sourceId: 0, isStatic: true, isSelectable: false });
  } else if (Array.isArray(catalog.legends) && catalog.legends.length > 0) {
    // Revenant: F1 is SHARED between both legend stances (clicking either swaps to it).
    // The legend stack UI handles F1; mech slots only show elite spec skills F2+.
    const legendSlots = editor.selectedLegends || ["", ""];
    const activeLegendSlot = Number(editor.activeLegendSlot) || 0;
    const activeLegendId = legendSlots[activeLegendSlot] || "";
    const activeLegend = activeLegendId ? catalog.legendById.get(activeLegendId) : null;
    const isAllianceLegendActive = activeLegendId === "Legend7";
    const allianceTacticsForm = Number(editor.allianceTacticsForm) || 0; // 0=Archemorus, 1=Saint Viktor

    const eliteByProfSlot = buildRevenantEliteByProfSlot(
      eliteFixedSkills,
      eliteSpecId,
      isAllianceLegendActive,
      catalog.skillById
    );

    mechSlots = [];
    if (eliteSpecId > 0) {
      for (let n = 2; n <= 5; n++) {
        const slotKey = `Profession_${n}`;
        const eliteSkill = eliteByProfSlot.get(slotKey);
        if (!eliteSkill) continue; // skip gaps (e.g. Vindicator has no Profession_2)
        const isAllianceTactics = eliteSkill.id === 62729;
        if (isAllianceTactics && !isAllianceLegendActive) continue;
        let displaySkill = eliteSkill;
        if (isAllianceTactics && allianceTacticsForm === 1 && eliteSkill.flipSkill) {
          displaySkill = catalog.skillById.get(eliteSkill.flipSkill) || eliteSkill;
        }
        // Conduit (spec 79) F2 — Release Potential: pick the variant matching the active legend.
        if (eliteSpecId === 79 && slotKey === "Profession_2") {
          const activeLegendSwap = activeLegend?.swap || 0;
          const f2Id = activeLegendSwap ? CONDUIT_F2_BY_SWAP.get(activeLegendSwap) : null;
          displaySkill = (f2Id && catalog.skillById.get(f2Id)) || eliteSkill;
        }
        mechSlots.push({ skill: displaySkill, sourceId: eliteSkill.id, isStatic: true, isSelectable: false, fKeyLabel: `F${n}`, isAllianceTactics });
      }
    }

    // Override skill option lists so they show this legend's fixed skills.
    if (activeLegend) {
      const ls = (id) => {
        if (!id) return null;
        const skill = catalog.skillById.get(id);
        if (!skill) return null;
        if (isAllianceLegendActive && allianceTacticsForm === 1 && skill.flipSkill) {
          return catalog.skillById.get(skill.flipSkill) || skill;
        }
        return skill;
      };
      nextOptions.heal = [ls(activeLegend.heal)].filter(Boolean);
      nextOptions.utility = (activeLegend.utilities || []).map(ls).filter(Boolean);
      nextOptions.elite = [ls(activeLegend.elite)].filter(Boolean);
    }
  } else if (isRanger) {
    const activePetSlotKey = editor.activePetSlot === "terrestrial2" ? "terrestrial2" : "terrestrial1";
    const activePetId = Number(editor.selectedPets?.[activePetSlotKey]) || 0;
    const activePet = activePetId && catalog.petById ? catalog.petById.get(activePetId) : null;

    mechSlots = [];
    if (eliteSpecId === 55) {
      const p5SoulbeastSkill = (nextOptions.profession || []).find((s) => s.slot === "Profession_5") || null;
      const beastmodeId = p5SoulbeastSkill?.id || 0;
      const beastmodeActive = beastmodeId > 0 && activeKit === beastmodeId;
      if (beastmodeActive) {
        const petFamilySkills = activePetId ? RANGER_PET_FAMILY_SKILLS.get(activePetId) : null;
        for (const key of ["p1", "p2", "p3"]) {
          const skillId = petFamilySkills?.[key] || null;
          const skill = skillId ? (catalog.skillById.get(skillId) || null) : null;
          mechSlots.push({ skill, sourceId: skill?.id || 0, isStatic: true, isSelectable: false });
        }
      } else {
        mechSlots.push({ skill: null, sourceId: 0, isStatic: true, isSelectable: false, fakeCommand: "attack" });
        const f2Skill = (activePet?.skills || [])[0] || null;
        mechSlots.push({ skill: f2Skill, sourceId: f2Skill?.id || 0, isStatic: true, isSelectable: false });
        mechSlots.push({ skill: null, sourceId: 0, isStatic: true, isSelectable: false, fakeCommand: "return" });
      }
      if (p5SoulbeastSkill) {
        mechSlots.push({
          skill: p5SoulbeastSkill, sourceId: p5SoulbeastSkill.id, isStatic: true, isSelectable: false,
          isBeastmodeToggle: true,
          leaveIcon: "https://wiki.guildwars2.com/images/2/2a/Leave_Beastmode.png",
          fKeyLabel: "F5",
          isF5AboveOrb: true,
        });
      }
    } else {
      mechSlots.push({ skill: null, sourceId: 0, isStatic: true, isSelectable: false, fakeCommand: "attack" });
      const petSkills = activePet?.skills || [];
      const isAquaticSlot = activePetSlotKey === "aquatic1" || activePetSlotKey === "aquatic2";
      const f2SkillIdx = isAquaticSlot && petSkills.length > 1 ? 1 : 0;
      const f2Skill = petSkills[f2SkillIdx] || null;
      mechSlots.push({ skill: f2Skill, sourceId: f2Skill?.id || 0, isStatic: true, isSelectable: false });
      if (eliteSpecId === 72) {
        const envHaze = catalog.skillById.get(63094) || null;
        mechSlots.push({ skill: envHaze, sourceId: envHaze?.id || 0, isStatic: true, isSelectable: false });
      } else {
        mechSlots.push({ skill: null, sourceId: 0, isStatic: true, isSelectable: false, fakeCommand: "return" });
      }
    }
    if (eliteSpecId !== 55) {
      const p5Skill = (nextOptions.profession || []).find((s) => s.slot === "Profession_5") || null;
      if (p5Skill) {
        mechSlots.push({ skill: p5Skill, sourceId: p5Skill.id, isStatic: true, isSelectable: false, fKeyLabel: "F5", isF5AboveOrb: true });
      }
    }
  } else {
    // Non-toolbelt professions (warrior, necro, guardian, mesmer, ele, thief, etc.)
    const activeMainhand = (equippedWeapons[mhKey] || "").toLowerCase();
    const activeOffhand = (equippedWeapons[ohKey] || "").toLowerCase();

    const bySlot = new Map(); // slotKey → skill[]
    for (const skill of (nextOptions.profession || [])) {
      if (!skill.slot) continue;
      if (!bySlot.has(skill.slot)) bySlot.set(skill.slot, []);
      bySlot.get(skill.slot).push(skill);
    }

    const sortedSlotKeys = [...bySlot.keys()]
      .filter((k) => !isWeaver || parseInt(k.replace("Profession_", ""), 10) <= 4)
      .sort((a, b) => {
        const na = parseInt(a.replace("Profession_", ""), 10) || 0;
        const nb = parseInt(b.replace("Profession_", ""), 10) || 0;
        return na - nb;
      });

    // Thief mechanics: Core/Daredevil/Deadeye only have a fixed F1 profession slot.
    // Specter (71) and Antiquary (77) are the only Thief specs with persistent F2+ slots.
    const isThief = (catalog?.profession?.id || editor.profession || "") === "Thief";
    const thiefHasPersistentF2Plus = eliteSpecId === 71 || eliteSpecId === 77;
    const renderSlotKeys = isThief && !thiefHasPersistentF2Plus
      ? sortedSlotKeys.filter((slotKey) => slotKey === "Profession_1")
      : sortedSlotKeys;

    const isWarrior = (catalog?.profession?.id || editor.profession || "") === "Warrior";
    const isBerserker = isWarrior && eliteSpecId === 18;
    // Berserk (F2 toggle for Berserker): resolve the Berserk skill from the Profession_2 slot.
    const berserkSkillId = isBerserker ? (bySlot.get("Profession_2")?.[0]?.id || 0) : 0;
    const berserkActive = berserkSkillId > 0 && activeKit === berserkSkillId;

    mechSlots = renderSlotKeys.map((slotKey) => {
      const candidates = bySlot.get(slotKey);
      let skill;
      if (candidates.length === 1) {
        skill = candidates[0];
      } else {
        // Split into elite-spec and base pools; prefer elite-spec when active.
        // Weaver is excluded: its F skills are the standard ele attunement swaps.
        // Berserker F1: handled separately — core vs primal burst depends on Berserk toggle.
        const isBerserkerBurstSlot = isBerserker && slotKey === "Profession_1";
        const eliteCandidates = eliteSpecId && !isWeaver && !isBerserkerBurstSlot
          ? candidates.filter((s) => Number(s.specialization) === eliteSpecId)
          : [];
        // Sort by ID descending: when the API lists multiple skill variants at the same slot
        // the higher ID is the more recently added/updated skill and should be preferred.
        let pool;
        if (isBerserkerBurstSlot) {
          // When Berserk is active show primal bursts (spec=51); otherwise show core bursts.
          const primalPool = candidates.filter((s) => Number(s.specialization) === 51);
          const corePool = candidates.filter((s) => !Number(s.specialization));
          const base = berserkActive ? primalPool : corePool;
          pool = (base.length > 0 ? base : candidates).sort((a, b) => b.id - a.id);
        } else {
          pool = [...(eliteCandidates.length > 0 ? eliteCandidates : candidates)]
            .sort((a, b) => b.id - a.id);
        }
        const wt = (s) => (s.weaponType || "").toLowerCase();
        const attunementSkill = !isWeaver && activeAttunement
          ? pool.find((s) => s.attunement && s.attunement.toLowerCase() === activeAttunement.toLowerCase())
          : null;
        if (isWeaver) {
          // Weaver F slots are always attunement swap buttons (Fire/Water/Air/Earth).
          const stdName = /^(?:Fire|Water|Air|Earth)\s+Attunement\b/i;
          skill = pool.find((s) => Number(s.specialization) === 56 && stdName.test(s.name || ""))
               || pool.find((s) => stdName.test(s.name || ""))
               || pool[0];
        } else {
          skill = pool.find((s) => wt(s) && wt(s) === activeMainhand)
               || pool.find((s) => wt(s) && wt(s) === activeOffhand)
               || attunementSkill
               || pool.find((s) => !s.weaponType && !s.attunement)
               || pool[0];
        }
      }
      // Warrior: F1 burst slot is blank when no weapon is equipped (all burst skills are
      // weapon-specific; show nothing rather than an arbitrary burst for an empty hand).
      if (isWarrior && slotKey === "Profession_1" && candidates.every((s) => s.weaponType) && !activeMainhand) {
        return { skill: null, sourceId: 0, isStatic: true, isSelectable: false };
      }
      // Berserker: F2 "Berserk" is toggleable — clicking it switches F1 between core and primal burst.
      if (isBerserker && slotKey === "Profession_2") {
        return { skill, sourceId: skill?.id || 0, isStatic: true, isSelectable: false, isBerserkToggle: true };
      }
      // Antiquary (spec=77): F1 gets the randomize play badge; F2/F3 show stored artifact draws.
      if (eliteSpecId === 77) {
        if (slotKey === "Profession_1") {
          return { skill, sourceId: skill?.id || 0, isStatic: true, isSelectable: false, isAntiquarySkritSwipe: true };
        }
        if (slotKey === "Profession_2") {
          const storedId = Number(editor.antiquaryArtifacts?.f2) || 0;
          const storedSkill = storedId ? catalog.skillById.get(storedId) || null : null;
          return { skill: storedSkill, sourceId: storedId, isStatic: true, isSelectable: false };
        }
        if (slotKey === "Profession_3") {
          const storedId = Number(editor.antiquaryArtifacts?.f3) || 0;
          const storedSkill = storedId ? catalog.skillById.get(storedId) || null : null;
          return { skill: storedSkill, sourceId: storedId, isStatic: true, isSelectable: false };
        }
      }
      return { skill, sourceId: skill?.id || 0, isStatic: true, isSelectable: false };
    });

    // Prolific Plunderer (trait 2346): append a virtual F4 artifact slot.
    if (eliteSpecId === 77 && isAntiquaryProlificPlundererActive(editor)) {
      const f4Id = Number(editor.antiquaryArtifacts?.f4) || 0;
      const f4Skill = f4Id ? catalog.skillById.get(f4Id) || null : null;
      mechSlots.push({ skill: f4Skill, sourceId: f4Id, isStatic: true, isSelectable: false });
    }
  }

  return { mechSlots, options: nextOptions, eliteSpecId, isWeaver, isToolbelt, isRanger };
}

export function makeSkillSlot(slot, catalog, options, utilitySelection, markSkillIconRendered = null) {
  const query = "";
  const selectedId =
    slot.index === undefined
      ? Number(state.editor.skills[slot.key]) || 0
      : Number(state.editor.skills[slot.key]?.[slot.index]) || 0;
  const selectedSkill = slot.list.find((skill) => Number(skill.id) === selectedId) || null;
  const filteredList = filterSkillList(slot.list, query, selectedId);

  const skillOptions = filteredList.map((skill) => ({
    value: String(skill.id),
    label: skill.name,
    icon: skill.icon || "",
    meta: skill.type ? String(skill.type).toUpperCase() : "",
    kind: "skill",
    entity: skill,
  }));

  const slotEl = document.createElement("div");
  slotEl.className = "skill-slot";

  const iconBtn = document.createElement("button");
  iconBtn.type = "button";
  iconBtn.className = "skill-icon-large";
  iconBtn.title = selectedSkill?.name || slot.label;
  if (selectedSkill?.icon) {
    iconBtn.innerHTML = `<img src="${escapeHtml(selectedSkill.icon)}" alt="${escapeHtml(selectedSkill.name || "")}" />`;
  }
  if (typeof markSkillIconRendered === "function") {
    markSkillIconRendered(
      iconBtn,
      slot.flipKey || slot.key,
      selectedSkill ? `${selectedSkill.id}:${selectedSkill.icon || ""}` : ""
    );
  }
  if (selectedSkill) {
    bindHoverPreview(iconBtn, "skill", () => selectedSkill);
  }
  if (slot.keybind) {
    const keyLabel = document.createElement("span");
    keyLabel.className = "skill-icon-large__keylabel";
    keyLabel.textContent = slot.keybind;
    iconBtn.append(keyLabel);
  }

  // Kit utilities (Flamethrower, Grenade Kit, etc.) get a toggle badge in the bottom-right
  // that shows/hides the kit's weapon skills in the weapon bar.
  const isKitSkill = (selectedSkill?.bundleSkills?.length ?? 0) > 0;
  if (isKitSkill) {
    const isKitActive = state.editor.activeKit === selectedId;
    const toggleBadge = document.createElement("span");
    toggleBadge.className = "kit-toggle-indicator" + (isKitActive ? " kit-toggle-indicator--active" : "");
    toggleBadge.textContent = isKitActive ? "✕" : "▸";
    toggleBadge.addEventListener("click", (e) => {
      e.stopPropagation();
      state.editor.activeKit = state.editor.activeKit === selectedId ? 0 : selectedId;
      renderSkills();
    });
    iconBtn.append(toggleBadge);
  }

  const selectHost = document.createElement("div");
  renderCustomSelect(selectHost, {
    value: String(selectedId || ""),
    className: "cselect--skill-slot",
    options: skillOptions,
    placeholder: filteredList.length ? "Select skill" : "No skills available",
    disabled: !filteredList.length,
    onChange: (nextValue) => {
      const nextId = Number(nextValue) || 0;
      if (!nextId) return;

      let swapRects = null;
      if (slot.index === undefined) {
        state.editor.skills[slot.key] = nextId;
      } else {
        // If the chosen skill is already in another utility slot, swap the two slots.
        const ids = state.editor.skills[slot.key];
        const otherIdx = ids.findIndex((id, i) => i !== slot.index && Number(id) === nextId);
        if (otherIdx !== -1) {
          // Capture icon positions BEFORE re-render for FLIP animation.
          // Utility slots are at DOM indices slot.index+1 and otherIdx+1 (heal is index 0).
          const utilSlots = _el.skillsHost?.querySelectorAll('.skill-group--utilities .skill-slot');
          const fromBtn = utilSlots?.[slot.index + 1]?.querySelector('.skill-icon-large');
          const toBtn = utilSlots?.[otherIdx + 1]?.querySelector('.skill-icon-large');
          if (fromBtn && toBtn) {
            swapRects = {
              fromIdx: slot.index,
              toIdx: otherIdx,
              fromRect: fromBtn.getBoundingClientRect(),
              toRect: toBtn.getBoundingClientRect(),
            };
          }
          ids[otherIdx] = Number(ids[slot.index]) || 0;
        }
        ids[slot.index] = nextId;
      }
      _enforceEditorConsistency();
      state.editor.activeKit = 0; // clear kit view when utility selection changes
      _markEditorChanged({ updateBuildList: true });
      renderSkills();

      // FLIP animation: after re-render, briefly offset the new icons to their OLD positions
      // then transition them to their natural (0,0) resting place with a springy easing.
      if (swapRects) {
        const newSlots = _el.skillsHost?.querySelectorAll('.skill-group--utilities .skill-slot');
        const newFromBtn = newSlots?.[swapRects.fromIdx + 1]?.querySelector('.skill-icon-large');
        const newToBtn = newSlots?.[swapRects.toIdx + 1]?.querySelector('.skill-icon-large');
        if (newFromBtn && newToBtn) {
          const dx1 = swapRects.toRect.left - swapRects.fromRect.left;
          const dy1 = swapRects.toRect.top  - swapRects.fromRect.top;
          const dx2 = swapRects.fromRect.left - swapRects.toRect.left;
          const dy2 = swapRects.fromRect.top  - swapRects.toRect.top;
          newFromBtn.style.transition = 'none';
          newFromBtn.style.transform = `translate(${dx1}px,${dy1}px)`;
          newToBtn.style.transition = 'none';
          newToBtn.style.transform = `translate(${dx2}px,${dy2}px)`;
          // Double rAF: first frame applies the offset, second starts the spring transition.
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const spring = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)';
            newFromBtn.style.transition = spring;
            newFromBtn.style.transform = '';
            newToBtn.style.transition = spring;
            newToBtn.style.transform = '';
            // Clean up inline styles once settled.
            newFromBtn.addEventListener('transitionend', () => {
              newFromBtn.style.transition = '';
            }, { once: true });
            newToBtn.addEventListener('transitionend', () => {
              newToBtn.style.transition = '';
            }, { once: true });
          }));
        }
      }

      const nextSkill = options[resolveSkillSlotType(slot)]?.find((skill) => Number(skill.id) === nextId) || null;
      if (nextSkill) selectDetail("skill", nextSkill);
    },
  });
  selectHost.classList.add("skill-select-overlay");

  iconBtn.addEventListener("click", () => {
    const trigger = selectHost.querySelector(".cselect__trigger");
    if (trigger instanceof HTMLElement) trigger.click();
  });

  if (selectedSkill?.specialization) {
    const lockSpec = catalog.specializationById.get(Number(selectedSkill.specialization));
    if (lockSpec?.name) {
      slotEl.classList.add("skill-slot--locked");
      iconBtn.title = `${selectedSkill.name} (Locked to ${lockSpec.name})`;
    }
  }

  slotEl.append(iconBtn, selectHost);
  return slotEl;
}

export function renderSkills() {
  const catalog = state.activeCatalog;
  _el.skillsHost.innerHTML = "";
  if (!catalog) return;

  let options = getSkillOptionsByType(catalog, state.editor.specializations);
  const utilitySelection = Array.isArray(state.editor.skills?.utilityIds)
    ? state.editor.skills.utilityIds.map((value) => Number(value) || 0)
    : [0, 0, 0];
  const prevRenderedSkillIconIds = state.renderedSkillIconIds || new Map();
  const nextRenderedSkillIconIds = new Map();
  const markSkillIconRendered = (node, key, skillId) => {
    if (!node || !key) return;
    const prevSig = String(prevRenderedSkillIconIds.get(key) || "");
    const nextSig = String(skillId || "");
    if (prevSig && nextSig && prevSig !== nextSig) {
      node.classList.add("skill-icon--flip-anim");
    }
    nextRenderedSkillIconIds.set(key, nextSig);
  };

  const bar = document.createElement("div");
  bar.className = "skills-bar";

  const activeAttunement = state.editor.activeAttunement || "";
  const activeAttunement2 = state.editor.activeAttunement2 || "";
  const activeKit = Number(state.editor.activeKit) || 0;
  const activeWeaponSet = Number(state.editor.activeWeaponSet) || 1;
  const equippedWeapons = state.editor.equipment?.weapons || {};

  const mhKey = activeWeaponSet === 2 ? "mainhand2" : "mainhand1";
  const ohKey = activeWeaponSet === 2 ? "offhand2" : "offhand1";
  const hasWeaponSet2 = !!(equippedWeapons.mainhand2 || equippedWeapons.offhand2);

  const mechanicState = buildMechanicSlotsForRender({
    catalog,
    options,
    editor: state.editor,
    utilitySelection,
    equippedWeapons,
    mhKey,
    ohKey,
    activeAttunement,
    activeKit,
  });
  const { mechSlots, eliteSpecId, isWeaver, isToolbelt, isRanger } = mechanicState;
  options = mechanicState.options;

  // If activeKit refers to a static shroud/bundle skill, ensure it still exists in current mechSlots.
  // This prevents stale shroud state when switching elite specs (e.g. Reaper → Scourge).
  // Must happen before weapon skill resolution so the weapon bar reflects the correct state.
  if (activeKit) {
    const kitSkill = catalog.skillById.get(activeKit);
    const isStaticBundle = kitSkill?.bundleSkills?.length > 0 &&
      mechSlots.some((s) => s.isStatic && s.skill?.id === activeKit);
    const isToolbeltSource = mechSlots.some((s) => !s.isStatic && s.sourceId === activeKit);
    // Also allow heal/utility/elite slot kits (e.g. Mortar Kit in elite slot, Med Kit in heal slot).
    const equippedIds = new Set([
      Number(state.editor.skills?.healId) || 0,
      ...(state.editor.skills?.utilityIds || []).map(Number),
      Number(state.editor.skills?.eliteId) || 0,
    ].filter(Boolean));
    const isEquippedSlotKit = (kitSkill?.bundleSkills?.length ?? 0) > 0 && equippedIds.has(activeKit);
    // Soulbeast Beastmode has no bundle_skills in the API; allow it to persist via isBeastmodeToggle.
    const isBeastmodeKit = mechSlots.some((s) => s.isBeastmodeToggle && s.skill?.id === activeKit);
    const isBerserkKit = mechSlots.some((s) => s.isBerserkToggle && s.skill?.id === activeKit);
    if (!isStaticBundle && !isToolbeltSource && !isEquippedSlotKit && !isBeastmodeKit && !isBerserkKit) {
      state.editor.activeKit = 0;
    }
  }

  // Resolve weapon skills after kit validation so bundle/shroud state is correct.
  const resolvedKit = Number(state.editor.activeKit) || 0;
  const kitSrcSkill = resolvedKit ? catalog.skillById.get(resolvedKit) : null;
  // Build weapon bar skills for active kit/bundle, or fall back to equipped weapon skills.
  // bundle_skills arrays include both land and aquatic variants with no flags to distinguish them.
  // Group by Weapon_N/Downed_N slot and prefer the lower skill ID per slot — land skills are
  // historically assigned lower IDs than their aquatic counterparts (e.g. Box of Nails 5995
  // vs Box of Piranhas 6175 in Tool Kit).
  let weaponSkills;
  if (kitSrcSkill?.bundleSkills?.length) {
    const slotMap = new Map(); // slot number (1–5) → skill
    for (const id of kitSrcSkill.bundleSkills) {
      const s = catalog.skillById.get(id);
      if (!s) continue;
      const m = /^(?:Weapon|Downed)_(\d)$/.exec(s.slot || "");
      if (!m) continue;
      const slotNum = parseInt(m[1], 10);
      const existing = slotMap.get(slotNum);
      if (!existing || id < existing.id) slotMap.set(slotNum, s);
    }
    weaponSkills = [1, 2, 3, 4, 5].map((n) => slotMap.get(n) || null);
  } else {
    weaponSkills = getEquippedWeaponSkills(catalog, {
      mainhand: equippedWeapons[mhKey] || "",
      offhand: equippedWeapons[ohKey] || "",
    }, activeAttunement, activeAttunement2, isWeaver);
  }

  const weaponGroup = document.createElement("div");
  weaponGroup.className = "skill-group skill-group--weapons";
  for (let i = 0; i < 5; i++) {
    const wSkill = weaponSkills[i];
    const slotEl = document.createElement("div");
    slotEl.className = "skill-slot skill-slot--weapon";
    const iconBtn = document.createElement("button");
    iconBtn.type = "button";
    iconBtn.className = "skill-icon-large skill-icon--weapon" + (wSkill ? "" : " skill-icon--empty");
    iconBtn.disabled = !wSkill;
    if (wSkill?.icon) {
      iconBtn.innerHTML = `<img src="${escapeHtml(wSkill.icon)}" alt="${escapeHtml(wSkill.name || "")}" />`;
      iconBtn.title = wSkill.name || "";
      bindHoverPreview(iconBtn, "skill", () => wSkill);
      iconBtn.addEventListener("click", () => selectDetail("skill", wSkill));
    }
    markSkillIconRendered(iconBtn, `weapon_${i + 1}`, wSkill ? `${wSkill.id}:${wSkill.icon || ""}` : "");
    const wKeyLabel = document.createElement("span");
    wKeyLabel.className = "skill-icon-large__keylabel";
    wKeyLabel.textContent = String(i + 1);
    iconBtn.append(wKeyLabel);
    slotEl.append(iconBtn);
    weaponGroup.append(slotEl);
  }

  const weaponCol = document.createElement("div");
  weaponCol.className = "skills-bar__weapon-col";

  // F5 slot (Celestial Avatar / Beastmode / Unleash / Cyclone Bow) is rendered above the health orb.
  let f5SlotEl = null;

  // Always create the mechBar for Ranger (even core Ranger with empty mechSlots) so the
  // pet selector panel can be shown. Same for Revenant so the legend stack is always rendered.
  const isRevenant = Array.isArray(catalog.legends) && catalog.legends.length > 0;
  if (isRanger || isRevenant || (mechSlots.length > 0 && mechSlots.some((s) => s.skill || s.isSelectable))) {
    const mechBar = document.createElement("div");
    mechBar.className = "profession-mechanics-bar";

    for (let fIdx = 0; fIdx < mechSlots.length; fIdx++) {
      const { skill, sourceId, sourceSkill, isStatic, isSelectable, morphIndex, mechIconOverride, fakeCommand, isBeastmodeToggle, isBerserkToggle, leaveIcon, fKeyLabel, isF5AboveOrb, isAllianceTactics, isAntiquarySkritSwipe } = mechSlots[fIdx];
      const slotEl = document.createElement("div");
      slotEl.className = "skill-slot";
      const iconBtn = document.createElement("button");
      iconBtn.type = "button";

      // Determine if this slot has a kit (bundle weapon skills available to toggle).
      // Toolbelt slots: the SOURCE utility skill must have bundleSkills (i.e. be a kit).
      // Static slots: the skill itself has bundleSkills (shroud, Photon Forge, etc.).
      const srcSkillForKit = (!isStatic && isToolbelt) ? catalog.skillById.get(sourceId) : null;
      const isKit = !isStatic && isToolbelt
        ? (srcSkillForKit?.bundleSkills?.length ?? 0) > 0
        : isStatic && ((skill?.bundleSkills?.length ?? 0) > 0 || !!isBeastmodeToggle || !!isBerserkToggle);

      let isActive = false;
      if (isSelectable) {
        // Amalgam morph slot — always interactive, never "active" in the attunement/kit sense
      } else if (!isStatic && isToolbelt) {
        isActive = isKit && resolvedKit === sourceId;
      } else if (isAllianceTactics) {
        isActive = (Number(state.editor.allianceTacticsForm) || 0) === 1;
      } else if (isStatic && ((skill?.bundleSkills?.length ?? 0) > 0 || isBeastmodeToggle || isBerserkToggle)) {
        // Static bundle skills: shroud, celestial avatar, Photon Forge, beastmode, Berserk, etc.
        isActive = resolvedKit === skill?.id;
      } else if (isStatic && !isToolbelt) {
        // Attunement-keyed skills: check name pattern ("Fire Attunement") or attunement field
        const attunementNameMatch = /^(\w+)\s+Attunement\b/i.exec(skill?.name || "");
        const skillAttunement = attunementNameMatch ? attunementNameMatch[1] : (skill?.attunement || "");
        const sa = skillAttunement.toLowerCase();
        // Weaver: both primary and secondary attunements are highlighted
        isActive = !!skillAttunement && (
          sa === activeAttunement.toLowerCase() ||
          (isWeaver && !!activeAttunement2 && sa === activeAttunement2.toLowerCase())
        );
      }

      iconBtn.className = "skill-icon--profession"
        + (isActive ? " skill-icon--profession-active" : "")
        + (!skill && !fakeCommand ? " skill-icon--profession-empty" : "")
        + (!isKit && !isSelectable && isStatic === false ? " skill-icon--profession-nokit" : "")
        + (fakeCommand ? ` skill-icon--fake-command skill-icon--fake-${fakeCommand}` : "");
      iconBtn.title = fakeCommand === "attack" ? "Attack My Target"
        : fakeCommand === "return" ? "Return to Me"
        : (isActive && leaveIcon) ? "Leave Beastmode"
        : skill?.name || (isSelectable ? "Choose morph skill…" : "");

      let mechIconSignature = "";
      if (fakeCommand) {
        // Ranger client-side pet commands — no API skill, render a placeholder icon
        iconBtn.disabled = true;
        iconBtn.innerHTML = fakeCommand === "attack"
          ? `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
               <circle cx="16" cy="16" r="11" stroke="rgba(160,230,140,0.9)" stroke-width="1.5" fill="none"/>
               <circle cx="16" cy="16" r="3" fill="rgba(160,230,140,0.9)"/>
               <line x1="16" y1="2" x2="16" y2="9" stroke="rgba(160,230,140,0.9)" stroke-width="1.5"/>
               <line x1="16" y1="23" x2="16" y2="30" stroke="rgba(160,230,140,0.9)" stroke-width="1.5"/>
               <line x1="2" y1="16" x2="9" y2="16" stroke="rgba(160,230,140,0.9)" stroke-width="1.5"/>
               <line x1="23" y1="16" x2="30" y2="16" stroke="rgba(160,230,140,0.9)" stroke-width="1.5"/>
             </svg>`
          : `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
               <path d="M26 7 L26 18 C26 22 22 25 18 25 L9 25" stroke="rgba(240,220,100,0.9)" stroke-width="2" fill="none" stroke-linecap="round"/>
               <polyline points="13,19 9,25 15,29" stroke="rgba(240,220,100,0.9)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
             </svg>`;
        mechIconSignature = `fake:${fakeCommand}`;
      } else {
        // When a static bundle skill (e.g. Photon Forge) is active, show the flip_skill icon.
        const flipSkillId = isActive && isStatic && (skill?.flipSkill ?? 0);
        const flipSkill = flipSkillId ? catalog.skillById.get(flipSkillId) : null;
        // Elixir toolbelt skills ("Detonate Elixir X") share a generic icon in the API.
        // Fall back to the source elixir's own icon so each slot looks distinct.
        // All other toolbelt skills (Defense Field, turret actions, etc.) have correct distinct icons.
        const isDetonateElixir = !isKit && !isStatic && /^Detonate Elixir\b/i.test(skill?.name || "");
        const slotIcon = (isDetonateElixir && sourceSkill?.icon)
          ? sourceSkill.icon
          : (skill?.icon || mechIconOverride || "");
        // Beastmode: show Leave Beastmode icon when active (API has no flip_skill for Beastmode).
        const displayIcon = (isActive && leaveIcon) ? leaveIcon : (flipSkill?.icon) || slotIcon;
        const displayName = (isActive && leaveIcon) ? "Leave Beastmode" : (flipSkill?.name) || skill?.name || "";
        if (displayIcon) {
          iconBtn.innerHTML = `<img src="${escapeHtml(displayIcon)}" alt="${escapeHtml(displayName)}" />`;
        }
        mechIconSignature = (isActive && leaveIcon)
          ? `leave:${leaveIcon}`
          : flipSkill
            ? `flip:${flipSkill.id}:${displayIcon || ""}`
            : skill
              ? `${skill.id}:${displayIcon || ""}`
              : "";
        if (flipSkill) {
          bindHoverPreview(iconBtn, "skill", () => flipSkill);
        } else if (skill) {
          bindHoverPreview(iconBtn, "skill", () => skill);
        }
      }

      // F-key label (F1, F2, …) in the bottom-left corner of the slot icon
      const fLabel = document.createElement("span");
      fLabel.className = "skill-icon--profession-flabel";
      fLabel.textContent = fKeyLabel || `F${fIdx + 1}`;
      iconBtn.append(fLabel);
      markSkillIconRendered(iconBtn, `mech_${fIdx + 1}`, mechIconSignature || (skill ? `${skill.id}:${skill.icon || ""}` : ""));

      // Antiquary F1 (Skritt Swipe): play badge randomizes the F2/F3 artifact draws.
      if (isAntiquarySkritSwipe) {
        const rollBadge = document.createElement("span");
        rollBadge.className = "kit-toggle-indicator";
        rollBadge.title = "Draw artifacts";
        rollBadge.textContent = "▸";
        rollBadge.addEventListener("click", (e) => {
          e.stopPropagation();
          randomizeAntiquaryArtifacts(catalog, state.editor);
          renderSkills();
        });
        iconBtn.append(rollBadge);
      }

      // Alliance Tactics F3 gets a toggle badge to show it's clickable.
      if (isAllianceTactics) {
        const toggleBadge = document.createElement("span");
        toggleBadge.className = "kit-toggle-indicator" + (isActive ? " kit-toggle-indicator--active" : "");
        toggleBadge.textContent = isActive ? "✕" : "▸";
        iconBtn.append(toggleBadge);
      }

      // Static kit slots (tomes, Photon Forge, shrouds) get a toggle badge bottom-right.
      if (isKit && isStatic) {
        const toggleBadge = document.createElement("span");
        toggleBadge.className = "kit-toggle-indicator" + (isActive ? " kit-toggle-indicator--active" : "");
        toggleBadge.textContent = isActive ? "✕" : "▸";
        toggleBadge.addEventListener("click", (e) => {
          e.stopPropagation();
          state.editor.activeKit = resolvedKit === skill.id ? 0 : skill.id;
          renderSkills();
        });
        iconBtn.append(toggleBadge);
      }

      if (isSelectable) {
        iconBtn.addEventListener("click", () => {
          const otherSelectedIds = new Set(
            (state.editor.morphSkillIds || [])
              .map((id, i) => (i !== morphIndex ? Number(id) : 0))
              .filter(Boolean)
          );
          // Morph pool: all Profession-type skills for the elite spec that aren't "Locked"/"Evolve"
          const allMorphPool = catalog.skills.filter(
            (s) => s.specialization === eliteSpecId &&
              (s.type || "").toLowerCase() === "profession" &&
              s.name.toLowerCase() !== "locked" &&
              s.name.toLowerCase() !== "evolve"
          );
          const morphItems = [
            { value: "", label: "— None —" },
            ...allMorphPool
              .filter((s) => !otherSelectedIds.has(s.id))
              .map((s) => ({ value: String(s.id), label: s.name, icon: s.icon })),
          ];
          _openSlotPicker(iconBtn, String(sourceId || ""), (newVal) => {
            if (!state.editor.morphSkillIds) state.editor.morphSkillIds = [0, 0, 0];
            state.editor.morphSkillIds[morphIndex] = Number(newVal) || 0;
            _markEditorChanged();
            renderSkills();
          }, { items: morphItems, searchPlaceholder: "Choose morph skill…" });
          if (skill) selectDetail("skill", skill);
        });
      } else if (!isKit && !isStatic && isToolbelt) {
        // Non-kit toolbelt slot (elixir, gadget, etc.): not interactive, just show skill detail.
        if (skill) iconBtn.addEventListener("click", () => selectDetail("skill", skill));
      } else if (isKit && !isStatic && isToolbelt) {
        // Kit toolbelt slot: clicking shows skill detail. Weapon skill toggling is done via the
        // badge on the utility skill slot itself (see makeSkillSlot).
        if (skill) iconBtn.addEventListener("click", () => selectDetail("skill", skill));
      } else {
        iconBtn.addEventListener("click", () => {
          if (isAllianceTactics) {
            state.editor.allianceTacticsForm = (Number(state.editor.allianceTacticsForm) || 0) === 0 ? 1 : 0;
            syncRevenantSkillsFromLegend(catalog);
            _markEditorChanged();
            renderSkills();
            if (skill) selectDetail("skill", skill);
            return;
          }
          if (isStatic && ((skill?.bundleSkills?.length ?? 0) > 0 || isBeastmodeToggle)) {
            // Static bundle skill (shroud, Photon Forge, beastmode, etc.): toggle active state.
            state.editor.activeKit = resolvedKit === skill.id ? 0 : skill.id;
            renderSkills();
            if (skill) selectDetail("skill", skill);
            return;
          } else if (isStatic && !isToolbelt) {
            const attunementNameMatch = /^(\w+)\s+Attunement\b/i.exec(skill?.name || "");
            const skillAttunement = attunementNameMatch ? attunementNameMatch[1] : (skill?.attunement || "");
            if (skillAttunement) {
              if (isWeaver) {
                // Clicked element → mainhand; current mainhand → offhand.
                // Clicking the current mainhand element again sets both to the same element
                // (single-attunement mode). Clicking the current offhand swaps them.
                state.editor.activeAttunement2 = state.editor.activeAttunement;
                state.editor.activeAttunement = skillAttunement;
              } else {
                state.editor.activeAttunement = skillAttunement;
              }
              renderSkills();
            }
          }
          if (skill) selectDetail("skill", skill);
        });
      }

      slotEl.append(iconBtn);
      if (isF5AboveOrb) {
        f5SlotEl = slotEl; // rendered above the health orb, not inside mechBar
      } else {
        mechBar.append(slotEl);
      }
    }
    // Ranger: add pet selector directly inside mechBar (right side, pushed by auto-margin spacer)
    if (Array.isArray(catalog.pets) && catalog.pets.length > 0) {
      const activeSlotKey = state.editor.activePetSlot === "terrestrial2" ? "terrestrial2" : "terrestrial1";
      const inactiveSlotKey = activeSlotKey === "terrestrial1" ? "terrestrial2" : "terrestrial1";
      const activePetId = Number(state.editor.selectedPets?.[activeSlotKey]) || 0;
      const inactivePetId = Number(state.editor.selectedPets?.[inactiveSlotKey]) || 0;
      const activePet = activePetId ? catalog.petById.get(activePetId) : null;

      const spacer = document.createElement("div");
      spacer.className = "pet-panel-spacer";

      const petWrapper = document.createElement("div");
      petWrapper.className = "pet-slot-wrapper";

      const petBtn = document.createElement("button");
      petBtn.type = "button";
      petBtn.className = "pet-slot-btn" + (activePet ? " pet-slot-btn--filled" : "");
      petBtn.title = activePet?.name || `Click to select ${activeSlotKey === "terrestrial1" ? "Pet 1" : "Pet 2"}`;
      if (activePet?.icon) {
        petBtn.innerHTML = `<img src="${escapeHtml(activePet.icon)}" alt="${escapeHtml(activePet.name || "")}" />`;
      }
      petBtn.addEventListener("click", () => openPetPicker(petBtn, activeSlotKey, catalog));

      const petLabel = document.createElement("span");
      petLabel.className = "pet-slot-btn__label";
      petLabel.textContent = activePet?.name?.replace(/^Juvenile\s+/i, "") || (activeSlotKey === "terrestrial1" ? "Pet 1" : "Pet 2");

      petWrapper.append(petBtn, petLabel);

      const petSwapBtn = document.createElement("button");
      petSwapBtn.type = "button";
      petSwapBtn.className = "pet-swap-btn" + (activeSlotKey === "terrestrial2" ? " pet-swap-btn--active" : "");
      petSwapBtn.title = inactivePetId
        ? `Switch to pet ${activeSlotKey === "terrestrial1" ? 2 : 1}`
        : "No second pet equipped";
      petSwapBtn.innerHTML = `<svg viewBox="0 0 18 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="2,3.5 13,3.5"/><polyline points="10,1 13,3.5 10,6"/><polyline points="16,10.5 5,10.5"/><polyline points="8,8 5,10.5 8,13"/></svg>`;
      petSwapBtn.addEventListener("click", () => {
        state.editor.activePetSlot = inactiveSlotKey;
        renderSkills();
      });

      mechBar.append(spacer, petWrapper, petSwapBtn);
    }

    // Revenant: prepend legend buttons into mechBar so they sit inline before any F2+ elite slots.
    // This avoids a separate wrapper div that would stretch to full column width.
    if (Array.isArray(catalog.legends) && catalog.legends.length > 0) {
      const legendSlots = state.editor.selectedLegends || ["", ""];
      const activeLegendSlot = Number(state.editor.activeLegendSlot) || 0;
      const legendStack = document.createElement("div");
      legendStack.className = "legend-stack";

      for (let slotIdx = 0; slotIdx < 2; slotIdx++) {
        const legendId = legendSlots[slotIdx] || "";
        const legend = legendId ? catalog.legendById.get(legendId) : null;
        const swapSkill = legend?.swap ? catalog.skillById.get(legend.swap) : null;
        const legendName = swapSkill?.name || legend?.id || "—";
        const legendIcon = swapSkill?.icon || "";
        const isActive = slotIdx === activeLegendSlot;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "legend-slot-btn" + (isActive ? " legend-slot-btn--active" : "");
        btn.title = legendName + (isActive ? " (active — right-click to change)" : " — click to swap, right-click to change");
        if (legendIcon) {
          btn.innerHTML = `<img src="${escapeHtml(legendIcon)}" alt="${escapeHtml(legendName)}" />`;
        }
        markSkillIconRendered(btn, `legend_${slotIdx + 1}`, legend ? `${legend.swap || 0}:${legendIcon}` : legendId);
        const slotLabel = document.createElement("span");
        slotLabel.className = "legend-slot-btn__label";
        slotLabel.textContent = "F1";
        btn.append(slotLabel);
        btn.addEventListener("click", () => {
          if (isActive || !legendId) {
            openLegendPicker(btn, slotIdx, catalog);
          } else {
            if (!state.editor.selectedLegends) state.editor.selectedLegends = ["", ""];
            state.editor.activeLegendSlot = slotIdx;
            // Reset Alliance form when switching to a non-Alliance legend
            if (legendId !== "Legend7") state.editor.allianceTacticsForm = 0;
            syncRevenantSkillsFromLegend(catalog);
            _markEditorChanged();
            renderSkills();
          }
        });
        btn.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          openLegendPicker(btn, slotIdx, catalog);
        });
        legendStack.append(btn);
      }

      mechBar.prepend(legendStack);
    }

    weaponCol.append(mechBar);
  }

  const swapBtn = document.createElement("button");
  swapBtn.type = "button";
  swapBtn.className = "weapon-swap-btn" + (activeWeaponSet === 2 ? " weapon-swap-btn--active" : "");
  swapBtn.disabled = !hasWeaponSet2;
  swapBtn.title = hasWeaponSet2
    ? `Switch to weapon set ${activeWeaponSet === 1 ? 2 : 1}`
    : "No second weapon set equipped";
  swapBtn.innerHTML = `<svg viewBox="0 0 18 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="2,3.5 13,3.5"/><polyline points="10,1 13,3.5 10,6"/>
    <polyline points="16,10.5 5,10.5"/><polyline points="8,8 5,10.5 8,13"/>
  </svg>`;
  swapBtn.addEventListener("click", () => {
    state.editor.activeWeaponSet = activeWeaponSet === 1 ? 2 : 1;
    renderSkills();
  });

  const weaponRow = document.createElement("div");
  weaponRow.className = "skills-bar__weapon-row";
  weaponRow.append(swapBtn, weaponGroup);
  weaponCol.append(weaponRow);

  // Center: health orb
  const profession = state.editor.profession || "";
  const baseHp = PROFESSION_BASE_HP[profession] ?? 0;
  const computed = computeEquipmentStats();
  const totalHp = baseHp > 0 ? baseHp + (computed.Vitality || 0) * 10 : 0;
  const orbEl = document.createElement("div");
  orbEl.className = "health-orb";
  orbEl.innerHTML = `
    <div class="health-orb__fill"></div>
    <div class="health-orb__text">
      <span class="health-orb__hp">${totalHp > 0 ? totalHp.toLocaleString() : "—"}</span>
      <span class="health-orb__label">HP</span>
    </div>
  `;

  // Right: heal, 3 utility, elite
  const utilityGroup = document.createElement("div");
  utilityGroup.className = "skill-group skill-group--utilities";
  const utilitySlots = [
    { key: "healId", label: "Heal", list: options.heal || [], keybind: "6", flipKey: "utility_heal" },
    { key: "utilityIds", index: 0, label: "Utility", list: options.utility || [], keybind: "7", flipKey: "utility_1" },
    { key: "utilityIds", index: 1, label: "Utility", list: options.utility || [], keybind: "8", flipKey: "utility_2" },
    { key: "utilityIds", index: 2, label: "Utility", list: options.utility || [], keybind: "9", flipKey: "utility_3" },
    { key: "eliteId", label: "Elite", list: options.elite || [], keybind: "0", flipKey: "utility_elite" },
  ];
  for (const slot of utilitySlots) {
    utilityGroup.append(makeSkillSlot(slot, catalog, options, utilitySelection, markSkillIconRendered));
  }

  if (f5SlotEl) {
    const orbCol = document.createElement("div");
    orbCol.className = "skills-bar__orb-col";
    orbCol.append(f5SlotEl, orbEl);
    bar.append(weaponCol, orbCol, utilityGroup);
  } else {
    bar.append(weaponCol, orbEl, utilityGroup);
  }
  _el.skillsHost.append(bar);
  state.renderedSkillIconIds = nextRenderedSkillIconIds;
}

export function openLegendPicker(anchorEl, slotIdx, catalog) {
  const legendSlots = state.editor.selectedLegends || ["", ""];
  const otherLegendId = legendSlots[1 - slotIdx] || "";
  const selectedSpecIds = new Set(
    (state.editor.specializations || []).map((s) => Number(s?.specializationId) || 0).filter(Boolean)
  );
  const items = [
    { value: "", label: "— None —" },
    ...(catalog.legends || []).flatMap((l) => {
      const swapSkill = l.swap ? catalog.skillById.get(l.swap) : null;
      // Elite-spec-only legends: swap skill has a non-zero specialization requirement
      const reqSpec = Number(swapSkill?.specialization) || 0;
      if (reqSpec && !selectedSpecIds.has(reqSpec)) return [];
      return [{ value: l.id, label: swapSkill?.name || l.id, icon: swapSkill?.icon || "" }];
    }).filter((item) => item.value !== otherLegendId),
  ];
  _openSlotPicker(anchorEl, legendSlots[slotIdx] || "", (newVal) => {
    if (!state.editor.selectedLegends) state.editor.selectedLegends = ["", ""];
    state.editor.selectedLegends[slotIdx] = newVal || "";
    syncRevenantSkillsFromLegend(catalog);
    _markEditorChanged();
    renderSkills();
  }, { items, searchPlaceholder: "Search legends…" });
}

export function openPetPicker(anchorEl, petKey, catalog) {
  const currentPetId = Number(state.editor.selectedPets?.[petKey]) || 0;
  const isAquatic = petKey.startsWith("aquatic");
  // Filter pets: aquatic slots show aquatic family pets; terrestrial slots show non-aquatic
  const aquaticFamilies = new Set(["Amphibious", "Aquatic"]);
  const filteredPets = (catalog.pets || []).filter((p) => {
    const isAquaticPet = aquaticFamilies.has(p.type);
    return isAquatic ? isAquaticPet : !isAquaticPet;
  });
  const items = [
    { value: "", label: "— None —" },
    ...filteredPets.map((p) => ({ value: String(p.id), label: p.name, icon: p.icon })),
  ];
  _openSlotPicker(anchorEl, currentPetId ? String(currentPetId) : "", (newVal) => {
    if (!state.editor.selectedPets) state.editor.selectedPets = { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 };
    state.editor.selectedPets[petKey] = Number(newVal) || 0;
    _markEditorChanged();
    renderSkills();
  }, { items, searchPlaceholder: "Search pets…", className: "slot-picker--pet" });
}

export function syncRevenantSkillsFromLegend(catalog) {
  const legendSlots = state.editor.selectedLegends || ["", ""];
  const activeLegendSlot = Number(state.editor.activeLegendSlot) || 0;
  const activeLegendId = legendSlots[activeLegendSlot] || "";
  const activeLegend = activeLegendId ? catalog.legendById.get(activeLegendId) : null;
  if (!activeLegend) return;
  if (!state.editor.skills) state.editor.skills = { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 };
  // Alliance legend: apply Saint Viktor (Luxon) flip skills when form=1
  const useFlip = activeLegendId === "Legend7" && (Number(state.editor.allianceTacticsForm) || 0) === 1;
  const resolveId = (id) => {
    if (!id) return 0;
    if (useFlip) {
      const skill = catalog.skillById.get(id);
      return skill?.flipSkill || id;
    }
    return id;
  };
  state.editor.skills.healId = resolveId(activeLegend.heal) || 0;
  state.editor.skills.utilityIds = [
    ...(activeLegend.utilities || []).slice(0, 3).map(resolveId),
    ...Array(3).fill(0),
  ].slice(0, 3);
  state.editor.skills.eliteId = resolveId(activeLegend.elite) || 0;
}
