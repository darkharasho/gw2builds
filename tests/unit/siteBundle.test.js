"use strict";

const { buildSiteBundle } = require("../../src/main/siteBundle");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuild(overrides = {}) {
  return {
    id: "build-001",
    title: "Power Warrior",
    profession: "Warrior",
    updatedAt: "2024-06-01T12:00:00.000Z",
    createdAt: "2024-05-01T08:00:00.000Z",
    notes: "Great open-world build",
    tags: ["pve", "dps", "power"],
    equipment: {
      statPackage: "Berserker",
      runeSet: "Superior Rune of the Scholar",
      relic: "Relic of the Thief",
      food: "Bowl of Seaweed Salad",
      utility: "Superior Sharpening Stone",
    },
    specializations: [
      {
        id: 4,
        name: "Strength",
        icon: "https://render.guildwars2.com/file/spec-4.png",
        background: "https://render.guildwars2.com/file/bg-4.png",
        majorChoices: { 1: 1444, 2: 1338, 3: 1451 },
        majorTraitsByTier: {
          1: [{ id: 1444, name: "Perseverance", icon: "trait-1444.png" }],
          2: [{ id: 1338, name: "Dual Wield Mastery", icon: "trait-1338.png" }],
          3: [{ id: 1451, name: "Berserker's Power", icon: "trait-1451.png" }],
        },
      },
    ],
    skills: {
      heal: { id: 14402, name: "Mending", icon: "mending.png", description: "Heal", type: "Heal", slot: "Heal" },
      utility: [
        { id: 14516, name: "Balanced Stance", icon: "bs.png", description: "Stance", type: "Utility", slot: "Utility" },
        { id: 14507, name: "Shake It Off!", icon: "sio.png", description: "Shout", type: "Utility", slot: "Utility" },
        null,
      ],
      elite: { id: 14404, name: "Rampage", icon: "rampage.png", description: "Transform", type: "Elite", slot: "Elite" },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildSiteBundle — return value structure
// ---------------------------------------------------------------------------

describe("buildSiteBundle — file keys", () => {
  test("returns exactly 5 files", () => {
    const bundle = buildSiteBundle([makeBuild()]);
    const keys = Object.keys(bundle);
    expect(keys).toHaveLength(5);
  });

  test("contains site/index.html", () => {
    const bundle = buildSiteBundle([]);
    expect(bundle["site/index.html"]).toBeTruthy();
  });

  test("contains site/styles.css", () => {
    const bundle = buildSiteBundle([]);
    expect(bundle["site/styles.css"]).toBeTruthy();
  });

  test("contains site/app.js", () => {
    const bundle = buildSiteBundle([]);
    expect(bundle["site/app.js"]).toBeTruthy();
  });

  test("contains site/data/builds.json", () => {
    const bundle = buildSiteBundle([]);
    expect(bundle["site/data/builds.json"]).toBeTruthy();
  });

  test("contains site/.nojekyll", () => {
    const bundle = buildSiteBundle([]);
    expect(bundle["site/.nojekyll"]).toBeTruthy();
  });

  test("site/.nojekyll is a newline (disables Jekyll)", () => {
    const bundle = buildSiteBundle([]);
    expect(bundle["site/.nojekyll"]).toBe("\n");
  });

  test("all values are strings", () => {
    const bundle = buildSiteBundle([makeBuild()]);
    for (const [key, value] of Object.entries(bundle)) {
      expect(typeof value).toBe("string");
    }
  });
});

describe("buildSiteBundle — site/index.html", () => {
  let html;
  beforeEach(() => { html = buildSiteBundle([])["site/index.html"]; });

  test("is valid HTML5 with doctype", () => {
    expect(html.trimStart()).toMatch(/^<!doctype html>/i);
  });

  test("links to styles.css", () => {
    expect(html).toContain("./styles.css");
  });

  test("includes app.js script tag", () => {
    expect(html).toContain("./app.js");
  });

  test("has search input with correct id", () => {
    expect(html).toContain('id="searchInput"');
  });

  test("has build grid container", () => {
    expect(html).toContain('id="buildGrid"');
  });

  test("has generatedAt footer", () => {
    expect(html).toContain('id="generatedAt"');
  });

  test("has GW2 Builds title", () => {
    expect(html).toContain("GW2 Builds");
  });

  test("has lang=en on html element", () => {
    expect(html).toContain('lang="en"');
  });

  test("has viewport meta tag", () => {
    expect(html).toContain("viewport");
  });
});

describe("buildSiteBundle — site/styles.css", () => {
  let css;
  beforeEach(() => { css = buildSiteBundle([])["site/styles.css"]; });

  test("is non-empty string", () => {
    expect(css.length).toBeGreaterThan(0);
  });

  test("defines dark color scheme", () => {
    expect(css).toContain("color-scheme: dark");
  });

  test("includes build-card class", () => {
    expect(css).toContain(".build-card");
  });

  test("includes build-grid class", () => {
    expect(css).toContain(".build-grid");
  });

  test("includes token class for tags/equipment", () => {
    expect(css).toContain(".token");
  });
});

describe("buildSiteBundle — site/app.js", () => {
  let js;
  beforeEach(() => { js = buildSiteBundle([])["site/app.js"]; });

  test("is non-empty string", () => {
    expect(js.length).toBeGreaterThan(0);
  });

  test("fetches builds.json", () => {
    expect(js).toContain("builds.json");
  });

  test("defines matchesQuery function", () => {
    expect(js).toContain("matchesQuery");
  });

  test("defines escapeHtml function", () => {
    expect(js).toContain("escapeHtml");
  });

  test("handles XSS by escaping HTML entities in escapeHtml", () => {
    // escapeHtml must handle & < > " '
    expect(js).toContain("&amp;");
    expect(js).toContain("&lt;");
    expect(js).toContain("&gt;");
    expect(js).toContain("&quot;");
    expect(js).toContain("&#039;");
  });

  test("handles fetch errors gracefully (try/catch around init)", () => {
    expect(js).toContain("catch");
  });
});

describe("buildSiteBundle — site/data/builds.json", () => {
  test("is valid JSON", () => {
    const bundle = buildSiteBundle([makeBuild()]);
    expect(() => JSON.parse(bundle["site/data/builds.json"])).not.toThrow();
  });

  test("contains generatedAt timestamp", () => {
    const bundle = buildSiteBundle([]);
    const data = JSON.parse(bundle["site/data/builds.json"]);
    expect(data.generatedAt).toBeTruthy();
    expect(() => new Date(data.generatedAt)).not.toThrow();
    expect(Number.isNaN(new Date(data.generatedAt).getTime())).toBe(false);
  });

  test("generatedAt is a recent timestamp (within 1 minute)", () => {
    const before = Date.now();
    const bundle = buildSiteBundle([]);
    const after = Date.now();
    const data = JSON.parse(bundle["site/data/builds.json"]);
    const generated = new Date(data.generatedAt).getTime();
    expect(generated).toBeGreaterThanOrEqual(before);
    expect(generated).toBeLessThanOrEqual(after);
  });

  test("contains builds array", () => {
    const bundle = buildSiteBundle([makeBuild()]);
    const data = JSON.parse(bundle["site/data/builds.json"]);
    expect(Array.isArray(data.builds)).toBe(true);
    expect(data.builds).toHaveLength(1);
  });

  test("empty builds array when no builds provided", () => {
    const bundle = buildSiteBundle([]);
    const data = JSON.parse(bundle["site/data/builds.json"]);
    expect(data.builds).toEqual([]);
  });

  test("null/undefined builds argument produces empty array", () => {
    const bundle1 = buildSiteBundle(null);
    const bundle2 = buildSiteBundle(undefined);
    expect(JSON.parse(bundle1["site/data/builds.json"]).builds).toEqual([]);
    expect(JSON.parse(bundle2["site/data/builds.json"]).builds).toEqual([]);
  });

  test("ends with newline for git-friendliness", () => {
    const bundle = buildSiteBundle([]);
    expect(bundle["site/data/builds.json"]).toMatch(/\n$/);
  });
});

// ---------------------------------------------------------------------------
// normalizeBuildsForSite — individual build fields
// ---------------------------------------------------------------------------

describe("normalizeBuildsForSite — basic fields", () => {
  function getBuilds(builds) {
    return JSON.parse(buildSiteBundle(builds)["site/data/builds.json"]).builds;
  }

  test("maps id field", () => {
    const [b] = getBuilds([makeBuild({ id: "abc-123" })]);
    expect(b.id).toBe("abc-123");
  });

  test("maps title field", () => {
    const [b] = getBuilds([makeBuild({ title: "Power Warrior" })]);
    expect(b.title).toBe("Power Warrior");
  });

  test("falls back to 'Untitled Build' when title missing", () => {
    const [b] = getBuilds([makeBuild({ title: null })]);
    expect(b.title).toBe("Untitled Build");
  });

  test("maps profession field", () => {
    const [b] = getBuilds([makeBuild({ profession: "Guardian" })]);
    expect(b.profession).toBe("Guardian");
  });

  test("maps updatedAt field", () => {
    const [b] = getBuilds([makeBuild({ updatedAt: "2024-06-01T12:00:00.000Z" })]);
    expect(b.updatedAt).toBe("2024-06-01T12:00:00.000Z");
  });

  test("maps createdAt field", () => {
    const [b] = getBuilds([makeBuild({ createdAt: "2024-05-01T08:00:00.000Z" })]);
    expect(b.createdAt).toBe("2024-05-01T08:00:00.000Z");
  });

  test("maps notes field", () => {
    const [b] = getBuilds([makeBuild({ notes: "Great build for raids" })]);
    expect(b.notes).toBe("Great build for raids");
  });

  test("maps tags array", () => {
    const [b] = getBuilds([makeBuild({ tags: ["pve", "dps"] })]);
    expect(b.tags).toEqual(["pve", "dps"]);
  });

  test("empty string for missing id", () => {
    const [b] = getBuilds([makeBuild({ id: null })]);
    expect(b.id).toBe("");
  });

  test("empty string for missing profession", () => {
    const [b] = getBuilds([makeBuild({ profession: null })]);
    expect(b.profession).toBe("");
  });

  test("handles null build gracefully", () => {
    const builds = getBuilds([null]);
    expect(builds).toHaveLength(1);
    expect(builds[0].id).toBe("");
    expect(builds[0].title).toBe("Untitled Build");
  });
});

describe("normalizeBuildsForSite — specializations", () => {
  function getBuilds(builds) {
    return JSON.parse(buildSiteBundle(builds)["site/data/builds.json"]).builds;
  }

  test("maps specialization id, name, icon, background", () => {
    const [b] = getBuilds([makeBuild()]);
    expect(b.specializations[0].id).toBe(4);
    expect(b.specializations[0].name).toBe("Strength");
  });

  test("maps majorChoices", () => {
    const [b] = getBuilds([makeBuild()]);
    expect(b.specializations[0].majorChoices).toEqual({ 1: 1444, 2: 1338, 3: 1451 });
  });

  test("maps majorTraitsByTier with id, name, icon", () => {
    const [b] = getBuilds([makeBuild()]);
    expect(b.specializations[0].majorTraitsByTier[1]).toEqual([{ id: 1444, name: "Perseverance", icon: "trait-1444.png" }]);
  });

  test("majorChoices defaults to 0 when missing", () => {
    const [b] = getBuilds([makeBuild({
      specializations: [{ id: 4, name: "Strength", icon: "", background: "", majorChoices: {}, majorTraitsByTier: {} }],
    })]);
    expect(b.specializations[0].majorChoices).toEqual({ 1: 0, 2: 0, 3: 0 });
  });

  test("empty array for missing specializations", () => {
    const [b] = getBuilds([makeBuild({ specializations: null })]);
    expect(b.specializations).toEqual([]);
  });

  test("majorTraitsByTier tiers 1/2/3 all present even if empty", () => {
    const [b] = getBuilds([makeBuild({
      specializations: [{ id: 4, name: "Strength", majorChoices: {}, majorTraitsByTier: {} }],
    })]);
    expect(b.specializations[0].majorTraitsByTier[1]).toEqual([]);
    expect(b.specializations[0].majorTraitsByTier[2]).toEqual([]);
    expect(b.specializations[0].majorTraitsByTier[3]).toEqual([]);
  });
});

describe("normalizeBuildsForSite — skills", () => {
  function getBuilds(builds) {
    return JSON.parse(buildSiteBundle(builds)["site/data/builds.json"]).builds;
  }

  test("maps heal skill fields", () => {
    const [b] = getBuilds([makeBuild()]);
    expect(b.skills.heal.id).toBe(14402);
    expect(b.skills.heal.name).toBe("Mending");
    expect(b.skills.heal.icon).toBe("mending.png");
    expect(b.skills.heal.type).toBe("Heal");
    expect(b.skills.heal.slot).toBe("Heal");
  });

  test("maps utility skills array", () => {
    const [b] = getBuilds([makeBuild()]);
    expect(b.skills.utility).toHaveLength(3);
    expect(b.skills.utility[0].id).toBe(14516);
    expect(b.skills.utility[2]).toBeNull();
  });

  test("maps elite skill", () => {
    const [b] = getBuilds([makeBuild()]);
    expect(b.skills.elite.id).toBe(14404);
    expect(b.skills.elite.name).toBe("Rampage");
  });

  test("null heal is null", () => {
    const [b] = getBuilds([makeBuild({
      skills: { heal: null, utility: [null, null, null], elite: null },
    })]);
    expect(b.skills.heal).toBeNull();
  });

  test("empty utility array when skills.utility is undefined", () => {
    const [b] = getBuilds([makeBuild({
      skills: { heal: null, utility: undefined, elite: null },
    })]);
    expect(Array.isArray(b.skills.utility)).toBe(true);
    expect(b.skills.utility).toEqual([]);
  });

  test("normalizes skill id to number", () => {
    const [b] = getBuilds([makeBuild({
      skills: {
        heal: { id: "14402", name: "Mending", icon: "", description: "", type: "Heal", slot: "Heal" },
        utility: [null, null, null],
        elite: null,
      },
    })]);
    expect(typeof b.skills.heal.id).toBe("number");
    expect(b.skills.heal.id).toBe(14402);
  });
});

describe("normalizeBuildsForSite — equipment", () => {
  function getBuilds(builds) {
    return JSON.parse(buildSiteBundle(builds)["site/data/builds.json"]).builds;
  }

  test("maps all equipment fields", () => {
    const [b] = getBuilds([makeBuild()]);
    expect(b.equipment.statPackage).toBe("Berserker");
    expect(b.equipment.runeSet).toBe("Superior Rune of the Scholar");
    expect(b.equipment.relic).toBe("Relic of the Thief");
    expect(b.equipment.food).toBe("Bowl of Seaweed Salad");
    expect(b.equipment.utility).toBe("Superior Sharpening Stone");
  });

  test("empty strings for missing equipment fields", () => {
    const [b] = getBuilds([makeBuild({ equipment: {} })]);
    expect(b.equipment.statPackage).toBe("");
    expect(b.equipment.runeSet).toBe("");
    expect(b.equipment.relic).toBe("");
    expect(b.equipment.food).toBe("");
    expect(b.equipment.utility).toBe("");
  });

  test("null equipment produces empty string fields", () => {
    const [b] = getBuilds([makeBuild({ equipment: null })]);
    expect(b.equipment.statPackage).toBe("");
    expect(b.equipment.runeSet).toBe("");
  });
});

describe("normalizeBuildsForSite — multiple builds", () => {
  function getBuilds(builds) {
    return JSON.parse(buildSiteBundle(builds)["site/data/builds.json"]).builds;
  }

  test("preserves order of multiple builds", () => {
    const builds = [
      makeBuild({ id: "1", title: "First" }),
      makeBuild({ id: "2", title: "Second" }),
      makeBuild({ id: "3", title: "Third" }),
    ];
    const result = getBuilds(builds);
    expect(result[0].title).toBe("First");
    expect(result[1].title).toBe("Second");
    expect(result[2].title).toBe("Third");
  });

  test("normalizes all builds in the array", () => {
    const builds = Array.from({ length: 10 }, (_, i) => makeBuild({ id: String(i), title: `Build ${i}` }));
    const result = getBuilds(builds);
    expect(result).toHaveLength(10);
    result.forEach((b, i) => {
      expect(b.id).toBe(String(i));
      expect(b.title).toBe(`Build ${i}`);
    });
  });
});

describe("normalizeBuildsForSite — tags normalization", () => {
  function getBuilds(builds) {
    return JSON.parse(buildSiteBundle(builds)["site/data/builds.json"]).builds;
  }

  test("converts tag values to strings", () => {
    const [b] = getBuilds([makeBuild({ tags: [123, "pve", true] })]);
    expect(b.tags).toEqual(["123", "pve", "true"]);
  });

  test("empty array when tags is null", () => {
    const [b] = getBuilds([makeBuild({ tags: null })]);
    expect(b.tags).toEqual([]);
  });

  test("empty array when tags is non-array", () => {
    const [b] = getBuilds([makeBuild({ tags: "pve,dps" })]);
    expect(b.tags).toEqual([]);
  });
});
