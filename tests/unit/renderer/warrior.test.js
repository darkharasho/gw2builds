"use strict";

const { createMechanicsSuite, setupMechanicsHarness } = require("./mechanicsSuite");

// Default weapon in the harness is Sword (first key in professionWeapons fixture).
// Core:        F1 = Sword core burst (14367 Flurry).
// Berserker (spec 18) with Berserk off: F1 = core burst (14367), F2 = Berserk toggle (30185).
// Spellbreaker (spec 61): F1 = Spellbreaker Sword burst (42494).
createMechanicsSuite("Warrior", [
  { specId: 0,  expected: ["14367"] },
  { specId: 18, expected: ["14367", "30185"] },
  { specId: 61, expected: ["42494"] },
]);

describe("renderer mechanics selection — Warrior core vs elite F skills", () => {
  const resolve = setupMechanicsHarness("Warrior");

  test("core Warrior F1 shows Sword burst when Sword is equipped", async () => {
    const core = await resolve({ specId: 0 });
    expect(core.signatures).toEqual(["14367"]);
  });

  test("Berserker shows Sword core burst at F1 and Berserk toggle at F2 when Berserk is off", async () => {
    const berserker = await resolve({ specId: 18, activeKit: 0 });
    expect(berserker.signatures).toEqual(["14367", "30185"]);
  });

  test("Berserker shows Sword primal burst at F1 when Berserk is active", async () => {
    const berserker = await resolve({ specId: 18, activeKit: 30185 });
    expect(berserker.signatures).toEqual(["30682", "30185"]);
  });

  test("Spellbreaker F1 shows Spellbreaker Sword burst", async () => {
    const spellbreaker = await resolve({ specId: 61 });
    expect(spellbreaker.signatures).toEqual(["42494"]);
  });
});
