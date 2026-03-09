const GW2_API_ROOT = "https://api.guildwars2.com/v2";
const WIKI_API_ROOT = "https://wiki.guildwars2.com/api.php";
const USER_AGENT = "gw2builds-desktop";

const cache = new Map();

async function getProfessionList(lang = "en") {
  const url = `${GW2_API_ROOT}/professions?ids=all&lang=${encodeURIComponent(lang)}`;
  const data = await fetchCachedJson(`professions:${lang}`, url, 1000 * 60 * 60);
  if (!Array.isArray(data)) return [];
  return data
    .filter((entry) => entry?.id)
    .map((entry) => ({
      id: entry.id,
      name: entry.name || entry.id,
      icon: entry.icon || "",
      iconBig: entry.icon_big || "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function getProfessionCatalog(professionId, lang = "en") {
  if (!professionId) {
    throw new Error("Missing profession id.");
  }

  const professionUrl = `${GW2_API_ROOT}/professions/${encodeURIComponent(professionId)}?lang=${encodeURIComponent(lang)}`;
  const profession = await fetchCachedJson(`profession:${professionId}:${lang}`, professionUrl, 1000 * 60 * 60);
  if (!profession?.id) {
    throw new Error(`Unknown profession "${professionId}".`);
  }

  const specializationIds = dedupeNumbers(profession.specializations || []);
  const specializations = await fetchGw2ByIds("specializations", specializationIds, lang);

  const traitIds = dedupeNumbers(
    specializations.flatMap((spec) => [...(spec?.minor_traits || []), ...(spec?.major_traits || [])])
  );
  const traits = await fetchGw2ByIds("traits", traitIds, lang);

  const professionSkillIds = dedupeNumbers((profession.skills || []).map((entry) => entry?.id));
  const skills = await fetchGw2ByIds("skills", professionSkillIds, lang);

  return {
    profession: {
      id: profession.id,
      name: profession.name || profession.id,
      icon: profession.icon || "",
      iconBig: profession.icon_big || "",
    },
    specializations: specializations.map((spec) => ({
      id: spec.id,
      name: spec.name || "",
      profession: spec.profession || "",
      elite: Boolean(spec.elite),
      icon: spec.icon || "",
      background: spec.background || "",
      minorTraits: Array.isArray(spec.minor_traits) ? spec.minor_traits : [],
      majorTraits: Array.isArray(spec.major_traits) ? spec.major_traits : [],
    })),
    traits: traits.map((trait) => ({
      id: trait.id,
      name: trait.name || "",
      icon: buildWikiFilePath(`${trait.name || ""}.png`) || trait.icon || "",
      iconFallback: trait.icon || "",
      description: trait.description || "",
      tier: Number(trait.tier) || 0,
      order: Number(trait.order) || 0,
      slot: trait.slot || "",
      specialization: Number(trait.specialization) || 0,
      facts: Array.isArray(trait.facts) ? trait.facts : [],
    })),
    skills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name || "",
      icon: skill.icon || "",
      description: skill.description || "",
      slot: skill.slot || "",
      type: skill.type || "",
      specialization: Number(skill.specialization) || 0,
      professions: Array.isArray(skill.professions) ? skill.professions : [],
      weaponType: skill.weapon_type || "",
      categories: Array.isArray(skill.categories) ? skill.categories : [],
      facts: Array.isArray(skill.facts) ? skill.facts : [],
    })),
    updatedAt: new Date().toISOString(),
  };
}

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

async function fetchGw2ByIds(endpoint, ids, lang = "en") {
  if (!Array.isArray(ids) || !ids.length) return [];
  const chunks = chunk(ids, 180);
  const all = [];
  for (const idsChunk of chunks) {
    const query = idsChunk.join(",");
    const url = `${GW2_API_ROOT}/${endpoint}?ids=${encodeURIComponent(query)}&lang=${encodeURIComponent(lang)}`;
    const data = await fetchCachedJson(`${endpoint}:${lang}:${query}`, url, 1000 * 60 * 60);
    if (Array.isArray(data)) {
      all.push(...data.filter(Boolean));
    }
  }
  return all;
}

async function fetchCachedJson(key, url, ttlMs) {
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }
  const data = await fetchJson(url);
  cache.set(key, { value: data, expiresAt: Date.now() + ttlMs });
  return data;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Request failed (${res.status}) for ${url}${text ? `: ${text.slice(0, 180)}` : ""}`);
  }
  return res.json();
}

function dedupeNumbers(values) {
  const set = new Set();
  const out = [];
  for (const value of values || []) {
    const num = Number(value);
    if (!Number.isFinite(num) || !num) continue;
    if (set.has(num)) continue;
    set.add(num);
    out.push(num);
  }
  return out;
}

function chunk(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
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
  getProfessionList,
  getProfessionCatalog,
  getWikiSummary,
};
