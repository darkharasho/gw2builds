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
  buildWikiFallbackUrl,
  buildWikiFilePath,
};
