"use strict";

const { createMechanicsSuite, setupMechanicsHarness } = require("./mechanicsSuite");

createMechanicsSuite("Necromancer", [
  { specId: 0, expected: ["10574"] },
  { specId: 34, expected: ["30792"] },
  { specId: 64, expected: ["62567"] },
  { specId: 76, expected: ["77238"] },
]);

describe("renderer mechanics selection — Necromancer core vs elite F skills", () => {
  const resolve = setupMechanicsHarness("Necromancer");

  test("core uses Death Shroud on F1", async () => {
    const core = await resolve({ specId: 0 });
    expect(core.signatures).toEqual(["10574"]);
  });

  test("Reaper, Harbinger, and Ritualist each replace core F1 with their own shroud", async () => {
    const reaper = await resolve({ specId: 34 });
    const harbinger = await resolve({ specId: 64 });
    const ritualist = await resolve({ specId: 76 });
    expect(reaper.signatures).toEqual(["30792"]);
    expect(harbinger.signatures).toEqual(["62567"]);
    expect(ritualist.signatures).toEqual(["77238"]);
  });

  test("each elite shroud F1 differs from the core Death Shroud F1", async () => {
    const core = await resolve({ specId: 0 });
    const reaper = await resolve({ specId: 34 });
    const harbinger = await resolve({ specId: 64 });
    const ritualist = await resolve({ specId: 76 });
    expect(reaper.signatures).not.toEqual(core.signatures);
    expect(harbinger.signatures).not.toEqual(core.signatures);
    expect(ritualist.signatures).not.toEqual(core.signatures);
  });
});
