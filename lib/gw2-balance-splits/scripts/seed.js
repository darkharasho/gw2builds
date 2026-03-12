#!/usr/bin/env node
/**
 * seed.js — Build splits.json by scraping the GW2 Wiki for balance-split data.
 *
 * The GW2 wiki uses {{skill fact|...|game mode=wvw}} templates inside
 * {{Skill infobox}} / {{Trait infobox}} to mark mode-specific values.
 * This script discovers all split skills/traits via wiki categories,
 * then parses the wikitext to extract WvW-specific facts.
 *
 * Usage: node lib/gw2-balance-splits/scripts/seed.js
 *
 * Dependencies: cheerio (npm install cheerio — for HTML fallback only)
 */

const path = require("path");
const fs = require("fs/promises");

const WIKI_API = "https://wiki.guildwars2.com/api.php";
const GW2_API = "https://api.guildwars2.com/v2";
const OUTPUT_PATH = path.join(__dirname, "..", "data", "splits.json");
const USER_AGENT = "GW2Builds-BalanceSplits/1.0 (https://github.com/gw2builds; balance-splits-seeder)";

// Rate-limit: 1 request per 200ms to be kind to the wiki
const RATE_LIMIT_MS = 200;
let lastRequestTime = 0;
async function rateLimitedFetch(url) {
  const now = Date.now();
  const wait = Math.max(0, lastRequestTime + RATE_LIMIT_MS - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestTime = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res;
}

// ── Progress bar ──

function progressBar(current, total, width = 30) {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(width * pct);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const pctStr = (pct * 100).toFixed(1).padStart(5);
  return `  ${bar} ${pctStr}% (${current}/${total})`;
}

// ── Discovery: find all skills/traits with balance splits ──

async function discoverSplitPages(category) {
  const pages = [];
  let cmcontinue = "";
  do {
    const url = `${WIKI_API}?action=query&list=categorymembers&cmtitle=${encodeURIComponent(category)}&cmnamespace=0&cmlimit=500&format=json${cmcontinue ? `&cmcontinue=${encodeURIComponent(cmcontinue)}` : ""}`;
    const res = await rateLimitedFetch(url);
    const data = await res.json();
    for (const member of data.query?.categorymembers || []) {
      pages.push(member.title);
    }
    cmcontinue = data.continue?.cmcontinue || "";
  } while (cmcontinue);
  return pages;
}

// ── Wikitext fact parsing ──

/**
 * Parse {{skill fact|...}} templates from wikitext and extract WvW-specific values.
 *
 * Wiki format examples:
 *   {{skill fact|damage|weapon=rifle|coefficient=1.81|game mode=pve}}
 *   {{skill fact|damage|weapon=rifle|coefficient=1.35|game mode=wvw}}
 *   {{skill fact|healing|1930|coefficient=1.0|game mode=wvw}}
 *   {{skill fact|blindness|3|game mode=pvp wvw}}
 *   {{skill fact|targets|5}}  (no game mode = applies to all)
 */
function parseWikitextFacts(wikitext) {
  const wvwFacts = [];

  // Match all {{skill fact|...}} templates (can span multiple lines via newlines inside braces)
  const factPattern = /\{\{skill fact\|([^}]+)\}\}/gi;
  let match;
  while ((match = factPattern.exec(wikitext)) !== null) {
    const raw = match[1];
    const parts = raw.split("|").map((s) => s.trim());
    if (parts.length === 0) continue;

    // Parse key=value pairs
    const params = {};
    const positional = [];
    for (const part of parts) {
      const eqIdx = part.indexOf("=");
      if (eqIdx > 0) {
        const key = part.slice(0, eqIdx).trim().toLowerCase();
        const val = part.slice(eqIdx + 1).trim();
        params[key] = val;
      } else {
        positional.push(part.trim());
      }
    }

    // Check game mode — include if wvw (or no mode specified = universal)
    const gameMode = (params["game mode"] || "").toLowerCase();
    const isWvw = gameMode.includes("wvw");
    const isUniversal = !gameMode;
    const isPveOnly = gameMode === "pve";

    if (isPveOnly) continue; // Skip PvE-only facts

    const factType = positional[0]?.toLowerCase() || "";
    const fact = mapWikiFactToApiFact(factType, positional, params, isWvw, isUniversal);
    if (fact) {
      // Tag so we know if this is WvW-specific or universal
      fact._wvwSpecific = isWvw && !isUniversal;
      wvwFacts.push(fact);
    }
  }

  return wvwFacts;
}

/**
 * Map a wiki {{skill fact|type|...}} to GW2 API fact format.
 */
