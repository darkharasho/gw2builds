"use strict";

// profession-icons.js uses ES module ?raw imports which are transformed by babel-jest.
// In Node test env, Vite ?raw imports resolve to empty strings via jest moduleNameMapper.
// We test the module's lookup logic, not the SVG content itself.
// The jest config already transforms src/renderer/**/*.js via babel-jest.
// Add moduleNameMapper for ?raw imports (see Step 3).

const profIcons = require("../../../src/renderer/modules/profession-icons");

describe("getProfessionSvg", () => {
  test("returns a string for a known profession", () => {
    const result = profIcons.getProfessionSvg("Guardian");
    expect(typeof result).toBe("string");
  });

  test("returns null for an unknown name", () => {
    expect(profIcons.getProfessionSvg("Unknown")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(profIcons.getProfessionSvg("")).toBeNull();
  });

  test("is case-sensitive (Guardian != guardian)", () => {
    expect(profIcons.getProfessionSvg("guardian")).toBeNull();
  });
});
