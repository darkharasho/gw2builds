"use strict";

const { skeletonTemplates, injectSkeleton } = require("../../../src/renderer/modules/skeleton");

describe("skeletonTemplates", () => {
  test("exports templates for all five panels", () => {
    expect(skeletonTemplates).toHaveProperty("skills");
    expect(skeletonTemplates).toHaveProperty("specs");
    expect(skeletonTemplates).toHaveProperty("equipment");
    expect(skeletonTemplates).toHaveProperty("detail");
    expect(skeletonTemplates).toHaveProperty("dropdown");
  });

  test("each template is a non-empty string containing skel class", () => {
    for (const [key, html] of Object.entries(skeletonTemplates)) {
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain("skel");
    }
  });

  test("skills template contains weapon and mechanic groups", () => {
    expect(skeletonTemplates.skills).toContain("skel-skills__group");
    expect(skeletonTemplates.skills).toContain("skel-skills__sep");
  });

  test("specs template contains 3 spec cards with hex emblems", () => {
    const matches = skeletonTemplates.specs.match(/skel-spec-card__emblem/g);
    expect(matches).toHaveLength(3);
    expect(skeletonTemplates.specs).toContain("skel-hex");
  });

  test("specs template has major (square) and minor (hex) traits", () => {
    expect(skeletonTemplates.specs).toContain("skel-spec-card__major-trait");
    expect(skeletonTemplates.specs).toContain("skel-spec-card__minor");
  });

  test("equipment template contains 3-column layout", () => {
    expect(skeletonTemplates.equipment).toContain("skel-equip__col--art");
    expect(skeletonTemplates.equipment).toContain("skel-equip__slot-icon");
    expect(skeletonTemplates.equipment).toContain("skel-equip__trinket");
  });

  test("detail template has icon+text fact rows", () => {
    expect(skeletonTemplates.detail).toContain("skel-detail__fact-row");
    expect(skeletonTemplates.detail).toContain("skel-detail__fact-icon");
  });
});

describe("injectSkeleton", () => {
  test("sets innerHTML of element to the named template", () => {
    const el = { innerHTML: "" };
    injectSkeleton(el, "skills");
    expect(el.innerHTML).toBe(skeletonTemplates.skills);
  });

  test("does nothing if element is null", () => {
    expect(() => injectSkeleton(null, "skills")).not.toThrow();
  });

  test("does nothing if template name is unknown", () => {
    const el = { innerHTML: "existing" };
    injectSkeleton(el, "nonexistent");
    expect(el.innerHTML).toBe("existing");
  });
});