function mapWikiFactToApiFact(factType, positional, params, isWvw, isUniversal) {
  const coefficient = parseFloat(params.coefficient || params.coeff || "0");

  switch (factType) {
    case "damage": {
      const coeff = !isNaN(coefficient) && coefficient > 0 ? coefficient : 1.0;
      const hitCount = parseInt(params["hit count"] || params.hits || "1", 10) || 1;
      return { type: "Damage", text: "Damage", dmg_multiplier: coeff, hit_count: hitCount };
    }
    case "healing": {
      const base = parseFloat(positional[1] || "0");
      return {
        type: "AttributeAdjust",
        text: "Healing",
        value: !isNaN(base) ? base : 0,
        ...(coefficient > 0 ? { target: "Healing", hit_count: 1 } : {}),
      };
    }
    case "recharge":
    case "cooldown": {
      const val = parseFloat(positional[1] || params.value || "0");
      return !isNaN(val) && val > 0 ? { type: "Recharge", text: "Recharge", value: val } : null;
    }
    case "duration":
    case "alt": {
      const dur = parseFloat(positional[1] || params.duration || "0");
      return !isNaN(dur) && dur > 0 ? { type: "Duration", text: params.alt || "Duration", duration: dur } : null;
    }
    case "radius": {
      const dist = parseInt(positional[1] || params.distance || "0", 10);
      return dist > 0 ? { type: "Radius", text: "Radius", distance: dist } : null;
    }
    case "range": {
      const val = parseInt(positional[1] || params.value || "0", 10);
      return val > 0 ? { type: "Range", text: "Range", value: val } : null;
    }
    case "targets": {
      const val = parseInt(positional[1] || "0", 10);
      return val > 0 ? { type: "Number", text: "Number of Targets", value: val } : null;
    }
    case "conditions removed": {
      const val = parseInt(positional[1] || "0", 10);
      return val > 0 ? { type: "Number", text: "Conditions Removed", value: val } : null;
    }
    case "combo": {
      const field = positional[1] || "";
      if (field.toLowerCase() === "blast" || field.toLowerCase() === "whirl" || field.toLowerCase() === "projectile" || field.toLowerCase() === "leap") {
        return { type: "ComboFinisher", text: "Combo Finisher", finisher_type: capitalize(field), percent: 100 };
      }
      return { type: "ComboField", text: "Combo Field", field_type: capitalize(field) };
    }
    case "stun break":
      return { type: "StunBreak", text: "Stun Break", value: true };
    case "unblockable":
      return { type: "Unblockable", text: "Unblockable", value: true };
    default: {
      // Boons and conditions: might, fury, quickness, bleeding, burning, etc.
      const duration = parseFloat(positional[1] || "0");
      const stacks = parseInt(params.stacks || params["apply count"] || "1", 10) || 1;
      if (duration > 0 || stacks > 0) {
        return {
          type: "Buff",
          text: capitalize(factType),
          status: capitalize(factType),
          duration: duration || 0,
          apply_count: stacks,
        };
      }
      return null;
    }
  }
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

// ── Extraction from wiki page ──

async function extractFromWikitext(pageName) {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageName)}&prop=wikitext&format=json`;
  try {
    const res = await rateLimitedFetch(url);
    const data = await res.json();
    const wikitext = data.parse?.wikitext?.["*"];
    if (!wikitext) return null;

    // Get skill/trait ID
    const idMatch = wikitext.match(/\|\s*id\s*=\s*(\d+)/);
    const entityId = idMatch ? Number(idMatch[1]) : null;
    if (!entityId) return null;

    // Check if this page actually has splits
    const splitMatch = wikitext.match(/\|\s*split\s*=\s*([^\n|]+)/i);
    if (!splitMatch) return null;
    const splitModes = splitMatch[1].toLowerCase();
    if (!splitModes.includes("wvw")) return null;

    // Determine entity type
    const isTraitMatch = /\{\{Trait infobox/i.test(wikitext);
    const entityType = isTraitMatch ? "trait" : "skill";

    // Parse all facts and keep WvW-relevant ones
    const allFacts = parseWikitextFacts(wikitext);
    if (allFacts.length === 0) return null;

    // Check if there are any WvW-specific facts (not just universal ones)
    const hasWvwSpecific = allFacts.some((f) => f._wvwSpecific);
    if (!hasWvwSpecific) return null;

    // Clean up internal tags
    const facts = allFacts.map(({ _wvwSpecific, ...rest }) => rest);

    return { id: entityId, type: entityType, facts };
  } catch {
    return null;
  }
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
  console.log("Discovering split pages...");
  const [skillPages, traitPages] = await Promise.all([
    discoverSplitPages("Category:Split skills"),
    discoverSplitPages("Category:Split traits"),
  ]);
  const allPages = [
    ...skillPages.map((p) => ({ title: p, hint: "skill" })),
    ...traitPages.map((p) => ({ title: p, hint: "trait" })),
  ];

  console.log(`  Found ${skillPages.length} split skills, ${traitPages.length} split traits (${allPages.length} total)\n`);

  if (allPages.length === 0) {
    console.log("No split pages found. Writing empty registry.");
    await writeOutput({}, {});
    return;
  }

  // Step 2: Extract WvW facts for each page
  console.log("Extracting WvW facts...\n");
  const skills = {};
  const traits = {};
  const methods = { wikitext: 0, failed: 0 };

  for (let i = 0; i < allPages.length; i++) {
    const { title } = allPages[i];

    const result = await extractFromWikitext(title);
    if (result && validateSplitEntry(result)) {
      methods.wikitext++;
      const bucket = result.type === "trait" ? traits : skills;
      bucket[String(result.id)] = {
        name: title.replace(/_/g, " "),
        modes: { wvw: { facts: result.facts } },
      };
    } else {
      methods.failed++;
    }

    // Progress bar
    const statusIcon = result && validateSplitEntry(result) ? "✓" : "✗";
    const shortName = title.length > 30 ? title.slice(0, 27) + "..." : title.padEnd(30);
    process.stdout.write(`\r${progressBar(i + 1, allPages.length)}  ${statusIcon} ${shortName}`);
  }
  process.stdout.write("\n\n");

  // Step 3: Write output
  await writeOutput(skills, traits);

  console.log(`\n=== Done ===`);
  console.log(`  Skills: ${Object.keys(skills).length}`);
  console.log(`  Traits: ${Object.keys(traits).length}`);
  console.log(`  Extracted: ${methods.wikitext}, Failed: ${methods.failed}`);
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
  console.log(`Wrote ${OUTPUT_PATH}`);
}

// Export for testing (no-op when run as a script)
module.exports = { parseWikitextFacts, mapWikiFactToApiFact, validateSplitEntry };

// Only run when executed directly (not when require()'d by tests)
if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
