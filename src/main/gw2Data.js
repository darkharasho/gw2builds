const GW2_API_ROOT = "https://api.guildwars2.com/v2";
const WIKI_API_ROOT = "https://wiki.guildwars2.com/api.php";
const USER_AGENT = "gw2builds-desktop";

const cache = new Map();

async function getProfessionList(lang = "en") {
  // Profession IDs are static (unchanged since 2015); hardcode to avoid an extra round-trip
  // and to avoid the /v2/professions bare endpoint which has inconsistent API support.
  const PROFESSION_IDS = ["Guardian","Warrior","Engineer","Ranger","Thief","Elementalist","Mesmer","Necromancer","Revenant"];
  const data = await fetchCachedJson(
    `professions:${lang}`,
    `${GW2_API_ROOT}/professions?ids=${PROFESSION_IDS.join(",")}&lang=${encodeURIComponent(lang)}`,
    1000 * 60 * 60
  );
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

  // Step 1: fetch profession data — everything else depends on this.
  const professionUrl = `${GW2_API_ROOT}/professions?ids=${encodeURIComponent(professionId)}&lang=${encodeURIComponent(lang)}`;
  const professionArr = await fetchCachedJson(`profession:${professionId}:${lang}`, professionUrl, 1000 * 60 * 60);
  const profession = Array.isArray(professionArr) ? professionArr[0] : professionArr;
  if (!profession?.id) {
    throw new Error(`Unknown profession "${professionId}".`);
  }

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

  const specializationIds = dedupeNumbers(profession.specializations || []);
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

  // Step 2: fetch specializations, profession skills, and weapon skills in parallel.
  // These are all independent of each other — they only need the profession data from step 1.
  // Also start Ranger pets and Revenant legend IDs here since they're fully independent.
  const petsPromise = professionId === "Ranger"
    ? fetchCachedJson(`pets:${lang}`, `${GW2_API_ROOT}/pets?ids=all&lang=${encodeURIComponent(lang)}`, 1000 * 60 * 60 * 24)
    : Promise.resolve([]);
  const legendsRawPromise = professionId === "Revenant"
    ? fetchCachedJson(`legendIds`, `${GW2_API_ROOT}/legends`, 1000 * 60 * 60 * 24)
        .then((legendIds) =>
          Array.isArray(legendIds) && legendIds.length
            ? fetchCachedJson(
                `legends:${legendIds.join(",")}`,
                `${GW2_API_ROOT}/legends?ids=${encodeURIComponent(legendIds.join(","))}`,
                1000 * 60 * 60 * 24
              )
            : []
        )
    : Promise.resolve([]);

  const [specializations, professionSkillsRawApi, weaponSkillsBase] = await Promise.all([
    fetchGw2ByIds("specializations", specializationIds, lang),
    fetchGw2ByIds("skills", allProfessionSkillIds, lang),
    fetchGw2ByIds("skills", weaponSkillIds, lang),
  ]);

  // Collect depth-1 weapon chain flip IDs upfront so they can be merged into the extraSkillIds
  // batch below — avoiding a separate sequential network request.
  const weaponSkillIdSet = new Set(weaponSkillIds);
  const weaponChainDepth1Ids = dedupeNumbers(
    weaponSkillsBase.map((s) => Number(s.flip_skill)).filter((id) => id && !weaponSkillIdSet.has(id))
  );

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

  // Photon Forge (skill 42938) has no bundle_skills in the GW2 API, but in-game it grants
  // 5 weapon skills when active. Hardcode them here so the toggle can display them.
  // Skills: Light Strike (44588), Holo Leap (42965), Corona Burst (44530),
  //         Photon Blitz (45783), Holographic Shockwave (42521).
  // Also include the flip_skill (Deactivate Photon Forge: 41123) for the active icon.
  const PHOTON_FORGE_SKILL_ID = 42938;
  const PHOTON_FORGE_BUNDLE = [44588, 42965, 44530, 45783, 42521];

  // Luminary (Guardian elite spec, spec 81) — Enter Radiant Forge (77073) replaces weapon skills.
  // API does not expose bundle_skills; hardcoded from /v2/skills lookups.
  // Multiple Glaring Burst variants exist (76982→77058→78674 chain); all listed so the slot-based
  // dedup in the renderer picks 76950 (the standalone variant, lowest ID) for Weapon_1.
  // Flip skills (76910, 77136, 77366) are fetched via RADIANT_FORGE_FLIP_SKILLS but kept OUT of
  // the bundle so dedup doesn't pick them over the primary skills.
  const RADIANT_FORGE_SKILL_ID = 77073;
  const RADIANT_FORGE_BUNDLE      = [76950, 76982, 77058, 78674, 78730, 77339, 76708, 76924, 76978];
  const RADIANT_FORGE_FLIP_SKILLS = [76910, 77136, 77366];

  // Firebrand tome chapter skills — the GW2 public API does not expose these via bundle_skills
  // or any other field. Skill data sourced from community tools (GW2EI, discretize-ui).
  const _WK = "https://wiki.guildwars2.com/images";
  const FIREBRAND_TOME_CHAPTERS = new Map([
    [44364, [ // Tome of Justice
      { id: 41258, name: "Chapter 1: Searing Spell",      slot: "Weapon_1", icon: `${_WK}/d/d3/Chapter_1-_Searing_Spell.png`,
        description: "Fueled by tales of the desolation in Istan, incite a great swelling of heat before you.",
        facts: [
          { type: "Damage",              text: "Damage",             dmg_multiplier: 1.6006,  hit_count: 1 },
          { type: "ApplyBuffCondition",  text: "Burning",            status: "Burning",       duration: 2.5, apply_count: 1 },
          { type: "ApplyBuffCondition",  text: "Vulnerability",      status: "Vulnerability", duration: 6 },
          { type: "Number",              text: "Number of Targets",  value: 5 },
          { type: "Distance",            text: "Range",              value: 600 },
          { type: "Number",              text: "Page Cost",          value: 1 },
        ] },
      { id: 40635, name: "Chapter 2: Igniting Burst",     slot: "Weapon_2", icon: `${_WK}/5/53/Chapter_2-_Igniting_Burst.png`,
        description: "Ignite the air around you in an expanding burst.",
        facts: [
          { type: "Damage",              text: "Damage",             dmg_multiplier: 1.46055, hit_count: 1 },
          { type: "ApplyBuffCondition",  text: "Burning",            status: "Burning",       duration: 5, apply_count: 1 },
          { type: "ApplyBuffCondition",  text: "Weakness",           status: "Weakness",      duration: 3 },
          { type: "ComboFinisher",       text: "Combo Finisher",     finisher_type: "Blast",  percent: 100 },
          { type: "Number",              text: "Number of Targets",  value: 5 },
          { type: "Distance",            text: "Radius",             value: 240 },
          { type: "Recharge",            text: "Recharge",           value: 8.5 },
          { type: "Number",              text: "Page Cost",          value: 1 },
        ] },
      { id: 42449, name: "Chapter 3: Heated Rebuke",      slot: "Weapon_3", icon: `${_WK}/e/e7/Chapter_3-_Heated_Rebuke.png`,
        description: "Call forth a heated vortex to collapse your enemies together.",
        facts: [
          { type: "Damage",              text: "Damage",             dmg_multiplier: 0.03001, hit_count: 1 },
          { type: "Distance",            text: "Pull",               value: 240 },
          { type: "Number",              text: "Defiance Break",     value: 150 },
          { type: "Number",              text: "Number of Targets",  value: 5 },
          { type: "Distance",            text: "Radius",             value: 240 },
          { type: "Distance",            text: "Range",              value: 900 },
          { type: "Recharge",            text: "Recharge",           value: 15 },
          { type: "Number",              text: "Page Cost",          value: 1 },
        ] },
      { id: 40015, name: "Chapter 4: Scorched Aftermath", slot: "Weapon_4", icon: `${_WK}/c/c9/Chapter_4-_Scorched_Aftermath.png`,
        description: "Detail the suffering in fire and blood inflicted during Vabbi's occupation.",
        facts: [
          { type: "Damage",              text: "Damage",             dmg_multiplier: 1.06008, hit_count: 5 },
          { type: "ApplyBuffCondition",  text: "Bleeding",           status: "Bleeding",      duration: 2, apply_count: 1 },
          { type: "ApplyBuffCondition",  text: "Burning",            status: "Burning",       duration: 2, apply_count: 1 },
          { type: "ComboField",          text: "Combo Field",        field_type: "Fire" },
          { type: "Number",              text: "Pulses",             value: 5 },
          { type: "Duration",            text: "Duration",           duration: 4 },
          { type: "Number",              text: "Number of Targets",  value: 5 },
          { type: "Distance",            text: "Radius",             value: 360 },
          { type: "Number",              text: "Page Cost",          value: 1 },
        ] },
      { id: 42898, name: "Epilogue: Ashes of the Just",   slot: "Weapon_5", icon: `${_WK}/6/6d/Epilogue-_Ashes_of_the_Just.png`,
        description: "Recall the memory of fallen heroes, granting allies the searing blades of justice.",
        facts: [
          { type: "Buff",                text: "Ashes of the Just",  status: "Ashes of the Just", duration: 10 },
          { type: "ApplyBuffCondition",  text: "Burning",            status: "Burning",       duration: 3, apply_count: 1 },
          { type: "Buff",                text: "Might",              status: "Might",         duration: 8, apply_count: 1 },
          { type: "Number",              text: "Number of Targets",  value: 5 },
          { type: "Distance",            text: "Radius",             value: 600 },
          { type: "Recharge",            text: "Recharge",           value: 20 },
          { type: "Number",              text: "Page Cost",          value: 1 },
        ] },
    ]],
    [41780, [ // Tome of Resolve
      { id: 45022, name: "Chapter 1: Desert Bloom",       slot: "Weapon_1", icon: `${_WK}/f/fd/Chapter_1-_Desert_Bloom.png`,
        description: "Tales of desert blooms create a wave of healing for your allies.",
        facts: [
          { type: "Heal",                text: "Healing",            value: 5640 },
          { type: "Number",              text: "Number of Targets",  value: 5 },
          { type: "Distance",            text: "Range",              value: 600 },
          { type: "Number",              text: "Page Cost",          value: 1 },
        ] },
      { id: 40679, name: "Chapter 2: Radiant Recovery",   slot: "Weapon_2", icon: `${_WK}/9/95/Chapter_2-_Radiant_Recovery.png`,
        description: "Release magic from pages detailing the rebuilding of Vabbi, cleansing conditions on nearby allies. Allies are healed for each condition removed.",
        facts: [
          { type: "Heal",                text: "Healing per Condition Removed", value: 3881 },
          { type: "Number",              text: "Conditions Removed", value: 2 },
          { type: "Number",              text: "Number of Targets",  value: 5 },
          { type: "Distance",            text: "Radius",             value: 240 },
          { type: "Recharge",            text: "Recharge",           value: 8.75 },
          { type: "Number",              text: "Page Cost",          value: 1 },
        ] },
      { id: 45128, name: "Chapter 3: Azure Sun",          slot: "Weapon_3", icon: `${_WK}/b/bf/Chapter_3-_Azure_Sun.png`,
        description: "Inspired by countless poems describing the comforting powers of the water-reflected sun, grant boons to allies.",
        facts: [
          { type: "Buff",                text: "Vigor",              status: "Vigor",         duration: 5 },
          { type: "Buff",                text: "Regeneration",       status: "Regeneration",  duration: 6 },
          { type: "Buff",                text: "Swiftness",          status: "Swiftness",     duration: 5 },
          { type: "Number",              text: "Number of Targets",  value: 5 },
          { type: "Distance",            text: "Radius",             value: 240 },
          { type: "Distance",            text: "Range",              value: 900 },
          { type: "Number",              text: "Page Cost",          value: 1 },
        ] },
      { id: 42008, name: "Chapter 4: Shining River",      slot: "Weapon_4", icon: `${_WK}/1/16/Chapter_4-_Shining_River.png`,
        description: "Release a torrent of pages describing the water cycle of the Elon River. Heal allies and grant them swiftness.",
        facts: [
          { type: "Heal",                text: "Healing",            value: 4640 },
          { type: "Buff",                text: "Swiftness",          status: "Swiftness",     duration: 4 },
          { type: "ComboField",          text: "Combo Field",        field_type: "Water" },
          { type: "Number",              text: "Pulses",             value: 5 },
          { type: "Distance",            text: "Radius",             value: 360 },
          { type: "Recharge",            text: "Recharge",           value: 15.5 },
          { type: "Number",              text: "Page Cost",          value: 1 },
        ] },
      { id: 42925, name: "Epilogue: Eternal Oasis",       slot: "Weapon_5", icon: `${_WK}/5/5f/Epilogue-_Eternal_Oasis.png`,
        description: "Purify your allies with the waters of Amnoon and increase the healing they receive.",
        facts: [
          { type: "Duration",            text: "Duration",           duration: 8 },
          { type: "Number",              text: "Healing Effectiveness Increase", value: "20%" },
          { type: "Number",              text: "Conditions Converted to Boons", value: 5 },
          { type: "Number",              text: "Number of Targets",  value: 5 },
          { type: "Distance",            text: "Radius",             value: 600 },
          { type: "Number",              text: "Page Cost",          value: 2 },
        ] },
    ]],
    [42259, [ // Tome of Courage
      { id: 42986, name: "Chapter 1: Unflinching Charge", slot: "Weapon_1", icon: `${_WK}/3/30/Chapter_1-_Unflinching_Charge.png`,
        description: "Roused by tales of mythical Sunspear charges, ground and motivate allies before you.",
        facts: [
          { type: "Buff",                text: "Protection",         status: "Protection",    duration: 1.5 },
          { type: "Buff",                text: "Swiftness",          status: "Swiftness",     duration: 6 },
          { type: "Number",              text: "Number of Targets",  value: 5 },
          { type: "Distance",            text: "Range",              value: 600 },
          { type: "Number",              text: "Page Cost",          value: 1 },
        ] },
      { id: 41968, name: "Chapter 2: Daring Challenge",   slot: "Weapon_2", icon: `${_WK}/7/79/Chapter_2-_Daring_Challenge.png`,
        description: "As the tales recount of Turai, taunt your enemies by issuing an insightfully inciting challenge.",
        facts: [
          { type: "ApplyBuffCondition",  text: "Taunt",              status: "Taunt",         duration: 1 },
          { type: "Buff",                text: "Resolution",         status: "Resolution",    duration: 3 },
          { type: "Distance",            text: "Radius",             value: 240 },
          { type: "Number",              text: "Page Cost",          value: 1 },
        ] },
      { id: 41836, name: "Chapter 3: Valiant Bulwark",    slot: "Weapon_3", icon: `${_WK}/7/73/Chapter_3-_Valiant_Bulwark.png`,
        description: "Manifest the shimmering purity of the desert sun, reflecting enemy missiles.",
        facts: [
          { type: "Duration",            text: "Duration",           duration: 5 },
          { type: "Distance",            text: "Radius",             value: 240 },
          { type: "Distance",            text: "Range",              value: 900 },
          { type: "Number",              text: "Page Cost",          value: 1 },
        ] },
      { id: 40988, name: "Chapter 4: Stalwart Stand",     slot: "Weapon_4", icon: `${_WK}/8/89/Chapter_4-_Stalwart_Stand.png`,
        description: "Recount the stand of Elonian loyalists against Palawa Joko, granting resistance to your allies.",
        facts: [
          { type: "Buff",                text: "Resistance",         status: "Resistance",    duration: 1 },
          { type: "Number",              text: "Pulses",             value: 3 },
          { type: "ComboField",          text: "Combo Field",        field_type: "Light" },
          { type: "Distance",            text: "Radius",             value: 360 },
          { type: "Recharge",            text: "Recharge",           value: 20 },
          { type: "Number",              text: "Page Cost",          value: 1 },
        ] },
      { id: 44455, name: "Epilogue: Unbroken Lines",      slot: "Weapon_5", icon: `${_WK}/d/d8/Epilogue-_Unbroken_Lines.png`,
        description: "Recalling the memory of heroes past, enchant nearby allies with formidable defenses.",
        facts: [
          { type: "Buff",                text: "Protection",         status: "Protection",    duration: 5 },
          { type: "Buff",                text: "Stability",          status: "Stability",     duration: 5, apply_count: 2 },
          { type: "Buff",                text: "Aegis",              status: "Aegis",         duration: 4 },
          { type: "Number",              text: "Number of Targets",  value: 5 },
          { type: "Distance",            text: "Radius",             value: 600 },
          { type: "Recharge",            text: "Recharge",           value: 25 },
          { type: "Number",              text: "Page Cost",          value: 2 },
        ] },
    ]],
  ]);

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

  // Step 3: compute extraSkillIds from raw API data and fetch traits + extra skills in parallel.
  // extraSkillIds only uses toolbelt_skill/flip_skill/bundle_skills/transform_skills — fields that
  // come directly from the GW2 API and are unaffected by the profSkillRefs/traitSkillTagMap merge.
  // This lets us start fetching extras without waiting for traits to complete.
  const extraSkillIds = dedupeNumbers([
    ...professionSkillsRawApi.flatMap((s) => [
      s.toolbelt_skill,
      s.flip_skill,
      ...(Array.isArray(s.bundle_skills) ? s.bundle_skills : []),
      ...(Array.isArray(s.transform_skills) ? s.transform_skills : []),
    ]).filter(Boolean),
    // Include Photon Forge weapon skills for Engineer (not discoverable via API bundle_skills).
    ...(professionId === "Engineer" ? PHOTON_FORGE_BUNDLE : []),
    // Include correct Toss Elixir toolbelt skills (API points to Detonate variants instead).
    ...(professionId === "Engineer" ? [...ELIXIR_TOOLBELT_OVERRIDES.values()] : []),
    // Include Radiant Forge weapon skills + their flip skills (Luminary, Guardian).
    ...(professionId === "Guardian" ? [...RADIANT_FORGE_BUNDLE, ...RADIANT_FORGE_FLIP_SKILLS] : []),
    // Weapon auto-attack chain continuations (depth 1): merged here to avoid an extra round-trip.
    ...weaponChainDepth1Ids,
  ]);
  const traitIds = dedupeNumbers(
    specializations.flatMap((spec) => [...(spec?.minor_traits || []), ...(spec?.major_traits || [])])
  );
  const [traits, extraSkillsRaw] = await Promise.all([
    fetchGw2ByIds("traits", traitIds, lang),
    extraSkillIds.length ? fetchGw2ByIds("skills", extraSkillIds, lang) : Promise.resolve([]),
  ]);

  // Build trait-skill specialization tag map (needs traits + specializations).
  // Skills embedded in elite spec major traits (e.g. Mechanist's Jade Mech F1-F3) should
  // inherit that elite spec's specialization ID, even when the profession or skills API omits it.
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

  // Merge profession reference metadata into fetched skill objects (needs traitSkillTagMap).
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

  // Depth-2 weapon chain IDs (discoverable now that depth-1 extraSkillsRaw is available).
  const extraSkillIdSet = new Set(extraSkillIds);
  const weaponChainDepth2Ids = dedupeNumbers(
    extraSkillsRaw
      .filter((s) => weaponChainDepth1Ids.includes(s.id))
      .map((s) => Number(s.flip_skill))
      .filter((id) => id && !weaponSkillIdSet.has(id) && !extraSkillIdSet.has(id))
  );

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

  // Build morph pool promise (runs concurrently in step 4).
  // Morph pool fetches skills for specs with "Locked" profession slots (e.g. Amalgam F2–F4).
  // The GW2 profession endpoint only lists "Locked" placeholder skills for these slots; the actual
  // selectable morph skills are not listed there. We find them by fetching all skill IDs from the
  // API, filtering to the ID range of the known Locked skills, and keeping those with matching
  // specialization + type="Profession" that are not "Locked"/"Evolve" placeholders.
  const lockedSkills = professionSkillsRaw.filter(
    (s) => s.name === "Locked" && s.type === "Profession" && s.specialization
  );
  let morphPoolPromise = Promise.resolve([]);
  if (lockedSkills.length > 0) {
    const lockedSpecId = lockedSkills[0].specialization;
    const lockedIds = lockedSkills.map((s) => s.id);
    const idMin = Math.min(...lockedIds) - 1000;
    const idMax = Math.max(...lockedIds) + 1000;
    const alreadyFetchedForMorph = new Set([...professionSkillsRaw, ...extraSkillsRaw].map((s) => s.id));
    morphPoolPromise = fetchCachedJson(
      `allSkillIds:${lang}`,
      `${GW2_API_ROOT}/skills?lang=${encodeURIComponent(lang)}`,
      1000 * 60 * 60 * 24
    ).then(async (allSkillIds) => {
      const candidateIds = (Array.isArray(allSkillIds) ? allSkillIds : []).filter(
        (id) => id >= idMin && id <= idMax && !alreadyFetchedForMorph.has(id)
      );
      if (!candidateIds.length) return [];
      const candidateSkills = await fetchGw2ByIds("skills", candidateIds, lang);
      // Morph pool skills have no type/slot/specialization set in the GW2 API — they are
      // identified solely by their description starting with "Morph." Tag them with the
      // locked spec's ID and type="Profession" so the renderer can find them.
      return candidateSkills
        .filter((s) => (s.description || "").startsWith("Morph."))
        .map((s) => ({ ...s, specialization: lockedSpecId, type: "Profession" }));
    });
  }

  // Step 4: fetch depth-2 chains, trait skills, and morph pool skills in parallel.
  const alreadyFetchedForTraits = new Set([
    ...professionSkillsRaw.map((s) => s.id),
    ...extraSkillsRaw.map((s) => s.id),
  ]);
  const traitSkillIdsToFetch = [...traitSkillTagMap.keys()].filter((id) => !alreadyFetchedForTraits.has(id));

  // Slots already occupied by base (spec=0) profession mechanic skills (e.g. Mesmer shatters at
  // Profession_1..4). Used to exclude contextual trait-sourced skills (e.g. Mirage mirror
  // mechanics at Profession_3) that would otherwise displace the base skill. Legitimate elite spec
  // additions like DH's F2/F3 appear at NEW slots not present in the base, so they pass through.
  const baseProfSlots = new Set(
    professionSkillsRaw
      .filter((s) => Number(s.specialization) === 0 && /^Profession_\d/.test(s.slot))
      .map((s) => s.slot)
  );

  const [weaponChainDepth2Raw, traitSkillsRaw, morphPoolSkillsRaw] = await Promise.all([
    weaponChainDepth2Ids.length ? fetchGw2ByIds("skills", weaponChainDepth2Ids, lang) : Promise.resolve([]),
    traitSkillIdsToFetch.length
      ? fetchGw2ByIds("skills", traitSkillIdsToFetch, lang).then((raw) =>
          raw
            .map((skill) => {
              const tag = traitSkillTagMap.get(skill.id);
              // Prefer the skill's own slot from /v2/skills over the trait-tier-inferred fallback.
              // Trait skills all share the same tier (e.g. DH minor trait 1848 is tier 1), so
              // the `Profession_${tier}` fallback would incorrectly map F2 and F3 to Profession_1.
              return tag ? { ...skill, slot: skill.slot || tag.slot, specialization: tag.specialization, type: tag.type } : skill;
            })
            .filter((skill) => {
              // Exclude contextual mechanic skills (e.g. Mirage mirror skills at Profession_3)
              // that appear at Profession_N slots already occupied by a base profession skill.
              const lockSpec = Number(skill.specialization) || 0;
              if (!lockSpec) return true;
              if (!/^Profession_\d/.test(skill.slot)) return true;
              return !baseProfSlots.has(skill.slot);
            })
        )
      : Promise.resolve([]),
    morphPoolPromise,
  ]);

  // Build weaponSkillsRaw: base slot skills + all chain continuations.
  const weaponSkillsRaw = [
    ...weaponSkillsBase,
    ...extraSkillsRaw.filter((s) => weaponChainDepth1Ids.includes(s.id)),
    ...weaponChainDepth2Raw,
  ];

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
        : skill.id === RADIANT_FORGE_SKILL_ID
          ? RADIANT_FORGE_BUNDLE
          : FIREBRAND_TOME_CHAPTERS.has(skill.id)
          ? FIREBRAND_TOME_CHAPTERS.get(skill.id).map((c) => c.id)
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
  // legendsRawPromise was started in step 2, so this await is typically instant (already in flight).
  let legends = [];
  if (professionId === "Revenant") {
    const legendsRaw = await legendsRawPromise;
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

  // Firebrand tome chapters are not in the GW2 API — inject synthetic raw skill objects so mapSkill
  // can include them in the catalog for weapon-bar display when a tome is toggled.
  if (professionId === "Guardian") {
    for (const chapters of FIREBRAND_TOME_CHAPTERS.values()) {
      for (const ch of chapters) {
        skills.push({
          id: ch.id, name: ch.name, icon: ch.icon, slot: ch.slot,
          type: "Weapon", specialization: 62, professions: ["Guardian"],
          weapon_type: "None", attunement: "None", dual_attunement: "None",
          categories: [], facts: ch.facts || [], bundle_skills: [], transform_skills: [],
          toolbelt_skill: 0, flip_skill: 0, description: ch.description || "",
        });
      }
    }
  }

  // Sixth pass: Ranger pet data.
  // Each pet has a type (family) and a set of skills. The pet's active skill (shown as the pet's
  // unique contribution to the skillbar) is skills[4] (the 5th slot). In Soulbeast, F1/F2 skill
  // resolution matches the skill's weapon_type against the active pet's type field.
  // petsPromise was started in step 2, so this await is typically instant (already in flight).
  let pets = [];
  if (professionId === "Ranger") {
    const petsRaw = await petsPromise;
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
      flipSkill: Number(skill.flip_skill) || 0,
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
  const results = await Promise.all(
    chunks.map((idsChunk) => {
      const query = idsChunk.join(",");
      const url = `${GW2_API_ROOT}/${endpoint}?ids=${encodeURIComponent(query)}&lang=${encodeURIComponent(lang)}`;
      return fetchCachedJson(`${endpoint}:${lang}:${query}`, url, 1000 * 60 * 60)
        .then((data) => (Array.isArray(data) ? data.filter(Boolean) : []));
    })
  );
  return results.flat();
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
  const RETRYABLE = new Set([429, 500, 502, 503, 504]);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
    let res;
    try {
      res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
    } catch (networkErr) {
      lastErr = networkErr;
      continue;
    }
    if (res.ok) return res.json();
    const text = await res.text().catch(() => "");
    lastErr = new Error(`Request failed (${res.status}) for ${url}${text ? `: ${text.slice(0, 180)}` : ""}`);
    if (!RETRYABLE.has(res.status)) break;
  }
  throw lastErr;
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
