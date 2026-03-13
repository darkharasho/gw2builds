"use strict";

/**
 * Tests for getWikiRelatedData in src/main/gw2Data/wiki.js
 *
 * Uses jest.resetModules() + require() to get a fresh module with mocked fetch.
 * Mocks fetchJson via jest.mock on the fetch module.
 */

let wiki;

function freshLoad() {
  jest.resetModules();
  wiki = require("../../src/main/gw2Data/wiki");
}

// Minimal related-skills HTML based on actual GW2 wiki structure
const SKILLS_HTML = `
<div class="mw-parser-output">
<h2><span class="mw-headline" id="Related_skills">Related skills</span></h2>
<h3><span class="mw-headline">Weapon skills that are improved by this trait</span></h3>
<ul>
<li class="filter-list f-Elementalist f-Weapon">
  <a href="/wiki/Elementalist"><img alt="Elementalist icon small.png" /></a> &#8201;
  <span style="overflow: hidden; width: 25px;"><span><a href="/wiki/Drake%27s_Breath"><img alt="Drake's Breath" /></a></span></span>
  &#160;<a href="/wiki/Drake%27s_Breath" title="Drake&#39;s Breath">Drake's Breath</a>&#160;&#8212;&#160;Dagger, when attuned to fire
</li>
<li class="filter-list f-Elementalist f-Weapon">
  <a href="/wiki/Elementalist"><img alt="Elementalist icon small.png" /></a> &#8201;
  <span style="overflow: hidden;"><span><a href="/wiki/Ring_of_Fire"><img alt="Ring of Fire" /></a></span></span>
  &#160;<a href="/wiki/Ring_of_Fire" title="Ring of Fire">Ring of Fire</a>&#160;&#8212;&#160;Dagger, when attuned to fire
</li>
</ul>
</div>
`;

const TRAITS_HTML = `
<div class="mw-parser-output">
<h2><span class="mw-headline" id="Related_traits">Related traits</span></h2>
<h4><span class="mw-headline" id="Fire"><a href="/wiki/Fire">Fire</a></span></h4>
<ul>
<li>
  <span class="inline-icon"><a href="/wiki/Burning_Precision"><img alt="Burning Precision" /></a></span>
  <a href="/wiki/Burning_Precision" title="Burning Precision">Burning Precision</a>&#32;&#8212;&#32;Burning you inflict has increased duration.
</li>
</ul>
<h4><span class="mw-headline" id="Catalyst"><a href="/wiki/Catalyst">Catalyst</a></span></h4>
<ul>
<li>
  <span class="inline-icon"><a href="/wiki/Spectacular_Sphere"><img alt="Spectacular Sphere" /></a></span>
  <a href="/wiki/Spectacular_Sphere" title="Spectacular Sphere">Spectacular Sphere</a>&#32;&#8212;&#32;Jade Sphere has reduced recharge.
</li>
</ul>
</div>
`;

