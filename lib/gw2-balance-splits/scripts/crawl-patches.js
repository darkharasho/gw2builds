#!/usr/bin/env node
/**
 * crawl-patches.js — Incremental split updater.
 *
 * Finds GW2 wiki game-update pages published since splits.json was last seeded,
 * extracts skill/trait wikilinks from those patch notes, filters to only pages
 * in the split categories, and re-runs fact extraction on those pages to update
 * splits.json without a full reseed.
 *
 * Usage: node lib/gw2-balance-splits/scripts/crawl-patches.js
 *
 * When to run: after a GW2 balance patch, before the next app release.
 * When to full-reseed instead: when many skills change, or splits seem wrong.
 */

const path = require("path");
const fs   = require("fs/promises");

const WIKI_API   = "https://wiki.guildwars2.com/api.php";
const USER_AGENT = "GW2Builds-PatchCrawler/1.0 (https://github.com/gw2builds)";

const {
  rateLimitedFetch, extractFromWikitext,
  validateSplitEntry, writeOutput,
} = require("./seed");

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Extract all [[Page Title]] and [[Page Title|label]] links from wikitext.
 * Returns a deduplicated array of page title strings (section anchors stripped).
 */
function extractWikilinks(wikitext) {
  const pattern = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  const titles = new Set();
  let match;
  while ((match = pattern.exec(wikitext)) !== null) {
    const title = match[1].trim();
    if (title) titles.add(title);
  }
  return [...titles];
}

/**
 * Given a list of wikilink titles and a Set of known split page titles,
 * return only the titles that appear in the split set.
 */
function filterToSplitPages(links, knownSplitPages) {
  return links.filter((title) => knownSplitPages.has(title));
}

module.exports = { extractWikilinks, filterToSplitPages };
