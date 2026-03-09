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

  // Build a map of skill ID → reference metadata from the profession endpoint.
  // The profession.skills entries carry slot/specialization/type for how the profession
  // uses each skill. Some skills (e.g. Mechanist's Jade Mech F1-F3) have no slot or
  // specialization set in /v2/skills itself — the profession reference is authoritative.
  const profSkillRefs = new Map(
    (profession.skills || [])
      .filter((entry) => entry?.id)
      .map((entry) => [Number(entry.id), {
        slot: entry.slot || "",
        specialization: Number(entry.specialization) || 0,
        type: entry.type || "",
      }])
  );

  // Build trait-skill specialization tag map early so it can be applied to profession skills.
  // Skills embedded in elite spec major traits (e.g. Mechanist's Jade Mech F1-F3) should
  // inherit that elite spec's specialization ID, even when the profession or skills API omits it.
  // Include skills WITH a slot set — those are already in profession.skills and need the
  // specialization tag applied there. Skills WITHOUT a slot will be fetched separately below.
  const eliteSpecIdSet = new Set(specializations.filter((s) => s.elite).map((s) => Number(s.id)));
  const traitSkillTagMap = new Map(); // skillId → {slot, specialization, type}
  for (const trait of traits) {
    const specId = Number(trait.specialization) || 0;
    if (!eliteSpecIdSet.has(specId)) continue;
    const tier = Number(trait.tier) || 0;
    if (!tier || !Array.isArray(trait.skills)) continue;
    for (const ts of trait.skills) {
      const skillId = Number(ts?.id);
      if (!skillId) continue;
      // Don't overwrite a more specific existing entry
      if (!traitSkillTagMap.has(skillId)) {
        traitSkillTagMap.set(skillId, {
          slot: ts.slot || `Profession_${tier}`,
          specialization: specId,
          type: "Profession",
        });
      }
    }
  }

  const professionSkillIds = dedupeNumbers((profession.skills || []).map((entry) => entry?.id));
  const weaponSkillIds = dedupeNumbers(
    Object.values(profession.weapons || {}).flatMap((w) => (w.skills || []).map((s) => s?.id))
  );
  const [professionSkillsRawApi, weaponSkillsRaw] = await Promise.all([
    fetchGw2ByIds("skills", professionSkillIds, lang),
    fetchGw2ByIds("skills", weaponSkillIds, lang),
  ]);

  // Merge profession reference metadata into fetched skill objects.
  // Prefer the reference's slot/specialization/type over the skill's own values.
  // Also apply traitSkillTagMap specialization as a fallback for elite spec skills whose
  // specialization the profession API leaves unset (e.g. Mechanist's mech command variants).
  const professionSkillsRaw = professionSkillsRawApi.map((skill) => {
    const ref = profSkillRefs.get(skill.id);
    const traitTag = traitSkillTagMap.get(skill.id);
    return {
      ...skill,
      slot: ref?.slot || skill.slot || "",
      specialization: ref?.specialization || traitTag?.specialization || skill.specialization || 0,
      type: ref?.type || skill.type || "",
    };
  });

  // Second pass: fetch toolbelt skills + bundle (kit weapon) skills referenced by profession skills
  const extraSkillIds = dedupeNumbers([
    ...professionSkillsRaw.flatMap((s) => [
      s.toolbelt_skill,
      ...(Array.isArray(s.bundle_skills) ? s.bundle_skills : []),
    ]).filter(Boolean),
  ]);
  const extraSkillsRaw = extraSkillIds.length ? await fetchGw2ByIds("skills", extraSkillIds, lang) : [];

  // Third pass: fetch morph pool skills for specs with "Locked" profession slots (e.g. Amalgam F2–F4).
  // The GW2 profession endpoint only lists "Locked" placeholder skills for these slots; the actual
  // selectable morph skills are not listed there. We find them by fetching all skill IDs from the
  // API, filtering to the ID range of the known Locked skills, and keeping those with matching
  // specialization + type="Profession" that are not "Locked"/"Evolve" placeholders.
  const lockedSkills = professionSkillsRaw.filter(
    (s) => s.name === "Locked" && s.type === "Profession" && s.specialization
  );
  let morphPoolSkillsRaw = [];
  if (lockedSkills.length > 0) {
    const lockedSpecId = lockedSkills[0].specialization;
    const lockedIds = lockedSkills.map((s) => s.id);
    const idMin = Math.min(...lockedIds) - 1000;
    const idMax = Math.max(...lockedIds) + 1000;
    const allSkillIds = await fetchCachedJson(
      `allSkillIds:${lang}`,
      `${GW2_API_ROOT}/skills?lang=${encodeURIComponent(lang)}`,
      1000 * 60 * 60 * 24
    );
    const alreadyFetched = new Set([...professionSkillsRaw, ...extraSkillsRaw].map((s) => s.id));
    const candidateIds = (Array.isArray(allSkillIds) ? allSkillIds : []).filter(
      (id) => id >= idMin && id <= idMax && !alreadyFetched.has(id)
    );
    if (candidateIds.length > 0) {
      const candidateSkills = await fetchGw2ByIds("skills", candidateIds, lang);
      // Morph pool skills have no type/slot/specialization set in the GW2 API — they are
      // identified solely by their description starting with "Morph." Tag them with the
      // locked spec's ID and type="Profession" so the renderer can find them.
      morphPoolSkillsRaw = candidateSkills
        .filter((s) => (s.description || "").startsWith("Morph."))
        .map((s) => ({ ...s, specialization: lockedSpecId, type: "Profession" }));
    }
  }

  // Fourth pass: fetch any trait-tagged skills not yet in the catalog.
  // traitSkillTagMap was already built above; here we fetch the remaining IDs
  // (those not already covered by profession skills, toolbelt/bundle skills, or morph pool).
  const alreadyFetchedIds = new Set([
    ...professionSkillsRaw.map((s) => s.id),
    ...extraSkillsRaw.map((s) => s.id),
    ...morphPoolSkillsRaw.map((s) => s.id),
  ]);
  const traitSkillIdsToFetch = [...traitSkillTagMap.keys()].filter((id) => !alreadyFetchedIds.has(id));
  const traitSkillsRaw = traitSkillIdsToFetch.length
    ? (await fetchGw2ByIds("skills", traitSkillIdsToFetch, lang)).map((skill) => {
        const tag = traitSkillTagMap.get(skill.id);
        return tag ? { ...skill, slot: tag.slot, specialization: tag.specialization, type: tag.type } : skill;
      })
    : [];

  function mapSkill(skill) {
    return {
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
      toolbeltSkill: Number(skill.toolbelt_skill) || 0,
      bundleSkills: Array.isArray(skill.bundle_skills)
        ? skill.bundle_skills.map(Number).filter(Boolean)
        : [],
    };
  }

  const skills = [...professionSkillsRaw, ...extraSkillsRaw, ...morphPoolSkillsRaw, ...traitSkillsRaw];

  // Normalize GW2 API weapon type keys (e.g. "ShortBow") to our lowercase IDs (e.g. "shortbow")
  // Special case: "HarpoonGun" → "harpoon"
  function normalizeWeaponKey(apiKey) {
    if (apiKey === "HarpoonGun") return "harpoon";
    return apiKey.toLowerCase();
  }

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
      // Skip wiki path for names containing colons — MediaWiki treats ":" as a namespace
      // separator, so "Mech Frame: Conductive Alloys.png" resolves to nothing on the wiki,
      // causing a failed load + onerror fallback blink. Use the render URL directly instead.
      icon: (!(trait.name || "").includes(":") && buildWikiFilePath(`${trait.name || ""}.png`)) || trait.icon || "",
      iconFallback: trait.icon || "",
      description: trait.description || "",
      tier: Number(trait.tier) || 0,
      order: Number(trait.order) || 0,
      slot: trait.slot || "",
      specialization: Number(trait.specialization) || 0,
      facts: Array.isArray(trait.facts) ? trait.facts : [],
      traitSkillIds: Array.isArray(trait.skills)
        ? trait.skills.map((s) => Number(s?.id)).filter(Boolean)
        : [],
      traitSkillIcons: Array.isArray(trait.skills)
        ? Object.fromEntries(
            trait.skills
              .filter((s) => s?.id && s?.icon)
              .map((s) => [Number(s.id), String(s.icon)])
          )
        : {},
    })),
    skills: skills.map(mapSkill),
    professionWeapons: Object.fromEntries(
      Object.entries(profession.weapons || {}).map(([apiKey, wData]) => [
        normalizeWeaponKey(apiKey),
        {
          flags: Array.isArray(wData.flags) ? wData.flags : [],
          specialization: Number(wData.specialization) || 0,
          skills: (wData.skills || []).map((s) => ({
            id: Number(s.id) || 0,
            slot: s.slot || "",
            offhand: s.offhand || "",
            attunement: s.attunement || "",
          })),
        },
      ])
    ),
    weaponSkills: weaponSkillsRaw.map((skill) => ({
      id: skill.id,
      name: skill.name || "",
      icon: skill.icon || "",
      description: skill.description || "",
      slot: skill.slot || "",
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
