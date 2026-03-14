"use strict";

const { createMechanicsSuite, setupMechanicsHarness } = require("./mechanicsSuite");

createMechanicsSuite("Engineer", [
  { specId: 0, expected: ["empty", "6092", "6077", "6118"] },
  { specId: 43, expected: ["empty", "6092", "6077", "6118", "72103"] },
  { specId: 57, expected: ["empty", "6092", "6077", "6118", "42938"] },
  { specId: 70, expected: ["6119", "empty", "empty"] },
  { specId: 80, expected: ["empty", "6092", "6077", "6118"] },
]);

describe("renderer mechanics selection — Engineer core vs elite F skills", () => {
  const resolve = setupMechanicsHarness("Engineer");

  test("core uses four toolbelt-derived F slots", async () => {
    const core = await resolve({ specId: 0 });
    expect(core.signatures).toEqual(["empty", "6092", "6077", "6118"]);
  });

  test("Scrapper preserves core F1–F4 toolbelt slots and adds Function Gyro as F5", async () => {
    const core = await resolve({ specId: 0 });
    const scrapper = await resolve({ specId: 43 });
    expect(scrapper.signatures.slice(0, 4)).toEqual(core.signatures);
    expect(scrapper.signatures[4]).toBe("72103");
  });

  test("Holosmith adds Photon Forge as an extra F5 while preserving core F1-F4", async () => {
    const core = await resolve({ specId: 0 });
    const holo = await resolve({ specId: 57 });
    expect(holo.signatures.slice(0, 4)).toEqual(core.signatures);
    expect(holo.signatures[4]).toBe("42938");
  });

  test("Mechanist replaces toolbelt F slots with its own command layout", async () => {
    const mechanist = await resolve({ specId: 70 });
    expect(mechanist.signatures).toEqual(["6119", "empty", "empty"]);
    expect(mechanist.signatures).not.toContain("6092");
    expect(mechanist.signatures).not.toContain("6077");
    expect(mechanist.signatures).not.toContain("6118");
  });

  test("Amalgam currently matches core persistent F slots in this fixture", async () => {
    const core = await resolve({ specId: 0 });
    const amalgam = await resolve({ specId: 80 });
    expect(amalgam.signatures).toEqual(core.signatures);
  });
});

describe("renderer mechanics selection — Mechanist underwater mode", () => {
  const resolve = setupMechanicsHarness("Engineer");

  test("Mechanist underwater returns only Depth Charges (63210) at F4", async () => {
    const mechanist = await resolve({ specId: 70, underwaterMode: true });
    expect(mechanist.signatures).toEqual(["63210"]);
  });

  test("Mechanist underwater has exactly one F-slot instead of three mech command slots", async () => {
    const terrestrial = await resolve({ specId: 70 });
    const underwater = await resolve({ specId: 70, underwaterMode: true });
    expect(terrestrial.result.mechSlots).toHaveLength(3);
    expect(underwater.result.mechSlots).toHaveLength(1);
  });

  test("Mechanist underwater F-slot has fKeyLabel F4", async () => {
    const mechanist = await resolve({ specId: 70, underwaterMode: true });
    expect(mechanist.result.mechSlots[0].fKeyLabel).toBe("F4");
  });

  test("Mechanist underwater F-slot does not contain any toolbelt-derived skills", async () => {
    const mechanist = await resolve({ specId: 70, underwaterMode: true });
    expect(mechanist.signatures).not.toContain("6092");
    expect(mechanist.signatures).not.toContain("6077");
    expect(mechanist.signatures).not.toContain("6118");
    expect(mechanist.signatures).not.toContain("6119");
  });

  test("core Engineer underwater does not change toolbelt F slot count", async () => {
    const terrestrial = await resolve({ specId: 0 });
    const underwater = await resolve({ specId: 0, underwaterMode: true });
    expect(underwater.result.mechSlots).toHaveLength(terrestrial.result.mechSlots.length);
  });
});