describe("getWikiRelatedData", () => {
  beforeEach(() => {
    freshLoad();
  });

  test("returns empty arrays for empty title", async () => {
    const result = await wiki.getWikiRelatedData("");
    expect(result).toEqual({ relatedSkills: [], relatedTraits: [] });
  });

  test("returns empty arrays when page has no related sections", async () => {
    jest.doMock("../../src/main/gw2Data/fetch", () => ({
      WIKI_API_ROOT: "https://wiki.guildwars2.com/api.php",
      cache: { get: () => null, set: jest.fn() },
      fetchJson: jest.fn().mockResolvedValue({ parse: { sections: [] } }),
    }));
    freshLoad();
    const result = await wiki.getWikiRelatedData("Some Skill");
    expect(result).toEqual({ relatedSkills: [], relatedTraits: [] });
  });

  test("parses related skills HTML into name+context pairs", async () => {
    jest.doMock("../../src/main/gw2Data/fetch", () => ({
      WIKI_API_ROOT: "https://wiki.guildwars2.com/api.php",
      cache: { get: () => null, set: jest.fn() },
      fetchJson: jest.fn()
        .mockResolvedValueOnce({
          parse: {
            sections: [
              { index: "1", line: "Related skills" },
            ],
          },
        })
        .mockResolvedValueOnce({ parse: { text: SKILLS_HTML } }),
    }));
    freshLoad();
    const result = await wiki.getWikiRelatedData("Burning Precision");
    expect(result.relatedSkills).toHaveLength(2);
    expect(result.relatedSkills[0].name).toBe("Drake's Breath");
    expect(result.relatedSkills[0].context).toContain("Dagger");
    expect(result.relatedSkills[1].name).toBe("Ring of Fire");
  });

  test("parses related traits HTML into grouped structure", async () => {
    jest.doMock("../../src/main/gw2Data/fetch", () => ({
      WIKI_API_ROOT: "https://wiki.guildwars2.com/api.php",
      cache: { get: () => null, set: jest.fn() },
      fetchJson: jest.fn()
        .mockResolvedValueOnce({
          parse: {
            sections: [
              { index: "2", line: "Related traits" },
            ],
          },
        })
        .mockResolvedValueOnce({ parse: { text: TRAITS_HTML } }),
    }));
    freshLoad();
    const result = await wiki.getWikiRelatedData("Burning Retreat");
    expect(result.relatedTraits).toHaveLength(2);
    expect(result.relatedTraits[0].groupName).toBe("Fire");
    expect(result.relatedTraits[0].items[0].name).toBe("Burning Precision");
    expect(result.relatedTraits[1].groupName).toBe("Catalyst");
    expect(result.relatedTraits[1].items[0].name).toBe("Spectacular Sphere");
  });

  test("extracts skill name correctly when context contains inline links", async () => {
    // Real wiki HTML: context ends with <a title="Fire">fire</a> — must NOT be picked up as the name
    const htmlWithContextLinks = `
<div class="mw-parser-output">
<ul>
<li class="filter-list f-Elementalist f-Weapon">
  <a href="/wiki/Elementalist"><img alt="Elementalist icon small.png" /></a>
  <span><a href="/wiki/Drake%27s_Breath"><img alt="Drake's Breath" /></a></span>
  &#160;<a href="/wiki/Drake%27s_Breath" title="Drake&#39;s Breath">Drake's Breath</a>&#160;&#8212;&#160;Dagger, when attuned to <a href="/wiki/Fire" title="Fire">fire</a>
</li>
</ul>
</div>`;
    jest.doMock("../../src/main/gw2Data/fetch", () => ({
      WIKI_API_ROOT: "https://wiki.guildwars2.com/api.php",
      cache: { get: () => null, set: jest.fn() },
      fetchJson: jest.fn()
        .mockResolvedValueOnce({ parse: { sections: [{ index: "1", line: "Related skills" }] } })
        .mockResolvedValueOnce({ parse: { text: htmlWithContextLinks } }),
    }));
    freshLoad();
    const result = await wiki.getWikiRelatedData("Burning Precision");
    expect(result.relatedSkills).toHaveLength(1);
    expect(result.relatedSkills[0].name).toBe("Drake's Breath");
    expect(result.relatedSkills[0].context).toContain("Dagger");
    expect(result.relatedSkills[0].context).toContain("fire");
  });

  test("returns empty arrays when fetchJson throws", async () => {
    jest.doMock("../../src/main/gw2Data/fetch", () => ({
      WIKI_API_ROOT: "https://wiki.guildwars2.com/api.php",
      cache: { get: () => null, set: jest.fn() },
      fetchJson: jest.fn().mockRejectedValue(new Error("network error")),
    }));
    freshLoad();
    const result = await wiki.getWikiRelatedData("Any Skill");
    expect(result).toEqual({ relatedSkills: [], relatedTraits: [] });
  });

  test("uses cached result on second call", async () => {
    const cached = { relatedSkills: [{ name: "Cached", context: "" }], relatedTraits: [] };
    jest.doMock("../../src/main/gw2Data/fetch", () => ({
      WIKI_API_ROOT: "https://wiki.guildwars2.com/api.php",
      cache: {
        get: () => ({ value: cached, expiresAt: Date.now() + 60000 }),
        set: jest.fn(),
      },
      fetchJson: jest.fn(),
    }));
    freshLoad();
    const result = await wiki.getWikiRelatedData("Burning Precision");
    expect(result).toBe(cached);
  });
});
