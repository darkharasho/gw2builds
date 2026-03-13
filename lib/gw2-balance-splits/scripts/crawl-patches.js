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

const MONTH_NAMES = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
};

/**
 * Parse a page title like "Game updates/2026 March 12" into a Date.
 * Returns null if the title doesn't match the expected format.
 */
function parsePatchPageDate(title) {
  const m = title.match(/^Game updates\/(\d{4}) (\w+) (\d+)$/);
  if (!m) return null;
  const month = MONTH_NAMES[m[2]];
  if (month === undefined) return null;
  return new Date(parseInt(m[1]), month, parseInt(m[3]));
}

/**
 * Fetch wiki game-update pages published after `since` (ISO date string).
 * Uses allpages with a year prefix and filters by parsing dates from titles.
 * Returns array of page title strings newest-first.
 */
async function fetchPatchPagesSince(since) {
  const sinceDate = new Date(since);
  const sinceYear = sinceDate.getFullYear();
  const currentYear = new Date().getFullYear();

  const titles = [];
  for (let year = sinceYear; year <= currentYear; year++) {
    let apcontinue = "";
    do {
      const url =
        `${WIKI_API}?action=query&list=allpages` +
        `&apprefix=${encodeURIComponent(`Game updates/${year}`)}&apnamespace=0&aplimit=500&format=json` +
        (apcontinue ? `&apcontinue=${encodeURIComponent(apcontinue)}` : "");
      const res = await rateLimitedFetch(url);
      const data = await res.json();
      for (const p of data.query?.allpages || []) {
        titles.push(p.title);
      }
      apcontinue = data.continue?.apcontinue || "";
    } while (apcontinue);
  }

  return titles
    .filter((t) => { const d = parsePatchPageDate(t); return d && d > sinceDate; })
    .sort((a, b) => parsePatchPageDate(b) - parsePatchPageDate(a));
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

// ── Merge & orchestration ─────────────────────────────────────────────────────

/**
 * Merge a single crawl result into the existing skills/traits buckets.
 * New entries are added; existing entries are replaced with fresh data.
 */
function mergeResult(result, skills, traits) {
  const bucket = result.type === "trait" ? traits : skills;
  const existing = bucket[String(result.id)] || {};
  const modes = { ...(existing.modes || {}) };
  modes.wvw = { facts: result.facts, complete: result.complete };
  if (result.pveFacts?.length) {
    modes.pve = { facts: result.pveFacts };
  }
  bucket[String(result.id)] = {
    name: existing.name || "",
    modes,
  };
}

async function main() {
  console.log("=== GW2 Patch Note Crawler ===\n");

  const SPLITS_PATH = path.join(__dirname, "..", "data", "splits.json");
  const existing = JSON.parse(await fs.readFile(SPLITS_PATH, "utf8"));
  const since = existing.updatedAt;

  console.log(`  Last seeded : ${since}`);

  // Step 1: Discover all known split pages (to filter patch-note links against)
  console.log("  Fetching split page titles...");
  const splitPageTitles = await fetchSplitPageTitles();
  console.log(`  Known split pages : ${splitPageTitles.size}`);

  // Step 2: Find patch notes published after last seed
  console.log("  Fetching patch pages since last seed...");
  const patchPages = await fetchPatchPagesSince(since);
  if (patchPages.length === 0) {
    console.log("  No new patch pages found — splits are up to date.\n");
    return;
  }
  console.log(`  Found ${patchPages.length} patch page(s): ${patchPages.join(", ")}\n`);

  // Step 3: Extract affected split pages from each patch note
  const affectedPages = new Set();
  for (const patchPage of patchPages) {
    const wikitext = await fetchWikitext(patchPage);
    if (!wikitext) continue;
    const links = extractWikilinks(wikitext);
    const splitLinks = filterToSplitPages(links, splitPageTitles);
    console.log(`  ${patchPage}: ${splitLinks.length} split page(s) affected`);
    for (const title of splitLinks) affectedPages.add(title);
  }

  if (affectedPages.size === 0) {
    console.log("\n  No split pages affected by recent patches.\n");
    return;
  }

  console.log(`\n  Re-extracting ${affectedPages.size} page(s)...\n`);

  // Step 4: Re-extract each affected page and merge into existing data
  const skills = { ...existing.skills };
  const traits = { ...existing.traits };
  let updated = 0, failed = 0;

  for (const pageTitle of affectedPages) {
    process.stdout.write(`  Extracting: ${pageTitle}... `);
    const result = await extractFromWikitext(pageTitle);
    if (result && validateSplitEntry(result)) {
      mergeResult(result, skills, traits);
      updated++;
      process.stdout.write("✓\n");
    } else {
      failed++;
      process.stdout.write("✗ (no valid split data)\n");
    }
  }

  // Step 5: Write updated splits.json
  await writeOutput(skills, traits);

  console.log(`\n=== Done ===`);
  console.log(`  Updated : ${updated}`);
  console.log(`  Skipped : ${failed}`);
}

module.exports = { extractWikilinks, filterToSplitPages, main };

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
