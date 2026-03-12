// Equipment stat computation — pure logic over state + constants, no DOM deps.
import { state } from "./state.js";
import { STAT_COMBOS, SLOT_WEIGHTS, GW2_FOOD } from "./constants.js";

export function computeSlotStats(comboLabel, slotKey) {
  const combo = STAT_COMBOS.find((c) => c.label === comboLabel);
  const w = SLOT_WEIGHTS[slotKey];
  if (!combo || !w) return [];
  const n = combo.stats.length;
  const result = [];
  if (n <= 3) {
    result.push({ stat: combo.stats[0], value: w.p });
    for (let i = 1; i < n; i++) result.push({ stat: combo.stats[i], value: w.s });
  } else if (n === 4) {
    result.push({ stat: combo.stats[0], value: Math.round(w.p * 0.895) });
    result.push({ stat: combo.stats[1], value: Math.round(w.s * 0.889) });
    result.push({ stat: combo.stats[2], value: Math.round(w.s * 0.889) });
    result.push({ stat: combo.stats[3], value: Math.round(w.p * 0.452) });
  } else {
    const each = Math.round((w.p + 2 * w.s) / n);
    for (const stat of combo.stats) result.push({ stat, value: each });
  }
  return result;
}

export function computeEquipmentStats() {
  const slots = state.editor.equipment?.slots || {};
  const totals = {
    Power: 1000, Precision: 1000, Toughness: 1000, Vitality: 1000,
    Ferocity: 0, ConditionDamage: 0, Expertise: 0, Concentration: 0, HealingPower: 0,
  };
  for (const [slotKey, comboLabel] of Object.entries(slots)) {
    if (!comboLabel) continue;
    const combo = STAT_COMBOS.find((c) => c.label === comboLabel);
    const w = SLOT_WEIGHTS[slotKey];
    if (!combo || !w) continue;
    const n = combo.stats.length;
    if (n <= 3) {
      totals[combo.stats[0]] = (totals[combo.stats[0]] || 0) + w.p;
      for (let i = 1; i < combo.stats.length; i++) {
        totals[combo.stats[i]] = (totals[combo.stats[i]] || 0) + w.s;
      }
    } else if (n === 4) {
      totals[combo.stats[0]] = (totals[combo.stats[0]] || 0) + Math.round(w.p * 0.895);
      totals[combo.stats[1]] = (totals[combo.stats[1]] || 0) + Math.round(w.s * 0.889);
      totals[combo.stats[2]] = (totals[combo.stats[2]] || 0) + Math.round(w.s * 0.889);
      totals[combo.stats[3]] = (totals[combo.stats[3]] || 0) + Math.round(w.p * 0.452);
    } else {
      const each = Math.round((w.p + 2 * w.s) / n);
      for (const stat of combo.stats) {
        totals[stat] = (totals[stat] || 0) + each;
      }
    }
  }

  // Food flat stat contributions (+N StatName patterns)
  const foodLabel = state.editor.equipment?.food;
  if (foodLabel) {
    const foodDef = GW2_FOOD.find((f) => f.label === foodLabel);
    if (foodDef) {
      const foodStatMap = {
        "Condition Damage": "ConditionDamage", "Healing Power": "HealingPower",
        "Power": "Power", "Precision": "Precision", "Toughness": "Toughness",
        "Vitality": "Vitality", "Ferocity": "Ferocity",
        "Concentration": "Concentration", "Expertise": "Expertise",
      };
      const re = /\+(\d+)\s+(Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise)/g;
      let m;
      while ((m = re.exec(foodDef.buff)) !== null) {
        const key = foodStatMap[m[2]];
        if (key) totals[key] = (totals[key] || 0) + Number(m[1]);
      }
    }
  }

  return totals;
}
