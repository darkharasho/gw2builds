const { WIKI_API_ROOT, cache, fetchJson } = require("./fetch");

async function getWikiSummary(title) {
  const query = String(title || "").trim();
  if (!query) return null;

  const cacheKey = `wiki-summary:${query.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  const url = new URL(WIKI_API_ROOT);
  url.searchParams.set("action", "query");
  url.searchParams.set("prop", "extracts|info");
  url.searchParams.set("inprop", "url");
  url.searchParams.set("exintro", "1");
  url.searchParams.set("explaintext", "1");
  url.searchParams.set("redirects", "1");
  url.searchParams.set("titles", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");

  const data = await fetchJson(url.toString());
  const page = Array.isArray(data?.query?.pages)
    ? data.query.pages.find((entry) => entry && !entry.missing)
    : null;

  const result = {
    title: page?.title || query,
    summary: page?.extract || "",
    url: page?.fullurl || buildWikiFallbackUrl(query),
    missing: !page,
  };

  cache.set(cacheKey, { value: result, expiresAt: Date.now() + 1000 * 60 * 15 });
  return result;
}

// ── Helpers for parseRelatedItems / parseRelatedGroups ─────────────────────

function decodeEntities(str) {
  return str
    .replace(/&#160;/g, " ")
    .replace(/&#32;/g, " ")
    .replace(/&#8212;/g, "—")
    .replace(/&#8201;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function stripTags(str) {
  return str.replace(/<[^>]+>/g, "");
}

/**
 * Extract {name, context} items from a MediaWiki HTML fragment containing <li> elements.
 * Each <li> follows this pattern:
 *   optional profession icon <a><img/></a>
 *   optional skill icon <span><a><img/></a></span>
 *   <a href="/wiki/Name" title="Name">Name</a> &#8212; context text
 */
function parseRelatedItems(html) {
  const results = [];
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch;
  while ((liMatch = liRe.exec(html)) !== null) {
    const liHtml = liMatch[1];
    // Split on &#8212; (em dash) — wiki puts " &#8212; context" after the item name link.
    // Context may contain inline links (e.g. <a title="Fire">fire</a>), so we must NOT
    // search the full <li> for the last text link — that would pick up context links as the name.
    const emDashIdx = liHtml.indexOf("&#8212;");
    const namePart = emDashIdx >= 0 ? liHtml.slice(0, emDashIdx) : liHtml;
    const contextPart = emDashIdx >= 0 ? liHtml.slice(emDashIdx + 7) : "";

    // Find the skill/trait name: last title-bearing text link in the name part
    const links = [];
    const linkRe = /<a\s[^>]*title="([^"]*)"[^>]*>([^<]+)<\/a>/gi;
    let linkMatch;
    while ((linkMatch = linkRe.exec(namePart)) !== null) {
      const text = linkMatch[2].trim();
      if (text) links.push(text);
    }
    if (links.length === 0) continue;
    const name = decodeEntities(links[links.length - 1]);
    if (!name) continue;
    // Context: strip all tags (including inline links like "fire"), decode, trim
    const context = decodeEntities(stripTags(contextPart)).replace(/^[\s—]+/, "").trim();
    results.push({ name, context });
  }
  return results;
}

/**
 * Extract [{groupName, items}] from a Related traits HTML section.
 * Groups are delimited by <h4> headings.
 */
function parseRelatedGroups(html) {
  const groups = [];
  // Split on <h4 to get group chunks; first chunk is preamble (TOC etc), skip it
  const parts = html.split(/<h4[^>]*>/i);
  for (const part of parts.slice(1)) {
    const h4End = part.indexOf("</h4>");
    if (h4End < 0) continue;
    const groupName = decodeEntities(stripTags(part.slice(0, h4End)))
      .replace(/\[edit\]/gi, "")
      .trim();
    if (!groupName) continue;
    const afterH4 = part.slice(h4End + 5);
    const items = parseRelatedItems(afterH4);
    if (items.length > 0) groups.push({ groupName, items });
  }
  return groups;
}

async function getWikiRelatedData(title) {
  const query = String(title || "").trim();
  if (!query) return { relatedSkills: [], relatedTraits: [] };

  const cacheKey = `wiki-related:${query.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  try {
    // Step 1: get section list
    const sectUrl = new URL(WIKI_API_ROOT);
    sectUrl.searchParams.set("action", "parse");
    sectUrl.searchParams.set("page", query);
    sectUrl.searchParams.set("prop", "sections");
    sectUrl.searchParams.set("format", "json");
    sectUrl.searchParams.set("formatversion", "2");
    const sectData = await fetchJson(sectUrl.toString());
    const sections = sectData?.parse?.sections || [];

    const skillsSect = sections.find((s) => /^related skills$/i.test(s.line));
    const traitsSect = sections.find((s) => /^related traits$/i.test(s.line));

    // Step 2: fetch HTML for each found section in parallel
    async function fetchSection(index) {
      const url = new URL(WIKI_API_ROOT);
      url.searchParams.set("action", "parse");
      url.searchParams.set("page", query);
      url.searchParams.set("prop", "text");
      url.searchParams.set("section", String(index));
      url.searchParams.set("format", "json");
      url.searchParams.set("formatversion", "2");
      const data = await fetchJson(url.toString());
      return data?.parse?.text || "";
    }

    const [skillsHtml, traitsHtml] = await Promise.all([
      skillsSect ? fetchSection(skillsSect.index) : Promise.resolve(""),
      traitsSect ? fetchSection(traitsSect.index) : Promise.resolve(""),
    ]);

    const result = {
      relatedSkills: skillsHtml ? parseRelatedItems(skillsHtml) : [],
      relatedTraits: traitsHtml ? parseRelatedGroups(traitsHtml) : [],
    };

    cache.set(cacheKey, { value: result, expiresAt: Date.now() + 1000 * 60 * 15 });
    return result;
  } catch {
    return { relatedSkills: [], relatedTraits: [] };
  }
}

function buildWikiFallbackUrl(title) {
  return `https://wiki.guildwars2.com/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
}

function buildWikiFilePath(filename) {
  const raw = String(filename || "").trim();
  if (!raw) return "";
  return `https://wiki.guildwars2.com/wiki/Special:FilePath/${encodeURIComponent(raw.replaceAll(" ", "_"))}`;
}

module.exports = {
  getWikiSummary,
  getWikiRelatedData,
  buildWikiFallbackUrl,
  buildWikiFilePath,
};
