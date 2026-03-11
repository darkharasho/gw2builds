"use strict";

const { createMechanicsSuite, setupMechanicsHarness } = require("./mechanicsSuite");

createMechanicsSuite("Thief", [
  { specId: 0, expected: ["13132"] },
  { specId: 44, expected: ["30423"] },
  { specId: 58, expected: ["43390"] },
  { specId: 71, expected: ["63067", "63155"] },
  // Antiquary F1 = Skritt Swipe (77397); F2/F3 empty until artifact draw
  { specId: 77, expected: ["77397", "empty", "empty"] },
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

  test("Antiquary F1 is Skritt Swipe (77397), F2/F3 empty before artifact draw", async () => {
    const antiquary = await resolve({ specId: 77 });
    expect(antiquary.signatures).toEqual(["77397", "empty", "empty"]);
  });

  test("Antiquary F2/F3 show stored artifact IDs when antiquaryArtifacts is set", async () => {
    const antiquary = await resolve({
      specId: 77,
      antiquaryArtifacts: { f2: 76582, f3: 78309 },
    });
    expect(antiquary.signatures).toEqual(["77397", "76582", "78309"]);
  });

  test("Prolific Plunderer (trait 2346) adds an empty F4 slot before artifact draw", async () => {
    const antiquary = await resolve({
      specId: 77,
      majorChoices: { 1: 2346, 2: 0, 3: 0 },
    });
    expect(antiquary.signatures).toEqual(["77397", "empty", "empty", "empty"]);
  });

  test("Prolific Plunderer F4 shows stored artifact when antiquaryArtifacts.f4 is set", async () => {
    const antiquary = await resolve({
      specId: 77,
      majorChoices: { 1: 2346, 2: 0, 3: 0 },
      antiquaryArtifacts: { f2: 76582, f3: 78309, f4: 76816 },
    });
    expect(antiquary.signatures).toEqual(["77397", "76582", "78309", "76816"]);
  });
});
