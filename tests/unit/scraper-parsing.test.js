const { mapWikitextToFacts, validateSplitEntry } = require("../../lib/gw2-balance-splits/scripts/seed");

describe("seed.js parsing functions", () => {
  describe("mapWikitextToFacts", () => {
    test("extracts damage coefficient", () => {
      const facts = mapWikitextToFacts({ damage: "0.8" }, []);
      expect(facts).toHaveLength(1);
      expect(facts[0]).toEqual({
        type: "Damage",
        text: "Damage",
        dmg_multiplier: 0.8,
        hit_count: 1,
      });
    });

    test("extracts damage with hit count", () => {
      const facts = mapWikitextToFacts({ damage: "0.5", "hit count": "3" }, []);
      expect(facts[0].hit_count).toBe(3);
    });

    test("extracts duration", () => {
      const facts = mapWikitextToFacts({ duration: "10" }, []);
      expect(facts).toHaveLength(1);
      expect(facts[0]).toEqual({ type: "Duration", text: "Duration", duration: 10 });
    });

    test("extracts recharge/cooldown", () => {
      const facts = mapWikitextToFacts({ recharge: "25" }, []);
      expect(facts[0]).toEqual({ type: "Recharge", text: "Recharge", value: 25 });
    });

    test("extracts healing", () => {
      const facts = mapWikitextToFacts({ healing: "300" }, []);
      expect(facts[0]).toEqual({ type: "AttributeAdjust", text: "Healing", value: 300 });
    });

    test("returns empty array for no WvW params", () => {
      expect(mapWikitextToFacts({}, [])).toEqual([]);
    });

    test("extracts damage from split sections", () => {
      const facts = mapWikitextToFacts({}, ["damage: 0.6"]);
      expect(facts).toHaveLength(1);
      expect(facts[0].dmg_multiplier).toBe(0.6);
    });

    test("ignores non-numeric values", () => {
      const facts = mapWikitextToFacts({ damage: "varies" }, []);
      expect(facts).toEqual([]);
    });
  });

  describe("validateSplitEntry", () => {
    test("valid entry with known fact types", () => {
      expect(validateSplitEntry({
        facts: [{ type: "Damage" }, { type: "Buff" }]
      })).toBe(true);
    });

    test("rejects null entry", () => {
      expect(validateSplitEntry(null)).toBe(false);
    });

    test("rejects empty facts array", () => {
      expect(validateSplitEntry({ facts: [] })).toBe(false);
    });

    test("rejects entry with unknown fact type", () => {
      expect(validateSplitEntry({ facts: [{ type: "FakeType" }] })).toBe(false);
    });

    test("rejects entry with missing type", () => {
      expect(validateSplitEntry({ facts: [{ text: "Damage" }] })).toBe(false);
    });
  });
});
