import { state } from "./state.js";
import {
  STAT_COMBOS, STAT_COMBOS_BY_LABEL, SLOT_WEIGHTS, EQUIP_ARMOR_SLOTS, EQUIP_WEAPON_SETS,
  EQUIP_TRINKET_SLOTS, EQUIP_UNDERWATER_SLOTS, GW2_WEAPONS, GW2_WEAPONS_BY_ID,
  GW2_RELICS, GW2_RELICS_BY_LABEL, GW2_FOOD, GW2_FOOD_BY_LABEL,
  GW2_UTILITY, GW2_UTILITY_BY_LABEL, PROFESSION_WEIGHT,
  LEGENDARY_ARMOR_ICONS, _WK,
  PROFESSION_BASE_HP, PROFESSION_CONCEPT_ART,
} from "./constants.js";
import { escapeHtml } from "./utils.js";
import { computeSlotStats, computeEquipmentStats } from "./stats.js";
import { bindHoverPreview } from "./detail-panel.js";

export { computeSlotStats, computeEquipmentStats } from "./stats.js";

// DOM refs
let _el = { equipmentPanel: null };
export function initEquipment(domRefs) { _el = { ..._el, ...domRefs }; }

// Callback injection (to avoid circular deps)
let _markEditorChanged = () => {};
let _render = () => {};
let _renderSkills = () => {};
export function initEquipmentCallbacks({ markEditorChanged, render, renderSkills }) {
  _markEditorChanged = markEditorChanged;
  _render = render;
  _renderSkills = renderSkills;
}

// Module-level slot picker state
let _slotPickerEl = null;
let _slotPickerCleanup = null;

export function closeSlotPicker() {
  if (_slotPickerEl) { _slotPickerEl.remove(); _slotPickerEl = null; }
  if (_slotPickerCleanup) { _slotPickerCleanup(); _slotPickerCleanup = null; }
}

