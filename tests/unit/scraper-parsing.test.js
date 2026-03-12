const { parseWikitextFacts, mapWikiFactToApiFact, parseInfoboxParams, validateSplitEntry } = require("../../lib/gw2-balance-splits/scripts/seed");

describe("seed.js parsing functions", () => {
  describe("mapWikiFactToApiFact", () => {
    test("extracts damage coefficient", () => {
      const fact = mapWikiFactToApiFact("damage", [], { coefficient: "0.8" }, true, false);
      expect(fact).toEqual({
        type: "Damage",
        text: "Damage",
        dmg_multiplier: 0.8,
        hit_count: 1,
      });
    });

    test("extracts damage with hit count", () => {
      const fact = mapWikiFactToApiFact("damage", [], { coefficient: "0.5", "hit count": "3" }, true, false);
      expect(fact.hit_count).toBe(3);
      expect(fact.dmg_multiplier).toBe(0.5);
    });

    test("extracts duration", () => {
      const fact = mapWikiFactToApiFact("duration", ["duration", "10"], {}, true, false);
      expect(fact).toEqual({ type: "Duration", text: "Duration", duration: 10 });
    });

    test("extracts recharge", () => {
      const fact = mapWikiFactToApiFact("recharge", ["recharge", "25"], {}, true, false);
      expect(fact).toEqual({ type: "Recharge", text: "Recharge", value: 25 });
    });

    test("extracts healing with base value", () => {
      const fact = mapWikiFactToApiFact("healing", ["healing", "300"], {}, true, false);
      expect(fact).toEqual({ type: "AttributeAdjust", text: "Healing", value: 300 });
    });

    test("extracts targets", () => {
      const fact = mapWikiFactToApiFact("targets", ["targets", "5"], {}, true, false);
      expect(fact).toEqual({ type: "Number", text: "Number of Targets", value: 5 });
    });

    test("extracts buff/condition with duration and stacks", () => {
      const fact = mapWikiFactToApiFact("bleeding", ["bleeding", "3"], { stacks: "2" }, true, false);
      expect(fact).toEqual({
        type: "Buff",
        text: "Bleeding",
        status: "Bleeding",
        duration: 3,
        apply_count: 2,
      });
    });

    test("unknown type defaults to Buff with apply_count 1", () => {
      const fact = mapWikiFactToApiFact("unknown", ["unknown"], {}, true, false);
      expect(fact).toEqual({
        type: "Buff",
        text: "Unknown",
        status: "Unknown",
        duration: 0,
        apply_count: 1,
      });
    });
  });

  describe("parseWikitextFacts", () => {
    test("extracts WvW-specific skill facts from wikitext", () => {
      const wikitext = `{{skill fact|damage|coefficient=1.35|game mode=wvw}}`;
      const facts = parseWikitextFacts(wikitext);
      expect(facts).toHaveLength(1);
      expect(facts[0].type).toBe("Damage");
      expect(facts[0].dmg_multiplier).toBe(1.35);
    });

    test("skips PvE-only facts", () => {
      const wikitext = `{{skill fact|damage|coefficient=1.81|game mode=pve}}`;
      const facts = parseWikitextFacts(wikitext);
      expect(facts).toEqual([]);
    });

    test("includes universal facts (no game mode)", () => {
      const wikitext = `{{skill fact|targets|5}}`;
      const facts = parseWikitextFacts(wikitext);
      expect(facts).toHaveLength(1);
      expect(facts[0].type).toBe("Number");
    });

    test("handles pvp wvw combined mode", () => {
      const wikitext = `{{skill fact|blindness|3|game mode=pvp wvw}}`;
      const facts = parseWikitextFacts(wikitext);
      expect(facts).toHaveLength(1);
      expect(facts[0].type).toBe("Buff");
      expect(facts[0].status).toBe("Blindness");
    });

    test("returns empty for no skill facts", () => {
      const facts = parseWikitextFacts("just some regular wikitext");
      expect(facts).toEqual([]);
    });
  });

  describe("parseInfoboxParams", () => {
    test("extracts recharge wvw param", () => {
      const wikitext = "| recharge = 10\n| recharge wvw = 25\n| id = 5648";
      const facts = parseInfoboxParams(wikitext);
      expect(facts).toEqual([{ type: "Recharge", text: "Recharge", value: 25 }]);
    });

    test("extracts energy wvw param", () => {
      const wikitext = "| energy = 20\n| energy wvw = 30";
      const facts = parseInfoboxParams(wikitext);
      expect(facts).toEqual([{ type: "Number", text: "Energy Cost", value: 30 }]);
    });

    test("extracts initiative wvw param", () => {
      const wikitext = "| initiative = 5\n| initiative wvw = 7";
      const facts = parseInfoboxParams(wikitext);
      expect(facts).toEqual([{ type: "Number", text: "Initiative Cost", value: 7 }]);
    });

    test("extracts upkeep wvw param", () => {
      const wikitext = "| upkeep = -1\n| upkeep wvw = -2";
      const facts = parseInfoboxParams(wikitext);
      expect(facts).toEqual([{ type: "Number", text: "Upkeep Cost", value: -2 }]);
    });

    test("returns empty for no wvw params", () => {
      const wikitext = "| recharge = 10\n| id = 1234";
      expect(parseInfoboxParams(wikitext)).toEqual([]);
    });

    test("ignores non-numeric values", () => {
      const wikitext = "| recharge wvw = varies";
      expect(parseInfoboxParams(wikitext)).toEqual([]);
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
