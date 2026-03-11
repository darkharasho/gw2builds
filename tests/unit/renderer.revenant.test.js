"use strict";

describe("renderer Revenant mechanics — Alliance Tactics fallback", () => {
  test("injects Alliance Tactics (62729) at Profession_3 for Vindicator when Legendary Alliance is active", () => {
    const { __testOnly } = require("../../src/renderer/renderer");
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
    const { __testOnly } = require("../../src/renderer/renderer");
    const skill62729 = { id: 62729, name: "Alliance Tactics", slot: "Profession_3" };
    const skillById = new Map([[62729, skill62729]]);

    const bySlot = __testOnly.buildRevenantEliteByProfSlot([], 69, false, skillById);

    expect(bySlot.has("Profession_3")).toBe(false);
  });
});
