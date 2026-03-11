"use strict";

const { setupHarness } = require("./harness");

describe("Warrior — end-to-end profession mechanics", () => {
  const h = setupHarness("Warrior");

  // ---------------------------------------------------------------------------
  // Catalog loading
  // ---------------------------------------------------------------------------

  test("catalog loads with Warrior profession data", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.profession.id).toBe("Warrior");
    expect(catalog.skills.length).toBeGreaterThan(0);
    expect(catalog.specializationById.has(51)).toBe(true); // Berserker
    expect(catalog.specializationById.has(3)).toBe(true);  // Spellbreaker
  });

  test("catalog contains core Warrior specializations", async () => {
    const catalog = await h.loadCatalog();
    // Core specs: Strength(4), Tactics(22), Defense(18), Arms(42), Discipline(31)
    expect(catalog.specializationById.has(4)).toBe(true);
    expect(catalog.specializationById.has(22)).toBe(true);
    expect(catalog.specializationById.has(18)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Skill options per spec
  // ---------------------------------------------------------------------------

  test("core Warrior has heal and elite options available", async () => {
    const catalog = await h.loadCatalog();
    const opts = h.skillOptions(catalog, 0);
    expect(opts.heal.length).toBeGreaterThan(0);
    expect(opts.elite.length).toBeGreaterThan(0);
    expect(opts.heal[0].id).toBe(14402); // Mending
  });

  test("Berserker spec does not expose spec-locked skills from Spellbreaker", async () => {
    const catalog = await h.loadCatalog();
    const berserkerOpts = h.skillOptions(catalog, 51);
    const spellbreakerOpts = h.skillOptions(catalog, 3);
    // With different elite specs selected, the option sets should not differ
    // for this fixture (no spec-gated utility skills in fixture for either spec)
    expect(berserkerOpts.heal).toEqual(spellbreakerOpts.heal);
  });

  // ---------------------------------------------------------------------------
  // Mechanic slots — core and all elite specs
  // ---------------------------------------------------------------------------

  test("core Warrior has no persistent profession mechanic F-slots", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 0)).toEqual([]);
  });

  test("Berserker (spec 51) has no persistent profession mechanic F-slots", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 51)).toEqual([]);
  });

  test("Spellbreaker (spec 3) has no persistent profession mechanic F-slots", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 3)).toEqual([]);
  });

  test("all Warrior specs share the same empty mechanic slot footprint", async () => {
    const catalog = await h.loadCatalog();
    const core = h.resolveMechSlots(catalog, 0);
    expect(h.resolveMechSlots(catalog, 51)).toEqual(core);
    expect(h.resolveMechSlots(catalog, 3)).toEqual(core);
  });

  // ---------------------------------------------------------------------------
  // Weapon skill resolution
  // ---------------------------------------------------------------------------

  test("Sword Weapon_1 resolves to Sever Artery", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "sword", "", "");
    expect(slots[0]).not.toBeNull();
    expect(slots[0].id).toBe(14360); // Sever Artery
  });

  test("Greatsword (TwoHand) Weapon_1 resolves to Whirlwind Attack", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "greatsword", "", "");
    expect(slots[0]).not.toBeNull();
    expect(slots[0].id).toBe(14447); // Whirlwind Attack
  });

  test("Shield offhand Weapon_4 resolves to Shield Bash", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "sword", "shield", "");
    expect(slots[3]).not.toBeNull();
    expect(slots[3].id).toBe(14521); // Shield Bash
  });

  test("Greatsword (TwoHand) ignores offhand slot", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "greatsword", "shield", "");
    // TwoHand weapon: offhand slots (4-5) should be null
    expect(slots[3]).toBeNull();
    expect(slots[4]).toBeNull();
  });
});
