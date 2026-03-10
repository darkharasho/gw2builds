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

  // Also include any Skill unlocks from elite specialization training tracks.
  // These are typically utility/heal/elite skills unlocked via training, NOT F-skills
  // (elite spec F-skills come from trait.skills on minor traits, see traitSkillTagMap below).
  // Training line `id` is a training-line ID, not the specialization ID, so we rely on
  // each skill's own `specialization` field from /v2/skills for correct spec tagging.
  const trainingSkillIds = dedupeNumbers(
    (profession.training || [])
      .filter((line) => line.category === "EliteSpecializations")
      .flatMap((line) =>
        (line.track || [])
          .filter((t) => t.type === "Skill" && t.skill_id)
          .map((t) => Number(t.skill_id))
      )
  );
  const allProfessionSkillIds = dedupeNumbers([...professionSkillIds, ...trainingSkillIds]);

  const weaponSkillIds = dedupeNumbers(
    Object.values(profession.weapons || {}).flatMap((w) => (w.skills || []).map((s) => s?.id))
  );
  const [professionSkillsRawApi, weaponSkillsRaw] = await Promise.all([
    fetchGw2ByIds("skills", allProfessionSkillIds, lang),
    fetchGw2ByIds("skills", weaponSkillIds, lang),
  ]);

  // Some GW2 skills have specialization: null in /v2/skills despite belonging to an elite spec,
  // or their spec is inconsistent between API endpoints. Override the specialization for known skills.
  const KNOWN_SKILL_SPEC_OVERRIDES = new Map([
    [30792, 34],  // Reaper's Shroud → Reaper
    [62567, 64],  // Harbinger Shroud → Harbinger
    [77397, 71],  // Specter Siphon (API name "Skritt Swipe") → Specter
    // Weaver dual-attunement F skills — /v2/skills returns spec=80 but Weaver spec is 56
    [76580, 56], [76988, 56], [76703, 56], [77082, 56],
    [76585, 56], [76811, 56], [77089, 56], [76707, 56],
    // Scrapper Function Gyro variants — profession endpoint incorrectly tags these as Holosmith (57)
    // but /v2/skills correctly returns spec=43 (Scrapper). Without override, they could appear at
    // Holosmith's F5 slot instead of Photon Forge (42938).
    [72103, 43], [72114, 43],
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
      specialization: KNOWN_SKILL_SPEC_OVERRIDES.get(skill.id) || ref?.specialization || traitTag?.specialization || skill.specialization || 0,
      type: ref?.type || skill.type || "",
    };
  });

  // Photon Forge (skill 42938) has no bundle_skills in the GW2 API, but in-game it grants
  // 5 weapon skills when active. Hardcode them here so the toggle can display them.
  // Skills: Light Strike (44588), Holo Leap (42965), Corona Burst (44530),
  //         Photon Blitz (45783), Holographic Shockwave (42521).
  // Also include the flip_skill (Deactivate Photon Forge: 41123) for the active icon.
  const PHOTON_FORGE_SKILL_ID = 42938;
  const PHOTON_FORGE_BUNDLE = [44588, 42965, 44530, 45783, 42521];

  // The GW2 API's toolbelt_skill for elixirs points to "Detonate Elixir X" (secondary action),
  // but the actual in-game F-slot skill is "Toss Elixir X" (the throw/primary action).
  // Map each elixir utility/heal skill ID → correct Toss Elixir toolbelt skill ID.
  const ELIXIR_TOOLBELT_OVERRIDES = new Map([
    [5834, 6118], // Elixir H   → Toss Elixir H  (API says 6119 Detonate Elixir H)
    [5821, 6092], // Elixir B   → Toss Elixir B  (API says 6082 Detonate Elixir B)
    [5860, 6077], // Elixir C   → Toss Elixir C  (API says 6078 Detonate Elixir C)
    [5968, 6091], // Elixir R   → Toss Elixir R  (API says 6086 Detonate Elixir R)
    [5861, 6090], // Elixir S   → Toss Elixir S  (API says 6084 Detonate Elixir S)
    [5862, 6089], // Elixir U   → Toss Elixir U  (API says 6088 Detonate Elixir U)
    // Elixir X (5832) keeps Detonate Elixir X (29722) — no Toss Elixir X exists.
  ]);

  // Second pass: fetch toolbelt skills + bundle (kit weapon) skills referenced by profession skills.
  // Also fetch transform_skills — used by Death Shroud to list all shroud weapon skill variants.
  // These are needed to synthesize bundleSkills for Reaper's Shroud and Harbinger Shroud, which
  // have no bundle_skills of their own in the GW2 API.
  const extraSkillIds = dedupeNumbers([
    ...professionSkillsRaw.flatMap((s) => [
      s.toolbelt_skill,
      s.flip_skill,
      ...(Array.isArray(s.bundle_skills) ? s.bundle_skills : []),
      ...(Array.isArray(s.transform_skills) ? s.transform_skills : []),
    ]).filter(Boolean),
    // Include Photon Forge weapon skills for Engineer (not discoverable via API bundle_skills).
    ...(professionId === "Engineer" ? PHOTON_FORGE_BUNDLE : []),
    // Include correct Toss Elixir toolbelt skills (API points to Detonate variants instead).
    ...(professionId === "Engineer" ? [...ELIXIR_TOOLBELT_OVERRIDES.values()] : []),
  ]);
  const extraSkillsRaw = extraSkillIds.length ? await fetchGw2ByIds("skills", extraSkillIds, lang) : [];

  // Build a transform-bundle map: spec_id → weapon-slot skill IDs.
  // For skills that have transform_skills but no bundle_skills (like Death Shroud), we group the
  // fetched transform children by their specialization. Each shroud variant's weapon skills share
  // the same spec as the shroud itself, letting us assign them as bundleSkills for Reaper's/Harbinger's Shroud.
  const transformBundleBySpec = new Map(); // specId → skillId[]
  for (const parent of professionSkillsRaw) {
    if ((parent.bundle_skills || []).length > 0) continue;
    if (!(parent.transform_skills || []).length) continue;
    for (const childId of parent.transform_skills) {
      const childSkill = extraSkillsRaw.find((s) => s.id === Number(childId));
      if (!childSkill) continue;
      // Only include weapon-bar skills (Weapon_1 … Weapon_5); skip exit/F-slot variants
      if (!/^Weapon_\d/.test(childSkill.slot || "")) continue;
      const childSpec = KNOWN_SKILL_SPEC_OVERRIDES.get(childSkill.id) || Number(childSkill.specialization) || 0;
      if (!childSpec) continue; // spec-0 children (e.g. Elixir X's transforms) don't belong to a shroud variant
      if (!transformBundleBySpec.has(childSpec)) transformBundleBySpec.set(childSpec, []);
      transformBundleBySpec.get(childSpec).push(Number(childId));
    }
  }

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
        // Prefer the skill's own slot from /v2/skills over the trait-tier-inferred fallback.
        // Trait skills all share the same tier (e.g. DH minor trait 1848 is tier 1), so
        // the `Profession_${tier}` fallback would incorrectly map F2 and F3 to Profession_1.
        return tag ? { ...skill, slot: skill.slot || tag.slot, specialization: tag.specialization, type: tag.type } : skill;
      })
    : [];

  function mapSkill(skill) {
    const specId = KNOWN_SKILL_SPEC_OVERRIDES.get(skill.id) || Number(skill.specialization) || 0;
    const rawBundleSkills = Array.isArray(skill.bundle_skills)
      ? skill.bundle_skills.map(Number).filter(Boolean)
      : [];
    // For skills with no bundle_skills of their own (e.g. Reaper's/Harbinger's Shroud), fall back
    // to the transform-bundle map built from Death Shroud's transform_skills, grouped by spec.
    // Photon Forge (42938) gets its bundle injected from the hardcoded PHOTON_FORGE_BUNDLE list.
    const bundleSkills = rawBundleSkills.length > 0
      ? rawBundleSkills
      : skill.id === PHOTON_FORGE_SKILL_ID
        ? PHOTON_FORGE_BUNDLE
        : (transformBundleBySpec.get(specId) || []);
    // GW2 API returns "None" for weapon-agnostic skills; normalize to "" so falsy checks work.
    const weaponType = skill.weapon_type === "None" ? "" : (skill.weapon_type || "");
    const attunement = skill.attunement === "None" ? "" : (skill.attunement || "");
    // dual_attunement is the Elementalist/Weaver dual attack secondary attunement field.
    // (dual_wield is a Thief-specific field for offhand weapon requirement — unrelated)
    const dualWield = skill.dual_attunement === "None" ? "" : (skill.dual_attunement || "");
    return {
      id: skill.id,
      name: skill.name || "",
      icon: skill.icon || "",
      description: skill.description || "",
      slot: skill.slot || "",
      type: skill.type || "",
      specialization: specId,
      professions: Array.isArray(skill.professions) ? skill.professions : [],
      weaponType,
      attunement,
      dualWield,
      categories: Array.isArray(skill.categories) ? skill.categories : [],
      facts: Array.isArray(skill.facts) ? skill.facts : [],
      toolbeltSkill: ELIXIR_TOOLBELT_OVERRIDES.get(skill.id) || Number(skill.toolbelt_skill) || 0,
      flipSkill: Number(skill.flip_skill) || 0,
      bundleSkills,
    };
  }

  let legendSkillsRaw = [];

  // Fifth pass: Revenant legend data.
  // Each legend defines the fixed swap/heal/utility/elite skills Revenant uses when that legend is active.
  let legends = [];
  if (professionId === "Revenant") {
    // /v2/legends with no parameters returns a list of string IDs (e.g. ["Legend1","Legend2",...]).
    // We then fetch each legend object using those IDs. The lang param is not relevant for legend
    // structure (it only contains skill IDs), but we pass it anyway for consistency.
    const legendIds = await fetchCachedJson(
      `legendIds`,
      `${GW2_API_ROOT}/legends`,
      1000 * 60 * 60 * 24
    );
    const legendsRaw = Array.isArray(legendIds) && legendIds.length > 0
      ? await fetchCachedJson(
          `legends:${legendIds.join(",")}`,
          `${GW2_API_ROOT}/legends?ids=${encodeURIComponent(legendIds.join(","))}`,
          1000 * 60 * 60 * 24
        )
      : [];
    if (Array.isArray(legendsRaw) && legendsRaw.length > 0) {
      const alreadyInSkills = new Set([
        ...professionSkillsRaw, ...extraSkillsRaw, ...morphPoolSkillsRaw, ...traitSkillsRaw,
      ].map((s) => s.id));
      const legendSkillIds = dedupeNumbers(
        legendsRaw.flatMap((l) => [l.swap, l.heal, ...(l.utilities || []), l.elite].filter(Boolean))
      ).filter((id) => !alreadyInSkills.has(id));
      legendSkillsRaw = legendSkillIds.length
        ? await fetchGw2ByIds("skills", legendSkillIds, lang)
        : [];
      const legendSkillMap = new Map([
        ...[...professionSkillsRaw, ...extraSkillsRaw, ...morphPoolSkillsRaw, ...traitSkillsRaw, ...legendSkillsRaw].map((s) => [s.id, s]),
      ]);
      legends = legendsRaw.map((l) => ({
        id: l.id,
        swap: l.swap || 0,
        heal: l.heal || 0,
        utilities: Array.isArray(l.utilities) ? l.utilities : [],
        elite: l.elite || 0,
        skills: [l.swap, l.heal, ...(l.utilities || []), l.elite].filter(Boolean).map((id) => {
          const s = legendSkillMap.get(id);
          return s
            ? { id: s.id, name: s.name || "", icon: s.icon || "", slot: s.slot || "", description: s.description || "" }
            : { id, name: "", icon: "", slot: "", description: "" };
        }),
      }));
    }
  }

  const skills = [...professionSkillsRaw, ...extraSkillsRaw, ...morphPoolSkillsRaw, ...traitSkillsRaw, ...legendSkillsRaw];

  // Sixth pass: Ranger pet data.
  // Each pet has a type (family) and a set of skills. The pet's active skill (shown as the pet's
  // unique contribution to the skillbar) is skills[4] (the 5th slot). In Soulbeast, F1/F2 skill
  // resolution matches the skill's weapon_type against the active pet's type field.
  let pets = [];
  if (professionId === "Ranger") {
    const petsRaw = await fetchCachedJson(
      `pets:${lang}`,
      `${GW2_API_ROOT}/pets?ids=all&lang=${encodeURIComponent(lang)}`,
      1000 * 60 * 60 * 24
    );
    if (Array.isArray(petsRaw)) {
      pets = petsRaw.map((p) => ({
        id: p.id,
        name: p.name || "",
        description: p.description || "",
        icon: p.icon || "",
        type: p.type || "",
        skills: Array.isArray(p.skills)
          ? p.skills.map((s) => ({
              id: Number(s.id) || 0,
              name: s.name || "",
              description: s.description || "",
              icon: s.icon || "",
            }))
          : [],
      }));
    }
  }

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
    legends,
    pets,
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
