#!/usr/bin/env node
/**
 * seed.js — Build splits.json by scraping the GW2 Wiki for balance-split data.
 *
 * Fallback chain per skill/trait (most reliable → least):
 *   1. SMW (Semantic MediaWiki) query
 *   2. Wikitext template parsing
 *   3. HTML scraping
 *
 * Usage: node lib/gw2-balance-splits/scripts/seed.js
 *
 * Dependencies: cheerio (npm install cheerio)
 */

const path = require("path");
const fs = require("fs/promises");

// Lazy-load cheerio — only needed for HTML fallback
let cheerio;
function getCheerio() {
  if (!cheerio) cheerio = require("cheerio");
  return cheerio;
}

const WIKI_API = "https://wiki.guildwars2.com/api.php";
const GW2_API = "https://api.guildwars2.com/v2";
const OUTPUT_PATH = path.join(__dirname, "..", "data", "splits.json");

// Rate-limit: 1 request per 200ms to be kind to the wiki
const RATE_LIMIT_MS = 200;
let lastRequestTime = 0;
async function rateLimitedFetch(url) {
  const now = Date.now();
  const wait = Math.max(0, lastRequestTime + RATE_LIMIT_MS - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestTime = Date.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res;
}

// ── Discovery: find all skills/traits with balance splits ──

async function discoverSplitPages() {
  // Try SMW query first: pages in Category:Skills with split mechanics
  const smwUrl = `${WIKI_API}?action=ask&query=[[Category:Skills with split mechanics]]|?Has game mode|limit=500&format=json`;
  try {
    const res = await rateLimitedFetch(smwUrl);
    const data = await res.json();
    if (data.query?.results && Object.keys(data.query.results).length > 0) {
      console.log(`[SMW] Found ${Object.keys(data.query.results).length} split pages`);
      return Object.keys(data.query.results);
    }
  } catch (err) {
    console.log(`[SMW] Discovery failed: ${err.message}`);
  }

  // Fallback: Category members API
  const pages = [];
  let cmcontinue = "";
  do {
    const url = `${WIKI_API}?action=query&list=categorymembers&cmtitle=Category:Skills_with_split_mechanics&cmlimit=500&format=json${cmcontinue ? `&cmcontinue=${cmcontinue}` : ""}`;
    const res = await rateLimitedFetch(url);
    const data = await res.json();
    for (const member of data.query?.categorymembers || []) {
      pages.push(member.title);
    }
    cmcontinue = data.continue?.cmcontinue || "";
  } while (cmcontinue);

  console.log(`[Category] Found ${pages.length} split pages`);
  return pages;
}

// ── Extraction: try each fallback method ──

// Method 1: SMW structured data
async function extractViaSMW(pageName) {
  const query = `[[${pageName}]]|?Has skill id|?Has WvW damage multiplier|?Has WvW duration|?Has WvW fact`;
  const url = `${WIKI_API}?action=ask&query=${encodeURIComponent(query)}&format=json`;
  try {
    const res = await rateLimitedFetch(url);
    const data = await res.json();
    const results = data.query?.results;
    if (!results) return null;
    const entry = Object.values(results)[0];
    if (!entry?.printouts) return null;

    const skillId = entry.printouts["Has skill id"]?.[0];
    const facts = entry.printouts["Has WvW fact"];
    if (!skillId || !facts || facts.length === 0) return null;

    // SMW doesn't reliably distinguish skill vs trait; default to "skill".
    // The wikitext/HTML fallbacks detect type from template names.
    return { id: Number(skillId), type: "skill", facts: facts.map(parseSMWFact).filter(Boolean) };
  } catch {
    return null;
  }
}

function parseSMWFact(raw) {
  // SMW facts come as structured objects — map to GW2 API fact format
  if (!raw || typeof raw !== "object") return null;
  return raw; // Pass through if already in API format; adjust based on actual SMW schema
}

// Method 2: Wikitext template parsing
async function extractViaWikitext(pageName) {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageName)}&prop=wikitext&format=json`;
  try {
    const res = await rateLimitedFetch(url);
    const data = await res.json();
    const wikitext = data.parse?.wikitext?.["*"];
    if (!wikitext) return null;

    // Look for skill ID in the infobox template
    const idMatch = wikitext.match(/\|\s*id\s*=\s*(\d+)/);
    const skillId = idMatch ? Number(idMatch[1]) : null;
    if (!skillId) return null;

    // Determine entity type from template name
    const isTraitMatch = wikitext.match(/\{\{trait infobox/i);
    const entityType = isTraitMatch ? "trait" : "skill";

    // Look for split sections — the wiki uses {{split|...}} templates
    const splitPattern = /\{\{split\|([^}]+)\}\}/gi;
    const splits = [];
    let match;
    while ((match = splitPattern.exec(wikitext)) !== null) {
      splits.push(match[1]);
    }

    // Also look for WvW-specific parameters in the skill infobox
    // Format: | wvw damage = 0.5 | wvw coefficient = 0.8 etc.
    const wvwParams = {};
    const wvwParamPattern = /\|\s*(?:wvw|competitive)\s+(\w[\w\s]*?)\s*=\s*([^\n|]+)/gi;
    while ((match = wvwParamPattern.exec(wikitext)) !== null) {
      wvwParams[match[1].trim().toLowerCase()] = match[2].trim();
    }

    if (splits.length === 0 && Object.keys(wvwParams).length === 0) return null;

    const facts = mapWikitextToFacts(wvwParams, splits);
    if (facts.length === 0) return null;

    return { id: skillId, type: entityType, facts };
  } catch {
    return null;
  }
}

// Map wikitext field names → GW2 API fact objects
function mapWikitextToFacts(params, splitSections) {
  const facts = [];

  // Damage coefficient
  if (params.damage || params.coefficient) {
    const coeff = parseFloat(params.damage || params.coefficient);
    if (!isNaN(coeff)) {
      facts.push({
        type: "Damage",
        text: "Damage",
        dmg_multiplier: coeff,
        hit_count: parseInt(params["hit count"] || params.hits || "1", 10) || 1,
      });
    }
  }

  // Duration (for buffs/conditions)
  if (params.duration) {
    const dur = parseFloat(params.duration);
    if (!isNaN(dur)) {
      facts.push({ type: "Duration", text: "Duration", duration: dur });
    }
  }

  // Recharge
  if (params.recharge || params.cooldown) {
    const cd = parseFloat(params.recharge || params.cooldown);
    if (!isNaN(cd)) {
      facts.push({ type: "Recharge", text: "Recharge", value: cd });
    }
  }

  // Healing
  if (params.healing) {
    const heal = parseFloat(params.healing);
    if (!isNaN(heal)) {
      facts.push({ type: "AttributeAdjust", text: "Healing", value: heal });
    }
  }

  // Parse split section text for additional facts
  for (const section of splitSections) {
    const parts = section.split("|").map((s) => s.trim());
    for (const part of parts) {
      const kvMatch = part.match(/^(\w[\w\s]*?)\s*[:=]\s*(.+)$/);
      if (kvMatch) {
        const key = kvMatch[1].toLowerCase();
        const val = kvMatch[2];
        if (key === "damage" && !isNaN(parseFloat(val))) {
          facts.push({ type: "Damage", text: "Damage", dmg_multiplier: parseFloat(val), hit_count: 1 });
        }
      }
    }
  }

  return facts;
}

// Method 3: HTML scraping (least reliable)
async function extractViaHTML(pageName) {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageName)}&prop=text&format=json`;
  try {
    const res = await rateLimitedFetch(url);
    const data = await res.json();
    const html = data.parse?.text?.["*"];
    if (!html) return null;

    const $ = getCheerio().load(html);

    // Look for skill ID in the page content
    const idText = $(".infobox .id, .skill-id").first().text();
    const idMatch = idText.match(/\d+/);
    const skillId = idMatch ? Number(idMatch[0]) : null;

    // Look for the split/competitive section
    const splitSection = $(".mw-headline:contains('Competitive'), .mw-headline:contains('WvW'), .mw-headline:contains('Split')")
      .closest("h2, h3")
      .nextUntil("h2, h3");

    if (splitSection.length === 0 && !skillId) return null;

    // Extract fact-like data from tooltip tables in the split section
    const facts = [];
    splitSection.find("dl dd, .skill-fact, .fact-row").each((_i, el) => {
      const text = $(el).text().trim();
      const dmgMatch = text.match(/Damage:\s*([\d.]+)/i);
      if (dmgMatch) {
        facts.push({ type: "Damage", text: "Damage", dmg_multiplier: parseFloat(dmgMatch[1]), hit_count: 1 });
      }
      const durMatch = text.match(/Duration:\s*([\d.]+)/i);
      if (durMatch) {
        facts.push({ type: "Duration", text: "Duration", duration: parseFloat(durMatch[1]) });
      }
    });

    if (facts.length === 0 || !skillId) return null;

    // Detect entity type from page structure
    const isTrait = $(".infobox-header:contains('Trait')").length > 0
      || $("th:contains('Trait type')").length > 0;
    return { id: skillId, type: isTrait ? "trait" : "skill", facts };
  } catch {
    return null;
  }
}

