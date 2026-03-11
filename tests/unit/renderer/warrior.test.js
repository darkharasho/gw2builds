"use strict";

const { createMechanicsSuite, setupMechanicsHarness } = require("./mechanicsSuite");

createMechanicsSuite("Warrior", [
  { specId: 0, expected: [] },
  { specId: 51, expected: [] },
  { specId: 3, expected: [] },
]);

describe("renderer mechanics selection — Warrior core vs elite F skills", () => {
  const resolve = setupMechanicsHarness("Warrior");

  test("core has no persistent profession-mechanics F slots in this fixture", async () => {
    const core = await resolve({ specId: 0 });
    expect(core.signatures).toEqual([]);
  });

  test("Berserker keeps the same persistent F-slot footprint as core", async () => {
    const core = await resolve({ specId: 0 });
    const berserker = await resolve({ specId: 51 });
    expect(berserker.signatures).toEqual(core.signatures);
  });

  test("Spellbreaker keeps the same persistent F-slot footprint as core", async () => {
    const core = await resolve({ specId: 0 });
    const spellbreaker = await resolve({ specId: 3 });
    expect(spellbreaker.signatures).toEqual(core.signatures);
  });
});
