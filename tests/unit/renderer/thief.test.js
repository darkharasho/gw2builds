"use strict";

const { createMechanicsSuite, setupMechanicsHarness } = require("./mechanicsSuite");

createMechanicsSuite("Thief", [
  { specId: 0, expected: ["13132"] },
  { specId: 44, expected: ["30423"] },
  { specId: 58, expected: ["43390"] },
  { specId: 71, expected: ["63067", "63155"] },
  { specId: 77, expected: ["13132", "77288", "78309"] },
]);

describe("renderer mechanics selection — Thief core vs elite F skills", () => {
  const resolve = setupMechanicsHarness("Thief");

  test("core has a single F1 steal slot", async () => {
    const core = await resolve({ specId: 0 });
    expect(core.signatures).toEqual(["13132"]);
  });

  test("Daredevil and Deadeye each replace core F1 with their own F1 skill", async () => {
    const daredevil = await resolve({ specId: 44 });
    const deadeye = await resolve({ specId: 58 });
    expect(daredevil.signatures).toEqual(["30423"]);
    expect(deadeye.signatures).toEqual(["43390"]);
    expect(daredevil.signatures).not.toEqual(deadeye.signatures);
  });

  test("Specter adds a persistent F2 slot in addition to F1", async () => {
    const specter = await resolve({ specId: 71 });
    expect(specter.signatures).toEqual(["63067", "63155"]);
  });

  test("Antiquary keeps core F1 and adds persistent F2/F3 slots", async () => {
    const antiquary = await resolve({ specId: 77 });
    expect(antiquary.signatures).toEqual(["13132", "77288", "78309"]);
  });
});