// ── Cross-reference with GW2 API ──

async function fetchGw2ApiFacts(ids) {
  // Batch fetch skill data from the GW2 API for cross-reference
  const batches = [];
  for (let i = 0; i < ids.length; i += 200) {
    batches.push(ids.slice(i, i + 200));
  }
  const results = new Map();
  for (const batch of batches) {
    try {
      const res = await rateLimitedFetch(`${GW2_API}/skills?ids=${batch.join(",")}&lang=en`);
      const data = await res.json();
      for (const skill of data) {
        results.set(skill.id, skill);
      }
    } catch (err) {
      console.warn(`[GW2 API] Failed to fetch batch: ${err.message}`);
    }
  }
  return results;
}

// ── Validation ──

const VALID_FACT_TYPES = new Set([
  "Damage", "Buff", "Number", "Recharge", "Distance", "Duration",
  "ComboField", "ComboFinisher", "NoData", "Time", "Radius",
  "Range", "Percent", "PrefixedBuff", "AttributeAdjust", "Unblockable",
  "StunBreak", "HealingAdjust",
]);

function validateSplitEntry(entry) {
  if (!entry || !Array.isArray(entry.facts) || entry.facts.length === 0) return false;
  return entry.facts.every((f) => f.type && VALID_FACT_TYPES.has(f.type));
}

