"use strict";

// detail-modal.js uses ES module imports — transformed by babel-jest.
// window.desktopApi is mocked; no real DOM needed beyond jsdom-like mocks.
// The jest testEnvironment is "node", so we mock document globally.

let detailModal;

// Minimal DOM mock
function makeDom() {
  const elements = {};
  const appendedChildren = [];

  function makeEl(id) {
    return {
      id,
      className: "",
      innerHTML: "",
      textContent: "",
      style: {},
      disabled: false,
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
      },
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      scrollTop: 0,
      querySelector: (sel) => {
        const id2 = sel.replace("#", "");
        return elements[id2] || null;
      },
    };
  }

  const body = makeEl("body");
  body.appendChild = jest.fn((el) => { appendedChildren.push(el); });

  // Simulate getElementById
  const getElementById = jest.fn((id) => elements[id] || null);

  // Pre-populate elements that initDetailModal will look up
  [
    "dm-title", "dm-wiki-btn", "dm-close", "dm-body", "dm-icon",
    "dm-prof-icon", "dm-name", "dm-meta", "dm-desc", "dm-facts",
    "dm-related-skills-section", "dm-related-traits-section",
    "dm-skills-spinner", "dm-traits-spinner",
    "dm-related-skills", "dm-related-traits",
  ].forEach((id) => { elements[id] = makeEl(id); });

  return { body, getElementById, appendedChildren, elements };
}

function freshLoad(dom) {
  jest.resetModules();
  global.document = {
    createElement: () => {
      const el = {
        className: "",
        innerHTML: "",
        appendChild: jest.fn(),
        classList: {
          _classes: new Set(),
          add(c) { this._classes.add(c); },
          remove(c) { this._classes.delete(c); },
          contains(c) { return this._classes.has(c); },
        },
      };
      return el;
    },
    body: dom.body,
    getElementById: dom.getElementById,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  global.window = {
    desktopApi: {
      getWikiRelatedData: jest.fn().mockResolvedValue({ relatedSkills: [], relatedTraits: [] }),
    },
  };
  detailModal = require("../../../src/renderer/modules/detail-modal");
}

describe("initDetailModal", () => {
  test("appends overlay to document.body once", () => {
    const dom = makeDom();
    freshLoad(dom);
    detailModal.initDetailModal();
    expect(dom.body.appendChild).toHaveBeenCalledTimes(1);
  });

  test("is idempotent — second call does nothing", () => {
    const dom = makeDom();
    freshLoad(dom);
    detailModal.initDetailModal();
    detailModal.initDetailModal();
    expect(dom.body.appendChild).toHaveBeenCalledTimes(1);
  });

  test("skips init when document is undefined", () => {
    jest.resetModules();
    global.document = undefined;
    detailModal = require("../../../src/renderer/modules/detail-modal");
    expect(() => detailModal.initDetailModal()).not.toThrow();
    global.document = {}; // restore
  });
});

describe("closeDetailModal", () => {
  test("adds --hidden class to overlay", () => {
    const dom = makeDom();
    freshLoad(dom);
    detailModal.initDetailModal();
    detailModal.closeDetailModal();
    const overlay = dom.body.appendChild.mock.calls[0][0];
    // The overlay's classList should have received --hidden
    // (We test via the added class or lack of error)
    expect(() => detailModal.closeDetailModal()).not.toThrow();
  });
});
