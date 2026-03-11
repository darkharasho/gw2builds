"use strict";

const { createMechanicsSuite, setupMechanicsHarness } = require("./mechanicsSuite");

describe("renderer Revenant mechanics — Alliance Tactics fallback", () => {
  test("injects Alliance Tactics (62729) at Profession_3 for Vindicator when Legendary Alliance is active", () => {
    const { __testOnly } = require("../../../src/renderer/renderer");
    const skill62729 = { id: 62729, name: "Alliance Tactics", slot: "Profession_3" };
    const skillById = new Map([[62729, skill62729]]);
    const eliteFixedSkills = [
      { id: 12345, slot: "Profession_4", name: "Tree Song" },
    ];

    const bySlot = __testOnly.buildRevenantEliteByProfSlot(
      eliteFixedSkills,
      69,
      true,
      skillById
    );

    expect(bySlot.get("Profession_3")).toEqual(skill62729);
    expect(bySlot.get("Profession_4")).toEqual(eliteFixedSkills[0]);
  });

  test("does not inject Alliance Tactics when Legendary Alliance is not active", () => {
    const { __testOnly } = require("../../../src/renderer/renderer");
    const skill62729 = { id: 62729, name: "Alliance Tactics", slot: "Profession_3" };
    const skillById = new Map([[62729, skill62729]]);

    const bySlot = __testOnly.buildRevenantEliteByProfSlot([], 69, false, skillById);

    expect(bySlot.has("Profession_3")).toBe(false);
  });
});

createMechanicsSuite("Revenant", [
  { specId: 0, expected: [] },
  { specId: 52, expected: [] },
  { specId: 63, expected: [] },
  {
    specId: 69,
    legendSlots: ["Legend7", "Legend1"],
    activeLegendSlot: 0,
    expected: ["62729"],
  },
  {
    specId: 69,
    legendSlots: ["Legend1", "Legend7"],
    activeLegendSlot: 0,
    expected: [],
  },
  { specId: 79, expected: [] },
]);

describe("renderer mechanics selection — Revenant core vs elite F skills", () => {
  const resolve = setupMechanicsHarness("Revenant");

  test("core has no persistent elite F2+ slots in this fixture", async () => {
    const core = await resolve({ specId: 0 });
    expect(core.signatures).toEqual([]);
  });

  test("Herald, Renegade, and Conduit keep no persistent elite F2+ slots in this fixture", async () => {
    const herald = await resolve({ specId: 52 });
    const renegade = await resolve({ specId: 63 });
    const conduit = await resolve({ specId: 79 });
    expect(herald.signatures).toEqual([]);
    expect(renegade.signatures).toEqual([]);
    expect(conduit.signatures).toEqual([]);
  });

  test("Vindicator shows Alliance Tactics only when Legendary Alliance is active", async () => {
    const allianceActive = await resolve({
      specId: 69,
      legendSlots: ["Legend7", "Legend1"],
      activeLegendSlot: 0,
    });
    const allianceInactive = await resolve({
      specId: 69,
      legendSlots: ["Legend1", "Legend7"],
      activeLegendSlot: 0,
    });
    expect(allianceActive.signatures).toEqual(["62729"]);
    expect(allianceInactive.signatures).toEqual([]);
  });
});
