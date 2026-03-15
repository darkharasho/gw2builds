import {
  BOON_NAMES, CONDITION_NAMES, CONDITION_NAME_NORMALIZE,
  BOON_DISPLAY_ORDER, BUFF_FACT_TYPES, BOON_CONDITION_ICONS,
} from "./constants.js";

function normalizeName(status) {
  return CONDITION_NAME_NORMALIZE[status] || status;
}

// Check whether a specific boon/condition is described as ally-targeted in the description.
// Looks for the boon name appearing in a sentence that also contains "allies" or "ally".
// Falls back to false (self-applied) when uncertain.
function isAllyTargeted(description, statusName) {
  if (!description) return false;
  const desc = description.toLowerCase();
  const name = statusName.toLowerCase();
  // Split into sentences (roughly) and check if any sentence mentions both the boon and allies
  const sentences = desc.split(/[.!;]/);
  for (const sentence of sentences) {
    if (sentence.includes(name) && /\b(allies|ally)\b/.test(sentence)) {
      return true;
    }
  }
  return false;
}

function extractBuffFacts(entity, sourceType) {
  const results = [];
  const facts = entity.facts || [];
  const desc = entity.description || "";
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
      isAlly: isAllyTargeted(desc, rawStatus),
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
  // Profession mechanic skill IDs (F1-F5)
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
