import { state } from "./state.js";
import {
  STAT_COMBOS, SLOT_WEIGHTS, EQUIP_ARMOR_SLOTS, EQUIP_WEAPON_SETS,
  EQUIP_TRINKET_SLOTS, EQUIP_UNDERWATER_SLOTS, GW2_WEAPONS,
  GW2_RELICS, GW2_FOOD, GW2_UTILITY, PROFESSION_WEIGHT,
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
  search.addEventListener("input", () => renderPickerList(search.value));
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
      const combo = STAT_COMBOS.find((c) => c.label === currentCombo);
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
      const combo = STAT_COMBOS.find((c) => c.label === currentCombo);
      if (!combo) return null;
      const facts = computeSlotStats(currentCombo, slotDef.key)
        .map(({ stat, value }) => ({ text: stat, value: `+${value}` }));
      return { name: combo.label, icon: imgSrc, description: "", facts, slot: slotDef.label };
    });

    return wrapper;
  }

  function makeWeaponSlot(slotDef) {
    const isOffhand = slotDef.hand === "off";
    const mainhandKey = slotDef.key.replace("offhand", "mainhand");
    const mainhandWeaponId = weapons[mainhandKey] || "";
    const mainhandProfFlags = (state.activeCatalog?.professionWeapons?.[mainhandWeaponId]?.flags) || [];
    const lockedByTwoHanded = isOffhand && (
      mainhandProfFlags.includes("TwoHand") ||
      GW2_WEAPONS.find((w) => w.id === mainhandWeaponId)?.hand === "two"
    );

    const currentWeapon = weapons[slotDef.key] || "";
    const currentCombo = slots[slotDef.key] || "";
    const weaponDef = GW2_WEAPONS.find((w) => w.id === currentWeapon);

    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--weapon" + (lockedByTwoHanded ? " equip-slot--disabled" : "");

    // Weapon type button (left side: icon + name)
    const weaponBtn = document.createElement("button");
    weaponBtn.type = "button";
    weaponBtn.className = "equip-weapon-type-btn";
    weaponBtn.disabled = lockedByTwoHanded;

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--weapon" + (currentWeapon ? " equip-slot__icon--filled" : "");
    const img = document.createElement("img");
    img.src = weaponDef ? weaponDef.icon : "https://wiki.guildwars2.com/images/d/de/Sword_slot.png";
    img.alt = weaponDef ? weaponDef.label : slotDef.label;
    img.draggable = false;
    img.addEventListener("error", () => img.remove());
    iconDiv.append(img);
    const weaponNameSpan = document.createElement("span");
    weaponNameSpan.className = "equip-weapon-name" + (currentWeapon ? "" : " equip-weapon-name--empty");
    weaponNameSpan.textContent = lockedByTwoHanded
      ? "— Two-Handed —"
      : (weaponDef?.label || slotDef.label);

    weaponBtn.append(iconDiv, weaponNameSpan);

    // Stat button (right side)
    const statBtn = document.createElement("button");
    statBtn.type = "button";
    statBtn.className = "equip-stat-pick-btn" + (currentCombo ? "" : " equip-stat-pick-btn--empty");
    statBtn.disabled = lockedByTwoHanded;
    if (currentCombo) {
      const combo = STAT_COMBOS.find((c) => c.label === currentCombo);
      statBtn.innerHTML = `<span class="equip-slot__combo-name">${escapeHtml(currentCombo)}</span>${combo ? `<span class="equip-slot__combo-stats">${combo.stats.join(" · ")}</span>` : ""}`;
    } else {
      statBtn.textContent = "Select stats…";
    }

    wrapper.append(weaponBtn, statBtn);

    bindHoverPreview(weaponBtn, "equip-weapon", () => {
      const wDef = GW2_WEAPONS.find((w) => w.id === (equip.weapons?.[slotDef.key] || ""));
      if (!wDef) return null;
      return { name: wDef.label, icon: wDef.icon, description: "", hand: wDef.hand };
    });

    bindHoverPreview(statBtn, "equip-stat", () => {
      const curCombo = equip.slots?.[slotDef.key] || "";
      const combo = curCombo ? STAT_COMBOS.find((c) => c.label === curCombo) : null;
      if (!combo) return null;
      const facts = computeSlotStats(curCombo, slotDef.key).map(({ stat, value }) => ({ text: stat, value: `+${value}` }));
      return { name: combo.label, icon: "", description: "", facts, slot: slotDef.label };
    });

    if (!lockedByTwoHanded) {
      // Filter weapons for this slot type, restricted to what this profession can equip
      const profWeapons = state.activeCatalog?.professionWeapons || {};
      const weaponItems = [
        { value: "", label: "— Empty —", subtitle: "" },
        ...GW2_WEAPONS.filter((w) => {
          if (w.hand === "aquatic") return false; // aquatic weapons belong in the underwater section
          const wData = profWeapons[w.id];
          if (!wData) return false;
          // Elite spec weapons are now usable by all specs (GW2 balance change)
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
          // If two-handed selected for mainhand, clear the offhand weapon
          const newFlags = profWeapons[newVal]?.flags || [];
          if (newFlags.includes("TwoHand")) {
            const ofKey = slotDef.key.replace("mainhand", "offhand");
            equip.weapons[ofKey] = "";
            equip.slots[ofKey] = "";
          }
          _markEditorChanged();
          renderEquipmentPanel();
          _renderSkills();
        }, { items: weaponItems, searchPlaceholder: "Search weapons…" });
      });

      statBtn.addEventListener("click", () => {
        openSlotPicker(statBtn, currentCombo, (newVal) => {
          equip.slots[slotDef.key] = newVal || "";
          _markEditorChanged();
          renderEquipmentPanel();
        });
      });
    }

    return wrapper;
  }

  function makeAquaticWeaponSlot(slotDef) {
    const currentWeapon = weapons[slotDef.key] || "";
    const currentCombo = slots[slotDef.key] || "";
    const weaponDef = GW2_WEAPONS.find((w) => w.id === currentWeapon);

    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--weapon";

    const weaponBtn = document.createElement("button");
    weaponBtn.type = "button";
    weaponBtn.className = "equip-weapon-type-btn";

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--weapon" + (currentWeapon ? " equip-slot__icon--filled" : "");
    {
      const img = document.createElement("img");
      img.src = weaponDef ? weaponDef.icon : `${_WK}/3/3f/Aquatic_weapon_slot.png`;
      img.alt = weaponDef ? weaponDef.label : slotDef.label;
      img.draggable = false;
      img.addEventListener("error", () => img.remove());
      iconDiv.append(img);
    }
    const weaponNameSpan = document.createElement("span");
    weaponNameSpan.className = "equip-weapon-name" + (currentWeapon ? "" : " equip-weapon-name--empty");
    weaponNameSpan.textContent = weaponDef?.label || slotDef.label;
    weaponBtn.append(iconDiv, weaponNameSpan);

    const statBtn = document.createElement("button");
    statBtn.type = "button";
    statBtn.className = "equip-stat-pick-btn" + (currentCombo ? "" : " equip-stat-pick-btn--empty");
    if (currentCombo) {
      const combo = STAT_COMBOS.find((c) => c.label === currentCombo);
      statBtn.innerHTML = `<span class="equip-slot__combo-name">${escapeHtml(currentCombo)}</span>${combo ? `<span class="equip-slot__combo-stats">${combo.stats.join(" · ")}</span>` : ""}`;
    } else {
      statBtn.textContent = "Select stats…";
    }

    wrapper.append(weaponBtn, statBtn);

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
    statBtn.addEventListener("click", () => {
      openSlotPicker(statBtn, currentCombo, (newVal) => {
        equip.slots[slotDef.key] = newVal || "";
        _markEditorChanged();
        renderEquipmentPanel();
      });
    });

    return wrapper;
  }

  function makeSection(title, fillSlotKeys) {
    const section = document.createElement("div");
    section.className = "equip-section panel";
    const head = document.createElement("div");
    head.className = "equip-section__head";
    const titleEl = document.createElement("span");
    titleEl.textContent = title;
    head.append(titleEl);
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
      head.append(fillBtn);
    }
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

  // Armor
  const armorSection = makeSection("Armor", EQUIP_ARMOR_SLOTS.map((s) => s.key));
  for (const slotDef of EQUIP_ARMOR_SLOTS) armorSection.append(makeSlot(slotDef));
  leftCol.append(armorSection);

  // Weapons
  const weaponSection = makeSection("Weapons");
  EQUIP_WEAPON_SETS.forEach((setSlots, i) => {
    const setLabel = document.createElement("div");
    setLabel.className = "equip-set-label";
    setLabel.textContent = `Set ${i + 1}`;
    weaponSection.append(setLabel);
    for (const slotDef of setSlots) weaponSection.append(makeWeaponSlot(slotDef));
  });
  leftCol.append(weaponSection);

  // Consumables
  const consumeSection = makeSection("Consumables");

  const foodItems = [
    { value: "", label: "— None —" },
    ...GW2_FOOD.map((f) => ({ value: f.label, label: f.label, icon: f.icon, subtitle: f.buff.replace(/\|/g, "·") })),
  ];

  function makeFoodSlot() {
    const currentFood = equip.food || "";
    const foodDef = GW2_FOOD.find((f) => f.label === currentFood);
    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--compact";
    wrapper.setAttribute("role", "button");
    wrapper.tabIndex = 0;

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--weapon" + (currentFood ? " equip-slot__icon--filled" : "");
    const img = document.createElement("img");
    img.src = foodDef ? foodDef.icon : `${_WK}/6/6b/Nourishment.png`;
    img.alt = foodDef ? foodDef.label : "Food";
    img.draggable = false;
    img.addEventListener("error", () => img.remove());
    iconDiv.append(img);

    const info = document.createElement("div");
    info.className = "equip-slot__info";
    const labelEl = document.createElement("div");
    labelEl.className = "equip-slot__label";
    labelEl.textContent = "Food";
    const valueEl = document.createElement("div");
    valueEl.className = "equip-slot__combo-name" + (currentFood ? "" : " equip-slot__value--empty");
    valueEl.style.fontSize = "10px";
    valueEl.textContent = currentFood || "Select…";
    info.append(labelEl, valueEl);
    wrapper.append(iconDiv, info);

    const doOpen = () => openSlotPicker(wrapper, currentFood, (newVal) => {
      equip.food = newVal || "";
      _markEditorChanged();
      renderEquipmentPanel();
    }, { items: foodItems, searchPlaceholder: "Search food…" });
    wrapper.addEventListener("click", doOpen);
    wrapper.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doOpen(); } });

    bindHoverPreview(wrapper, "equip-food", () => {
      const fDef = GW2_FOOD.find((f) => f.label === (equip.food || ""));
      if (!fDef) return null;
      return { name: fDef.label, icon: fDef.icon, description: fDef.buff.split(" | ").join("\n") };
    });

    return wrapper;
  }

  const utilityItems = [
    { value: "", label: "— None —" },
    ...GW2_UTILITY.map((u) => ({ value: u.label, label: u.label, icon: u.icon, subtitle: u.buff.replace(/\|/g, "·") })),
  ];

  function makeUtilitySlot() {
    const currentUtility = equip.utility || "";
    const utilityDef = GW2_UTILITY.find((u) => u.label === currentUtility);
    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--compact";
    wrapper.setAttribute("role", "button");
    wrapper.tabIndex = 0;

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--weapon" + (currentUtility ? " equip-slot__icon--filled" : "");
    const img = document.createElement("img");
    img.src = utilityDef ? utilityDef.icon : `${_WK}/d/d6/Enhancement.png`;
    img.alt = utilityDef ? utilityDef.label : "Utility";
    img.draggable = false;
    img.addEventListener("error", () => img.remove());
    iconDiv.append(img);

    const info = document.createElement("div");
    info.className = "equip-slot__info";
    const labelEl = document.createElement("div");
    labelEl.className = "equip-slot__label";
    labelEl.textContent = "Utility";
    const valueEl = document.createElement("div");
    valueEl.className = "equip-slot__combo-name" + (currentUtility ? "" : " equip-slot__value--empty");
    valueEl.style.fontSize = "10px";
    valueEl.textContent = currentUtility || "Select…";
    info.append(labelEl, valueEl);
    wrapper.append(iconDiv, info);

    const doOpen = () => openSlotPicker(wrapper, currentUtility, (newVal) => {
      equip.utility = newVal || "";
      _markEditorChanged();
      renderEquipmentPanel();
    }, { items: utilityItems, searchPlaceholder: "Search utility…" });
    wrapper.addEventListener("click", doOpen);
    wrapper.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doOpen(); } });

    bindHoverPreview(wrapper, "equip-utility", () => {
      const uDef = GW2_UTILITY.find((u) => u.label === (equip.utility || ""));
      if (!uDef) return null;
      return { name: uDef.label, icon: uDef.icon, description: uDef.buff.split(" | ").join("\n") };
    });

    return wrapper;
  }

  consumeSection.append(makeFoodSlot(), makeUtilitySlot());
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
  const upgradesSection = makeSection("Upgrades");
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
    const relicDef = GW2_RELICS.find((r) => r.label === currentRelic);
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
      const rDef = GW2_RELICS.find((r) => r.label === (equip.relic || ""));
      if (!rDef) return null;
      return { name: rDef.label, icon: rDef.icon, description: "" };
    });

    return wrapper;
  }

  const allTrinketKeys = ["back", "accessory1", "accessory2", "amulet", "ring1", "ring2"];
  const trinketSection = makeSection("Trinkets", allTrinketKeys);

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
  const underwaterSection = makeSection("Underwater");
  for (const slotDef of EQUIP_UNDERWATER_SLOTS) {
    underwaterSection.append(slotDef.hand === "aquatic" ? makeAquaticWeaponSlot(slotDef) : makeSlot(slotDef));
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
  panel.append(layout);
  updateHealthOrb();
}
