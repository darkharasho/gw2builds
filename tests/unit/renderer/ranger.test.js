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

describe("renderer mechanics selection — Ranger aquatic pets underwater", () => {
  const resolve = setupMechanicsHarness("Ranger");

  // Lashtail Devourer (pet ID 33) is the aquatic pet in the test fixtures.
  // Its skills array is [12523, 12524, 12525]; for aquatic slots the harness
  // picks index 1 (12524) as the F2 pet skill instead of index 0.
  const aquaticPets = { aquatic1: 33, aquatic2: 0 };

  test("underwater mode switches to aquatic pet slot for F2 skill", async () => {
    const underwater = await resolve({
      specId: 0,
      underwaterMode: true,
      selectedPets: aquaticPets,
      activePetSlot: "aquatic1",
    });
    // Aquatic F2 uses skill index 1 of the aquatic pet's skills array (12524)
    expect(underwater.signatures).toEqual(["fake:attack", "12524", "fake:return"]);
  });

  test("underwater F2 skill differs from terrestrial F2 when different pets are assigned", async () => {
    const terrestrial = await resolve({ specId: 0 });
    const underwater = await resolve({
      specId: 0,
      underwaterMode: true,
      selectedPets: aquaticPets,
      activePetSlot: "aquatic1",
    });
    // Black Bear (terrestrial1=1) uses skill index 0 → 12478
    // Lashtail Devourer (aquatic1=33) uses skill index 1 → 12524
    expect(terrestrial.signatures[1]).toBe("12478");
    expect(underwater.signatures[1]).toBe("12524");
  });

  test("underwater with no aquatic pet assigned shows empty F2 slot", async () => {
    const underwater = await resolve({
      specId: 0,
      underwaterMode: true,
      selectedPets: { aquatic1: 0, aquatic2: 0 },
      activePetSlot: "aquatic1",
    });
    expect(underwater.signatures).toEqual(["fake:attack", "empty", "fake:return"]);
  });

  test("Untamed underwater still replaces F3 return with profession skill", async () => {
    const underwater = await resolve({
      specId: 72,
      underwaterMode: true,
      selectedPets: aquaticPets,
      activePetSlot: "aquatic1",
    });
    expect(underwater.signatures[2]).not.toBe("fake:return");
  });
});
