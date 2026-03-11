"use strict";

const { createMechanicsSuite, setupMechanicsHarness } = require("./mechanicsSuite");

createMechanicsSuite("Mesmer", [
  { specId: 0, expected: ["10192", "10267", "10191", "10197"] },
  { specId: 59, expected: ["10192", "10267", "10191", "10197"] },
  { specId: 61, expected: ["10192", "10267", "10191", "10197"] },
]);

describe("renderer mechanics selection — Mesmer core vs elite F skills", () => {
  const resolve = setupMechanicsHarness("Mesmer");

  test("core uses the four shatter mechanic slots", async () => {
    const core = await resolve({ specId: 0 });
    expect(core.signatures).toEqual(["10192", "10267", "10191", "10197"]);
  });

  test("Chronomancer keeps the same persistent shatter F slots in this fixture", async () => {
    const core = await resolve({ specId: 0 });
    const chrono = await resolve({ specId: 59 });
    expect(chrono.signatures).toEqual(core.signatures);
  });

  test("Mirage keeps the same persistent shatter F slots in this fixture", async () => {
    const core = await resolve({ specId: 0 });
    const mirage = await resolve({ specId: 61 });
    expect(mirage.signatures).toEqual(core.signatures);
  });
});
