"use strict";

const { createMechanicsSuite, setupMechanicsHarness } = require("./mechanicsSuite");

// Weaver F1-F4 are the four attunement swap buttons (Fire/Water/Air/Earth).
// Their mechanic-slot IDs appear once the fixture includes professions: ["Elementalist"].
const WEAVER_ATTUNEMENT_SIGS = ["76703", "76988", "76580", "77082"];

createMechanicsSuite("Elementalist", [
  { specId: 0, expected: [] },
  { specId: 48, expected: [] },
  { specId: 56, expected: WEAVER_ATTUNEMENT_SIGS },
]);

describe("renderer mechanics selection — Elementalist core vs elite F skills", () => {
  const resolve = setupMechanicsHarness("Elementalist");

  test("core has no persistent F slots", async () => {
    const core = await resolve({ specId: 0 });
    expect(core.signatures).toEqual([]);
  });

  test("Tempest keeps the same persistent F-slot footprint as core", async () => {
    const core = await resolve({ specId: 0 });
    const tempest = await resolve({ specId: 48 });
    expect(tempest.signatures).toEqual(core.signatures);
  });

  test("Weaver exposes four attunement swap buttons (Fire/Water/Air/Earth) as F1-F4", async () => {
    const weaver = await resolve({ specId: 56 });
    expect(weaver.signatures).toEqual(WEAVER_ATTUNEMENT_SIGS);
  });

  test("Weaver F-slot count (4) differs from core (0)", async () => {
    const core  = await resolve({ specId: 0 });
    const weaver = await resolve({ specId: 56 });
    expect(weaver.signatures.length).toBeGreaterThan(core.signatures.length);
  });
});
