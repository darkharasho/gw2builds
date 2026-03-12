const splits = require("./data/splits.json");

function getSkillSplit(skillId, gameMode) {
  if (gameMode === "pve") return null;
  return splits.skills?.[String(skillId)]?.modes?.[gameMode] || null;
}

function getTraitSplit(traitId, gameMode) {
  if (gameMode === "pve") return null;
  return splits.traits?.[String(traitId)]?.modes?.[gameMode] || null;
}

function getSkillPveFacts(skillId) {
  return splits.skills?.[String(skillId)]?.modes?.pve || null;
}

function getTraitPveFacts(traitId) {
  return splits.traits?.[String(traitId)]?.modes?.pve || null;
}

function hasSplit(entityType, id) {
  const bucket = entityType === "trait" ? splits.traits : splits.skills;
  return Boolean(bucket?.[String(id)]);
}

module.exports = { getSkillSplit, getTraitSplit, getSkillPveFacts, getTraitPveFacts, hasSplit, splits };
