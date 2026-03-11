"use strict";

const { createMechanicsSuite, setupMechanicsHarness } = require("./mechanicsSuite");

createMechanicsSuite("Ranger", [
  { specId: 0, expected: ["fake:attack", "12478", "fake:return"] },
  { specId: 55, expected: ["fake:attack", "12478", "fake:return"] },
  { specId: 72, expected: ["fake:attack", "12478", "empty"] },
]);

describe("renderer mechanics selection — Ranger core vs elite F skills", () => {
  const resolve = setupMechanicsHarness("Ranger");

  test("core uses Attack command, pet F2 skill, and Return command", async () => {
    const core = await resolve({ specId: 0 });
    expect(core.signatures).toEqual(["fake:attack", "12478", "fake:return"]);
  });

  test("Soulbeast matches core F1-F3 when not in beastmode", async () => {
    const core = await resolve({ specId: 0 });
    const soulbeast = await resolve({ specId: 55 });
    expect(soulbeast.signatures).toEqual(core.signatures);
  });

  test("Untamed replaces F3 return command with a profession skill slot", async () => {
    const untamed = await resolve({ specId: 72 });
    expect(untamed.signatures).toEqual(["fake:attack", "12478", "empty"]);
    expect(untamed.signatures[2]).not.toBe("fake:return");
  });
});
