"use strict";

const detailPanel = require("../../../src/renderer/modules/detail-panel");

function makeDetachHost() {
  return { addEventListener: jest.fn() };
}

describe("initDetailPanel — openWikiModal callback injection", () => {
  test("registers a click listener on detailHost", () => {
    const detailHost = makeDetachHost();
    detailPanel.initDetailPanel({ detailHost, hoverPreview: null }, {});
    expect(detailHost.addEventListener).toHaveBeenCalledWith("click", expect.any(Function));
  });

  test("calls openWikiModal with the data-url when a [data-url] element is clicked", () => {
    const openWikiModal = jest.fn();
    const detailHost = makeDetachHost();
    detailPanel.initDetailPanel({ detailHost, hoverPreview: null }, { openWikiModal });

    const [, handler] = detailHost.addEventListener.mock.calls.at(-1);
    const btn = { dataset: { url: "https://wiki.guildwars2.com/wiki/Fireball" } };
    handler({ target: { closest: () => btn } });

    expect(openWikiModal).toHaveBeenCalledWith("https://wiki.guildwars2.com/wiki/Fireball");
  });

  test("does not call openWikiModal when the clicked element has no [data-url]", () => {
    const openWikiModal = jest.fn();
    const detailHost = makeDetachHost();
    detailPanel.initDetailPanel({ detailHost, hoverPreview: null }, { openWikiModal });

    const [, handler] = detailHost.addEventListener.mock.calls.at(-1);
    handler({ target: { closest: () => null } });

    expect(openWikiModal).not.toHaveBeenCalled();
  });

  test("does not throw when no openWikiModal callback is provided", () => {
    const detailHost = makeDetachHost();
    detailPanel.initDetailPanel({ detailHost, hoverPreview: null }, {});

    const [, handler] = detailHost.addEventListener.mock.calls.at(-1);
    const btn = { dataset: { url: "https://wiki.guildwars2.com/wiki/Fireball" } };
    expect(() => handler({ target: { closest: () => btn } })).not.toThrow();
  });
});
