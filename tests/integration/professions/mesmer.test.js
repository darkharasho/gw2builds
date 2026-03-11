"use strict";

const { setupHarness } = require("./harness");

describe("Mesmer — end-to-end profession mechanics", () => {
  const h = setupHarness("Mesmer");

  // ---------------------------------------------------------------------------
  // Catalog loading
  // ---------------------------------------------------------------------------

  test("catalog loads with Mesmer profession data", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.profession.id).toBe("Mesmer");
    expect(catalog.skills.length).toBeGreaterThan(0);
  });

  test("catalog includes all Mesmer elite specs", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.specializationById.has(59)).toBe(true); // Chronomancer
    expect(catalog.specializationById.has(61)).toBe(true); // Mirage
  });

  // ---------------------------------------------------------------------------
  // Skill options
  // ---------------------------------------------------------------------------

  test("core Mesmer skill options include heal and elite", async () => {
    const catalog = await h.loadCatalog();
    const opts = h.skillOptions(catalog, 0);
    expect(opts.heal[0].id).toBe(10213); // Ether Feast
  });

  test("shatter skills (10192/10267/10191/10197) appear in profession options for all specs", async () => {
    const catalog = await h.loadCatalog();
    for (const specId of [0, 59, 61]) {
      const opts = h.skillOptions(catalog, specId);
      const profIds = opts.profession.map((s) => s.id);
      expect(profIds).toContain(10192); // Mind Wrack
      expect(profIds).toContain(10267); // Cry of Frustration
      expect(profIds).toContain(10191); // Diversion
      expect(profIds).toContain(10197); // Distortion
    }
  });

  // ---------------------------------------------------------------------------
  // Mechanic slots — four shatters always present
  // ---------------------------------------------------------------------------

  test("core Mesmer has four shatter mechanic F-slots", async () => {
    const catalog = await h.loadCatalog();
    const sigs = h.resolveMechSlots(catalog, 0);
    expect(sigs).toEqual(["10192", "10267", "10191", "10197"]);
  });

  test("Chronomancer (spec 59) retains all four core shatter F-slots", async () => {
    const catalog = await h.loadCatalog();
    const core  = h.resolveMechSlots(catalog, 0);
    const chrono = h.resolveMechSlots(catalog, 59);
    expect(chrono).toEqual(core);
  });

  test("Mirage (spec 61) retains all four core shatter F-slots", async () => {
    const catalog = await h.loadCatalog();
    const core  = h.resolveMechSlots(catalog, 0);
    const mirage = h.resolveMechSlots(catalog, 61);
    expect(mirage).toEqual(core);
  });

  test("shatter mechanic footprint is consistent across all Mesmer elite specs", async () => {
    const catalog = await h.loadCatalog();
    const expected = ["10192", "10267", "10191", "10197"];
    expect(h.resolveMechSlots(catalog, 0)).toEqual(expected);
    expect(h.resolveMechSlots(catalog, 59)).toEqual(expected);
    expect(h.resolveMechSlots(catalog, 61)).toEqual(expected);
  });

  test("Mesmer has exactly four shatter slots, no more", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 0)).toHaveLength(4);
    expect(h.resolveMechSlots(catalog, 59)).toHaveLength(4);
    expect(h.resolveMechSlots(catalog, 61)).toHaveLength(4);
  });

  test("shatter skills are presented in the correct F-key order (Mind Wrack → Cry → Diversion → Distortion)", async () => {
    const catalog = await h.loadCatalog();
    const sigs = h.resolveMechSlots(catalog, 0);
    expect(sigs[0]).toBe("10192"); // F1: Mind Wrack
    expect(sigs[1]).toBe("10267"); // F2: Cry of Frustration
    expect(sigs[2]).toBe("10191"); // F3: Diversion
    expect(sigs[3]).toBe("10197"); // F4: Distortion
  });

  // ---------------------------------------------------------------------------
  // Weapon skill resolution
  // ---------------------------------------------------------------------------

  test("Sword Weapon_1 resolves to Spatial Surge", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "sword", "", "");
    expect(slots[0]).not.toBeNull();
    expect(slots[0].id).toBe(10173); // Spatial Surge
  });
});
