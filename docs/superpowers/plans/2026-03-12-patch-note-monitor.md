# Patch Note Crawler Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an incremental update script that crawls GW2 wiki patch note pages published since the last seed, extracts skill/trait wikilinks from those notes, filters to only pages in the split categories, and re-runs fact extraction on just those pages to update `splits.json` without a full reseed.

**Architecture:** A new `crawl-patches.js` script sits alongside `seed.js` as a companion tool. It reuses extraction logic from `seed.js` (added to its exports), builds a set of known split pages from the wiki categories, and only re-extracts entries that appear in patch notes published after `splits.json.updatedAt`. The merge is additive — new splits are added, updated splits replace existing ones, removed splits are left as-is (full reseed handles removals).

**Tech Stack:** Node.js; no new deps — same wiki API pattern as `seed.js`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `lib/gw2-balance-splits/scripts/crawl-patches.js` | New: find patch pages since last seed, extract wikilinks, filter to split pages, re-extract and merge |
| `lib/gw2-balance-splits/scripts/seed.js` | Modified: export `extractFromWikitext`, `lookupWikiImageUrls`, `validateSplitEntry`, `rateLimitedFetch`, `writeOutput` for reuse |
| `tests/unit/crawl-patches.test.js` | New: unit tests for wikilink extraction and patch-page filtering logic |
| `package.json` | Modified: add `crawl` npm script |

---

## Chunk 1: Export shared functions from seed.js

`crawl-patches.js` needs to reuse `extractFromWikitext`, `rateLimitedFetch`, `validateSplitEntry`, `lookupWikiImageUrls`, and `writeOutput` from `seed.js`. Currently only parsing helpers are exported.

### Task 1: Extend seed.js module.exports

**Files:**
- Modify: `lib/gw2-balance-splits/scripts/seed.js` — bottom `module.exports` line

- [ ] **Step 1: Add the shared functions to exports**

Find this line near the bottom of `seed.js`:
```js
module.exports = { parseSplitGrouping, parseWikitextFacts, mapWikiFactToApiFact, parseInfoboxParams, validateSplitEntry };
```

Replace with:
```js
module.exports = {
  // Parsing helpers (used by tests)
  parseSplitGrouping, parseWikitextFacts, mapWikiFactToApiFact, parseInfoboxParams,
  // Shared infrastructure (used by crawl-patches.js)
  rateLimitedFetch, lookupWikiImageUrls, extractFromWikitext,
  validateSplitEntry, writeOutput,
};
```

- [ ] **Step 2: Verify existing tests still pass**

```bash
npm test -- --testPathPattern=scraper
```

Expected: all scraper tests pass (exports are additive — nothing removed)

- [ ] **Step 3: Commit**

```bash
git add lib/gw2-balance-splits/scripts/seed.js
git commit -m "feat(splits): export shared extraction functions from seed.js"
```

---

## Chunk 2: Core crawler logic (pure functions)

These functions have no side effects and are fully unit-testable. Write tests first.

### Task 2: extractWikilinks — parse patch-note wikitext for linked page titles

**Files:**
- Create: `lib/gw2-balance-splits/scripts/crawl-patches.js` (stub + one function)
- Create: `tests/unit/crawl-patches.test.js`

GW2 wiki patch notes look like:
```
== World versus World ==
* [[Berserker's Stance]]: Recharge reduced from 60 to 50 in WvW.
* [[Healer's Retribution]]: Now also grants [[Resistance]] for 2s in WvW.
```

We want all `[[Page Title]]` and `[[Page Title|display text]]` links, returned as a deduplicated array of page title strings.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/crawl-patches.test.js`:

```js
const { extractWikilinks } = require("../../lib/gw2-balance-splits/scripts/crawl-patches");

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
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- tests/unit/crawl-patches.test.js
```

Expected: FAIL — module not found

- [ ] **Step 3: Create crawl-patches.js with extractWikilinks**

Create `lib/gw2-balance-splits/scripts/crawl-patches.js`:

```js
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

module.exports = { extractWikilinks };
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- tests/unit/crawl-patches.test.js
```

Expected: 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/gw2-balance-splits/scripts/crawl-patches.js tests/unit/crawl-patches.test.js
git commit -m "feat(splits): add crawl-patches.js with extractWikilinks"
```

---

### Task 3: filterToSplitPages — intersect wikilinks with known split pages

We need to know which linked pages are actually in the split categories, so we only re-extract those. This function takes a Set of known split page titles and a list of wikilinks, and returns the intersection.

