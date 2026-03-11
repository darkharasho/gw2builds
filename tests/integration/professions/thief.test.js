"use strict";

const { setupHarness } = require("./harness");

describe("Thief — end-to-end profession mechanics", () => {
  const h = setupHarness("Thief");

  // ---------------------------------------------------------------------------
  // Catalog loading
  // ---------------------------------------------------------------------------

  test("catalog loads with Thief profession data", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.profession.id).toBe("Thief");
    expect(catalog.skills.length).toBeGreaterThan(0);
  });

  test("catalog includes all Thief elite specs", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.specializationById.has(44)).toBe(true); // Daredevil
    expect(catalog.specializationById.has(58)).toBe(true); // Deadeye
    expect(catalog.specializationById.has(71)).toBe(true); // Specter
    expect(catalog.specializationById.has(77)).toBe(true); // Antiquary
  });

  // ---------------------------------------------------------------------------
  // Skill options per spec
  // ---------------------------------------------------------------------------

  test("Antiquary spec enables Mistburn Mortar and Zephyrite Sun Crystal in profession options", async () => {
    const catalog = await h.loadCatalog();
    const opts = h.skillOptions(catalog, 77);
    const profIds = opts.profession.map((s) => s.id);
    expect(profIds).toContain(77288); // Mistburn Mortar (Antiquary F2)
    expect(profIds).toContain(78309); // Zephyrite Sun Crystal (Antiquary F3)
  });

  test("Specter spec enables its F-slot skills in profession options", async () => {
    const catalog = await h.loadCatalog();
    const opts = h.skillOptions(catalog, 71);
    const profIds = opts.profession.map((s) => s.id);
    expect(profIds).toContain(63067); // Specter Siphon (F1)
    expect(profIds).toContain(63155); // Specter Shadow Shroud (F2)
  });

  test("Antiquary-locked stolen skills do not appear in options without Antiquary spec", async () => {
    const catalog = await h.loadCatalog();
    const coreOpts = h.skillOptions(catalog, 0);
    const coreProfIds = coreOpts.profession.map((s) => s.id);
    expect(coreProfIds).not.toContain(77288);
    expect(coreProfIds).not.toContain(78309);
  });

  // ---------------------------------------------------------------------------
  // Mechanic slots — all specs (F-skill variations)
  // ---------------------------------------------------------------------------

  test("core Thief has a single F1 Steal slot (13132)", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 0)).toEqual(["13132"]);
  });

  test("Daredevil (spec 44) replaces F1 with Bound (30423)", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 44)).toEqual(["30423"]);
  });

  test("Deadeye (spec 58) replaces F1 with Deadeye's Mark (43390)", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 58)).toEqual(["43390"]);
  });

  test("Daredevil and Deadeye F1 skills differ from each other and from core", async () => {
    const catalog = await h.loadCatalog();
    const core      = h.resolveMechSlots(catalog, 0);
    const daredevil = h.resolveMechSlots(catalog, 44);
    const deadeye   = h.resolveMechSlots(catalog, 58);
    expect(daredevil).not.toEqual(core);
    expect(deadeye).not.toEqual(core);
    expect(daredevil).not.toEqual(deadeye);
  });

  test("Specter (spec 71) exposes Siphon (63067) + Shadow Shroud (63155) as F1+F2", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 71)).toEqual(["63067", "63155"]);
  });

  test("Specter has two persistent F-slots (more than core or Daredevil)", async () => {
    const catalog = await h.loadCatalog();
    const core    = h.resolveMechSlots(catalog, 0);
    const specter = h.resolveMechSlots(catalog, 71);
    expect(specter.length).toBeGreaterThan(core.length);
    expect(specter).toHaveLength(2);
  });

  test("Antiquary (spec 77) keeps core F1 Steal and adds F2 (77288) and F3 (78309)", async () => {
    const catalog = await h.loadCatalog();
    const sigs = h.resolveMechSlots(catalog, 77);
    expect(sigs).toEqual(["13132", "77288", "78309"]);
    expect(sigs[0]).toBe("13132"); // F1 = Steal (retained from core)
  });

  test("Antiquary has three persistent F-slots (most of any Thief spec)", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 77)).toHaveLength(3);
  });

  // ---------------------------------------------------------------------------
  // Shadow Shroud bundle and flip skills (Specter)
  // ---------------------------------------------------------------------------

  test("Specter Shadow Shroud (63155) has a bundle of 7 weapon skills", async () => {
    const catalog = await h.loadCatalog();
    const shroud = catalog.skillById.get(63155);
    expect(shroud).toBeTruthy();
    expect(Array.isArray(shroud.bundleSkills)).toBe(true);
    expect(shroud.bundleSkills.length).toBe(7);
    expect(shroud.bundleSkills).toContain(63362); // Haunt Shot
    expect(shroud.bundleSkills).toContain(63107); // Shadow Bolt
    expect(shroud.bundleSkills).toContain(63167); // Eternal Night
    expect(shroud.bundleSkills).toContain(63220); // Grasping Shadows
    expect(shroud.bundleSkills).toContain(63227); // Rot Wallow Venom
    expect(shroud.bundleSkills).toContain(63160); // Well of Gloom
    expect(shroud.bundleSkills).toContain(63249); // Mind Shock
  });

  test("Enter Shadow Shroud (63155) has flip skill Exit Shadow Shroud (63251)", async () => {
    const catalog = await h.loadCatalog();
    const enter = catalog.skillById.get(63155);
    expect(enter).toBeTruthy();
    expect(enter.flipSkill).toBe(63251);
  });

  test("Exit Shadow Shroud (63251) is present in the catalog as a flip target", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.skillById.has(63251)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Weapon skill resolution
  // ---------------------------------------------------------------------------

  test("Dagger Weapon_1 resolves to the dagger auto-attack", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "dagger", "", "");
    expect(slots[0]).not.toBeNull();
    expect(slots[0].id).toBe(13010);
  });

  test("Pistol offhand Weapon_4 resolves when paired with dagger mainhand", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "dagger", "pistol", "");
    expect(slots[3]).not.toBeNull();
    expect(slots[3].id).toBe(13026);
  });
});
