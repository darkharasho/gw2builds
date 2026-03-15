"use strict";

// Tests for two-handed weapon infusion slots (issue #13).
// Two-handed weapons should have 2 infusion slots, matching sigil behaviour.

const { normalizeInfusionValue, INFUSION_ARRAY_SLOTS } = require("../../../src/renderer/modules/editor");
const { createEmptyEditor } = require("../../../src/renderer/modules/state");

describe("INFUSION_ARRAY_SLOTS includes weapon slots", () => {
  test("mainhand1 allows 2 infusion slots", () => {
    expect(INFUSION_ARRAY_SLOTS.mainhand1).toBe(2);
  });

  test("mainhand2 allows 2 infusion slots", () => {
    expect(INFUSION_ARRAY_SLOTS.mainhand2).toBe(2);
  });

  test("offhand1 allows 1 infusion slot", () => {
    expect(INFUSION_ARRAY_SLOTS.offhand1).toBe(1);
  });

  test("offhand2 allows 1 infusion slot", () => {
    expect(INFUSION_ARRAY_SLOTS.offhand2).toBe(1);
  });

  test("aquatic1 allows 2 infusion slots", () => {
    expect(INFUSION_ARRAY_SLOTS.aquatic1).toBe(2);
  });

  test("aquatic2 allows 2 infusion slots", () => {
    expect(INFUSION_ARRAY_SLOTS.aquatic2).toBe(2);
  });

  test("breather allows 1 infusion slot", () => {
    expect(INFUSION_ARRAY_SLOTS.breather).toBe(1);
  });
});

describe("normalizeInfusionValue for weapon slots", () => {
  test("normalizes mainhand1 string to empty array of 2 (migration)", () => {
    expect(normalizeInfusionValue("123", "mainhand1")).toEqual(["", ""]);
  });

  test("normalizes mainhand1 array to correct length", () => {
    expect(normalizeInfusionValue(["123", "456"], "mainhand1")).toEqual(["123", "456"]);
  });

  test("normalizes empty mainhand1 to array of 2 empty strings", () => {
    expect(normalizeInfusionValue("", "mainhand1")).toEqual(["", ""]);
  });

  test("normalizes offhand1 string to empty array of 1 (migration)", () => {
    expect(normalizeInfusionValue("456", "offhand1")).toEqual([""]);
  });

  test("normalizes offhand1 array to correct length", () => {
    expect(normalizeInfusionValue(["456"], "offhand1")).toEqual(["456"]);
  });

  test("normalizes aquatic1 to array of 2", () => {
    expect(normalizeInfusionValue("", "aquatic1")).toEqual(["", ""]);
  });

  test("normalizes breather to array of 1", () => {
    expect(normalizeInfusionValue("", "breather")).toEqual([""]);
  });
});

describe("createEmptyEditor weapon infusions are arrays", () => {
  const editor = createEmptyEditor();
  const inf = editor.equipment.infusions;

  test("mainhand1 infusion is array of length 2", () => {
    expect(Array.isArray(inf.mainhand1)).toBe(true);
    expect(inf.mainhand1).toHaveLength(2);
  });

  test("offhand1 infusion is array of length 1", () => {
    expect(Array.isArray(inf.offhand1)).toBe(true);
    expect(inf.offhand1).toHaveLength(1);
  });

  test("aquatic1 infusion is array of length 2", () => {
    expect(Array.isArray(inf.aquatic1)).toBe(true);
    expect(inf.aquatic1).toHaveLength(2);
  });

  test("breather infusion is array of length 1", () => {
    expect(Array.isArray(inf.breather)).toBe(true);
    expect(inf.breather).toHaveLength(1);
  });
});