**Files:**
- Modify: `lib/gw2-balance-splits/scripts/crawl-patches.js`
- Modify: `tests/unit/crawl-patches.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/crawl-patches.test.js`:

```js
const { extractWikilinks, filterToSplitPages } = require("../../lib/gw2-balance-splits/scripts/crawl-patches");

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
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- tests/unit/crawl-patches.test.js
```

Expected: 3 new tests FAIL — filterToSplitPages not defined

- [ ] **Step 3: Implement filterToSplitPages in crawl-patches.js**

Add after `extractWikilinks`:

```js
/**
 * Given a list of wikilink titles and a Set of known split page titles,
 * return only the titles that appear in the split set.
 */
function filterToSplitPages(links, knownSplitPages) {
  return links.filter((title) => knownSplitPages.has(title));
}
```

Update `module.exports`:
```js
module.exports = { extractWikilinks, filterToSplitPages };
```

- [ ] **Step 4: Run tests to confirm all pass**

```bash
npm test -- tests/unit/crawl-patches.test.js
```

Expected: all 9 tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/gw2-balance-splits/scripts/crawl-patches.js tests/unit/crawl-patches.test.js
git commit -m "feat(splits): add filterToSplitPages to crawl-patches.js"
```

---

## Chunk 3: Network functions + main()

### Task 4: fetchPatchPagesSince — get wiki patch note pages added after a date

**Files:**
- Modify: `lib/gw2-balance-splits/scripts/crawl-patches.js`

Wiki's `Category:Game_updates` has member pages for each patch (one page per update date). We use `cmsort=timestamp&cmdir=desc` and filter by `cmstart` to get only pages added/modified after the last seed.

Note: `cmstart` is the END of the range when using `cmdir=desc` (the wiki API uses start/end relative to the sort direction). To get pages NEWER than a date in descending order, use `cmend` for the cutoff.

- [ ] **Step 1: Add fetchPatchPagesSince to crawl-patches.js**

```js
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
```

- [ ] **Step 2: Add fetchSplitPageTitles — get all known split page titles**

This builds the Set used by `filterToSplitPages`. It reuses the wiki category query that `seed.js`'s `discoverSplitPages` uses.

```js
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
```

- [ ] **Step 3: Add fetchWikitext — get raw wikitext for a page (for patch note parsing)**

```js
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
```

- [ ] **Step 4: Commit**

```bash
git add lib/gw2-balance-splits/scripts/crawl-patches.js
git commit -m "feat(splits): add network helpers to crawl-patches.js"
```

---

### Task 5: main() — wire everything together

**Files:**
- Modify: `lib/gw2-balance-splits/scripts/crawl-patches.js`

The main flow:
1. Load `splits.json` to get `updatedAt`
2. Fetch all split page titles (the known-splits Set)
3. Fetch patch note pages published after `updatedAt`
4. For each patch page, fetch its wikitext, extract wikilinks, filter to split pages
5. Deduplicate the affected pages across all patch notes
6. Re-extract each affected page using `extractFromWikitext` (from seed.js)
7. Merge results into existing splits data
8. Write updated `splits.json` with new `updatedAt`

- [ ] **Step 1: Add the merge helper**

```js
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
```

- [ ] **Step 2: Add main()**

```js
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

module.exports = { extractWikilinks, filterToSplitPages };

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Smoke-test the script (will hit the real wiki)**

```bash
node lib/gw2-balance-splits/scripts/crawl-patches.js
```

Expected: prints patch pages found since last seed and re-extracts any affected split pages. If no new patches, prints "splits are up to date."

- [ ] **Step 3: Commit**

```bash
git add lib/gw2-balance-splits/scripts/crawl-patches.js
git commit -m "feat(splits): implement patch note crawler with incremental reseed"
```

---

## Chunk 4: npm script + full test run

### Task 6: Wire up npm script and verify

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `crawl` script to package.json**

Add to the `"scripts"` block:

```json
"crawl": "node lib/gw2-balance-splits/scripts/crawl-patches.js"
```

The workflow is now:
- `npm run seed` — full reseed from scratch (slow, ~500 wiki pages)
- `npm run crawl` — incremental update from patch notes (fast, only changed pages)

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(splits): add crawl npm script for incremental patch-note updates"
```

---

## Done

After these tasks, the maintenance workflow for keeping splits current is:

```
npm run crawl    # After a GW2 balance patch — fast incremental update
npm run seed     # Periodic full refresh, or when crawl seems wrong
```

The crawler finds all GW2 wiki patch note pages published since `splits.json.updatedAt`, extracts every skill/trait wikilink from them, and re-extracts only those that are in the split categories. The rest of the existing splits data is untouched.