export function openSlotPicker(anchorEl, currentValue, onSelect, { items = null, searchPlaceholder = "Search stats…", className = "" } = {}) {
  closeSlotPicker();

  const picker = document.createElement("div");
  picker.className = "slot-picker" + (className ? ` ${className}` : "");

  const search = document.createElement("input");
  search.type = "search";
  search.className = "slot-picker__search";
  search.placeholder = searchPlaceholder;
  search.autocomplete = "off";

  const list = document.createElement("div");
  list.className = "slot-picker__list";

  const allOptions = items ?? [
    { value: "", label: "— Empty —", subtitle: "" },
    ...STAT_COMBOS.map((c) => ({ value: c.label, label: c.label, subtitle: c.stats.join(" · ") })),
  ];

  function renderPickerList(query) {
    list.innerHTML = "";
    const q = query.trim().toLowerCase();
    const filtered = allOptions.filter((o) => !q || o.label.toLowerCase().includes(q) || (o.subtitle || "").toLowerCase().includes(q));
    for (const opt of filtered) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot-picker__option" + (opt.value === currentValue ? " slot-picker__option--selected" : "");
      if (opt.icon) {
        const img = document.createElement("img");
        img.className = "slot-picker__icon";
        img.src = opt.icon;
        img.alt = "";
        img.draggable = false;
        img.addEventListener("error", () => img.remove());
        btn.append(img);
      }
      const text = document.createElement("span");
      text.className = "slot-picker__text";
      if (opt.subtitle) {
        text.innerHTML = `<span class="slot-picker__name">${escapeHtml(opt.label)}</span><span class="slot-picker__stats">${escapeHtml(opt.subtitle)}</span>`;
      } else {
        text.innerHTML = `<span class="slot-picker__name">${escapeHtml(opt.label)}</span>`;
      }
      btn.append(text);
      btn.addEventListener("click", () => { onSelect(opt.value); closeSlotPicker(); });
      list.append(btn);
    }
  }

  renderPickerList("");
  let _searchDebounce = null;
  search.addEventListener("input", () => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(() => renderPickerList(search.value), 80);
  });
  picker.append(search, list);
  document.body.append(picker);
  _slotPickerEl = picker;

  const rect = anchorEl.getBoundingClientRect();
  const pickerW = Math.max(rect.width, 250);
  const spaceBelow = window.innerHeight - rect.bottom;
  picker.style.position = "fixed";
  picker.style.left = `${Math.min(rect.left, window.innerWidth - pickerW - 8)}px`;
  picker.style.width = `${pickerW}px`;
  if (spaceBelow >= 260 || spaceBelow >= rect.top) {
    picker.style.top = `${rect.bottom + 4}px`;
    picker.style.maxHeight = `${Math.min(300, spaceBelow - 8)}px`;
  } else {
    picker.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    picker.style.maxHeight = `${Math.min(300, rect.top - 8)}px`;
  }

  requestAnimationFrame(() => search.focus());

  const onOutside = (e) => { if (!picker.contains(e.target) && !anchorEl.contains(e.target)) closeSlotPicker(); };
  const onEsc = (e) => { if (e.key === "Escape") closeSlotPicker(); };
  // Prevent the page from scrolling when the wheel is used over the picker.
  // If the event is over the scrollable list, only block when the list is already at its scroll limit.
  picker.addEventListener("wheel", (e) => {
    const inList = list.contains(e.target);
    if (inList) {
      const atTop = list.scrollTop === 0 && e.deltaY < 0;
      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1 && e.deltaY > 0;
      if (!atTop && !atBottom) return;
    }
    e.preventDefault();
  }, { passive: false });
  const onOutsideWheel = (e) => { if (!picker.contains(e.target)) closeSlotPicker(); };
  setTimeout(() => {
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onEsc);
    document.addEventListener("wheel", onOutsideWheel, { capture: true, passive: true });
  }, 0);
  _slotPickerCleanup = () => {
    document.removeEventListener("pointerdown", onOutside);
    document.removeEventListener("keydown", onEsc);
    document.removeEventListener("wheel", onOutsideWheel, { capture: true });
  };
}

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

// Create upgrade sub-slot button for a given equipment slot
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

export function updateHealthOrb() {
  const orbHp = document.querySelector(".health-orb__hp");
  if (!orbHp) return;
  const profession = state.editor.profession || "";
  const baseHp = PROFESSION_BASE_HP[profession] ?? 0;
  const computed = computeEquipmentStats();
  const totalHp = baseHp > 0 ? baseHp + (computed.Vitality || 0) * 10 : 0;
  orbHp.textContent = totalHp > 0 ? totalHp.toLocaleString() : "—";
}