// ── Main ──

async function main() {
  console.log("=== GW2 Balance Splits Seeder ===\n");

  // Step 1: Discover pages with balance splits
  const pages = await discoverSplitPages();
  if (pages.length === 0) {
    console.log("No split pages found. Writing empty registry.");
    await writeOutput({}, {});
    return;
  }

  // Step 2: Extract WvW facts for each page using fallback chain
  const skills = {};
  const traits = {};
  const methods = { smw: 0, wikitext: 0, html: 0, failed: 0 };

  for (const page of pages) {
    let result = null;
    let method = "";

    // Try 1: SMW
    result = await extractViaSMW(page);
    if (result && validateSplitEntry(result)) {
      method = "smw";
    } else {
      // Try 2: Wikitext
      result = await extractViaWikitext(page);
      if (result && validateSplitEntry(result)) {
        method = "wikitext";
      } else {
        // Try 3: HTML
        result = await extractViaHTML(page);
        if (result && validateSplitEntry(result)) {
          method = "html";
        }
      }
    }

    if (result && method) {
      methods[method]++;
      const bucket = result.type === "trait" ? traits : skills;
      bucket[String(result.id)] = {
        name: page.replace(/_/g, " "),
        modes: { wvw: { facts: result.facts } },
      };
      console.log(`  ✓ ${page} (id=${result.id}, method=${method})`);
    } else {
      methods.failed++;
      console.log(`  ✗ ${page} (no extraction method succeeded)`);
    }
  }

  // Step 3: Write output
  await writeOutput(skills, traits);

  console.log(`\n=== Done ===`);
  console.log(`Skills: ${Object.keys(skills).length}, Traits: ${Object.keys(traits).length}`);
  console.log(`Methods: SMW=${methods.smw}, Wikitext=${methods.wikitext}, HTML=${methods.html}, Failed=${methods.failed}`);
}

async function writeOutput(skills, traits) {
  const output = {
    version: 1,
    updatedAt: new Date().toISOString(),
    skills: skills || {},
    traits: traits || {},
  };
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${OUTPUT_PATH}`);
}

// Export for testing (no-op when run as a script)
module.exports = { mapWikitextToFacts, validateSplitEntry };

// Only run when executed directly (not when require()'d by tests)
if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
