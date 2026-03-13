const { extractWikilinks, filterToSplitPages } = require("../../lib/gw2-balance-splits/scripts/crawl-patches");

describe("extractWikilinks", () => {
  test("extracts bare wikilinks", () => {
    expect(extractWikilinks("See [[Berserker's Stance]] for details."))
      .toEqual(["Berserker's Stance"]);
  });

  test("uses display text target, not label", () => {
    expect(extractWikilinks("[[Healer's Retribution|this skill]]"))
      .toEqual(["Healer's Retribution"]);
  });

  test("deduplicates repeated links", () => {
    expect(extractWikilinks("[[Foo]] and [[Foo]] again"))
      .toEqual(["Foo"]);
  });

  test("strips section anchors", () => {
    // [[Page#Section|label]] → "Page"
    expect(extractWikilinks("[[Might#Details|Might stacks]]"))
      .toEqual(["Might"]);
  });

  test("returns empty array for no links", () => {
    expect(extractWikilinks("No links here.")).toEqual([]);
  });

  test("handles multiple distinct links", () => {
    const result = extractWikilinks("[[Alpha]] and [[Beta]] and [[Gamma]]");
    expect(result).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});

describe("filterToSplitPages", () => {
  const knownSplits = new Set(["Berserker's Stance", "Healer's Retribution", "Boon Overload"]);

  test("returns only pages present in knownSplits", () => {
    const links = ["Berserker's Stance", "Resistance", "Game updates/2026"];
    expect(filterToSplitPages(links, knownSplits))
      .toEqual(["Berserker's Stance"]);
  });

  test("returns empty array when no overlap", () => {
    expect(filterToSplitPages(["Foo", "Bar"], knownSplits)).toEqual([]);
  });

  test("returns all links that match", () => {
    const links = ["Berserker's Stance", "Healer's Retribution"];
    expect(filterToSplitPages(links, knownSplits))
      .toEqual(["Berserker's Stance", "Healer's Retribution"]);
  });
});
