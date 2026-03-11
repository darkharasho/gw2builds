"use strict";

const { createMechanicsSuite, setupMechanicsHarness } = require("./mechanicsSuite");

createMechanicsSuite("Guardian", [
  { specId: 0, expected: [] },
  { specId: 27, expected: ["29887", "30783", "30029"] },
  { specId: 62, expected: ["44364", "41780", "42259"] },
  { specId: 65, expected: [] },
]);

describe("renderer mechanics selection — Guardian core vs elite F skills", () => {
  const resolve = setupMechanicsHarness("Guardian");

  test("core has no persistent F slots in this fixture", async () => {
    const core = await resolve({ specId: 0 });
    expect(core.signatures).toEqual([]);
  });

  test("Dragonhunter replaces virtues with Hunter's Ward/Test of Faith/Fragments of Faith", async () => {
    const dragonhunter = await resolve({ specId: 27 });
    expect(dragonhunter.signatures).toEqual(["29887", "30783", "30029"]);
  });

  test("Firebrand replaces virtues with tome skills and differs from Dragonhunter", async () => {
    const dragonhunter = await resolve({ specId: 27 });
    const firebrand = await resolve({ specId: 62 });
    expect(firebrand.signatures).toEqual(["44364", "41780", "42259"]);
    expect(firebrand.signatures).not.toEqual(dragonhunter.signatures);
  });

  test("Willbender keeps the same persistent F-slot footprint as core in this fixture", async () => {
    const core = await resolve({ specId: 0 });
    const willbender = await resolve({ specId: 65 });
    expect(willbender.signatures).toEqual(core.signatures);
  });
});