export function renderEquipmentPanel() {
  const panel = _el.equipmentPanel;
  if (!panel) return;
  closeSlotPicker();
  panel.innerHTML = "";

  const equip = state.editor.equipment;
  const slots = equip.slots || {};
  const weapons = equip.weapons || {};

  function makeSlot(slotDef, { compact = false } = {}) {
    const currentCombo = slots[slotDef.key] || "";
    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot" + (compact ? " equip-slot--compact" : "");
    wrapper.setAttribute("role", "button");
    wrapper.tabIndex = 0;

    const icon = document.createElement("div");
    icon.className = "equip-slot__icon" + (currentCombo ? " equip-slot__icon--filled" : "");
    const legendaryUrl = (() => {
      if (!currentCombo) return null;
      const prof = state.editor.profession;
      const weight = PROFESSION_WEIGHT[prof];
      return weight ? (LEGENDARY_ARMOR_ICONS[weight]?.[slotDef.key] ?? null) : null;
    })();
    const imgSrc = legendaryUrl
      ? legendaryUrl
      : slotDef.icon
        ? (slotDef.icon.startsWith("https://") ? slotDef.icon : `https://wiki.guildwars2.com/wiki/Special:FilePath/${slotDef.icon}`)
        : null;
    if (imgSrc) {
      const img = document.createElement("img");
      img.src = imgSrc;
      img.alt = slotDef.label;
      img.draggable = false;
      img.addEventListener("error", () => { img.remove(); });
      icon.append(img);
    }

    const info = document.createElement("div");
    info.className = "equip-slot__info";

    const labelEl = document.createElement("div");
    labelEl.className = "equip-slot__label";
    labelEl.textContent = slotDef.label;

    const valueEl = document.createElement("div");
    valueEl.className = "equip-slot__value" + (currentCombo ? "" : " equip-slot__value--empty");
    if (currentCombo) {
      const combo = STAT_COMBOS_BY_LABEL.get(currentCombo);
      valueEl.innerHTML = `<span class="equip-slot__combo-name">${escapeHtml(currentCombo)}</span>${combo ? `<span class="equip-slot__combo-stats">${combo.stats.join(" · ")}</span>` : ""}`;
    } else {
      valueEl.textContent = "Select stats…";
    }

    info.append(labelEl, valueEl);
    wrapper.append(icon, info);

    const doOpen = () => openSlotPicker(wrapper, currentCombo, (newVal) => {
      state.editor.equipment.slots[slotDef.key] = newVal || "";
      _markEditorChanged();
      renderEquipmentPanel();
    });
    wrapper.addEventListener("click", doOpen);
    wrapper.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doOpen(); } });

    bindHoverPreview(wrapper, "equip-stat", () => {
      if (!currentCombo) return null;
      const combo = STAT_COMBOS_BY_LABEL.get(currentCombo);
      if (!combo) return null;
      const facts = computeSlotStats(currentCombo, slotDef.key)
        .map(({ stat, value }) => ({ text: stat, value: `+${value}` }));
      return { name: combo.label, icon: imgSrc, description: "", facts, slot: slotDef.label };
    });

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
    if (equip.infusions && slotDef.key in equip.infusions) {
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

    return wrapper;
  }

  function makeWeaponSlot(slotDef, { isAquatic = false } = {}) {
    const isOffhand = slotDef.hand === "off";
    const mainhandKey = slotDef.key.replace("offhand", "mainhand");
    const mainhandWeaponId = !isAquatic ? (weapons[mainhandKey] || "") : "";
    const mainhandProfFlags = !isAquatic ? (state.activeCatalog?.professionWeapons?.[mainhandWeaponId]?.flags || []) : [];
    const lockedByTwoHanded = !isAquatic && isOffhand && (
      mainhandProfFlags.includes("TwoHand") ||
      GW2_WEAPONS_BY_ID.get(mainhandWeaponId)?.hand === "two"
    );

    const currentWeapon = weapons[slotDef.key] || "";
    const currentCombo = slots[slotDef.key] || "";
    const weaponDef = GW2_WEAPONS_BY_ID.get(currentWeapon);
    const emptyIcon = isAquatic
      ? `${_WK}/3/3f/Aquatic_weapon_slot.png`
      : "https://wiki.guildwars2.com/images/d/de/Sword_slot.png";

    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--weapon" + (lockedByTwoHanded ? " equip-slot--disabled" : "");

    const weaponBtn = document.createElement("button");
    weaponBtn.type = "button";
    weaponBtn.className = "equip-weapon-type-btn";
    weaponBtn.disabled = lockedByTwoHanded;

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--weapon" + (currentWeapon ? " equip-slot__icon--filled" : "");
    const img = document.createElement("img");
    img.src = weaponDef ? weaponDef.icon : emptyIcon;
    img.alt = weaponDef ? weaponDef.label : slotDef.label;
    img.draggable = false;
    img.addEventListener("error", () => img.remove());
    iconDiv.append(img);

    const weaponNameSpan = document.createElement("span");
    weaponNameSpan.className = "equip-weapon-name" + (currentWeapon ? "" : " equip-weapon-name--empty");
    weaponNameSpan.textContent = lockedByTwoHanded ? "— Two-Handed —" : (weaponDef?.label || slotDef.label);
    weaponBtn.append(iconDiv, weaponNameSpan);

    const statBtn = document.createElement("button");
    statBtn.type = "button";
    statBtn.className = "equip-stat-pick-btn" + (currentCombo ? "" : " equip-stat-pick-btn--empty");
    statBtn.disabled = lockedByTwoHanded;
    if (currentCombo) {
      const combo = STAT_COMBOS_BY_LABEL.get(currentCombo);
      statBtn.innerHTML = `<span class="equip-slot__combo-name">${escapeHtml(currentCombo)}</span>${combo ? `<span class="equip-slot__combo-stats">${combo.stats.join(" · ")}</span>` : ""}`;
    } else {
      statBtn.textContent = "Select stats…";
    }

    wrapper.append(weaponBtn, statBtn);

    bindHoverPreview(weaponBtn, "equip-weapon", () => {
      const wDef = GW2_WEAPONS_BY_ID.get(equip.weapons?.[slotDef.key] || "");
      if (!wDef) return null;
      return { name: wDef.label, icon: wDef.icon, description: "", hand: wDef.hand };
    });

    bindHoverPreview(statBtn, "equip-stat", () => {
      const curCombo = equip.slots?.[slotDef.key] || "";
      const combo = curCombo ? STAT_COMBOS_BY_LABEL.get(curCombo) : null;
      if (!combo) return null;
      const facts = computeSlotStats(curCombo, slotDef.key).map(({ stat, value }) => ({ text: stat, value: `+${value}` }));
      return { name: combo.label, icon: "", description: "", facts, slot: slotDef.label };
    });

    if (!lockedByTwoHanded) {
      if (isAquatic) {
        const aquaticItems = [
          { value: "", label: "— Empty —" },
          ...GW2_WEAPONS.filter((w) => w.hand === "aquatic").map((w) => ({
            value: w.id, label: w.label, icon: w.icon,
          })),
        ];
        weaponBtn.addEventListener("click", () => {
          openSlotPicker(weaponBtn, currentWeapon, (newVal) => {
            if (!equip.weapons) equip.weapons = {};
            equip.weapons[slotDef.key] = newVal || "";
            _markEditorChanged();
            renderEquipmentPanel();
          }, { items: aquaticItems, searchPlaceholder: "Search aquatic weapons…" });
        });
      } else {
        const profWeapons = state.activeCatalog?.professionWeapons || {};
        const weaponItems = [
          { value: "", label: "— Empty —", subtitle: "" },
          ...GW2_WEAPONS.filter((w) => {
            if (w.hand === "aquatic") return false;
            const wData = profWeapons[w.id];
            if (!wData) return false;
            if (isOffhand) return wData.flags.includes("Offhand");
            return wData.flags.includes("Mainhand") || wData.flags.includes("TwoHand");
          }).map((w) => {
            const flags = profWeapons[w.id]?.flags || [];
            const subtitle = flags.includes("TwoHand") ? "Two-handed"
              : flags.includes("Mainhand") && flags.includes("Offhand") ? "Main / Off Hand"
              : "";
            return { value: w.id, label: w.label, subtitle, icon: w.icon };
          }),
        ];
        weaponBtn.addEventListener("click", () => {
          openSlotPicker(weaponBtn, currentWeapon, (newVal) => {
            if (!equip.weapons) equip.weapons = {};
            equip.weapons[slotDef.key] = newVal || "";
            const newFlags = profWeapons[newVal]?.flags || [];
            if (newFlags.includes("TwoHand")) {
              const ofKey = slotDef.key.replace("mainhand", "offhand");
              equip.weapons[ofKey] = "";
              equip.slots[ofKey] = "";
            }
            // Clear second sigil on the mainhand when swapping to one-handed
            if (!newFlags.includes("TwoHand") && equip.sigils?.[slotDef.key]) {
              equip.sigils[slotDef.key][1] = "";
            }
            _markEditorChanged();
            renderEquipmentPanel();
            _renderSkills();
          }, { items: weaponItems, searchPlaceholder: "Search weapons…" });
        });
      }

      statBtn.addEventListener("click", () => {
        openSlotPicker(statBtn, currentCombo, (newVal) => {
          equip.slots[slotDef.key] = newVal || "";
          _markEditorChanged();
          renderEquipmentPanel();
        });
      });
    }

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

    return wrapper;
  }

  function makeSection(title, { fillSlotKeys, onClear } = {}) {
    const section = document.createElement("div");
    section.className = "equip-section panel";
    const head = document.createElement("div");
    head.className = "equip-section__head";
    const titleEl = document.createElement("span");
    titleEl.textContent = title;
    head.append(titleEl);
    const btnGroup = document.createElement("div");
    btnGroup.className = "equip-section__btns";
    if (fillSlotKeys && fillSlotKeys.length) {
      const fillBtn = document.createElement("button");
      fillBtn.type = "button";
      fillBtn.className = "equip-fill-btn";
      fillBtn.textContent = "Fill All";
      fillBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openSlotPicker(fillBtn, "", (newVal) => {
          if (newVal === "") return;
          for (const key of fillSlotKeys) state.editor.equipment.slots[key] = newVal;
          _markEditorChanged();
          renderEquipmentPanel();
        });
      });
      btnGroup.append(fillBtn);
    }
    if (onClear) {
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "equip-fill-btn equip-clear-btn";
      clearBtn.textContent = "Clear";
      clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        onClear();
        _markEditorChanged();
        renderEquipmentPanel();
      });
      btnGroup.append(clearBtn);
    }
    head.append(btnGroup);
    section.append(head);
    return section;
  }

  function makeTextInput(labelText, value, placeholder, onChange) {
    const label = document.createElement("label");
    label.className = "equip-text-label";
    const span = document.createElement("span");
    span.textContent = labelText;
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.placeholder = placeholder;
    input.addEventListener("input", () => onChange(input.value));
    label.append(span, input);
    return label;
  }

  // === LEFT COLUMN ===
  const leftCol = document.createElement("div");
  leftCol.className = "equip-col equip-col--left";

  // Clear All button
  const clearAllBtn = document.createElement("button");
  clearAllBtn.type = "button";
  clearAllBtn.className = "equip-fill-btn equip-clear-btn equip-clear-all-btn";
  clearAllBtn.textContent = "Clear All Equipment";
  clearAllBtn.addEventListener("click", () => {
    for (const key of Object.keys(equip.slots)) equip.slots[key] = "";
    for (const key of Object.keys(equip.weapons)) equip.weapons[key] = "";
    equip.runeSet = "";
    equip.relic = "";
    equip.food = "";
    equip.utility = "";
    _markEditorChanged();
    renderEquipmentPanel();
  });

  // Armor
  const armorKeys = EQUIP_ARMOR_SLOTS.map((s) => s.key);
  const armorSection = makeSection("Armor", {
    fillSlotKeys: armorKeys,
    onClear: () => { for (const key of armorKeys) equip.slots[key] = ""; },
  });
  for (const slotDef of EQUIP_ARMOR_SLOTS) armorSection.append(makeSlot(slotDef));
  leftCol.append(armorSection);

  // Weapons
  const weaponKeys = EQUIP_WEAPON_SETS.flat().map((s) => s.key);
  const weaponSection = makeSection("Weapons", {
    onClear: () => {
      for (const key of weaponKeys) { equip.slots[key] = ""; equip.weapons[key] = ""; }
    },
  });
  EQUIP_WEAPON_SETS.forEach((setSlots, i) => {
    const setLabel = document.createElement("div");
    setLabel.className = "equip-set-label";
    setLabel.textContent = `Set ${i + 1}`;
    weaponSection.append(setLabel);
    for (const slotDef of setSlots) weaponSection.append(makeWeaponSlot(slotDef));
  });
  leftCol.append(weaponSection);

  // Consumables
  const consumeSection = makeSection("Consumables", {
    onClear: () => { equip.food = ""; equip.utility = ""; },
  });

  const foodItems = [
    { value: "", label: "— None —" },
    ...GW2_FOOD.map((f) => ({ value: f.label, label: f.label, icon: f.icon, subtitle: f.buff.replace(/\|/g, "·") })),
  ];
  const utilityItems = [
    { value: "", label: "— None —" },
    ...GW2_UTILITY.map((u) => ({ value: u.label, label: u.label, icon: u.icon, subtitle: u.buff.replace(/\|/g, "·") })),
  ];

  function makeConsumableSlot({ field, label, items, searchPlaceholder, hoverKind, defaultIcon, getDefByLabel }) {
    const current = equip[field] || "";
    const def = getDefByLabel(current);
    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--compact";
    wrapper.setAttribute("role", "button");
    wrapper.tabIndex = 0;

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--weapon" + (current ? " equip-slot__icon--filled" : "");
    const img = document.createElement("img");
    img.src = def ? def.icon : defaultIcon;
    img.alt = def ? def.label : label;
    img.draggable = false;
    img.addEventListener("error", () => img.remove());
    iconDiv.append(img);

    const info = document.createElement("div");
    info.className = "equip-slot__info";
    const labelEl = document.createElement("div");
    labelEl.className = "equip-slot__label";
    labelEl.textContent = label;
    const valueEl = document.createElement("div");
    valueEl.className = "equip-slot__combo-name" + (current ? "" : " equip-slot__value--empty");
    valueEl.style.fontSize = "10px";
    valueEl.textContent = current || "Select…";
    info.append(labelEl, valueEl);
    wrapper.append(iconDiv, info);

    const doOpen = () => openSlotPicker(wrapper, current, (newVal) => {
      equip[field] = newVal || "";
      _markEditorChanged();
      renderEquipmentPanel();
    }, { items, searchPlaceholder });
    wrapper.addEventListener("click", doOpen);
    wrapper.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doOpen(); } });

    bindHoverPreview(wrapper, hoverKind, () => {
      const d = getDefByLabel(equip[field] || "");
      if (!d) return null;
      return { name: d.label, icon: d.icon, description: d.buff.split(" | ").join("\n") };
    });

    return wrapper;
  }

  consumeSection.append(
    makeConsumableSlot({
      field: "food", label: "Food", items: foodItems, searchPlaceholder: "Search food…",
      hoverKind: "equip-food", defaultIcon: `${_WK}/6/6b/Nourishment.png`,
      getDefByLabel: (v) => GW2_FOOD_BY_LABEL.get(v),
    }),
    makeConsumableSlot({
      field: "utility", label: "Utility", items: utilityItems, searchPlaceholder: "Search utility…",
      hoverKind: "equip-utility", defaultIcon: `${_WK}/d/d6/Enhancement.png`,
      getDefByLabel: (v) => GW2_UTILITY_BY_LABEL.get(v),
    }),
  );
  leftCol.append(consumeSection);

  // Notes
  const notesSection = makeSection("Notes");
  const notesTA = document.createElement("textarea");
  notesTA.id = "notesInput";
  notesTA.className = "equip-notes";
  notesTA.rows = 4;
  notesTA.value = state.editor.notes || "";
  notesTA.placeholder = "Combo priorities, matchup notes, rotation...";
  notesTA.addEventListener("input", () => {
    state.editor.notes = notesTA.value;
    _markEditorChanged({ updateBuildList: true });
  });
  notesSection.append(notesTA);
  leftCol.append(notesSection);

  // === RIGHT COLUMN ===
  const rightCol = document.createElement("div");
  rightCol.className = "equip-col equip-col--right";

  // Attributes
  const statsSection = makeSection("Attributes");
  const computed = computeEquipmentStats();
  const professionName = state.editor.profession;
  const baseHP = PROFESSION_BASE_HP[professionName] || 9212;
  const health = baseHP + (computed.Vitality || 0) * 10;
  const critChance = Math.min(100, 5 + ((computed.Precision || 1000) - 895) / 21.0);
  const critDamage = 150 + (computed.Ferocity || 0) / 15.0;
  const condDuration = (computed.Expertise || 0) / 15.0;
  const boonDuration = (computed.Concentration || 0) / 15.0;

  const statRows = [
    { stat: "Power",           value: computed.Power },
    { stat: "Precision",       value: computed.Precision,       derived: "Crit Chance",      derivedVal: `${critChance.toFixed(1)}%` },
    { stat: "Toughness",       value: computed.Toughness },
    { stat: "Vitality",        value: computed.Vitality,        derived: "Health",            derivedVal: health.toLocaleString() },
    { stat: "Ferocity",        value: computed.Ferocity,        derived: "Crit Damage",       derivedVal: `${critDamage.toFixed(0)}%` },
    { stat: "Condition Dmg",   value: computed.ConditionDamage },
    { stat: "Expertise",       value: computed.Expertise,       derived: "Cond. Duration",    derivedVal: `${condDuration.toFixed(1)}%` },
    { stat: "Concentration",   value: computed.Concentration,   derived: "Boon Duration",     derivedVal: `${boonDuration.toFixed(1)}%` },
    { stat: "Healing Power",   value: computed.HealingPower },
  ];

  const statsGrid = document.createElement("div");
  statsGrid.className = "equip-stats";
  for (const row of statRows) {
    const rowEl = document.createElement("div");
    rowEl.className = "equip-stat-row";

    const leftEl = document.createElement("div");
    leftEl.className = "equip-stat-cell";
    leftEl.innerHTML = `<span class="equip-stat-label">${row.stat}</span><span class="equip-stat-value">${(row.value || 0).toLocaleString()}</span>`;

    rowEl.append(leftEl);

    if (row.derived) {
      const rightEl = document.createElement("div");
      rightEl.className = "equip-stat-cell equip-stat-cell--derived";
      rightEl.innerHTML = `<span class="equip-stat-label">${row.derived}</span><span class="equip-stat-value equip-stat-value--derived">${row.derivedVal}</span>`;
      rowEl.append(rightEl);
    }

    statsGrid.append(rowEl);
  }
  statsSection.append(statsGrid);
  rightCol.append(statsSection);

  // Upgrades (rune only now — relic moved to trinkets row)
  const upgradesSection = makeSection("Upgrades", {
    onClear: () => { equip.runeSet = ""; },
  });
  upgradesSection.append(
    makeTextInput("Rune", equip.runeSet, "Rune of the Scholar", (v) => { equip.runeSet = v; _markEditorChanged(); }),
  );
  rightCol.append(upgradesSection);

  // Trinkets — row1 (4 cols): Back, Accessory 1, Accessory 2, Relic
  //            row2 (3 cols): Amulet, Ring 1, Ring 2
  const relicItems = [
    { value: "", label: "— None —" },
    ...GW2_RELICS.map((r) => ({ value: r.label, label: r.label, icon: r.icon })),
  ];

  function makeRelicSlot() {
    const currentRelic = equip.relic || "";
    const relicDef = GW2_RELICS_BY_LABEL.get(currentRelic);
    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--compact";
    wrapper.setAttribute("role", "button");
    wrapper.tabIndex = 0;

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--weapon" + (currentRelic ? " equip-slot__icon--filled" : "");
    const img = document.createElement("img");
    img.src = relicDef
      ? relicDef.icon
      : "https://wiki.guildwars2.com/wiki/Special:FilePath/Relic_slot.png";
    img.alt = relicDef ? relicDef.label : "Relic";
    img.draggable = false;
    img.addEventListener("error", () => img.remove());
    iconDiv.append(img);

    const info = document.createElement("div");
    info.className = "equip-slot__info";
    const labelEl = document.createElement("div");
    labelEl.className = "equip-slot__label";
    labelEl.textContent = "Relic";
    const valueEl = document.createElement("div");
    valueEl.className = "equip-slot__combo-name" + (currentRelic ? "" : " equip-slot__value--empty");
    valueEl.style.fontSize = "10px";
    valueEl.textContent = currentRelic
      ? currentRelic.replace("Relic of ", "").replace("Relic of the ", "the ")
      : "Select…";
    info.append(labelEl, valueEl);
    wrapper.append(iconDiv, info);

    const doOpen = () => openSlotPicker(wrapper, currentRelic, (newVal) => {
      equip.relic = newVal || "";
      _markEditorChanged();
      renderEquipmentPanel();
    }, { items: relicItems, searchPlaceholder: "Search relics…" });
    wrapper.addEventListener("click", doOpen);
    wrapper.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doOpen(); } });

    bindHoverPreview(wrapper, "equip-relic", () => {
      const rDef = GW2_RELICS_BY_LABEL.get(equip.relic || "");
      if (!rDef) return null;
      return { name: rDef.label, icon: rDef.icon, description: "" };
    });

    return wrapper;
  }

  const allTrinketKeys = ["back", "accessory1", "accessory2", "amulet", "ring1", "ring2"];
  const trinketSection = makeSection("Trinkets", {
    fillSlotKeys: allTrinketKeys,
    onClear: () => {
      for (const key of allTrinketKeys) equip.slots[key] = "";
      equip.relic = "";
    },
  });

  const trinketRow1 = document.createElement("div");
  trinketRow1.className = "equip-trinket-grid equip-trinket-grid--4";
  for (const key of ["back", "accessory1", "accessory2"]) {
    const slotDef = EQUIP_TRINKET_SLOTS.find((s) => s.key === key);
    if (slotDef) trinketRow1.append(makeSlot(slotDef, { compact: true }));
  }
  trinketRow1.append(makeRelicSlot());

  const trinketRow2 = document.createElement("div");
  trinketRow2.className = "equip-trinket-grid";
  for (const key of ["amulet", "ring1", "ring2"]) {
    const slotDef = EQUIP_TRINKET_SLOTS.find((s) => s.key === key);
    if (slotDef) trinketRow2.append(makeSlot(slotDef, { compact: true }));
  }

  trinketSection.append(trinketRow1, trinketRow2);
  rightCol.append(trinketSection);

  // Underwater
  const underwaterKeys = EQUIP_UNDERWATER_SLOTS.map((s) => s.key);
  const underwaterSection = makeSection("Underwater", {
    onClear: () => {
      for (const key of underwaterKeys) {
        equip.slots[key] = "";
        if (equip.weapons[key] !== undefined) equip.weapons[key] = "";
      }
    },
  });
  for (const slotDef of EQUIP_UNDERWATER_SLOTS) {
    underwaterSection.append(slotDef.hand === "aquatic" ? makeWeaponSlot(slotDef, { isAquatic: true }) : makeSlot(slotDef));
  }
  rightCol.append(underwaterSection);

  // Center: profession concept art
  const artCol = document.createElement("div");
  artCol.className = "equip-col equip-col--art";
  const artUrl = PROFESSION_CONCEPT_ART[state.editor.profession];
  if (artUrl) {
    const artImg = document.createElement("img");
    artImg.className = "equip-concept-art";
    artImg.src = artUrl;
    artImg.alt = state.editor.profession || "";
    artImg.draggable = false;
    artCol.append(artImg);
  }

  // Layout
  const layout = document.createElement("div");
  layout.className = "equip-layout";
  layout.append(leftCol, artCol, rightCol);
  panel.append(clearAllBtn, layout);
  updateHealthOrb();
}
