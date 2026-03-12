"use strict";

const { setupHarness } = require("./harness");

describe("Engineer — end-to-end profession mechanics", () => {
  const h = setupHarness("Engineer");

  // ---------------------------------------------------------------------------
  // Catalog loading
  // ---------------------------------------------------------------------------

  test("catalog loads with Engineer profession data", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.profession.id).toBe("Engineer");
    expect(catalog.skills.length).toBeGreaterThan(0);
  });

  test("catalog includes all Engineer elite specs", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.specializationById.has(43)).toBe(true); // Scrapper
    expect(catalog.specializationById.has(57)).toBe(true); // Holosmith
    expect(catalog.specializationById.has(70)).toBe(true); // Mechanist
    expect(catalog.specializationById.has(80)).toBe(true); // Amalgam
  });

  // ---------------------------------------------------------------------------
  // Skill options
  // ---------------------------------------------------------------------------

  test("core Engineer skill options include heal, utilities, and elite", async () => {
    const catalog = await h.loadCatalog();
    const opts = h.skillOptions(catalog, 0);
    expect(opts.heal.length).toBeGreaterThan(0);
    expect(opts.utility.length).toBeGreaterThan(0);
    expect(opts.elite.length).toBeGreaterThan(0);
    expect(opts.heal[0].id).toBe(5802); // Healing Turret
  });

  // ---------------------------------------------------------------------------
  // Mechanic slots — toolbelt resolution
  // ---------------------------------------------------------------------------

  test("core Engineer: F1-F4 are toolbelt slots driven by equipped utilities", async () => {
    const catalog = await h.loadCatalog();
    // buildEditor selects the first 3 utilities; Elixir H (5834) → toolbelt → Toss Elixir H (6118)
    const sigs = h.resolveMechSlots(catalog, 0);
    // F1 (heal toolbelt) is empty in fixture since Healing Turret has no toolbelt_skill
    expect(sigs).toHaveLength(4);
    expect(sigs[0]).toBe("empty"); // Heal toolbelt → null
  });

  test("Elixir B utility maps to Toss Elixir B (6092) via elixir override, not Detonate", async () => {
    const catalog = await h.loadCatalog();
    const elixirB = catalog.skillById.get(5821);
    expect(elixirB).toBeTruthy();
    // gw2Data ELIXIR_TOOLBELT_OVERRIDES maps Elixir B (5821) → Toss Elixir B (6092)
    expect(elixirB.toolbeltSkill).toBe(6092); // Toss Elixir B, not Detonate Elixir B (6082)
  });

  test("Elixir H utility maps to Toss Elixir H (6118) via elixir override", async () => {
    const catalog = await h.loadCatalog();
    const elixirH = catalog.skillById.get(5834);
    expect(elixirH).toBeTruthy();
    expect(elixirH.toolbeltSkill).toBe(6118); // Toss Elixir H
  });

  test("Scrapper (spec 43) preserves core F1–F4 toolbelt slots and adds Function Gyro (72103) as F5", async () => {
    const catalog = await h.loadCatalog();
    const core = h.resolveMechSlots(catalog, 0);
    const scrapper = h.resolveMechSlots(catalog, 43);
    expect(scrapper).toHaveLength(5);
    expect(scrapper.slice(0, 4)).toEqual(core);
    expect(scrapper[4]).toBe("72103");
  });

  test("Holosmith (spec 57) adds Photon Forge (42938) as a 5th F-slot", async () => {
    const catalog = await h.loadCatalog();
    const core = h.resolveMechSlots(catalog, 0);
    const holo = h.resolveMechSlots(catalog, 57);
    expect(holo).toHaveLength(5);
    expect(holo.slice(0, 4)).toEqual(core); // F1-F4 unchanged
    expect(holo[4]).toBe("42938");           // F5 = Photon Forge
  });

  test("Mechanist (spec 70) replaces all toolbelt slots with mech command layout", async () => {
    const catalog = await h.loadCatalog();
    const mech = h.resolveMechSlots(catalog, 70);
    // Mechanist F1 = Detonate Elixir H (6119) from heal toolbelt override; F2/F3 are empty placeholders
    expect(mech).toEqual(["6119", "empty", "empty"]);
    // Core toolbelt skills must not appear
    expect(mech).not.toContain("6092");
    expect(mech).not.toContain("6077");
    expect(mech).not.toContain("6118");
  });

  test("Amalgam (spec 80) matches core toolbelt footprint in this fixture", async () => {
    const catalog = await h.loadCatalog();
    const core = h.resolveMechSlots(catalog, 0);
    const amalgam = h.resolveMechSlots(catalog, 80);
    expect(amalgam).toEqual(core);
  });

  test("Holosmith Photon Forge (42938) has a bundle of exactly 5 weapon skills", async () => {
    const catalog = await h.loadCatalog();
    const photonForge = catalog.skillById.get(42938);
    expect(photonForge).toBeTruthy();
    expect(Array.isArray(photonForge.bundleSkills)).toBe(true);
    expect(photonForge.bundleSkills.length).toBe(5);
    // Light Strike (44588), Holo Leap (42965), Corona Burst (44530), Photon Blitz (45783), Prime Light Beam (42521)
    expect(photonForge.bundleSkills).toContain(44588);
    expect(photonForge.bundleSkills).toContain(42965);
    expect(photonForge.bundleSkills).toContain(44530);
    expect(photonForge.bundleSkills).toContain(45783);
    expect(photonForge.bundleSkills).toContain(42521);
  });

  // ---------------------------------------------------------------------------
  // Flip skills — Photon Forge enter/exit chain
  // ---------------------------------------------------------------------------

  test("Deactivate Photon Forge (41123) has a flip skill back to Enter Photon Forge (42938)", async () => {
    const catalog = await h.loadCatalog();
    const deactivate = catalog.skillById.get(41123);
    expect(deactivate).toBeTruthy();
    expect(deactivate.flipSkill).toBe(42938);
  });

  test("Enter Photon Forge (42938) and Deactivate Photon Forge (41123) are both in the catalog", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.skillById.has(42938)).toBe(true);
    expect(catalog.skillById.has(41123)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Weapon skill resolution
  // ---------------------------------------------------------------------------

  test("Rifle (TwoHand) Weapon_1 resolves to Hip Shot", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "rifle", "", "");
    expect(slots[0]).not.toBeNull();
    expect(slots[0].id).toBe(5811); // Hip Shot
  });
});
