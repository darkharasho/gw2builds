"use strict";

/**
 * Elementalist integration tests — focuses on Weaver's unique dual-attunement
 * weapon skill mechanics (slot 3 dual-attack) and attunement button F-skills,
 * as well as Tempest's mechanic footprint.
 *
 * GW2 wiki reference — Weaver:
 *   Dual attacks occupy weapon slot 3 and are determined by the combination of
 *   the two active attunements. The skill changes when attunements differ
 *   (dual-attunement mode); same-element attunement uses a regular slot-3 skill.
 *   F1-F4 are the four attunement-swap buttons (Fire/Water/Air/Earth).
 */

const { setupHarness } = require("./harness");

describe("Elementalist — end-to-end profession mechanics", () => {
  const h = setupHarness("Elementalist");

  // ---------------------------------------------------------------------------
  // Catalog loading
  // ---------------------------------------------------------------------------

  test("catalog loads with Elementalist profession data", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.profession.id).toBe("Elementalist");
    expect(catalog.skills.length).toBeGreaterThan(0);
    expect(catalog.weaponSkills.length).toBeGreaterThan(0);
  });

  test("catalog includes all Elementalist elite specs", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.specializationById.has(48)).toBe(true); // Tempest
    expect(catalog.specializationById.has(56)).toBe(true); // Weaver
  });

  test("catalog weaponSkillById contains Weaver dual-attack skills", async () => {
    const catalog = await h.loadCatalog();
    // These are in weaponSkillById because we reference them in the Staff weapon fixture
    expect(catalog.weaponSkillById.has(76585)).toBe(true); // Aqua Surge (Water+Fire)
    expect(catalog.weaponSkillById.has(76811)).toBe(true); // Earthen Vortex (Earth+Air)
    expect(catalog.weaponSkillById.has(77089)).toBe(true); // Plasma Burst (Fire+Air)
    expect(catalog.weaponSkillById.has(76707)).toBe(true); // Seismic Impact (Earth+Water)
  });

  test("Weaver dual-attack skills have dualWield field set", async () => {
    const catalog = await h.loadCatalog();
    const aquaSurge = catalog.weaponSkillById.get(76585);
    expect(aquaSurge.dualWield).toBeTruthy();
    expect(aquaSurge.dualWield.toLowerCase()).toBe("fire"); // secondary attunement
    expect(aquaSurge.attunement.toLowerCase()).toBe("water"); // primary attunement
  });

  // ---------------------------------------------------------------------------
  // Mechanic slots — all specs
  // ---------------------------------------------------------------------------

  test("core Elementalist has no persistent profession mechanic F-slots", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 0)).toEqual([]);
  });

  test("Tempest (spec 48) has no additional persistent profession mechanic F-slots", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 48)).toEqual([]);
  });

  test("Weaver (spec 56) exposes four attunement swap buttons as mechanic F1-F4 slots", async () => {
    const catalog = await h.loadCatalog();
    const sigs = h.resolveMechSlots(catalog, 56);
    // Fire(76703) / Water(76988) / Air(76580) / Earth(77082)
    expect(sigs).toEqual(["76703", "76988", "76580", "77082"]);
  });

  test("Weaver has more mechanic F-slots than core and Tempest", async () => {
    const catalog = await h.loadCatalog();
    const core    = h.resolveMechSlots(catalog, 0);
    const tempest = h.resolveMechSlots(catalog, 48);
    const weaver  = h.resolveMechSlots(catalog, 56);
    expect(weaver.length).toBeGreaterThan(core.length);
    expect(weaver.length).toBeGreaterThan(tempest.length);
  });

  // ---------------------------------------------------------------------------
  // Weaver F-skill options — attunement swap buttons
  // ---------------------------------------------------------------------------

  test("Weaver spec enables all four attunement buttons in profession options", async () => {
    const catalog = await h.loadCatalog();
    const opts = h.skillOptions(catalog, 56);
    const profIds = opts.profession.map((s) => s.id);
    expect(profIds).toContain(76703); // Fire Attunement  → Profession_1
    expect(profIds).toContain(76988); // Water Attunement → Profession_2
    expect(profIds).toContain(76580); // Air Attunement   → Profession_3
    expect(profIds).toContain(77082); // Earth Attunement → Profession_4
  });

  test("attunement buttons occupy the correct Profession_N slot numbers", async () => {
    const catalog = await h.loadCatalog();
    const opts = h.skillOptions(catalog, 56);
    const byId = Object.fromEntries(opts.profession.map((s) => [s.id, s.slot]));
    expect(byId[76703]).toBe("Profession_1"); // Fire
    expect(byId[76988]).toBe("Profession_2"); // Water
    expect(byId[76580]).toBe("Profession_3"); // Air
    expect(byId[77082]).toBe("Profession_4"); // Earth
  });

  test("core Elementalist does not see Weaver-gated attunement buttons", async () => {
    const catalog = await h.loadCatalog();
    const opts = h.skillOptions(catalog, 0);
    const profIds = opts.profession.map((s) => s.id);
    expect(profIds).not.toContain(76703);
    expect(profIds).not.toContain(76988);
  });

  // ---------------------------------------------------------------------------
  // Weaver dual-attunement weapon skill (slot 3)
  // ---------------------------------------------------------------------------

  test("Weaver Staff Water+Fire attunement pair yields Aqua Surge (76585) on slot 3", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "staff", "", "Water", "Fire", true);
    expect(slots[2]).not.toBeNull();
    expect(slots[2].id).toBe(76585);
    expect(slots[2].name).toBe("Aqua Surge");
  });

  test("Weaver Staff Fire+Air attunement pair yields Plasma Burst (77089) on slot 3", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "staff", "", "Fire", "Air", true);
    expect(slots[2]).not.toBeNull();
    expect(slots[2].id).toBe(77089);
    expect(slots[2].name).toBe("Plasma Burst");
  });

  test("Weaver Staff Earth+Air attunement pair yields Earthen Vortex (76811) on slot 3", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "staff", "", "Earth", "Air", true);
    expect(slots[2]).not.toBeNull();
    expect(slots[2].id).toBe(76811);
    expect(slots[2].name).toBe("Earthen Vortex");
  });

  test("Weaver Staff Earth+Water attunement pair yields Seismic Impact (76707) on slot 3", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "staff", "", "Earth", "Water", true);
    expect(slots[2]).not.toBeNull();
    expect(slots[2].id).toBe(76707);
    expect(slots[2].name).toBe("Seismic Impact");
  });

  test("Weaver dual-attack is order-independent: Water+Fire and Fire+Water yield the same skill", async () => {
    const catalog = await h.loadCatalog();
    const wf = h.resolveWeaponSlots(catalog, "staff", "", "Water", "Fire", true);
    const fw = h.resolveWeaponSlots(catalog, "staff", "", "Fire", "Water", true);
    expect(wf[2]?.id).toBe(fw[2]?.id);
    expect(wf[2]?.id).toBe(76585); // Aqua Surge
  });

  test("Weaver Earth+Air and Air+Earth yield the same dual-attack skill (order-independent)", async () => {
    const catalog = await h.loadCatalog();
    const ea = h.resolveWeaponSlots(catalog, "staff", "", "Earth", "Air", true);
    const ae = h.resolveWeaponSlots(catalog, "staff", "", "Air", "Earth", true);
    expect(ea[2]?.id).toBe(ae[2]?.id);
  });

  test("Weaver same-element mode (Fire+Fire) does not produce a dual-attack skill on slot 3", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "staff", "", "Fire", "Fire", true);
    // In single-attunement mode, slot 3 uses the regular weapon_3 skill or null
    // Dual-attack logic is only invoked when att1 !== att2
    if (slots[2]) {
      expect(slots[2].dualWield).toBeFalsy(); // must not be a dual-attack skill
    } else {
      expect(slots[2]).toBeNull(); // fixture only has Weapon_1 for Fire, so null is correct
    }
  });

  test("non-Weaver Elementalist (isWeaver=false) ignores second attunement for slot 3", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "staff", "", "Fire", "Water", false);
    // Without Weaver flag, dual-attack logic is not activated
    if (slots[2]) {
      expect(slots[2].dualWield).toBeFalsy();
    } else {
      expect(slots[2]).toBeNull();
    }
  });

  // ---------------------------------------------------------------------------
  // Weapon skill resolution — base attunement slots
  // ---------------------------------------------------------------------------

  test("Elementalist Staff Fire Weapon_1 resolves to Fire Attunement (Staff) skill", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "staff", "", "Fire", "", false);
    expect(slots[0]).not.toBeNull();
    expect(slots[0].id).toBe(5507);
  });
});
