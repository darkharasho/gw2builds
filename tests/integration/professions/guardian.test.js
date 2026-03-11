"use strict";

const { setupHarness } = require("./harness");

describe("Guardian — end-to-end profession mechanics", () => {
  const h = setupHarness("Guardian");

  // ---------------------------------------------------------------------------
  // Catalog loading
  // ---------------------------------------------------------------------------

  test("catalog loads with Guardian profession data", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.profession.id).toBe("Guardian");
    expect(catalog.skills.length).toBeGreaterThan(0);
  });

  test("catalog includes all Guardian elite specs", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.specializationById.has(27)).toBe(true); // Dragonhunter
    expect(catalog.specializationById.has(62)).toBe(true); // Firebrand
    expect(catalog.specializationById.has(65)).toBe(true); // Willbender
    expect(catalog.specializationById.has(81)).toBe(true); // Luminary
  });

  // ---------------------------------------------------------------------------
  // Skill options per spec
  // ---------------------------------------------------------------------------

  test("core Guardian skill options include heal and elite", async () => {
    const catalog = await h.loadCatalog();
    const opts = h.skillOptions(catalog, 0);
    expect(opts.heal[0].id).toBe(9083); // Shelter
  });

  test("Dragonhunter F-skills appear in profession options when spec is active", async () => {
    const catalog = await h.loadCatalog();
    const opts = h.skillOptions(catalog, 27);
    const profIds = opts.profession.map((s) => s.id);
    expect(profIds).toContain(29887); // Hunter's Ward (F1)
    expect(profIds).toContain(30783); // Test of Faith (F2)
    expect(profIds).toContain(30029); // Fragments of Faith (F3)
  });

  test("Firebrand tome skills appear in profession options when spec is active", async () => {
    const catalog = await h.loadCatalog();
    const opts = h.skillOptions(catalog, 62);
    const profIds = opts.profession.map((s) => s.id);
    expect(profIds).toContain(44364); // Tome of Justice
    expect(profIds).toContain(41780); // Tome of Resolve
    expect(profIds).toContain(42259); // Tome of Courage
  });

  test("Dragonhunter F-skills are not in options without that spec", async () => {
    const catalog = await h.loadCatalog();
    const opts = h.skillOptions(catalog, 0);
    const profIds = opts.profession.map((s) => s.id);
    expect(profIds).not.toContain(29887);
  });

  // ---------------------------------------------------------------------------
  // Mechanic slots — all specs
  // ---------------------------------------------------------------------------

  test("core Guardian has no persistent profession mechanic F-slots", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 0)).toEqual([]);
  });

  test("Dragonhunter (spec 27) exposes Hunter's Ward / Test of Faith / Fragments of Faith as F1-F3", async () => {
    const catalog = await h.loadCatalog();
    const sigs = h.resolveMechSlots(catalog, 27);
    expect(sigs).toEqual(["29887", "30783", "30029"]);
  });

  test("Firebrand (spec 62) exposes Tome of Justice / Tome of Resolve / Tome of Courage as F1-F3", async () => {
    const catalog = await h.loadCatalog();
    const sigs = h.resolveMechSlots(catalog, 62);
    expect(sigs).toEqual(["44364", "41780", "42259"]);
  });

  test("Firebrand F-slots differ from Dragonhunter F-slots", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 62)).not.toEqual(h.resolveMechSlots(catalog, 27));
  });

  test("Willbender (spec 65) has no persistent profession mechanic F-slots", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 65)).toEqual([]);
  });

  test("Willbender matches core Guardian mechanic footprint", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 65)).toEqual(h.resolveMechSlots(catalog, 0));
  });

  test("Luminary (spec 81) exposes Enter Radiant Forge (77073) as its F1 mechanic slot", async () => {
    const catalog = await h.loadCatalog();
    const sigs = h.resolveMechSlots(catalog, 81);
    expect(sigs).toEqual(["77073"]);
  });

  // ---------------------------------------------------------------------------
  // Bundle skills — Firebrand tomes and Luminary Radiant Forge
  // ---------------------------------------------------------------------------

  test("Tome of Justice (44364) has a bundle of 5 chapter skills", async () => {
    const catalog = await h.loadCatalog();
    const tome = catalog.skillById.get(44364);
    expect(tome).toBeTruthy();
    expect(Array.isArray(tome.bundleSkills)).toBe(true);
    expect(tome.bundleSkills.length).toBe(5);
    expect(tome.bundleSkills).toContain(41258); // Chapter 1: Searing Spell
    expect(tome.bundleSkills).toContain(42898); // Epilogue: Ashes of the Just
  });

  test("Tome of Resolve (41780) has a bundle of 5 chapter skills", async () => {
    const catalog = await h.loadCatalog();
    const tome = catalog.skillById.get(41780);
    expect(tome).toBeTruthy();
    expect(Array.isArray(tome.bundleSkills)).toBe(true);
    expect(tome.bundleSkills.length).toBe(5);
    expect(tome.bundleSkills).toContain(45022); // Chapter 1: Desert Bloom
    expect(tome.bundleSkills).toContain(42925); // Epilogue: Eternal Oasis
  });

  test("Tome of Courage (42259) has a bundle of 5 chapter skills", async () => {
    const catalog = await h.loadCatalog();
    const tome = catalog.skillById.get(42259);
    expect(tome).toBeTruthy();
    expect(Array.isArray(tome.bundleSkills)).toBe(true);
    expect(tome.bundleSkills.length).toBe(5);
    expect(tome.bundleSkills).toContain(42986); // Chapter 1: Unflinching Charge
    expect(tome.bundleSkills).toContain(44455); // Epilogue: Unbroken Lines
  });

  test("all three Firebrand tomes have distinct chapter bundles", async () => {
    const catalog = await h.loadCatalog();
    const justice = catalog.skillById.get(44364).bundleSkills;
    const resolve  = catalog.skillById.get(41780).bundleSkills;
    const courage  = catalog.skillById.get(42259).bundleSkills;
    expect(justice).not.toEqual(resolve);
    expect(justice).not.toEqual(courage);
    expect(resolve).not.toEqual(courage);
  });

  test("Radiant Forge (77073) has a bundle of 9 weapon skills including Glaring Burst variants", async () => {
    const catalog = await h.loadCatalog();
    const forge = catalog.skillById.get(77073);
    expect(forge).toBeTruthy();
    expect(Array.isArray(forge.bundleSkills)).toBe(true);
    expect(forge.bundleSkills.length).toBe(9);
    expect(forge.bundleSkills).toContain(76950); // Glaring Burst (Weapon_1)
    expect(forge.bundleSkills).toContain(77339); // Radiant Arc (Weapon_2)
    expect(forge.bundleSkills).toContain(76978); // Radiant Storm (Weapon_5)
  });

  test("Radiant Forge flip skills (exit versions) are present in the catalog", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.skillById.has(76910)).toBe(true); // Radiant Forge Exit F1
    expect(catalog.skillById.has(77136)).toBe(true); // Radiant Forge Exit F2
    expect(catalog.skillById.has(77366)).toBe(true); // Radiant Forge Exit F3
  });

  // ---------------------------------------------------------------------------
  // Weapon skill resolution
  // ---------------------------------------------------------------------------

  test("Sword Weapon_1 resolves to Symbol of Blades", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "sword", "", "");
    expect(slots[0]).not.toBeNull();
    expect(slots[0].id).toBe(9104); // Symbol of Blades
  });
});
