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

// ── Network helpers ───────────────────────────────────────────────────────────

/**
 * Fetch wiki game-update pages modified after `since` (ISO date string).
 * Returns array of page title strings, e.g. ["2026 March 12", "2026 February 25"].
 */
async function fetchPatchPagesSince(since) {
  // cmend is the older boundary (category sorted newest-first by timestamp)
  const sinceEncoded = encodeURIComponent(since);
  const url =
    `${WIKI_API}?action=query&list=categorymembers` +
    `&cmtitle=Category%3AGame_updates` +
    `&cmsort=timestamp&cmdir=desc&cmlimit=20` +
    `&cmprop=title%7Ctimestamp` +
    `&cmend=${sinceEncoded}` +
    `&format=json`;
  const res = await rateLimitedFetch(url);
  const data = await res.json();
  return (data.query?.categorymembers || []).map((m) => m.title);
}

/**
 * Fetch all page titles from Category:Split_skills and Category:Split_traits.
 * Returns a Set<string> of wiki page titles that have WvW splits.
 */
async function fetchSplitPageTitles() {
  const titles = new Set();
  for (const category of ["Category:Split skills", "Category:Split traits"]) {
    let cmcontinue = "";
    do {
      const url =
        `${WIKI_API}?action=query&list=categorymembers` +
        `&cmtitle=${encodeURIComponent(category)}&cmnamespace=0&cmlimit=500&format=json` +
        (cmcontinue ? `&cmcontinue=${encodeURIComponent(cmcontinue)}` : "");
      const res = await rateLimitedFetch(url);
      const data = await res.json();
      for (const m of data.query?.categorymembers || []) {
        titles.add(m.title);
      }
      cmcontinue = data.continue?.cmcontinue || "";
    } while (cmcontinue);
  }
  return titles;
}

/**
 * Fetch the raw wikitext of a wiki page.
 * Returns the wikitext string, or null on failure.
 */
async function fetchWikitext(pageTitle) {
  const url =
    `${WIKI_API}?action=parse&page=${encodeURIComponent(pageTitle)}` +
    `&prop=wikitext&format=json`;
  try {
    const res = await rateLimitedFetch(url);
    const data = await res.json();
    return data.parse?.wikitext?.["*"] || null;
  } catch {
    return null;
  }
}

module.exports = { extractWikilinks, filterToSplitPages };
