function q(selector) {
  return typeof document !== "undefined" ? document.querySelector(selector) : null;
}

const state = {
  user: null,
  onboarding: null,
  targets: [],
  selectedTarget: null,
  pagesPoll: {
    active: false,
    status: "",
    error: null,
  },
  loginFlow: {
    pending: false,
    beginData: null,
    waitingForApproval: false,
  },
  builds: [],
  professions: [],
  activePage: "editor",
  buildSearch: "",
  skillSearch: "",
  catalogCache: new Map(),
  activeCatalog: null,
  renderedSkillIconIds: new Map(),
  editor: createEmptyEditor(),
  editorBaselineSignature: "",
  editorDirty: false,
  detail: null,
  wikiCache: new Map(),
  openCustomSelect: null,
};

const el = {
  setupGate: q("#setupGate"),
  authRow: q("#authRow"),
  onboarding: q("#onboarding"),
  workspaceBtn: q("#workspaceBtn"),
  workspaceMenu: q("#workspaceMenu"),
  subnav: q("#subnav"),
  appLayout: q(".app-layout"),
  buildList: q("#buildList"),
  buildSearch: q("#buildSearch"),
  editorTitle: q("#editorTitle"),
  professionSelect: q("#professionSelect"),
  tagsInput: q("#tagsInput"),
  equipmentPanel: q("#equipmentPanel"),
  newBuildBtn: q("#newBuildBtn"),
  saveBuildBtn: q("#saveBuildBtn"),
  duplicateBuildBtn: q("#duplicateBuildBtn"),
  copyBuildBtn: q("#copyBuildBtn"),
  pasteBuildBtn: q("#pasteBuildBtn"),
  editorDirtyBadge: q("#editorDirtyBadge"),
  buildSummary: q("#buildSummary"),
  publishSiteBtn: q("#publishSiteBtn"),
  specializationsHost: q("#specializationsHost"),
  skillsHost: q("#skillsHost"),
  detailHost: q("#detailHost"),
  publishStatus: q("#publishStatus"),
  hoverPreview: q("#hoverPreview"),
  winMin: q("#winMin"),
  winMax: q("#winMax"),
  winClose: q("#winClose"),
  titlebar: q("#titlebar"),
};

if (typeof window !== "undefined" && !window.__GW2_RENDERER_TEST__) {
  init().catch((err) => showError(err));
}

function buildRevenantEliteByProfSlot(eliteFixedSkills, eliteSpecId, isAllianceLegendActive, skillById) {
  const eliteByProfSlot = new Map((eliteFixedSkills || []).map((s) => [s.slot, s]));
  // Vindicator + Legendary Alliance should always expose Alliance Tactics at F3.
  // Keep this as a defensive fallback in case upstream skill selection misses 62729.
  if (Number(eliteSpecId) === 69 && isAllianceLegendActive) {
    const allianceTactics = skillById?.get(62729);
    if (allianceTactics) eliteByProfSlot.set("Profession_3", allianceTactics);
  }
  return eliteByProfSlot;
}

async function init() {
  wireWindowControls();
  wireEvents();

  const [builds, professions] = await Promise.all([
    window.desktopApi.listBuilds(),
    window.desktopApi.listProfessions(),
  ]);
  state.builds = Array.isArray(builds) ? builds : [];
  state.professions = Array.isArray(professions) ? professions : [];
  await refreshOnboardingStatus();

  if (state.builds.length) {
    await loadBuildIntoEditor(state.builds[0], { captureBaseline: true });
  } else if (state.professions.length) {
    state.editor = createEmptyEditor(state.professions[0].id);
    await setProfession(state.professions[0].id, { preserveSelections: false });
    captureEditorBaseline();
  }

  await refreshWindowControls();
  render();
}

function wireEvents() {
  el.editorTitle.addEventListener("input", () => {
    state.editor.title = String(el.editorTitle.value || "");
    markEditorChanged({ updateBuildList: true });
  });

  el.tagsInput.addEventListener("input", () => {
    state.editor.tagsText = String(el.tagsInput.value || "");
    markEditorChanged();
  });

  el.newBuildBtn.addEventListener("click", async () => {
    await startNewBuild();
  });

  el.saveBuildBtn.addEventListener("click", async () => {
    await saveCurrentBuild();
  });

  el.duplicateBuildBtn.addEventListener("click", async () => {
    await duplicateCurrentBuild();
  });

  el.copyBuildBtn.addEventListener("click", async () => {
    await copyBuildJsonToClipboard();
  });

  el.pasteBuildBtn.addEventListener("click", async () => {
    await importBuildJsonFromClipboard();
  });

  el.publishSiteBtn.addEventListener("click", async () => {
    try {
      if (!state.user) {
        throw new Error("Log in and complete setup before publishing.");
      }
      setPublishStatus("Publishing static site to GitHub...");
      await window.desktopApi.publishSite();
      await runPagesBuildPoll();
      await refreshOnboardingStatus();
      setPublishStatus(`Publish triggered. Pages URL: ${state.onboarding?.pagesUrl || "pending"}`);
      render();
    } catch (err) {
      showError(err);
    }
  });

  el.buildSearch.addEventListener("input", () => {
    state.buildSearch = String(el.buildSearch.value || "").trim().toLowerCase();
    renderBuildList();
  });


  window.addEventListener("keydown", async (event) => {
    if (event.key === "Escape") {
      closeCustomSelect();
      hideHoverPreview();
      return;
    }
    const key = String(event.key || "").toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;
    if (key === "s") {
      event.preventDefault();
      await saveCurrentBuild();
    } else if (key === "d") {
      event.preventDefault();
      await duplicateCurrentBuild();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".cselect")) return;
    closeCustomSelect();
  });

  document.addEventListener("scroll", (event) => {
    // Don't close when scrolling inside the open dropdown's own list
    const open = state.openCustomSelect;
    if (open && event.target instanceof Node && open.contains(event.target)) return;
    closeCustomSelect();
  }, { capture: true, passive: true });

  // Workspace menu toggle
  el.workspaceBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    el.workspaceMenu.classList.toggle("hidden");
  });

  document.addEventListener("pointerdown", (event) => {
    if (!el.workspaceMenu.classList.contains("hidden") &&
        !el.workspaceMenu.contains(event.target) &&
        event.target !== el.workspaceBtn) {
      el.workspaceMenu.classList.add("hidden");
    }
  });

  // Left nav page switching
  document.querySelectorAll(".leftnav__item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.page;
      if (!page) return;
      state.activePage = page;
      document.querySelectorAll(".leftnav__item").forEach((b) => b.classList.remove("leftnav__item--active"));
      btn.classList.add("leftnav__item--active");
      document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
      const target = document.querySelector(`#page-${page}`);
      if (target) target.classList.remove("hidden");
      // Show/hide subnav for editor page
      const showSubnav = page === "editor";
      el.subnav.classList.toggle("subnav--visible", showSubnav);
      el.appLayout.classList.toggle("app-layout--subnav", showSubnav);
    });
  });

  // Subnav tab switching
  document.querySelectorAll(".subnav__item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.subtab;
      if (!tab) return;
      document.querySelectorAll(".subnav__item").forEach((b) => b.classList.remove("subnav__item--active"));
      btn.classList.add("subnav__item--active");
      document.querySelectorAll(".subtab").forEach((t) => t.classList.add("hidden"));
      const target = document.querySelector(`#subtab-${tab}`);
      if (target) target.classList.remove("hidden");
    });
  });
}

async function startNewBuild() {
  if (!confirmDiscardDirty("Start a new build")) return;
  const profession = state.editor.profession || state.professions[0]?.id || "";
  state.editor = createEmptyEditor(profession);
  if (profession) {
    await setProfession(profession, { preserveSelections: false });
  }
  state.detail = null;
  captureEditorBaseline();
  render();
  setPublishStatus("Started a new local build draft.");
}

async function saveCurrentBuild() {
  try {
    const saved = await window.desktopApi.saveBuild(serializeEditorToBuild());
    state.editor.id = saved.id;
    await reloadBuilds();
    const savedBuild = state.builds.find((entry) => entry.id === saved.id);
    if (savedBuild) await loadBuildIntoEditor(savedBuild, { captureBaseline: true });
    else captureEditorBaseline();
    render();
    setPublishStatus("Build saved locally.");
  } catch (err) {
    showError(err);
  }
}

async function duplicateCurrentBuild() {
  const baseTitle = String(state.editor.title || "Untitled Build").trim();
  state.editor.id = "";
  state.editor.title = baseTitle ? `${baseTitle} (Copy)` : "Copied Build";
  markEditorChanged({ updateBuildList: true });
  renderEditorForm();
  setPublishStatus("Build duplicated. Save to keep it in your library.");
}

async function copyBuildJsonToClipboard() {
  try {
    const payload = serializeEditorToBuild();
    const json = JSON.stringify(payload, null, 2);
    await window.desktopApi.writeClipboardText(json);
    setPublishStatus("Build JSON copied to clipboard.");
  } catch (err) {
    showError(err);
  }
}

async function importBuildJsonFromClipboard() {
  try {
    if (!confirmDiscardDirty("Import another build")) return;
    const text = await window.desktopApi.readClipboardText();
    if (!text || !String(text).trim()) {
      throw new Error("Clipboard is empty.");
    }
    const parsed = parseBuildImportPayload(String(text));
    await loadBuildIntoEditor(parsed, { captureBaseline: false });
    state.editor.id = "";
    markEditorChanged({ updateBuildList: true });
    state.editorDirty = true;
    renderEditorMeta();
    render();
    setPublishStatus("Imported build JSON from clipboard. Save to keep it locally.");
  } catch (err) {
    showError(err);
  }
}

function wireWindowControls() {
  el.titlebar.addEventListener("dblclick", async (event) => {
    if (event.target.closest(".no-drag")) return;
    await window.desktopApi.toggleMaximizeWindow();
    await refreshWindowControls();
  });
  el.winMin.addEventListener("click", async () => {
    await window.desktopApi.minimizeWindow();
  });
  el.winMax.addEventListener("click", async () => {
    await window.desktopApi.toggleMaximizeWindow();
    await refreshWindowControls();
  });
  el.winClose.addEventListener("click", async () => {
    await window.desktopApi.closeWindow();
  });
}

async function refreshWindowControls() {
  const maximized = await window.desktopApi.isMaximizedWindow();
  el.winMax.textContent = maximized ? "[] " : "+";
}

async function refreshOnboardingStatus() {
  const status = await window.desktopApi.getOnboardingStatus();
  state.onboarding = status;
  state.user = status.viewer;

  if (status.isAuthenticated) {
    state.targets = await window.desktopApi.listTargets();
    if (!state.selectedTarget) {
      state.selectedTarget =
        state.targets.find((target) => target.login === status.targetOwner) ||
        state.targets[0] ||
        null;
    }
  } else {
    state.targets = [];
    state.selectedTarget = null;
  }

  if (status.isAuthenticated && status.repoReady && !status.pagesReady && !state.pagesPoll.active) {
    runPagesBuildPoll().catch((err) => showError(err));
  }
}

async function setProfession(professionId, options = {}) {
  const selected = String(professionId || "");
  if (!selected) return;

  const catalog = await getCatalog(selected);
  state.activeCatalog = catalog;
  state.editor.profession = selected;

  if (!options.preserveSelections) {
    state.editor.specializations = createDefaultSpecializationSelections(catalog);
    state.editor.skills = createDefaultSkillSelections(catalog, state.editor.specializations);
  }

  enforceEditorConsistency({ preferredEliteSlot: options.preferredEliteSlot });
  renderEditor();
}

async function getCatalog(professionId) {
  if (state.catalogCache.has(professionId)) return state.catalogCache.get(professionId);
  const raw = await window.desktopApi.getProfessionCatalog(professionId);
  const catalog = {
    ...raw,
    specializationById: new Map((raw.specializations || []).map((entry) => [Number(entry.id), entry])),
    traitById: new Map((raw.traits || []).map((entry) => [Number(entry.id), entry])),
    skillById: new Map((raw.skills || []).map((entry) => [Number(entry.id), entry])),
    weaponSkillById: new Map((raw.weaponSkills || []).map((entry) => [Number(entry.id), entry])),
    legendById: new Map((raw.legends || []).map((entry) => [String(entry.id), entry])),
    petById: new Map((raw.pets || []).map((entry) => [Number(entry.id), entry])),
  };
  state.catalogCache.set(professionId, catalog);

  // Pre-load all spec background images so they're cached before the user switches specs
  for (const spec of catalog.specializations || []) {
    const wikiUrl = `https://wiki.guildwars2.com/wiki/Special:FilePath/${encodeURIComponent(`${spec.name || ""} specialization.png`)}`;
    const img = new Image();
    img.src = wikiUrl;
  }

  return catalog;
}

function createDefaultSpecializationSelections(catalog) {
  const specs = Array.isArray(catalog.specializations) ? catalog.specializations : [];
  const core = specs.filter((entry) => !entry.elite);
  const elite = specs.filter((entry) => entry.elite);
  const picks = [core[0], core[1], elite[0] || core[2] || core[0]].filter(Boolean);
  const seen = new Set();
  const selections = [];
  for (const spec of picks) {
    if (!spec || seen.has(spec.id)) continue;
    seen.add(spec.id);
    selections.push(createSpecializationSelection(spec, catalog));
  }

  while (selections.length < 3) {
    const fallback = specs.find((entry) => !seen.has(entry.id));
    if (!fallback) break;
    seen.add(fallback.id);
    selections.push(createSpecializationSelection(fallback, catalog));
  }

  return selections.slice(0, 3);
}

function createSpecializationSelection(spec, catalog) {
  const majors = getMajorTraitsByTier(spec, catalog);
  return {
    specializationId: Number(spec.id),
    majorChoices: {
      1: Number(majors[1]?.[0]?.id || 0),
      2: Number(majors[2]?.[0]?.id || 0),
      3: Number(majors[3]?.[0]?.id || 0),
    },
  };
}

function createDefaultSkillSelections(catalog, specializations) {
  const skillOptions = getSkillOptionsByType(catalog, specializations);
  const utilityIds = (skillOptions.utility || []).slice(0, 3).map((skill) => skill.id);
  return {
    healId: Number(skillOptions.heal?.[0]?.id || 0),
    utilityIds: [utilityIds[0] || 0, utilityIds[1] || 0, utilityIds[2] || 0],
    eliteId: Number(skillOptions.elite?.[0]?.id || 0),
  };
}

function enforceEditorConsistency(options = {}) {
  const catalog = state.activeCatalog;
  if (!catalog) return;

  const specs = Array.isArray(catalog.specializations) ? catalog.specializations : [];
  const used = new Set();
  const nextSpecs = [];
  for (let i = 0; i < 3; i += 1) {
    const current = state.editor.specializations[i] || {};
    const currentId = Number(current.specializationId) || 0;
    let spec = catalog.specializationById.get(currentId) || null;
    if (!spec || used.has(spec.id)) {
      spec = specs.find((entry) => !used.has(entry.id)) || null;
    }
    if (!spec) continue;
    used.add(spec.id);
    const majors = getMajorTraitsByTier(spec, catalog);
    nextSpecs.push({
      specializationId: spec.id,
      majorChoices: {
        1: chooseTraitId(current.majorChoices?.[1], majors[1]),
        2: chooseTraitId(current.majorChoices?.[2], majors[2]),
        3: chooseTraitId(current.majorChoices?.[3], majors[3]),
      },
    });
  }
  const preferredEliteSlot = Number(options.preferredEliteSlot);
  const eliteSlots = nextSpecs
    .map((entry, index) => {
      const spec = catalog.specializationById.get(Number(entry.specializationId));
      return spec?.elite ? index : -1;
    })
    .filter((index) => index >= 0);
  if (eliteSlots.length > 1) {
    const keepSlot = eliteSlots.includes(preferredEliteSlot) ? preferredEliteSlot : eliteSlots[0];
    for (const slot of eliteSlots) {
      if (slot === keepSlot) continue;
      const usedIds = new Set(nextSpecs.map((entry) => Number(entry.specializationId) || 0));
      usedIds.delete(Number(nextSpecs[slot]?.specializationId) || 0);
      const replacement = specs.find((entry) => !entry.elite && !usedIds.has(Number(entry.id)));
      if (!replacement) continue;
      const current = state.editor.specializations[slot] || {};
      const majors = getMajorTraitsByTier(replacement, catalog);
      nextSpecs[slot] = {
        specializationId: Number(replacement.id),
        majorChoices: {
          1: chooseTraitId(current.majorChoices?.[1], majors[1]),
          2: chooseTraitId(current.majorChoices?.[2], majors[2]),
          3: chooseTraitId(current.majorChoices?.[3], majors[3]),
        },
      };
    }
  }

  state.editor.specializations = nextSpecs;

  // Clear Antiquary artifact draws when Antiquary is no longer the active elite spec.
  if (!nextSpecs.some((e) => Number(e?.specializationId) === 77)) {
    state.editor.antiquaryArtifacts = { f2: 0, f3: 0, f4: 0 };
  } else if (state.editor.antiquaryArtifacts) {
    // Antiquary active: clear f4 if Prolific Plunderer is no longer selected.
    const aqEntry = nextSpecs.find((e) => Number(e?.specializationId) === 77);
    const prolificActive = Object.values(aqEntry?.majorChoices || {})
      .some((id) => Number(id) === ANTIQUARY_PROLIFIC_PLUNDERER_TRAIT_ID);
    if (!prolificActive) state.editor.antiquaryArtifacts.f4 = 0;
  }

  // Revenant: skills are locked to the active legend; skip normal skill-options enforcement.
  // Instead, sync from the selected legend (or set defaults if no legend is selected yet).
  const isRevenant = Array.isArray(catalog.legends) && catalog.legends.length > 0;
  if (isRevenant) {
    if (!state.editor.selectedLegends) state.editor.selectedLegends = ["", ""];
    // Clear legends that require an elite spec the player no longer has
    const selectedSpecIds = new Set(
      (state.editor.specializations || []).map((s) => Number(s?.specializationId) || 0).filter(Boolean)
    );
    const isLegendValid = (legendId) => {
      if (!legendId) return false;
      const legend = catalog.legendById.get(legendId);
      if (!legend) return false;
      const swapSkill = legend.swap ? catalog.skillById.get(legend.swap) : null;
      const reqSpec = Number(swapSkill?.specialization) || 0;
      return !reqSpec || selectedSpecIds.has(reqSpec);
    };
    if (!isLegendValid(state.editor.selectedLegends[0])) state.editor.selectedLegends[0] = "";
    if (!isLegendValid(state.editor.selectedLegends[1])) state.editor.selectedLegends[1] = "";
    // Reset Alliance form if Alliance legend is no longer selected
    const allianceSelected = state.editor.selectedLegends[0] === "Legend7" || state.editor.selectedLegends[1] === "Legend7";
    if (!allianceSelected) state.editor.allianceTacticsForm = 0;
    // Default to first two valid legends if none selected
    const validLegends = (catalog.legends || []).filter((l) => {
      const swapSkill = l.swap ? catalog.skillById.get(l.swap) : null;
      const reqSpec = Number(swapSkill?.specialization) || 0;
      return !reqSpec || selectedSpecIds.has(reqSpec);
    });
    if (!state.editor.selectedLegends[0]) {
      const pick = validLegends.find((l) => l.id !== state.editor.selectedLegends[1]);
      if (pick) state.editor.selectedLegends[0] = pick.id;
    }
    if (!state.editor.selectedLegends[1]) {
      const pick = validLegends.find((l) => l.id !== state.editor.selectedLegends[0]);
      if (pick) state.editor.selectedLegends[1] = pick.id;
    }
    syncRevenantSkillsFromLegend(catalog);
  } else {
    const skillOptions = getSkillOptionsByType(catalog, state.editor.specializations);
    const utilityIds = Array.isArray(state.editor.skills.utilityIds)
      ? state.editor.skills.utilityIds.map((value) => Number(value) || 0).slice(0, 3)
      : [];
    while (utilityIds.length < 3) utilityIds.push(0);

    state.editor.skills.healId = chooseSkillId(state.editor.skills.healId, skillOptions.heal);
    state.editor.skills.eliteId = chooseSkillId(state.editor.skills.eliteId, skillOptions.elite);

    const usedUtility = new Set();
    state.editor.skills.utilityIds = utilityIds.map((value) => {
      const selected = chooseSkillId(value, skillOptions.utility, usedUtility);
      if (selected) usedUtility.add(selected);
      return selected;
    });
  }

  // Weaver: primary (mainhand) is always set; secondary (offhand) can be any element including
  // the same as primary, producing a single-attunement skill bar (identical to core Ele slot 3).
  const weaverEliteId = 56;
  const activeEliteSpecId = Number(
    (state.editor.specializations || [])
      .map((e) => Number(e?.specializationId))
      .find((id) => catalog.specializationById.get(id)?.elite)
  ) || 0;
  if (activeEliteSpecId === weaverEliteId) {
    const attunements = ["Fire", "Water", "Air", "Earth"];
    if (!state.editor.activeAttunement || !attunements.includes(state.editor.activeAttunement)) {
      state.editor.activeAttunement = "Fire";
    }
    // Secondary defaults to primary (single-attunement start state); any valid element is accepted.
    if (!state.editor.activeAttunement2 || !attunements.includes(state.editor.activeAttunement2)) {
      state.editor.activeAttunement2 = state.editor.activeAttunement;
    }
  }

  // Clear weapons that the new profession cannot equip
  const profWeapons = catalog.professionWeapons || {};
  const equip = state.editor.equipment;
  if (equip?.weapons) {
    for (const [key, weaponId] of Object.entries(equip.weapons)) {
      if (!weaponId) continue;
      const wData = profWeapons[weaponId];
      const isOffhand = key.startsWith("offhand");
      const isMainhand = key.startsWith("mainhand");
      let valid = false;
      if (wData) {
        if (isOffhand) valid = wData.flags.includes("Offhand");
        else if (isMainhand) valid = wData.flags.includes("Mainhand") || wData.flags.includes("TwoHand");
        else valid = true; // aquatic — keep as-is (no per-profession filtering in picker)
      }
      if (!valid) {
        equip.weapons[key] = "";
        if (equip.slots?.[key] !== undefined) equip.slots[key] = "";
      }
    }
  }
}

function chooseTraitId(currentId, options) {
  const id = Number(currentId) || 0;
  if (id && Array.isArray(options) && options.some((entry) => Number(entry.id) === id)) {
    return id;
  }
  return Number(options?.[0]?.id || 0);
}

function chooseSkillId(currentId, options, usedSet = null) {
  const id = Number(currentId) || 0;
  if (
    id &&
    Array.isArray(options) &&
    options.some((entry) => Number(entry.id) === id) &&
    (!usedSet || !usedSet.has(id))
  ) {
    return id;
  }
  const fallback = (options || []).find((entry) => !usedSet || !usedSet.has(Number(entry.id)));
  return Number(fallback?.id || 0);
}

function render() {
  hideHoverPreview();
  closeCustomSelect();
  renderAuth();
  renderOnboarding();
  renderSetupGate();
  renderBuildList();
  renderEditor();
  // Update titlebar user display
  const titlebarUser = document.querySelector("#titlebarUser");
  if (titlebarUser) {
    titlebarUser.textContent = state.user ? state.user.login : "";
  }
  if (el.workspaceBtn) {
    el.workspaceBtn.title = state.user ? `Workspace (${state.user.login})` : "Workspace (not signed in)";
    el.workspaceBtn.classList.toggle("titlebar__workspace-btn--active", Boolean(state.user));
  }
}

function renderAuth() {
  el.authRow.innerHTML = "";

  const status = state.onboarding;
  const target = getSelectedTarget();

  if (state.user) {
    const who = document.createElement("div");
    who.className = "workspace-menu__user";
    who.textContent = `Signed in as ${state.user.login}`;
    el.authRow.append(who);

    const reauth = makeButton("Re-authenticate", "secondary", async () => {
      try {
        await startLoginFlow();
        await refreshOnboardingStatus();
        render();
      } catch (err) { showError(err); }
    });

    const rerunSetup = makeButton("Re-run Setup", "secondary", async () => {
      try {
        if (!target) throw new Error("No target selected.");
        await window.desktopApi.setupRepoPages(target.login, target.type);
        await runPagesBuildPoll();
        await refreshOnboardingStatus();
        render();
      } catch (err) { showError(err); }
    });
    rerunSetup.disabled = !status?.isAuthenticated || !target;

    const logout = makeButton("Log out", "danger", async () => {
      await window.desktopApi.logout();
      state.loginFlow.beginData = null;
      await refreshOnboardingStatus();
      render();
    });

    el.authRow.append(who, reauth, rerunSetup, logout);
    return;
  }

  const loginBtn = makeButton("Login with GitHub", "primary", async () => {
    try {
      await startLoginFlow();
      await refreshOnboardingStatus();
      render();
    } catch (err) {
      showError(err);
    }
  });
  el.authRow.append(loginBtn);
}

function renderOnboarding() {
  const status = state.onboarding;
  el.onboarding.innerHTML = "";
  if (!status) return;
  // Onboarding steps are surfaced via the workspace dropdown actions, not as cards here
  if (status.isAuthenticated) return;

  const target = getSelectedTarget();
  const targetHint = target ? `Target: ${target.login}` : "Target: not selected";
  const steps = [
    {
      title: "Authenticate with GitHub",
      done: status.isAuthenticated,
      actionLabel: status.isAuthenticated ? "Re-authenticate" : "Authenticate",
      canRun: !state.loginFlow.pending,
      action: async () => {
        await startLoginFlow();
        await refreshOnboardingStatus();
        render();
      },
    },
    {
      title: "Create gw2builds + enable Pages",
      done: status.repoReady && status.pagesReady,
      actionLabel: status.repoReady && status.pagesReady ? "Re-run setup" : "Setup",
      canRun: status.isAuthenticated && Boolean(target),
      action: async () => {
        await window.desktopApi.setupRepoPages(target.login, target.type);
        await runPagesBuildPoll();
        await refreshOnboardingStatus();
        render();
      },
    },
  ];

  for (const step of steps) {
    const card = document.createElement("article");
    card.className = `status-card ${step.done ? "status-card--done" : ""}`;
    const title = document.createElement("h3");
    title.textContent = step.title;
    const body = document.createElement("p");
    body.textContent =
      step.title.includes("gw2builds") && !step.done ? targetHint : step.done ? "Completed" : "Required";
    card.append(title, body);

    if (step.canRun) {
      const btn = makeButton(step.actionLabel, "primary", async () => {
        try {
          btn.disabled = true;
          await step.action();
        } catch (err) {
          showError(err);
        } finally {
          btn.disabled = false;
        }
      });
      btn.classList.add("mt-8");
      card.append(btn);
    }
    el.onboarding.append(card);
  }
}

function renderSetupGate() {
  const status = state.onboarding;
  if (!status) return;
  const isReady = status.isAuthenticated && status.repoReady && status.pagesReady && status.siteReady;
  if (isReady) {
    el.setupGate.classList.add("hidden");
    return;
  }

  el.setupGate.classList.remove("hidden");
  const flow = state.loginFlow;
  const codeBlock = flow.beginData
    ? `
      <article class="gate-card">
        <h3>GitHub Device Code</h3>
        <p>Approve login at GitHub using this code.</p>
        <div class="gate-code">${escapeHtml(flow.beginData.userCode || "")}</div>
        <button id="copyDeviceCode" class="btn btn-secondary">Copy code</button>
        <p class="gate-link">Open <a href="${escapeHtml(flow.beginData.verificationUri)}" target="_blank" rel="noreferrer">${escapeHtml(flow.beginData.verificationUri)}</a>.</p>
      </article>
    `
    : "";
  const pollBlock = state.pagesPoll.active
    ? `
      <article class="gate-card gate-card--poll">
        <h3>Waiting For GitHub Pages</h3>
        <p>Current status: <strong>${escapeHtml(formatPagesStatus(state.pagesPoll.status))}</strong></p>
        ${state.pagesPoll.error ? `<p class="error-line">${escapeHtml(state.pagesPoll.error)}</p>` : ""}
      </article>
    `
    : "";

  el.setupGate.innerHTML = `
    <div class="gate-shell">
      <div>
        <h1>Complete First-Time Setup</h1>
        <p>GW2Builds stays locked until authentication and repository setup are complete.</p>
      </div>
      ${codeBlock}
      ${pollBlock}
      <div id="targetPicker"></div>
      <div id="setupGateSteps" class="gate-steps"></div>
    </div>
  `;

  const picker = el.setupGate.querySelector("#targetPicker");
  renderTargetPicker(picker);

  const host = el.setupGate.querySelector("#setupGateSteps");
  const target = getSelectedTarget();
  const targetHint = target ? `Target: ${target.login}` : "Pick a target first.";
  const steps = [
    {
      title: "1. Authenticate with GitHub",
      done: status.isAuthenticated,
      actionLabel: flow.waitingForApproval
        ? "Waiting for approval..."
        : status.isAuthenticated
          ? "Re-authenticate"
          : "Authenticate",
      canRun: !flow.pending,
      action: async () => {
        await startLoginFlow();
        await refreshOnboardingStatus();
        render();
      },
    },
    {
      title: "2. Create gw2builds and enable Pages",
      done: status.repoReady && status.pagesReady,
      actionLabel: status.repoReady && status.pagesReady ? "Re-run setup" : "Setup repo + Pages",
      canRun: status.isAuthenticated && Boolean(target),
      action: async () => {
        await window.desktopApi.setupRepoPages(target.login, target.type);
        await runPagesBuildPoll();
        await refreshOnboardingStatus();
        render();
      },
    },
  ];

  for (const step of steps) {
    const card = document.createElement("article");
    card.className = `status-card ${step.done ? "status-card--done" : ""}`;
    card.innerHTML = `<h3>${escapeHtml(step.title)}</h3><p>${step.done ? "Completed" : escapeHtml(targetHint)}</p>`;
    if (step.canRun) {
      const btn = makeButton(step.actionLabel, "primary", async () => {
        try {
          btn.disabled = true;
          await step.action();
        } catch (err) {
          showError(err);
        } finally {
          btn.disabled = false;
        }
      });
      btn.classList.add("mt-8");
      card.append(btn);
    }
    host.append(card);
  }

  const copyBtn = el.setupGate.querySelector("#copyDeviceCode");
  if (copyBtn && flow.beginData?.userCode) {
    copyBtn.addEventListener("click", async () => {
      await window.desktopApi.writeClipboardText(flow.beginData.userCode);
      copyBtn.textContent = "Copied";
      setTimeout(() => {
        copyBtn.textContent = "Copy code";
      }, 1000);
    });
  }
}

function renderTargetPicker(container) {
  if (!container || !state.targets.length) return;
  const wrap = document.createElement("div");
  wrap.className = "target-picker";
  const label = document.createElement("label");
  label.textContent = "Repository owner";
  const host = document.createElement("div");
  renderCustomSelect(host, {
    value: state.selectedTarget?.login || state.targets[0]?.login || "",
    className: "cselect--target",
    options: state.targets.map((target) => ({
      value: target.login,
      label: target.login,
      meta: String(target.type || "").toUpperCase(),
      iconText: target.type === "org" ? "O" : "U",
    })),
    placeholder: "Select owner",
    onChange: (login) => {
      state.selectedTarget = state.targets.find((target) => target.login === String(login)) || null;
      render();
    },
  });
  label.append(host);
  wrap.append(label);
  container.innerHTML = "";
  container.append(wrap);
}

function renderBuildList() {
  const query = state.buildSearch;
  const visible = state.builds
    .filter((build) => matchesBuildQuery(build, query))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  el.buildList.innerHTML = "";
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty-line";
    empty.textContent = "No local builds yet.";
    el.buildList.append(empty);
    return;
  }

  for (const build of visible) {
    const card = document.createElement("article");
    const active = build.id && build.id === state.editor.id;
    const dirtySuffix = active && state.editorDirty ? " | Unsaved edits" : "";
    card.className = `build-card ${active ? "build-card--active" : ""}`;
    card.innerHTML = `
      <h3>${escapeHtml(build.title || "Untitled Build")}</h3>
      <p>${escapeHtml(build.profession || "Unknown Profession")} | Updated ${escapeHtml(formatDate(build.updatedAt))}${escapeHtml(dirtySuffix)}</p>
    `;

    const actions = document.createElement("div");
    actions.className = "build-card__actions";

    const loadBtn = makeButton("Load", "secondary", async () => {
      if (!confirmDiscardDirty("Load a different build")) return;
      await loadBuildIntoEditor(build);
      render();
    });
    const deleteBtn = makeButton("Delete", "danger", async () => {
      await window.desktopApi.deleteBuild(build.id);
      await reloadBuilds();
      if (state.editor.id === build.id) {
        const next = state.builds[0] || null;
        if (next) await loadBuildIntoEditor(next);
        else {
          const profession = state.professions[0]?.id || "";
          state.editor = createEmptyEditor(profession);
          if (profession) {
            await setProfession(profession, { preserveSelections: false });
          }
          captureEditorBaseline();
        }
      }
      render();
    });
    actions.append(loadBtn, deleteBtn);
    card.append(actions);
    el.buildList.append(card);
  }
}

// Conduit (spec 79) F2 — Release Potential variant to show based on the active legend.
// Keyed by the legend's swap skill ID (stable, confirmed values) rather than legend IDs
// (Legend1-8) which may not reliably map to stances across API versions.
// Each stance has two known swap skill IDs (active/inactive forms); both map to the same variant.
const CONDUIT_F2_BY_SWAP = new Map([
  [27659, 78845], [28134, 78845], // Legendary Assassin Stance → Release Potential: Assassin
  [26650, 78895], [28419, 78895], // Legendary Dwarf Stance    → Release Potential: Warrior
  [28376, 78615], [28494, 78615], // Legendary Demon Stance    → Release Potential: Mesmer
  [28141, 78501], [28195, 78501], // Legendary Centaur Stance  → Release Potential: Monk
  [76610, 78661],                 // Legendary Entity Stance   → Release Potential: Dervish
]);

const STAT_COMBOS = [
  { label: "Berserker's",   stats: ["Power", "Precision", "Ferocity"] },
  { label: "Marauder's",    stats: ["Power", "Precision", "Vitality", "Ferocity"] },
  { label: "Assassin's",    stats: ["Precision", "Power", "Ferocity"] },
  { label: "Valkyrie",      stats: ["Power", "Vitality", "Ferocity"] },
  { label: "Dragon's",      stats: ["Power", "Ferocity", "Vitality", "Precision"] },
  { label: "Viper's",       stats: ["Power", "ConditionDamage", "Precision", "Expertise"] },
  { label: "Grieving",      stats: ["Power", "ConditionDamage", "Ferocity", "Precision"] },
  { label: "Sinister",      stats: ["ConditionDamage", "Power", "Precision"] },
  { label: "Dire",          stats: ["ConditionDamage", "Toughness", "Vitality"] },
  { label: "Rabid",         stats: ["ConditionDamage", "Toughness", "Precision"] },
  { label: "Carrion",       stats: ["ConditionDamage", "Power", "Vitality"] },
  { label: "Trailblazer's", stats: ["Toughness", "ConditionDamage", "Vitality", "Expertise"] },
  { label: "Knight's",      stats: ["Toughness", "Power", "Precision"] },
  { label: "Soldier's",     stats: ["Power", "Toughness", "Vitality"] },
  { label: "Cleric's",      stats: ["HealingPower", "Toughness", "Power"] },
  { label: "Minstrel's",    stats: ["Toughness", "HealingPower", "Vitality", "Concentration"] },
  { label: "Harrier's",     stats: ["Power", "HealingPower", "Concentration"] },
  { label: "Ritualist's",   stats: ["Vitality", "ConditionDamage", "Expertise", "Concentration"] },
  { label: "Seraph",        stats: ["Precision", "ConditionDamage", "HealingPower", "Concentration"] },
  { label: "Zealot's",      stats: ["Power", "Precision", "HealingPower"] },
  { label: "Celestial",     stats: ["Power", "Precision", "Toughness", "Vitality", "ConditionDamage", "Ferocity", "HealingPower", "Expertise", "Concentration"] },
];

const SLOT_WEIGHTS = {
  head:       { p: 60,  s: 43 },
  shoulders:  { p: 45,  s: 32 },
  chest:      { p: 134, s: 96 },
  hands:      { p: 45,  s: 32 },
  legs:       { p: 90,  s: 64 },
  feet:       { p: 45,  s: 32 },
  mainhand1:  { p: 120, s: 85 },
  offhand1:   { p: 90,  s: 64 },
  mainhand2:  { p: 120, s: 85 },
  offhand2:   { p: 90,  s: 64 },
  back:       { p: 63,  s: 40 },
  amulet:     { p: 157, s: 108 },
  ring1:      { p: 126, s: 85 },
  ring2:      { p: 126, s: 85 },
  accessory1: { p: 110, s: 74 },
  accessory2: { p: 110, s: 74 },
  breather:   { p: 60,  s: 43  },
  aquatic1:   { p: 215, s: 154 },
  aquatic2:   { p: 215, s: 154 },
};

const EQUIP_ARMOR_SLOTS = [
  { key: "head",      label: "Head",      icon: "Head_slot.png" },
  { key: "shoulders", label: "Shoulders", icon: "Shoulder_slot.png" },
  { key: "chest",     label: "Chest",     icon: "Chest_slot.png" },
  { key: "hands",     label: "Hands",     icon: "Hand_slot.png" },
  { key: "legs",      label: "Legs",      icon: "Leg_slot.png" },
  { key: "feet",      label: "Feet",      icon: "Feet_slot.png" },
];

const EQUIP_WEAPON_SETS = [
  [{ key: "mainhand1", label: "Main Hand", hand: "main" }, { key: "offhand1", label: "Off Hand", hand: "off" }],
  [{ key: "mainhand2", label: "Main Hand", hand: "main" }, { key: "offhand2", label: "Off Hand", hand: "off" }],
];

const _RW = "https://render.guildwars2.com/file";
const _WK = "https://wiki.guildwars2.com/images";
const GW2_WEAPONS = [
  { id: "axe",        label: "Axe",        hand: "main",    icon: `${_WK}/b/b5/Bandit_Cleaver.png` },
  { id: "dagger",     label: "Dagger",      hand: "either",  icon: `${_WK}/a/ac/Bandit_Shiv.png` },
  { id: "mace",       label: "Mace",        hand: "either",  icon: `${_WK}/b/b3/Bandit_Mallet.png` },
  { id: "pistol",     label: "Pistol",      hand: "either",  icon: `${_WK}/f/f3/Bandit_Revolver.png` },
  { id: "sword",      label: "Sword",       hand: "main",    icon: `${_WK}/e/e1/Bandit_Slicer.png` },
  { id: "scepter",    label: "Scepter",     hand: "main",    icon: `${_WK}/9/95/Bandit_Baton.png` },
  { id: "focus",      label: "Focus",       hand: "off",     icon: `${_WK}/d/da/Bandit_Focus.png` },
  { id: "shield",     label: "Shield",      hand: "off",     icon: `${_WK}/7/7c/Bandit_Ward.png` },
  { id: "torch",      label: "Torch",       hand: "off",     icon: `${_WK}/7/7e/Bandit_Torch.png` },
  { id: "warhorn",    label: "Warhorn",     hand: "off",     icon: `${_WK}/3/31/Bandit_Bugle.png` },
  { id: "greatsword", label: "Greatsword",  hand: "two",     icon: `${_WK}/0/0b/Bandit_Sunderer.png` },
  { id: "hammer",     label: "Hammer",      hand: "two",     icon: `${_WK}/f/fb/Bandit_Demolisher.png` },
  { id: "longbow",    label: "Longbow",     hand: "two",     icon: `${_WK}/2/2d/Bandit_Longbow.png` },
  { id: "rifle",      label: "Rifle",       hand: "two",     icon: `${_WK}/3/37/Bandit_Musket.png` },
  { id: "shortbow",   label: "Short Bow",   hand: "two",     icon: `${_WK}/2/2f/Bandit_Short_Bow.png` },
  { id: "staff",      label: "Staff",       hand: "two",     icon: `${_WK}/9/98/Bandit_Spire.png` },
  { id: "harpoon",    label: "Harpoon Gun", hand: "aquatic", icon: `${_WK}/2/20/Bandit_Harpoon_Gun.png` },
  { id: "spear",      label: "Spear",       hand: "two",     icon: `${_WK}/c/c9/Bandit_Spear.png` },
  { id: "trident",    label: "Trident",     hand: "aquatic", icon: `${_WK}/6/66/Bandit_Trident.png` },
];

// Exotic level 80 weapon strength midpoints (avg of min/max per wiki.guildwars2.com/wiki/Weapon_strength).
const WEAPON_STRENGTH_MIDPOINT = {
  axe: 952.5, dagger: 952.5, mace: 952.5, pistol: 952.5, sword: 952.5, scepter: 952.5,
  focus: 857.5, shield: 857.5, torch: 857.5, warhorn: 857,
  greatsword: 1047.5, hammer: 1048, longbow: 1000, rifle: 1095.5, shortbow: 952.5, staff: 1048,
  spear: 952.5, trident: 952.5, harpoon: 952.5,
};

const EQUIP_TRINKET_SLOTS = [
  { key: "back",       label: "Back",        icon: "Back_slot.png" },
  { key: "amulet",     label: "Amulet",      icon: "Amulet_slot.png" },
  { key: "ring1",      label: "Ring 1",      icon: "Trinket_slot.png" },
  { key: "ring2",      label: "Ring 2",      icon: "Trinket_slot.png" },
  { key: "accessory1", label: "Accessory 1", icon: "Trinket_slot.png" },
  { key: "accessory2", label: "Accessory 2", icon: "Trinket_slot.png" },
];

const EQUIP_UNDERWATER_SLOTS = [
  { key: "breather", label: "Breather",  icon: "Head_slot.png" },
  { key: "aquatic1", label: "Weapon 1",  hand: "aquatic" },
  { key: "aquatic2", label: "Weapon 2",  hand: "aquatic" },
];

const PROFESSION_WEIGHT = {
  Elementalist: "light", Mesmer: "light", Necromancer: "light",
  Engineer: "medium", Ranger: "medium", Thief: "medium",
  Guardian: "heavy", Warrior: "heavy", Revenant: "heavy",
};

const R = "https://render.guildwars2.com/file";
const LEGENDARY_ARMOR_ICONS = {
  light: {
    head:      `${R}/06146C9BD029041178F50B5D9ACD0A76E7051408/1634576.png`,
    shoulders: `${R}/A77403E5F0EB03E46E686B12297A04707AF50278/1634579.png`,
    chest:     `${R}/C8FB494379CC98171EFB0F13923CACFD047743B3/1634574.png`,
    hands:     `${R}/9703DBC0926F6BB4072032E6B55BE593F6B750CD/1634575.png`,
    legs:      `${R}/65A4D3A41592D10EEABD0BC0D611F13A383B0261/1634577.png`,
    feet:      `${R}/FD60D4E3986FA46F4FEBB8131B65159195260B19/1634578.png`,
  },
  medium: {
    head:      `${R}/49092A1358E528DEC67EFA1C090546ED034642E2/1634588.png`,
    shoulders: `${R}/CF7609512FC6527D805F2B74F26AF4549FF4E808/1634591.png`,
    chest:     `${R}/57360F35D1210D12010F6AE772382450A07D08F6/1634586.png`,
    hands:     `${R}/C57E5E5FA69261A2503CBB50080A6C023A155C49/1634587.png`,
    legs:      `${R}/EBD907C061747927AE062D1B41BC13D0EAF14AD5/1634589.png`,
    feet:      `${R}/BF4C6A48BA02BD6D6AC32F1E9C3F32A50399E336/1634590.png`,
  },
  heavy: {
    head:      `${R}/2695A8E44B7F07EF15A20857790EFCA91513F5F0/1634565.png`,
    shoulders: `${R}/0F0F4BE73C9316BAA4956A3AA622CB0AE84D9CEA/1634567.png`,
    chest:     `${R}/DACF9B1ACBE8687B6B31ABC0CF295301120D7A67/1634563.png`,
    hands:     `${R}/A5DD0D661970F02CC26D04B510C7C94259B99520/1634564.png`,
    legs:      `${R}/EA9294557C175A43567906721E43962EC4B12D34/1634566.png`,
    feet:      `${R}/E895D40AE0D1A500FFFDB955C27A98FF687AA4C1/1634562.png`,
  },
};

const GW2_RELICS = [
  { label: "Relic of Akeem",               icon: "https://render.guildwars2.com/file/594C437E9606A167F4F372BCEB0C2B7C7828037B/3122330.png" },
  { label: "Relic of Antitoxin",           icon: "https://render.guildwars2.com/file/61C74AAFED48CF9AD4BBCAD89F902654EA02B2AE/3122331.png" },
  { label: "Relic of Cerus",               icon: "https://render.guildwars2.com/file/656FCA9408A0FFDB35A3CE20311E0F66423F026B/3122337.png" },
  { label: "Relic of Dagda",               icon: "https://render.guildwars2.com/file/CA28F7BFEA1B695DD19204E455BA270D334EE307/3122340.png" },
  { label: "Relic of Durability",          icon: "https://render.guildwars2.com/file/A8F61493030863CAB537780398D64D80554D959D/3122345.png" },
  { label: "Relic of Dwayna",              icon: "https://render.guildwars2.com/file/CBBD4FAFCC3568ACA04F9901162FE7C0747C1E9B/3122346.png" },
  { label: "Relic of Evasion",             icon: "https://render.guildwars2.com/file/19296379D120EF9FF10EE0B0CDD7711DA5E7A9AF/3122347.png" },
  { label: "Relic of Febe",                icon: "https://render.guildwars2.com/file/3B063D0B0BA20A0530086595F367F0149D9679F2/3187628.png" },
  { label: "Relic of Fireworks",           icon: "https://render.guildwars2.com/file/2999CCF7C94267B2EE3DDA7459050864622927C9/3122349.png" },
  { label: "Relic of Isgarren",            icon: "https://render.guildwars2.com/file/5FB808F04E427650A84031E46B632DC292A3583F/3122354.png" },
  { label: "Relic of Karakosa",            icon: "https://render.guildwars2.com/file/DD034A0B53355503350F07CCFFE5CC06A90F41D9/3187629.png" },
  { label: "Relic of Leadership",          icon: "https://render.guildwars2.com/file/077C30D957D30B0D282BB21199A193A2D74971DF/3122356.png" },
  { label: "Relic of Lyhr",               icon: "https://render.guildwars2.com/file/FE580A90C9E4513D062A148045F933C7F3C557E3/3122357.png" },
  { label: "Relic of Mabon",              icon: "https://render.guildwars2.com/file/49481C31650D384B68A1BFB53DC1A39F2AE4AD56/3122358.png" },
  { label: "Relic of Mercy",              icon: "https://render.guildwars2.com/file/1AA33B5654D3E7F91B9065BA6D0F1EB6AA755AFF/3122359.png" },
  { label: "Relic of Nayos",              icon: "https://render.guildwars2.com/file/EA382BAFD541080F71D5530893CC7E069165EA0C/3187631.png" },
  { label: "Relic of Nourys",             icon: "https://render.guildwars2.com/file/9B47CEBB551B7C5E7A961AB45361E292074E0823/3187632.png" },
  { label: "Relic of Peitha",             icon: "https://render.guildwars2.com/file/949A6A4179F514FCDEF3AC3D9C292B38D5E0047D/3122365.png" },
  { label: "Relic of Resistance",         icon: "https://render.guildwars2.com/file/C3A39C916063067E190EE5D42D6CAC2018385F44/3122367.png" },
  { label: "Relic of Speed",              icon: "https://render.guildwars2.com/file/15B07C1813B63DFD27A6A8A5E36CF1BC50DB0562/3122369.png" },
  { label: "Relic of Surging",            icon: "https://render.guildwars2.com/file/755D9F3BA1C2C42CDAEBF59BBF4564B77ADC105D/3592840.png" },
  { label: "Relic of Vampirism",          icon: "https://render.guildwars2.com/file/349D3B9098A1EB445E00C45E70B892E8CFE3762C/3592842.png" },
  { label: "Relic of Vass",               icon: "https://render.guildwars2.com/file/21D7FDF1DD4EAD33DBC01F11D80E48AD3370FDE6/3122374.png" },
  { label: "Relic of the Adventurer",     icon: "https://render.guildwars2.com/file/9A76D8C27FCAB8F66D0DC531906808B134D80EAD/3122328.png" },
  { label: "Relic of the Afflicted",      icon: "https://render.guildwars2.com/file/3B1DA625E3DF0591087E62F12E5301C1D8D6EDC0/3122329.png" },
  { label: "Relic of the Aristocracy",    icon: "https://render.guildwars2.com/file/BCC01F0B6616FE26ED4BE159532A6A6FBD0EA2D8/3122332.png" },
  { label: "Relic of the Astral Ward",    icon: "https://render.guildwars2.com/file/57A961A8ADFE279BC4F124A40CC4B5646BC8035F/3161446.png" },
  { label: "Relic of the Brawler",        icon: "https://render.guildwars2.com/file/2B5297A932F55DA3BDDD0A39C9CB0D9CF70244A1/3122334.png" },
  { label: "Relic of the Cavalier",       icon: "https://render.guildwars2.com/file/C3AFC50F654E2749ADD9033CE007033F6F9B0D7A/3122335.png" },
  { label: "Relic of the Centaur",        icon: "https://render.guildwars2.com/file/59551CFA6F4AB3D678370651ABF20D5F69B949D5/3122336.png" },
  { label: "Relic of the Chronomancer",   icon: "https://render.guildwars2.com/file/C209ABF01D7429EC09354E2E0BBF9DB14EBDD613/3122338.png" },
  { label: "Relic of the Citadel",        icon: "https://render.guildwars2.com/file/B21C5A6DFCDB0A729358A22CA76547150E7C541E/3122339.png" },
  { label: "Relic of the Daredevil",      icon: "https://render.guildwars2.com/file/29FE690460A037C7FAC3C71903BA1EBECB204012/3122341.png" },
  { label: "Relic of the Deadeye",        icon: "https://render.guildwars2.com/file/060151B961CE56CB9546E7B6AF33B0A318426372/3122342.png" },
  { label: "Relic of the Defender",       icon: "https://render.guildwars2.com/file/E854AFDE03F40ED335C0A30DE90BD9973612BD75/3122343.png" },
  { label: "Relic of the Demon Queen",    icon: "https://render.guildwars2.com/file/D0C6F322473F2A0F6C65FBD3B21733777BB14015/3187627.png" },
  { label: "Relic of the Dragonhunter",   icon: "https://render.guildwars2.com/file/F61EEC535059F1FA027049AB4DEFCD5465405DB7/3122344.png" },
  { label: "Relic of the Earth",          icon: "https://render.guildwars2.com/file/EBB3060FF2E9A10CECC3F1B2CAC0213AE9D93337/3592833.png" },
  { label: "Relic of the Firebrand",      icon: "https://render.guildwars2.com/file/4E4F4AA81DB63D9D9BB4BF3757D0750E935701F7/3122348.png" },
  { label: "Relic of the Flock",          icon: "https://render.guildwars2.com/file/2F7AE267BA29B35DEC7F2C0FCE5C30D806E31E0D/3122350.png" },
  { label: "Relic of the Fractal",        icon: "https://render.guildwars2.com/file/B2D409644147BF18935A95A52505ABCB9EECE142/3122351.png" },
  { label: "Relic of the Golemancer",     icon: "https://render.guildwars2.com/file/13412697BB6AD89F2E6ED97A750873C0BB35AA9A/3592835.png" },
  { label: "Relic of the Herald",         icon: "https://render.guildwars2.com/file/DE62250A48F802DD09A1FAFF0D2BA804EA29A3B9/3122352.png" },
  { label: "Relic of the Holosmith",      icon: "https://render.guildwars2.com/file/0976F60805023D2F14DA6CC72F55F3D64407C7AF/3592836.png" },
  { label: "Relic of the Ice",            icon: "https://render.guildwars2.com/file/5E0E012F921D3D5D364BFEFC04D7BEF1DC5B52F7/3122353.png" },
  { label: "Relic of the Krait",          icon: "https://render.guildwars2.com/file/645EFCBFFBB7B1C6630CBB7C0FB268CA27B703AC/3122355.png" },
  { label: "Relic of the Lich",           icon: "https://render.guildwars2.com/file/045D16259918EFA90A76B4D1B1400AA8D9CC0D4B/3592837.png" },
  { label: "Relic of the Midnight King",  icon: "https://render.guildwars2.com/file/C0602C3D27B10AC815D4B9F0DF0E4C3D23D12E9F/3187630.png" },
  { label: "Relic of the Mirage",         icon: "https://render.guildwars2.com/file/5FCA620E77D3D5022ADC70C1191F0B154AB13827/3122360.png" },
  { label: "Relic of the Monk",           icon: "https://render.guildwars2.com/file/6C340014C525FEF8089AC6DAD03662637A5B07CA/3122361.png" },
  { label: "Relic of the Necromancer",    icon: "https://render.guildwars2.com/file/B20C589B0915915F5AB55BDA6EC52670B29706F2/3122362.png" },
  { label: "Relic of the Nightmare",      icon: "https://render.guildwars2.com/file/74940C36779745CBA9DDD56CDF6CBAC1CEA8179F/3122363.png" },
  { label: "Relic of the Ogre",           icon: "https://render.guildwars2.com/file/633231B05DC3D1D44003DAA891400C4624180D17/3592838.png" },
  { label: "Relic of the Pack",           icon: "https://render.guildwars2.com/file/26503D1FF7BA354058789E371992A7500B3AA89B/3122364.png" },
  { label: "Relic of the Privateer",      icon: "https://render.guildwars2.com/file/9CE01CF33B943BCC3FABD8491073DE0AD63F340C/3592839.png" },
  { label: "Relic of the Reaper",         icon: "https://render.guildwars2.com/file/AFDAA23D3C61F202225DDFA7C17F420C5368BBB8/3122366.png" },
  { label: "Relic of the Scourge",        icon: "https://render.guildwars2.com/file/0802B36898A6EB0C77D20FD4F3DFD0A2270A3ECD/3122368.png" },
  { label: "Relic of the Sunless",        icon: "https://render.guildwars2.com/file/CEF1E6DA2DBF143661DF26E668034A621812B61A/3122370.png" },
  { label: "Relic of the Thief",          icon: "https://render.guildwars2.com/file/3523AC08EB04347CF371E9A91F4B985D12FB4ED3/3122371.png" },
  { label: "Relic of the Trooper",        icon: "https://render.guildwars2.com/file/500CB9B12FED6948EB74FAF299726007002BDFBA/3122372.png" },
  { label: "Relic of the Unseen Invasion",icon: "https://render.guildwars2.com/file/0CAF5ACE9D4ABEFF3EF2DE0DB47D57A8AB3CABB3/3122373.png" },
  { label: "Relic of the Warrior",        icon: "https://render.guildwars2.com/file/1D3CF82C05450A605921F6EB9D0AC23421C9CFA5/3122375.png" },
  { label: "Relic of the Water",          icon: "https://render.guildwars2.com/file/A202CF0CF4314C049B16A89A595CCC9534B0A90E/3122376.png" },
  { label: "Relic of the Weaver",         icon: "https://render.guildwars2.com/file/12997110B0509463DD9F1364A92493B2C4309BE1/3122377.png" },
  { label: "Relic of the Wizard's Tower", icon: "https://render.guildwars2.com/file/0C0EE407B9DAA44438ED6C2DCDA4EEB30953DF1B/3122378.png" },
  { label: "Relic of the Zephyrite",      icon: "https://render.guildwars2.com/file/070E32046C250E32DA76F2CBDFC504D6C0AB0344/3122379.png" },
];

const GW2_FOOD = [
  { id: 91734, label: "Peppercorn-Crusted Sous-Vide Steak",            icon: `${_RW}/EBFB0A55087C48E905D4ED9E6BE549DA6D9560F4/2191071.png`, buff: "-10% Incoming Damage | +100 Power | +70 Ferocity" },
  { id: 91805, label: "Cilantro Lime Sous-Vide Steak",                 icon: `${_RW}/D2C00407A3FFE06251BDE9DC13525FE167ABA3E6/2191069.png`, buff: "66% Chance to Life Steal on Crit | +100 Power | +70 Precision" },
  { id: 41569, label: "Bowl of Sweet and Spicy Butternut Squash Soup", icon: `${_RW}/FD0A2497B8C711A73AE9A6020118A895091E68E5/561719.png`,   buff: "+100 Power | +70 Ferocity" },
  { id: 12469, label: "Plate of Truffle Steak Dinner",                 icon: `${_RW}/67CFD9FD4B17A44CC4EC99C2DF276CF0A46C7B0D/433658.png`,   buff: "+200 Power for 30s on Kill | +70 Ferocity" },
  { id: 12485, label: "Bowl of Fancy Potato and Leek Soup",            icon: `${_RW}/AD7A1D7FAEE6E6F3AA9061CFDC90A418633DDD5C/433672.png`,   buff: "+100 Precision | +70 Condition Damage" },
  { id: 86997, label: "Plate of Beef Rendang",                         icon: `${_RW}/ED54F2CA2B6AEAE258C90A20BB213E60956CDD13/1947191.png`,  buff: "+100 Condition Damage | +70 Expertise" },
  { id: 96578, label: "Plate of Kimchi Pancakes",                      icon: `${_RW}/D64959DDB9D89E6A4FE321EC2965B6C72B557575/2594835.png`,  buff: "+15% Increased Bleeding Duration | +70 Condition Damage" },
  { id: 91703, label: "Mint-Pear Cured Meat Flatbread",                icon: `${_RW}/F56EAF0DD0CFF41CE402282E37F20F4D22501358/2191048.png`,  buff: "+10% Outgoing Healing | +100 Condition Damage | +70 Expertise" },
  { id: 91784, label: "Clove-Spiced Pear and Cured Meat Flatbread",    icon: `${_RW}/CE437DB26797C84F9127C9D190720311EB614512/2191047.png`,  buff: "-20% Incoming Condition Duration | +100 Condition Damage | +70 Expertise" },
  { id: 91727, label: "Mint and Veggie Flatbread",                     icon: `${_RW}/FCB44856734BE45744C8B10509CF710BBBE13C7B/2191027.png`,  buff: "+10% Outgoing Healing | +100 Expertise | +70 Condition Damage" },
  { id: 68634, label: "Delicious Rice Ball",                           icon: `${_RW}/3FF95B9A7DA10501B9BA5AB7FEB24BFF65357B24/1341426.png`,  buff: "+100 Healing Power | +10% Outgoing Healing" },
  { id: 91758, label: "Eggs Benedict with Mint-Parsley Sauce",         icon: `${_RW}/247DFE7FA45A2DF9B24E5515C3BDB96D28ED213B/2191053.png`,  buff: "+10% Outgoing Healing | +100 Concentration | +70 Expertise" },
  { id: 91690, label: "Bowl of Fruit Salad with Mint Garnish",         icon: `${_RW}/1D44545301F3BB1C046898EA08D5906EB369DD0A/2191059.png`,  buff: "+10% Outgoing Healing | +100 Healing Power | +70 Concentration" },
  { id: 12471, label: "Bowl of Seaweed Salad",                         icon: `${_RW}/0D442C30D4E29832725800E22990BA111D05E0BE/219455.png`,    buff: "60% to Gain Swiftness on Kill | +5% Damage While Moving" },
];

const GW2_UTILITY = [
  { id: 78305, label: "Superior Sharpening Stone",  icon: `${_RW}/91AC9F70D30C5E3E22635DF4F30CAFA1F6F803A0/219361.png`, buff: "Gain Power Equal to 3% of Your Precision | Gain Power Equal to 6% of Your Ferocity" },
  { id: 67530, label: "Furious Sharpening Stone",   icon: `${_RW}/91AC9F70D30C5E3E22635DF4F30CAFA1F6F803A0/219361.png`, buff: "Gain Power Equal to 3% of Your Precision | Gain Ferocity Equal to 3% of Your Precision" },
  { id: 67531, label: "Bountiful Sharpening Stone", icon: `${_RW}/91AC9F70D30C5E3E22635DF4F30CAFA1F6F803A0/219361.png`, buff: "Gain Power Equal to 6% of Your Healing Power | Gain Power Equal to 8% of Your Concentration" },
  { id: 67528, label: "Bountiful Maintenance Oil",  icon: `${_RW}/BA57FF7A052FFE37669F97A815BD28089FCFF0AD/219367.png`, buff: "Gain 0.6% Healing to Allies per 100 Healing Power | Gain 0.8% per 100 Concentration" },
  { id: 67529, label: "Furious Maintenance Oil",    icon: `${_RW}/BA57FF7A052FFE37669F97A815BD28089FCFF0AD/219367.png`, buff: "Gain Concentration Equal to 3% of Your Precision | Gain Healing Power Equal to 3% of Your Precision" },
];

const PROFESSION_CONCEPT_ART = {
  Elementalist: `${_WK}/5/5e/Elementalist_04_concept_art.png`,
  Mesmer:       `${_WK}/4/4a/Mesmer_04_concept_art.png`,
  Necromancer:  `${_WK}/4/43/Necromancer_04_concept_art.png`,
  Guardian:     `${_WK}/8/88/Guardian_04_concept_art.png`,
  Warrior:      `${_WK}/5/56/Warrior_04_concept_art.png`,
  Ranger:       `${_WK}/f/f5/Ranger_04_concept_art.png`,
  Thief:        `${_WK}/3/35/Thief_04_concept_art.png`,
  Engineer:     `${_WK}/e/e5/Engineer_04_concept_art.png`,
  Revenant:     `${_WK}/1/18/Revenant_02_concept_art.jpg`,
};

function computeSlotStats(comboLabel, slotKey) {
  const combo = STAT_COMBOS.find((c) => c.label === comboLabel);
  const w = SLOT_WEIGHTS[slotKey];
  if (!combo || !w) return [];
  const n = combo.stats.length;
  const result = [];
  if (n <= 3) {
    result.push({ stat: combo.stats[0], value: w.p });
    for (let i = 1; i < n; i++) result.push({ stat: combo.stats[i], value: w.s });
  } else if (n === 4) {
    result.push({ stat: combo.stats[0], value: Math.round(w.p * 0.895) });
    result.push({ stat: combo.stats[1], value: Math.round(w.s * 0.889) });
    result.push({ stat: combo.stats[2], value: Math.round(w.s * 0.889) });
    result.push({ stat: combo.stats[3], value: Math.round(w.p * 0.452) });
  } else {
    const each = Math.round((w.p + 2 * w.s) / n);
    for (const stat of combo.stats) result.push({ stat, value: each });
  }
  return result;
}

function computeEquipmentStats() {
  const slots = state.editor.equipment?.slots || {};
  const totals = {
    Power: 1000, Precision: 1000, Toughness: 1000, Vitality: 1000,
    Ferocity: 0, ConditionDamage: 0, Expertise: 0, Concentration: 0, HealingPower: 0,
  };
  for (const [slotKey, comboLabel] of Object.entries(slots)) {
    if (!comboLabel) continue;
    const combo = STAT_COMBOS.find((c) => c.label === comboLabel);
    const w = SLOT_WEIGHTS[slotKey];
    if (!combo || !w) continue;
    const n = combo.stats.length;
    if (n <= 3) {
      totals[combo.stats[0]] = (totals[combo.stats[0]] || 0) + w.p;
      for (let i = 1; i < combo.stats.length; i++) {
        totals[combo.stats[i]] = (totals[combo.stats[i]] || 0) + w.s;
      }
    } else if (n === 4) {
      totals[combo.stats[0]] = (totals[combo.stats[0]] || 0) + Math.round(w.p * 0.895);
      totals[combo.stats[1]] = (totals[combo.stats[1]] || 0) + Math.round(w.s * 0.889);
      totals[combo.stats[2]] = (totals[combo.stats[2]] || 0) + Math.round(w.s * 0.889);
      totals[combo.stats[3]] = (totals[combo.stats[3]] || 0) + Math.round(w.p * 0.452);
    } else {
      const each = Math.round((w.p + 2 * w.s) / n);
      for (const stat of combo.stats) {
        totals[stat] = (totals[stat] || 0) + each;
      }
    }
  }

  // Food flat stat contributions (+N StatName patterns)
  const foodLabel = state.editor.equipment?.food;
  if (foodLabel) {
    const foodDef = GW2_FOOD.find((f) => f.label === foodLabel);
    if (foodDef) {
      const foodStatMap = {
        "Condition Damage": "ConditionDamage", "Healing Power": "HealingPower",
        "Power": "Power", "Precision": "Precision", "Toughness": "Toughness",
        "Vitality": "Vitality", "Ferocity": "Ferocity",
        "Concentration": "Concentration", "Expertise": "Expertise",
      };
      const re = /\+(\d+)\s+(Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise)/g;
      let m;
      while ((m = re.exec(foodDef.buff)) !== null) {
        const key = foodStatMap[m[2]];
        if (key) totals[key] = (totals[key] || 0) + Number(m[1]);
      }
    }
  }

  return totals;
}

let _slotPickerEl = null;
let _slotPickerCleanup = null;
let _connectorRafId = 0;

function closeSlotPicker() {
  if (_slotPickerEl) { _slotPickerEl.remove(); _slotPickerEl = null; }
  if (_slotPickerCleanup) { _slotPickerCleanup(); _slotPickerCleanup = null; }
}

function openSlotPicker(anchorEl, currentValue, onSelect, { items = null, searchPlaceholder = "Search stats…", className = "" } = {}) {
  closeSlotPicker();

  const picker = document.createElement("div");
  picker.className = "slot-picker" + (className ? ` ${className}` : "");

  const search = document.createElement("input");
  search.type = "search";
  search.className = "slot-picker__search";
  search.placeholder = searchPlaceholder;
  search.autocomplete = "off";

  const list = document.createElement("div");
  list.className = "slot-picker__list";

  const allOptions = items ?? [
    { value: "", label: "— Empty —", subtitle: "" },
    ...STAT_COMBOS.map((c) => ({ value: c.label, label: c.label, subtitle: c.stats.join(" · ") })),
  ];

  function renderPickerList(query) {
    list.innerHTML = "";
    const q = query.trim().toLowerCase();
    const filtered = allOptions.filter((o) => !q || o.label.toLowerCase().includes(q) || (o.subtitle || "").toLowerCase().includes(q));
    for (const opt of filtered) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot-picker__option" + (opt.value === currentValue ? " slot-picker__option--selected" : "");
      if (opt.icon) {
        const img = document.createElement("img");
        img.className = "slot-picker__icon";
        img.src = opt.icon;
        img.alt = "";
        img.draggable = false;
        img.addEventListener("error", () => img.remove());
        btn.append(img);
      }
      const text = document.createElement("span");
      text.className = "slot-picker__text";
      if (opt.subtitle) {
        text.innerHTML = `<span class="slot-picker__name">${escapeHtml(opt.label)}</span><span class="slot-picker__stats">${escapeHtml(opt.subtitle)}</span>`;
      } else {
        text.innerHTML = `<span class="slot-picker__name">${escapeHtml(opt.label)}</span>`;
      }
      btn.append(text);
      btn.addEventListener("click", () => { onSelect(opt.value); closeSlotPicker(); });
      list.append(btn);
    }
  }

  renderPickerList("");
  search.addEventListener("input", () => renderPickerList(search.value));
  picker.append(search, list);
  document.body.append(picker);
  _slotPickerEl = picker;

  const rect = anchorEl.getBoundingClientRect();
  const pickerW = Math.max(rect.width, 250);
  const spaceBelow = window.innerHeight - rect.bottom;
  picker.style.position = "fixed";
  picker.style.left = `${Math.min(rect.left, window.innerWidth - pickerW - 8)}px`;
  picker.style.width = `${pickerW}px`;
  if (spaceBelow >= 260 || spaceBelow >= rect.top) {
    picker.style.top = `${rect.bottom + 4}px`;
    picker.style.maxHeight = `${Math.min(300, spaceBelow - 8)}px`;
  } else {
    picker.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    picker.style.maxHeight = `${Math.min(300, rect.top - 8)}px`;
  }

  requestAnimationFrame(() => search.focus());

  const onOutside = (e) => { if (!picker.contains(e.target) && !anchorEl.contains(e.target)) closeSlotPicker(); };
  const onEsc = (e) => { if (e.key === "Escape") closeSlotPicker(); };
  // Prevent the page from scrolling when the wheel is used over the picker.
  // If the event is over the scrollable list, only block when the list is already at its scroll limit.
  picker.addEventListener("wheel", (e) => {
    const inList = list.contains(e.target);
    if (inList) {
      const atTop = list.scrollTop === 0 && e.deltaY < 0;
      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1 && e.deltaY > 0;
      if (!atTop && !atBottom) return;
    }
    e.preventDefault();
  }, { passive: false });
  const onOutsideWheel = (e) => { if (!picker.contains(e.target)) closeSlotPicker(); };
  setTimeout(() => {
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onEsc);
    document.addEventListener("wheel", onOutsideWheel, { capture: true, passive: true });
  }, 0);
  _slotPickerCleanup = () => {
    document.removeEventListener("pointerdown", onOutside);
    document.removeEventListener("keydown", onEsc);
    document.removeEventListener("wheel", onOutsideWheel, { capture: true });
  };
}

function updateHealthOrb() {
  const orbHp = document.querySelector(".health-orb__hp");
  if (!orbHp) return;
  const profession = state.editor.profession || "";
  const baseHp = PROFESSION_BASE_HP[profession] ?? 0;
  const computed = computeEquipmentStats();
  const totalHp = baseHp > 0 ? baseHp + (computed.Vitality || 0) * 10 : 0;
  orbHp.textContent = totalHp > 0 ? totalHp.toLocaleString() : "—";
}

function renderEquipmentPanel() {
  const panel = el.equipmentPanel;
  if (!panel) return;
  closeSlotPicker();
  panel.innerHTML = "";

  const equip = state.editor.equipment;
  const slots = equip.slots || {};
  const weapons = equip.weapons || {};

  function makeSlot(slotDef, { compact = false } = {}) {
    const currentCombo = slots[slotDef.key] || "";
    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot" + (compact ? " equip-slot--compact" : "");
    wrapper.setAttribute("role", "button");
    wrapper.tabIndex = 0;

    const icon = document.createElement("div");
    icon.className = "equip-slot__icon" + (currentCombo ? " equip-slot__icon--filled" : "");
    const legendaryUrl = (() => {
      if (!currentCombo) return null;
      const prof = state.editor.profession;
      const weight = PROFESSION_WEIGHT[prof];
      return weight ? (LEGENDARY_ARMOR_ICONS[weight]?.[slotDef.key] ?? null) : null;
    })();
    const imgSrc = legendaryUrl
      ? legendaryUrl
      : slotDef.icon
        ? (slotDef.icon.startsWith("https://") ? slotDef.icon : `https://wiki.guildwars2.com/wiki/Special:FilePath/${slotDef.icon}`)
        : null;
    if (imgSrc) {
      const img = document.createElement("img");
      img.src = imgSrc;
      img.alt = slotDef.label;
      img.draggable = false;
      img.addEventListener("error", () => { img.remove(); });
      icon.append(img);
    }

    const info = document.createElement("div");
    info.className = "equip-slot__info";

    const labelEl = document.createElement("div");
    labelEl.className = "equip-slot__label";
    labelEl.textContent = slotDef.label;

    const valueEl = document.createElement("div");
    valueEl.className = "equip-slot__value" + (currentCombo ? "" : " equip-slot__value--empty");
    if (currentCombo) {
      const combo = STAT_COMBOS.find((c) => c.label === currentCombo);
      valueEl.innerHTML = `<span class="equip-slot__combo-name">${escapeHtml(currentCombo)}</span>${combo ? `<span class="equip-slot__combo-stats">${combo.stats.join(" · ")}</span>` : ""}`;
    } else {
      valueEl.textContent = "Select stats…";
    }

    info.append(labelEl, valueEl);
    wrapper.append(icon, info);

    const doOpen = () => openSlotPicker(wrapper, currentCombo, (newVal) => {
      state.editor.equipment.slots[slotDef.key] = newVal || "";
      markEditorChanged();
      renderEquipmentPanel();
    });
    wrapper.addEventListener("click", doOpen);
    wrapper.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doOpen(); } });

    bindHoverPreview(wrapper, "equip-stat", () => {
      if (!currentCombo) return null;
      const combo = STAT_COMBOS.find((c) => c.label === currentCombo);
      if (!combo) return null;
      const facts = computeSlotStats(currentCombo, slotDef.key)
        .map(({ stat, value }) => ({ text: stat, value: `+${value}` }));
      return { name: combo.label, icon: imgSrc, description: "", facts, slot: slotDef.label };
    });

    return wrapper;
  }

  function makeWeaponSlot(slotDef) {
    const isOffhand = slotDef.hand === "off";
    const mainhandKey = slotDef.key.replace("offhand", "mainhand");
    const mainhandWeaponId = weapons[mainhandKey] || "";
    const mainhandProfFlags = (state.activeCatalog?.professionWeapons?.[mainhandWeaponId]?.flags) || [];
    const lockedByTwoHanded = isOffhand && (
      mainhandProfFlags.includes("TwoHand") ||
      GW2_WEAPONS.find((w) => w.id === mainhandWeaponId)?.hand === "two"
    );

    const currentWeapon = weapons[slotDef.key] || "";
    const currentCombo = slots[slotDef.key] || "";
    const weaponDef = GW2_WEAPONS.find((w) => w.id === currentWeapon);

    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--weapon" + (lockedByTwoHanded ? " equip-slot--disabled" : "");

    // Weapon type button (left side: icon + name)
    const weaponBtn = document.createElement("button");
    weaponBtn.type = "button";
    weaponBtn.className = "equip-weapon-type-btn";
    weaponBtn.disabled = lockedByTwoHanded;

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--weapon" + (currentWeapon ? " equip-slot__icon--filled" : "");
    const img = document.createElement("img");
    img.src = weaponDef ? weaponDef.icon : "https://wiki.guildwars2.com/images/d/de/Sword_slot.png";
    img.alt = weaponDef ? weaponDef.label : slotDef.label;
    img.draggable = false;
    img.addEventListener("error", () => img.remove());
    iconDiv.append(img);
    const weaponNameSpan = document.createElement("span");
    weaponNameSpan.className = "equip-weapon-name" + (currentWeapon ? "" : " equip-weapon-name--empty");
    weaponNameSpan.textContent = lockedByTwoHanded
      ? "— Two-Handed —"
      : (weaponDef?.label || slotDef.label);

    weaponBtn.append(iconDiv, weaponNameSpan);

    // Stat button (right side)
    const statBtn = document.createElement("button");
    statBtn.type = "button";
    statBtn.className = "equip-stat-pick-btn" + (currentCombo ? "" : " equip-stat-pick-btn--empty");
    statBtn.disabled = lockedByTwoHanded;
    if (currentCombo) {
      const combo = STAT_COMBOS.find((c) => c.label === currentCombo);
      statBtn.innerHTML = `<span class="equip-slot__combo-name">${escapeHtml(currentCombo)}</span>${combo ? `<span class="equip-slot__combo-stats">${combo.stats.join(" · ")}</span>` : ""}`;
    } else {
      statBtn.textContent = "Select stats…";
    }

    wrapper.append(weaponBtn, statBtn);

    bindHoverPreview(weaponBtn, "equip-weapon", () => {
      const wDef = GW2_WEAPONS.find((w) => w.id === (equip.weapons?.[slotDef.key] || ""));
      if (!wDef) return null;
      return { name: wDef.label, icon: wDef.icon, description: "", hand: wDef.hand };
    });

    bindHoverPreview(statBtn, "equip-stat", () => {
      const curCombo = equip.slots?.[slotDef.key] || "";
      const combo = curCombo ? STAT_COMBOS.find((c) => c.label === curCombo) : null;
      if (!combo) return null;
      const facts = computeSlotStats(curCombo, slotDef.key).map(({ stat, value }) => ({ text: stat, value: `+${value}` }));
      return { name: combo.label, icon: "", description: "", facts, slot: slotDef.label };
    });

    if (!lockedByTwoHanded) {
      // Filter weapons for this slot type, restricted to what this profession can equip
      const profWeapons = state.activeCatalog?.professionWeapons || {};
      const weaponItems = [
        { value: "", label: "— Empty —", subtitle: "" },
        ...GW2_WEAPONS.filter((w) => {
          if (w.hand === "aquatic") return false; // aquatic weapons belong in the underwater section
          const wData = profWeapons[w.id];
          if (!wData) return false;
          // Elite spec weapons are now usable by all specs (GW2 balance change)
          if (isOffhand) return wData.flags.includes("Offhand");
          return wData.flags.includes("Mainhand") || wData.flags.includes("TwoHand");
        }).map((w) => {
          const flags = profWeapons[w.id]?.flags || [];
          const subtitle = flags.includes("TwoHand") ? "Two-handed"
            : flags.includes("Mainhand") && flags.includes("Offhand") ? "Main / Off Hand"
            : "";
          return { value: w.id, label: w.label, subtitle, icon: w.icon };
        }),
      ];
      weaponBtn.addEventListener("click", () => {
        openSlotPicker(weaponBtn, currentWeapon, (newVal) => {
          if (!equip.weapons) equip.weapons = {};
          equip.weapons[slotDef.key] = newVal || "";
          // If two-handed selected for mainhand, clear the offhand weapon
          const newFlags = profWeapons[newVal]?.flags || [];
          if (newFlags.includes("TwoHand")) {
            const ofKey = slotDef.key.replace("mainhand", "offhand");
            equip.weapons[ofKey] = "";
            equip.slots[ofKey] = "";
          }
          markEditorChanged();
          renderEquipmentPanel();
          renderSkills();
        }, { items: weaponItems, searchPlaceholder: "Search weapons…" });
      });

      statBtn.addEventListener("click", () => {
        openSlotPicker(statBtn, currentCombo, (newVal) => {
          equip.slots[slotDef.key] = newVal || "";
          markEditorChanged();
          renderEquipmentPanel();
        });
      });
    }

    return wrapper;
  }

  function makeAquaticWeaponSlot(slotDef) {
    const currentWeapon = weapons[slotDef.key] || "";
    const currentCombo = slots[slotDef.key] || "";
    const weaponDef = GW2_WEAPONS.find((w) => w.id === currentWeapon);

    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--weapon";

    const weaponBtn = document.createElement("button");
    weaponBtn.type = "button";
    weaponBtn.className = "equip-weapon-type-btn";

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--weapon" + (currentWeapon ? " equip-slot__icon--filled" : "");
    {
      const img = document.createElement("img");
      img.src = weaponDef ? weaponDef.icon : `${_WK}/3/3f/Aquatic_weapon_slot.png`;
      img.alt = weaponDef ? weaponDef.label : slotDef.label;
      img.draggable = false;
      img.addEventListener("error", () => img.remove());
      iconDiv.append(img);
    }
    const weaponNameSpan = document.createElement("span");
    weaponNameSpan.className = "equip-weapon-name" + (currentWeapon ? "" : " equip-weapon-name--empty");
    weaponNameSpan.textContent = weaponDef?.label || slotDef.label;
    weaponBtn.append(iconDiv, weaponNameSpan);

    const statBtn = document.createElement("button");
    statBtn.type = "button";
    statBtn.className = "equip-stat-pick-btn" + (currentCombo ? "" : " equip-stat-pick-btn--empty");
    if (currentCombo) {
      const combo = STAT_COMBOS.find((c) => c.label === currentCombo);
      statBtn.innerHTML = `<span class="equip-slot__combo-name">${escapeHtml(currentCombo)}</span>${combo ? `<span class="equip-slot__combo-stats">${combo.stats.join(" · ")}</span>` : ""}`;
    } else {
      statBtn.textContent = "Select stats…";
    }

    wrapper.append(weaponBtn, statBtn);

    const aquaticItems = [
      { value: "", label: "— Empty —" },
      ...GW2_WEAPONS.filter((w) => w.hand === "aquatic").map((w) => ({
        value: w.id, label: w.label, icon: w.icon,
      })),
    ];
    weaponBtn.addEventListener("click", () => {
      openSlotPicker(weaponBtn, currentWeapon, (newVal) => {
        if (!equip.weapons) equip.weapons = {};
        equip.weapons[slotDef.key] = newVal || "";
        markEditorChanged();
        renderEquipmentPanel();
      }, { items: aquaticItems, searchPlaceholder: "Search aquatic weapons…" });
    });
    statBtn.addEventListener("click", () => {
      openSlotPicker(statBtn, currentCombo, (newVal) => {
        equip.slots[slotDef.key] = newVal || "";
        markEditorChanged();
        renderEquipmentPanel();
      });
    });

    return wrapper;
  }

  function makeSection(title, fillSlotKeys) {
    const section = document.createElement("div");
    section.className = "equip-section panel";
    const head = document.createElement("div");
    head.className = "equip-section__head";
    const titleEl = document.createElement("span");
    titleEl.textContent = title;
    head.append(titleEl);
    if (fillSlotKeys && fillSlotKeys.length) {
      const fillBtn = document.createElement("button");
      fillBtn.type = "button";
      fillBtn.className = "equip-fill-btn";
      fillBtn.textContent = "Fill All";
      fillBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openSlotPicker(fillBtn, "", (newVal) => {
          if (newVal === "") return;
          for (const key of fillSlotKeys) state.editor.equipment.slots[key] = newVal;
          markEditorChanged();
          renderEquipmentPanel();
        });
      });
      head.append(fillBtn);
    }
    section.append(head);
    return section;
  }

  function makeTextInput(labelText, value, placeholder, onChange) {
    const label = document.createElement("label");
    label.className = "equip-text-label";
    const span = document.createElement("span");
    span.textContent = labelText;
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.placeholder = placeholder;
    input.addEventListener("input", () => onChange(input.value));
    label.append(span, input);
    return label;
  }

  // === LEFT COLUMN ===
  const leftCol = document.createElement("div");
  leftCol.className = "equip-col equip-col--left";

  // Armor
  const armorSection = makeSection("Armor", EQUIP_ARMOR_SLOTS.map((s) => s.key));
  for (const slotDef of EQUIP_ARMOR_SLOTS) armorSection.append(makeSlot(slotDef));
  leftCol.append(armorSection);

  // Weapons
  const weaponSection = makeSection("Weapons");
  EQUIP_WEAPON_SETS.forEach((setSlots, i) => {
    const setLabel = document.createElement("div");
    setLabel.className = "equip-set-label";
    setLabel.textContent = `Set ${i + 1}`;
    weaponSection.append(setLabel);
    for (const slotDef of setSlots) weaponSection.append(makeWeaponSlot(slotDef));
  });
  leftCol.append(weaponSection);

  // Consumables
  const consumeSection = makeSection("Consumables");

  const foodItems = [
    { value: "", label: "— None —" },
    ...GW2_FOOD.map((f) => ({ value: f.label, label: f.label, icon: f.icon, subtitle: f.buff.replace(/\|/g, "·") })),
  ];

  function makeFoodSlot() {
    const currentFood = equip.food || "";
    const foodDef = GW2_FOOD.find((f) => f.label === currentFood);
    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--compact";
    wrapper.setAttribute("role", "button");
    wrapper.tabIndex = 0;

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--weapon" + (currentFood ? " equip-slot__icon--filled" : "");
    const img = document.createElement("img");
    img.src = foodDef ? foodDef.icon : `${_WK}/6/6b/Nourishment.png`;
    img.alt = foodDef ? foodDef.label : "Food";
    img.draggable = false;
    img.addEventListener("error", () => img.remove());
    iconDiv.append(img);

    const info = document.createElement("div");
    info.className = "equip-slot__info";
    const labelEl = document.createElement("div");
    labelEl.className = "equip-slot__label";
    labelEl.textContent = "Food";
    const valueEl = document.createElement("div");
    valueEl.className = "equip-slot__combo-name" + (currentFood ? "" : " equip-slot__value--empty");
    valueEl.style.fontSize = "10px";
    valueEl.textContent = currentFood || "Select…";
    info.append(labelEl, valueEl);
    wrapper.append(iconDiv, info);

    const doOpen = () => openSlotPicker(wrapper, currentFood, (newVal) => {
      equip.food = newVal || "";
      markEditorChanged();
      renderEquipmentPanel();
    }, { items: foodItems, searchPlaceholder: "Search food…" });
    wrapper.addEventListener("click", doOpen);
    wrapper.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doOpen(); } });

    bindHoverPreview(wrapper, "equip-food", () => {
      const fDef = GW2_FOOD.find((f) => f.label === (equip.food || ""));
      if (!fDef) return null;
      return { name: fDef.label, icon: fDef.icon, description: fDef.buff.split(" | ").join("\n") };
    });

    return wrapper;
  }

  const utilityItems = [
    { value: "", label: "— None —" },
    ...GW2_UTILITY.map((u) => ({ value: u.label, label: u.label, icon: u.icon, subtitle: u.buff.replace(/\|/g, "·") })),
  ];

  function makeUtilitySlot() {
    const currentUtility = equip.utility || "";
    const utilityDef = GW2_UTILITY.find((u) => u.label === currentUtility);
    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--compact";
    wrapper.setAttribute("role", "button");
    wrapper.tabIndex = 0;

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--weapon" + (currentUtility ? " equip-slot__icon--filled" : "");
    const img = document.createElement("img");
    img.src = utilityDef ? utilityDef.icon : `${_WK}/d/d6/Enhancement.png`;
    img.alt = utilityDef ? utilityDef.label : "Utility";
    img.draggable = false;
    img.addEventListener("error", () => img.remove());
    iconDiv.append(img);

    const info = document.createElement("div");
    info.className = "equip-slot__info";
    const labelEl = document.createElement("div");
    labelEl.className = "equip-slot__label";
    labelEl.textContent = "Utility";
    const valueEl = document.createElement("div");
    valueEl.className = "equip-slot__combo-name" + (currentUtility ? "" : " equip-slot__value--empty");
    valueEl.style.fontSize = "10px";
    valueEl.textContent = currentUtility || "Select…";
    info.append(labelEl, valueEl);
    wrapper.append(iconDiv, info);

    const doOpen = () => openSlotPicker(wrapper, currentUtility, (newVal) => {
      equip.utility = newVal || "";
      markEditorChanged();
      renderEquipmentPanel();
    }, { items: utilityItems, searchPlaceholder: "Search utility…" });
    wrapper.addEventListener("click", doOpen);
    wrapper.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doOpen(); } });

    bindHoverPreview(wrapper, "equip-utility", () => {
      const uDef = GW2_UTILITY.find((u) => u.label === (equip.utility || ""));
      if (!uDef) return null;
      return { name: uDef.label, icon: uDef.icon, description: uDef.buff.split(" | ").join("\n") };
    });

    return wrapper;
  }

  consumeSection.append(makeFoodSlot(), makeUtilitySlot());
  leftCol.append(consumeSection);

  // Notes
  const notesSection = makeSection("Notes");
  const notesTA = document.createElement("textarea");
  notesTA.id = "notesInput";
  notesTA.className = "equip-notes";
  notesTA.rows = 4;
  notesTA.value = state.editor.notes || "";
  notesTA.placeholder = "Combo priorities, matchup notes, rotation...";
  notesTA.addEventListener("input", () => {
    state.editor.notes = notesTA.value;
    markEditorChanged({ updateBuildList: true });
  });
  notesSection.append(notesTA);
  leftCol.append(notesSection);

  // === RIGHT COLUMN ===
  const rightCol = document.createElement("div");
  rightCol.className = "equip-col equip-col--right";

  // Attributes
  const statsSection = makeSection("Attributes");
  const computed = computeEquipmentStats();
  const professionName = state.editor.profession;
  const baseHP = PROFESSION_BASE_HP[professionName] || 9212;
  const health = baseHP + (computed.Vitality || 0) * 10;
  const critChance = Math.min(100, 5 + ((computed.Precision || 1000) - 895) / 21.0);
  const critDamage = 150 + (computed.Ferocity || 0) / 15.0;
  const condDuration = (computed.Expertise || 0) / 15.0;
  const boonDuration = (computed.Concentration || 0) / 15.0;

  const statRows = [
    { stat: "Power",           value: computed.Power },
    { stat: "Precision",       value: computed.Precision,       derived: "Crit Chance",      derivedVal: `${critChance.toFixed(1)}%` },
    { stat: "Toughness",       value: computed.Toughness },
    { stat: "Vitality",        value: computed.Vitality,        derived: "Health",            derivedVal: health.toLocaleString() },
    { stat: "Ferocity",        value: computed.Ferocity,        derived: "Crit Damage",       derivedVal: `${critDamage.toFixed(0)}%` },
    { stat: "Condition Dmg",   value: computed.ConditionDamage },
    { stat: "Expertise",       value: computed.Expertise,       derived: "Cond. Duration",    derivedVal: `${condDuration.toFixed(1)}%` },
    { stat: "Concentration",   value: computed.Concentration,   derived: "Boon Duration",     derivedVal: `${boonDuration.toFixed(1)}%` },
    { stat: "Healing Power",   value: computed.HealingPower },
  ];

  const statsGrid = document.createElement("div");
  statsGrid.className = "equip-stats";
  for (const row of statRows) {
    const rowEl = document.createElement("div");
    rowEl.className = "equip-stat-row";

    const leftEl = document.createElement("div");
    leftEl.className = "equip-stat-cell";
    leftEl.innerHTML = `<span class="equip-stat-label">${row.stat}</span><span class="equip-stat-value">${(row.value || 0).toLocaleString()}</span>`;

    rowEl.append(leftEl);

    if (row.derived) {
      const rightEl = document.createElement("div");
      rightEl.className = "equip-stat-cell equip-stat-cell--derived";
      rightEl.innerHTML = `<span class="equip-stat-label">${row.derived}</span><span class="equip-stat-value equip-stat-value--derived">${row.derivedVal}</span>`;
      rowEl.append(rightEl);
    }

    statsGrid.append(rowEl);
  }
  statsSection.append(statsGrid);
  rightCol.append(statsSection);

  // Upgrades (rune only now — relic moved to trinkets row)
  const upgradesSection = makeSection("Upgrades");
  upgradesSection.append(
    makeTextInput("Rune", equip.runeSet, "Rune of the Scholar", (v) => { equip.runeSet = v; markEditorChanged(); }),
  );
  rightCol.append(upgradesSection);

  // Trinkets — row1 (4 cols): Back, Accessory 1, Accessory 2, Relic
  //            row2 (3 cols): Amulet, Ring 1, Ring 2
  const relicItems = [
    { value: "", label: "— None —" },
    ...GW2_RELICS.map((r) => ({ value: r.label, label: r.label, icon: r.icon })),
  ];

  function makeRelicSlot() {
    const currentRelic = equip.relic || "";
    const relicDef = GW2_RELICS.find((r) => r.label === currentRelic);
    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--compact";
    wrapper.setAttribute("role", "button");
    wrapper.tabIndex = 0;

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--weapon" + (currentRelic ? " equip-slot__icon--filled" : "");
    const img = document.createElement("img");
    img.src = relicDef
      ? relicDef.icon
      : "https://wiki.guildwars2.com/wiki/Special:FilePath/Relic_slot.png";
    img.alt = relicDef ? relicDef.label : "Relic";
    img.draggable = false;
    img.addEventListener("error", () => img.remove());
    iconDiv.append(img);

    const info = document.createElement("div");
    info.className = "equip-slot__info";
    const labelEl = document.createElement("div");
    labelEl.className = "equip-slot__label";
    labelEl.textContent = "Relic";
    const valueEl = document.createElement("div");
    valueEl.className = "equip-slot__combo-name" + (currentRelic ? "" : " equip-slot__value--empty");
    valueEl.style.fontSize = "10px";
    valueEl.textContent = currentRelic
      ? currentRelic.replace("Relic of ", "").replace("Relic of the ", "the ")
      : "Select…";
    info.append(labelEl, valueEl);
    wrapper.append(iconDiv, info);

    const doOpen = () => openSlotPicker(wrapper, currentRelic, (newVal) => {
      equip.relic = newVal || "";
      markEditorChanged();
      renderEquipmentPanel();
    }, { items: relicItems, searchPlaceholder: "Search relics…" });
    wrapper.addEventListener("click", doOpen);
    wrapper.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doOpen(); } });

    bindHoverPreview(wrapper, "equip-relic", () => {
      const rDef = GW2_RELICS.find((r) => r.label === (equip.relic || ""));
      if (!rDef) return null;
      return { name: rDef.label, icon: rDef.icon, description: "" };
    });

    return wrapper;
  }

  const allTrinketKeys = ["back", "accessory1", "accessory2", "amulet", "ring1", "ring2"];
  const trinketSection = makeSection("Trinkets", allTrinketKeys);

  const trinketRow1 = document.createElement("div");
  trinketRow1.className = "equip-trinket-grid equip-trinket-grid--4";
  for (const key of ["back", "accessory1", "accessory2"]) {
    const slotDef = EQUIP_TRINKET_SLOTS.find((s) => s.key === key);
    if (slotDef) trinketRow1.append(makeSlot(slotDef, { compact: true }));
  }
  trinketRow1.append(makeRelicSlot());

  const trinketRow2 = document.createElement("div");
  trinketRow2.className = "equip-trinket-grid";
  for (const key of ["amulet", "ring1", "ring2"]) {
    const slotDef = EQUIP_TRINKET_SLOTS.find((s) => s.key === key);
    if (slotDef) trinketRow2.append(makeSlot(slotDef, { compact: true }));
  }

  trinketSection.append(trinketRow1, trinketRow2);
  rightCol.append(trinketSection);

  // Underwater
  const underwaterSection = makeSection("Underwater");
  for (const slotDef of EQUIP_UNDERWATER_SLOTS) {
    underwaterSection.append(slotDef.hand === "aquatic" ? makeAquaticWeaponSlot(slotDef) : makeSlot(slotDef));
  }
  rightCol.append(underwaterSection);

  // Center: profession concept art
  const artCol = document.createElement("div");
  artCol.className = "equip-col equip-col--art";
  const artUrl = PROFESSION_CONCEPT_ART[state.editor.profession];
  if (artUrl) {
    const artImg = document.createElement("img");
    artImg.className = "equip-concept-art";
    artImg.src = artUrl;
    artImg.alt = state.editor.profession || "";
    artImg.draggable = false;
    artCol.append(artImg);
  }

  // Layout
  const layout = document.createElement("div");
  layout.className = "equip-layout";
  layout.append(leftCol, artCol, rightCol);
  panel.append(layout);
  updateHealthOrb();
}

function renderEditor() {
  closeCustomSelect();
  hideHoverPreview();
  renderEditorForm();
  renderEditorMeta();
  renderSpecializations();
  renderSkills();
  renderEquipmentPanel();
  renderDetailPanel();
}

function renderEditorForm() {
  renderCustomSelect(el.professionSelect, {
    value: state.editor.profession,
    className: "cselect--toolbar",
    options: state.professions.map((profession) => ({
      value: profession.id,
      label: profession.name,
      icon: profession.icon || "",
    })),
    placeholder: "Select profession",
    onChange: async (nextProfession) => {
      const professionId = String(nextProfession || "");
      if (!professionId || professionId === state.editor.profession) return;
      state.editor.profession = professionId;
      await setProfession(professionId, { preserveSelections: false });
      state.detail = null;
      markEditorChanged({ updateBuildList: true });
      renderEditor();
    },
  });

  el.editorTitle.value = state.editor.title || "";
  el.tagsInput.value = state.editor.tagsText || "";

  const status = state.onboarding;
  const canPublish = Boolean(status?.isAuthenticated && status?.repoReady);
  el.publishSiteBtn.disabled = !canPublish;
  el.copyBuildBtn.disabled = !state.editor.profession;
  el.duplicateBuildBtn.disabled = !state.editor.profession;
}

function renderEditorMeta() {
  el.saveBuildBtn.textContent = state.editorDirty ? "Save Build*" : "Save Build";
  if (state.editorDirty) {
    el.editorDirtyBadge.classList.remove("hidden");
  } else {
    el.editorDirtyBadge.classList.add("hidden");
  }

  const catalog = state.activeCatalog;
  const professionName =
    state.professions.find((entry) => entry.id === state.editor.profession)?.name ||
    state.editor.profession ||
    "Not selected";
  const specNames = (state.editor.specializations || [])
    .map((entry) => catalog?.specializationById.get(Number(entry.specializationId))?.name || "")
    .filter(Boolean);
  const eliteSpec = (state.editor.specializations || [])
    .map((entry) => catalog?.specializationById.get(Number(entry.specializationId)))
    .find((entry) => entry?.elite);
  const skillById = catalog?.skillById || new Map();
  const utilityNames = (state.editor.skills?.utilityIds || [])
    .map((id) => skillById.get(Number(id))?.name || "")
    .filter(Boolean);
  const skills = [
    skillById.get(Number(state.editor.skills?.healId))?.name || "",
    ...utilityNames,
    skillById.get(Number(state.editor.skills?.eliteId))?.name || "",
  ].filter(Boolean);
  const summaryRows = [
    { label: "Status", value: state.editorDirty ? "Unsaved draft" : "Saved" },
    { label: "Profession", value: professionName },
    { label: "Specializations", value: specNames.join(" | ") || "None selected" },
    { label: "Skills", value: skills.join(" | ") || "None selected" },
  ];
  if (eliteSpec) {
    summaryRows.push({ label: "Elite Line", value: eliteSpec.name });
  }
  el.buildSummary.innerHTML = summaryRows
    .map(
      (row) =>
        `<div class="build-summary__row"><span class="build-summary__label">${escapeHtml(row.label)}</span><span class="build-summary__value">${escapeHtml(row.value)}</span></div>`
    )
    .join("");
}

function renderSpecializations() {
  const catalog = state.activeCatalog;
  el.specializationsHost.innerHTML = "";
  if (!catalog) {
    el.specializationsHost.innerHTML = `<p class="empty-line">Choose a profession to load specialization data.</p>`;
    return;
  }

  const allSpecs = Array.isArray(catalog.specializations) ? catalog.specializations : [];
  const lastSlotSpec = catalog.specializationById.get(
    Number(state.editor.specializations[2]?.specializationId) || 0
  );
  const selectedEliteCount = (state.editor.specializations || []).reduce((count, entry) => {
    const spec = catalog.specializationById.get(Number(entry?.specializationId) || 0);
    return spec?.elite ? count + 1 : count;
  }, 0);
  const ruleHint = document.createElement("p");
  ruleHint.className = "empty-line";
  ruleHint.textContent =
    selectedEliteCount > 0
      ? "One elite specialization is active. Picking another elite line will swap the previous elite line to a core line."
      : "You can use up to one elite specialization.";
  el.specializationsHost.append(ruleHint);

  for (let slotIndex = 0; slotIndex < 3; slotIndex += 1) {
    const selection = state.editor.specializations[slotIndex];
    const currentId = Number(selection?.specializationId) || 0;
    const spec = catalog.specializationById.get(currentId) || null;
    if (!spec) continue;

    const card = document.createElement("article");
    card.className = "spec-card";
    const panel = document.createElement("div");
    panel.className = spec.elite ? "spec-card__panel spec-card__panel--elite" : "spec-card__panel";
    const wikiBackground = `https://wiki.guildwars2.com/wiki/Special:FilePath/${encodeURIComponent(`${spec.name || ""} specialization.png`)}`;
    panel.style.backgroundImage = `linear-gradient(0deg, rgba(7, 14, 27, 0.1), rgba(7, 14, 27, 0.1)), url("${wikiBackground.replaceAll('"', '\\"')}")`;
    panel.style.backgroundPosition = "center, center";
    panel.style.backgroundSize = "100% 100%, cover";
    panel.style.backgroundRepeat = "no-repeat, no-repeat";

    const selectHost = document.createElement("div");
    renderCustomSelect(selectHost, {
      value: String(spec.id),
      className: "cselect--spec",
      options: (() => {
        // Slot 2 with elite: disable specs already used in slots 0/1 (no swap allowed).
        // Slots 0/1: never disable anything — always freely swappable.
        const slot2IsElite = slotIndex === 2 && !!lastSlotSpec?.elite;
        const usedInOtherSlots = slot2IsElite
          ? new Set(state.editor.specializations
              .filter((_, i) => i !== slotIndex)
              .map(e => Number(e?.specializationId) || 0)
              .filter(Boolean))
          : new Set();
        return allSpecs
          .filter((optionSpec) => slotIndex === 2 || !optionSpec.elite)
          .map((optionSpec) => ({
            value: String(optionSpec.id),
            label: optionSpec.name,
            icon: optionSpec.icon || "",
            disabled: usedInOtherSlots.has(optionSpec.id),
          }));
      })(),
      placeholder: "Select specialization",
      onChange: (nextValue) => {
        const nextId = Number(nextValue) || 0;
        const currentSpec = catalog.specializationById.get(Number(spec.id) || 0);
        const otherIdx = state.editor.specializations.findIndex(
          (entry, i) => i !== slotIndex && (Number(entry?.specializationId) || 0) === nextId
        );
        // Slots 0/1 always swap freely. Slot 2 swaps only if its current spec is not elite.
        const canSwap = otherIdx !== -1 && (slotIndex !== 2 || !currentSpec?.elite);

        let swapRects = null;
        if (canSwap) {
          // Capture card positions BEFORE re-render for FLIP animation.
          const cards = el.specializationsHost?.querySelectorAll('.spec-card');
          const fromCard = cards?.[slotIndex];
          const toCard = cards?.[otherIdx];
          if (fromCard && toCard) {
            swapRects = {
              fromIdx: slotIndex, toIdx: otherIdx,
              fromRect: fromCard.getBoundingClientRect(),
              toRect: toCard.getBoundingClientRect(),
            };
          }
          // Swap: preserve each slot's majorChoices.
          const tmp = state.editor.specializations[slotIndex];
          state.editor.specializations[slotIndex] = state.editor.specializations[otherIdx];
          state.editor.specializations[otherIdx] = tmp;
        } else {
          state.editor.specializations[slotIndex] = {
            specializationId: nextId,
            majorChoices: { 1: 0, 2: 0, 3: 0 },
          };
        }

        enforceEditorConsistency({ preferredEliteSlot: slotIndex });
        markEditorChanged({ updateBuildList: true });
        renderEditor();

        if (swapRects) {
          const newCards = el.specializationsHost?.querySelectorAll('.spec-card');
          const newFromCard = newCards?.[swapRects.fromIdx];
          const newToCard = newCards?.[swapRects.toIdx];
          if (newFromCard && newToCard) {
            const dx1 = swapRects.toRect.left - swapRects.fromRect.left;
            const dy1 = swapRects.toRect.top  - swapRects.fromRect.top;
            const dx2 = swapRects.fromRect.left - swapRects.toRect.left;
            const dy2 = swapRects.fromRect.top  - swapRects.toRect.top;
            newFromCard.style.transition = 'none';
            newFromCard.style.transform = `translate(${dx1}px,${dy1}px)`;
            newToCard.style.transition = 'none';
            newToCard.style.transform = `translate(${dx2}px,${dy2}px)`;
            requestAnimationFrame(() => requestAnimationFrame(() => {
              const spring = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)';
              newFromCard.style.transition = spring;
              newFromCard.style.transform = '';
              newToCard.style.transition = spring;
              newToCard.style.transform = '';
              newFromCard.addEventListener('transitionend', () => { newFromCard.style.transition = ''; }, { once: true });
              newToCard.addEventListener('transitionend', () => { newToCard.style.transition = ''; }, { once: true });
            }));
          }
        }
      },
    });
    selectHost.classList.add("spec-select-overlay");

    const body = document.createElement("div");
    body.className = "spec-card__body";
    const emblem = document.createElement("button");
    emblem.type = "button";
    emblem.className = spec.elite ? "spec-emblem spec-emblem--elite" : "spec-emblem";
    emblem.title = spec.name || `Spec ${slotIndex + 1}`;
    if (spec.icon) {
      emblem.innerHTML = `<img src="${escapeHtml(spec.icon)}" alt="${escapeHtml(spec.name || "Specialization")}" />`;
    } else {
      emblem.textContent = "?";
    }
    emblem.addEventListener("click", () => {
      const trigger = selectHost.querySelector(".cselect__trigger");
      if (trigger instanceof HTMLElement) trigger.click();
    });
    if (spec.name) {
      bindHoverPreview(emblem, "spec", () => spec);
    }
    body.append(emblem);

    const majors = getMajorTraitsByTier(spec, catalog);
    const minorTraits = (spec.minorTraits || [])
      .slice(0, 3)
      .map((traitId) => catalog.traitById.get(Number(traitId)) || null);
    const lanes = [1, 2, 3];
    for (const tier of lanes) {
      const minorColumn = document.createElement("div");
      minorColumn.className = "trait-minor-anchor";
      const minorTrait = minorTraits[tier - 1];
      const minorButton = makeTraitButton(minorTrait, false, () => selectDetail("trait", minorTrait), {
        alwaysSelected: true,
      });
      minorButton.dataset.connectorRole = `minor-${tier}`;
      minorColumn.append(minorButton);
      body.append(minorColumn);

      const column = document.createElement("div");
      column.className = "trait-column trait-column--major";
      const selectedId = Number(selection?.majorChoices?.[tier]) || 0;
      for (const trait of majors[tier] || []) {
        const isSelected = Number(trait.id) === selectedId;
        const majorButton = makeTraitButton(trait, isSelected, () => {
          state.editor.specializations[slotIndex].majorChoices[tier] = Number(trait.id);
          markEditorChanged({ updateBuildList: true });
          // Surgical update: toggle active class and connector role without full re-render
          for (const sibling of column.querySelectorAll(".trait-btn")) {
            sibling.classList.remove("trait-btn--active");
            delete sibling.dataset.connectorRole;
          }
          majorButton.classList.add("trait-btn--active");
          majorButton.dataset.connectorRole = `major-${tier}`;
          cancelAnimationFrame(_connectorRafId);
          _connectorRafId = requestAnimationFrame(() => drawSpecConnector(body));
          renderSkills();
          selectDetail("trait", trait);
        });
        if (isSelected) {
          majorButton.dataset.connectorRole = `major-${tier}`;
        }
        column.append(majorButton);
      }
      body.append(column);
    }

    panel.append(body);
    card.append(panel, selectHost);
    el.specializationsHost.append(card);
  }

  cancelAnimationFrame(_connectorRafId);
  _connectorRafId = requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const body of el.specializationsHost.querySelectorAll(".spec-card__body")) {
      drawSpecConnector(body);
    }
  }));
}

function drawSpecConnector(body) {
  if (!body) return;
  body.querySelector(".spec-connector")?.remove();
  const roles = ["minor-1", "major-1", "minor-2", "major-2", "minor-3", "major-3"];
  const bodyRect = body.getBoundingClientRect();

  const points = [];
  for (const role of roles) {
    const node = body.querySelector(`[data-connector-role="${role}"]`);
    if (!(node instanceof HTMLElement)) continue;
    const r = node.getBoundingClientRect();
    points.push({ x: r.left + r.width / 2 - bodyRect.left, y: r.top + r.height / 2 - bodyRect.top });
  }
  if (points.length < 2) return;

  const pathData = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ");

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "spec-connector");
  svg.setAttribute("viewBox", `0 0 ${Math.max(1, bodyRect.width)} ${Math.max(1, bodyRect.height)}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("overflow", "hidden");

  const corePath = document.createElementNS(svgNS, "path");
  corePath.setAttribute("d", pathData);
  corePath.setAttribute("fill", "none");
  corePath.setAttribute("stroke", "rgba(180, 235, 255, 0.5)");
  corePath.setAttribute("stroke-width", "1.5");
  corePath.setAttribute("stroke-linecap", "round");
  svg.append(corePath);

  const flowPath = document.createElementNS(svgNS, "path");
  flowPath.setAttribute("class", "connector-flow");
  flowPath.setAttribute("d", pathData);
  flowPath.setAttribute("fill", "none");
  flowPath.setAttribute("stroke", "rgba(220, 250, 255, 1)");
  flowPath.setAttribute("stroke-width", "2.5");
  flowPath.setAttribute("stroke-linecap", "round");
  flowPath.setAttribute("stroke-dasharray", "10 22");
  svg.append(flowPath);

  const flowPath2 = document.createElementNS(svgNS, "path");
  flowPath2.setAttribute("class", "connector-flow2");
  flowPath2.setAttribute("d", pathData);
  flowPath2.setAttribute("fill", "none");
  flowPath2.setAttribute("stroke", "rgba(160, 230, 255, 0.7)");
  flowPath2.setAttribute("stroke-width", "2.5");
  flowPath2.setAttribute("stroke-linecap", "round");
  flowPath2.setAttribute("stroke-dasharray", "10 22");
  svg.append(flowPath2);

  body.prepend(svg);
}

const PROFESSION_BASE_HP = {
  Warrior: 20212, Berserker: 20212, Spellbreaker: 20212, Bladesworn: 20212,
  Revenant: 21894, Herald: 21894, Renegade: 21894, Vindicator: 21894,
  Necromancer: 17985, Reaper: 17985, Scourge: 17985, Harbinger: 17985,
  Ranger: 15922, Druid: 15922, Soulbeast: 15922, Untamed: 15922,
  Guardian: 14462, Dragonhunter: 14462, Firebrand: 14462, Willbender: 14462,
  Engineer: 14462, Scrapper: 14462, Holosmith: 14462, Mechanist: 14462,
  Elementalist: 11645, Tempest: 11645, Weaver: 11645, Catalyst: 11645,
  Mesmer: 11645, Chronomancer: 11645, Mirage: 11645, Virtuoso: 11645,
  Thief: 11645, Daredevil: 11645, Deadeye: 11645, Specter: 11645,
};

function makeSkillSlot(slot, catalog, options, utilitySelection, markSkillIconRendered = null) {
  const query = "";
  const selectedId =
    slot.index === undefined
      ? Number(state.editor.skills[slot.key]) || 0
      : Number(state.editor.skills[slot.key]?.[slot.index]) || 0;
  const selectedSkill = slot.list.find((skill) => Number(skill.id) === selectedId) || null;
  const filteredList = filterSkillList(slot.list, query, selectedId);

  const skillOptions = filteredList.map((skill) => ({
    value: String(skill.id),
    label: skill.name,
    icon: skill.icon || "",
    meta: skill.type ? String(skill.type).toUpperCase() : "",
    kind: "skill",
    entity: skill,
  }));

  const slotEl = document.createElement("div");
  slotEl.className = "skill-slot";

  const iconBtn = document.createElement("button");
  iconBtn.type = "button";
  iconBtn.className = "skill-icon-large";
  iconBtn.title = selectedSkill?.name || slot.label;
  if (selectedSkill?.icon) {
    iconBtn.innerHTML = `<img src="${escapeHtml(selectedSkill.icon)}" alt="${escapeHtml(selectedSkill.name || "")}" />`;
  }
  if (typeof markSkillIconRendered === "function") {
    markSkillIconRendered(
      iconBtn,
      slot.flipKey || slot.key,
      selectedSkill ? `${selectedSkill.id}:${selectedSkill.icon || ""}` : ""
    );
  }
  if (selectedSkill) {
    bindHoverPreview(iconBtn, "skill", () => selectedSkill);
  }
  if (slot.keybind) {
    const keyLabel = document.createElement("span");
    keyLabel.className = "skill-icon-large__keylabel";
    keyLabel.textContent = slot.keybind;
    iconBtn.append(keyLabel);
  }

  // Kit utilities (Flamethrower, Grenade Kit, etc.) get a toggle badge in the bottom-right
  // that shows/hides the kit's weapon skills in the weapon bar.
  const isKitSkill = (selectedSkill?.bundleSkills?.length ?? 0) > 0;
  if (isKitSkill) {
    const isKitActive = state.editor.activeKit === selectedId;
    const toggleBadge = document.createElement("span");
    toggleBadge.className = "kit-toggle-indicator" + (isKitActive ? " kit-toggle-indicator--active" : "");
    toggleBadge.textContent = isKitActive ? "✕" : "▸";
    toggleBadge.addEventListener("click", (e) => {
      e.stopPropagation();
      state.editor.activeKit = state.editor.activeKit === selectedId ? 0 : selectedId;
      renderSkills();
    });
    iconBtn.append(toggleBadge);
  }

  const selectHost = document.createElement("div");
  renderCustomSelect(selectHost, {
    value: String(selectedId || ""),
    className: "cselect--skill-slot",
    options: skillOptions,
    placeholder: filteredList.length ? "Select skill" : "No skills available",
    disabled: !filteredList.length,
    onChange: (nextValue) => {
      const nextId = Number(nextValue) || 0;
      if (!nextId) return;

      let swapRects = null;
      if (slot.index === undefined) {
        state.editor.skills[slot.key] = nextId;
      } else {
        // If the chosen skill is already in another utility slot, swap the two slots.
        const ids = state.editor.skills[slot.key];
        const otherIdx = ids.findIndex((id, i) => i !== slot.index && Number(id) === nextId);
        if (otherIdx !== -1) {
          // Capture icon positions BEFORE re-render for FLIP animation.
          // Utility slots are at DOM indices slot.index+1 and otherIdx+1 (heal is index 0).
          const utilSlots = el.skillsHost?.querySelectorAll('.skill-group--utilities .skill-slot');
          const fromBtn = utilSlots?.[slot.index + 1]?.querySelector('.skill-icon-large');
          const toBtn = utilSlots?.[otherIdx + 1]?.querySelector('.skill-icon-large');
          if (fromBtn && toBtn) {
            swapRects = {
              fromIdx: slot.index,
              toIdx: otherIdx,
              fromRect: fromBtn.getBoundingClientRect(),
              toRect: toBtn.getBoundingClientRect(),
            };
          }
          ids[otherIdx] = Number(ids[slot.index]) || 0;
        }
        ids[slot.index] = nextId;
      }
      enforceEditorConsistency();
      state.editor.activeKit = 0; // clear kit view when utility selection changes
      markEditorChanged({ updateBuildList: true });
      renderSkills();

      // FLIP animation: after re-render, briefly offset the new icons to their OLD positions
      // then transition them to their natural (0,0) resting place with a springy easing.
      if (swapRects) {
        const newSlots = el.skillsHost?.querySelectorAll('.skill-group--utilities .skill-slot');
        const newFromBtn = newSlots?.[swapRects.fromIdx + 1]?.querySelector('.skill-icon-large');
        const newToBtn = newSlots?.[swapRects.toIdx + 1]?.querySelector('.skill-icon-large');
        if (newFromBtn && newToBtn) {
          const dx1 = swapRects.toRect.left - swapRects.fromRect.left;
          const dy1 = swapRects.toRect.top  - swapRects.fromRect.top;
          const dx2 = swapRects.fromRect.left - swapRects.toRect.left;
          const dy2 = swapRects.fromRect.top  - swapRects.toRect.top;
          newFromBtn.style.transition = 'none';
          newFromBtn.style.transform = `translate(${dx1}px,${dy1}px)`;
          newToBtn.style.transition = 'none';
          newToBtn.style.transform = `translate(${dx2}px,${dy2}px)`;
          // Double rAF: first frame applies the offset, second starts the spring transition.
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const spring = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)';
            newFromBtn.style.transition = spring;
            newFromBtn.style.transform = '';
            newToBtn.style.transition = spring;
            newToBtn.style.transform = '';
            // Clean up inline styles once settled.
            newFromBtn.addEventListener('transitionend', () => {
              newFromBtn.style.transition = '';
            }, { once: true });
            newToBtn.addEventListener('transitionend', () => {
              newToBtn.style.transition = '';
            }, { once: true });
          }));
        }
      }

      const nextSkill = options[resolveSkillSlotType(slot)]?.find((skill) => Number(skill.id) === nextId) || null;
      if (nextSkill) selectDetail("skill", nextSkill);
    },
  });
  selectHost.classList.add("skill-select-overlay");

  iconBtn.addEventListener("click", () => {
    const trigger = selectHost.querySelector(".cselect__trigger");
    if (trigger instanceof HTMLElement) trigger.click();
  });

  if (selectedSkill?.specialization) {
    const lockSpec = catalog.specializationById.get(Number(selectedSkill.specialization));
    if (lockSpec?.name) {
      slotEl.classList.add("skill-slot--locked");
      iconBtn.title = `${selectedSkill.name} (Locked to ${lockSpec.name})`;
    }
  }

  slotEl.append(iconBtn, selectHost);
  return slotEl;
}

function parseWeaponSlotNum(slotStr) {
  const m = /Weapon_(\d)/.exec(slotStr || "");
  return m ? parseInt(m[1], 10) : 0;
}

function getEquippedWeaponSkills(catalog, weapons, activeAttunement = "", activeAttunement2 = "", isWeaver = false) {
  const profWeapons = catalog?.professionWeapons || {};
  const weaponSkillById = catalog?.weaponSkillById || new Map();
  const slots = [null, null, null, null, null];

  const mhId = (weapons.mainhand || "").toLowerCase();
  const ohId = (weapons.offhand || "").toLowerCase();
  const mhData = profWeapons[mhId];
  const isTwoHanded = mhData?.flags?.includes("TwoHand") ?? false;

  // Collect all refs to determine available attunements
  const allRefs = [
    ...(mhData?.skills || []),
    ...(!isTwoHanded && ohId ? (profWeapons[ohId]?.skills || []) : []),
  ];
  const availableAttunements = [...new Set(allRefs.map((r) => r.attunement).filter(Boolean))];
  // Pick the effective primary attunement: prefer the stored one, fall back to first available
  const effectiveAttunement = availableAttunements.includes(activeAttunement)
    ? activeAttunement
    : (availableAttunements[0] || "");

  // For Weaver: effective secondary attunement. May equal primary (single-attunement mode).
  const effectiveAttunement2 = isWeaver
    ? (availableAttunements.includes(activeAttunement2)
        ? activeAttunement2
        : effectiveAttunement)
    : "";

  const att1 = effectiveAttunement.toLowerCase();
  const att2 = effectiveAttunement2.toLowerCase();

  function matchesAttunement(ref, slotNum) {
    if (isWeaver) {
      const refAtt = (ref.attunement || "").toLowerCase();
      // Slots 1-2: mainhand attunement
      if (slotNum >= 1 && slotNum <= 2) return !refAtt || refAtt === att1;
      // Slots 4-5: offhand attunement
      if (slotNum >= 4 && slotNum <= 5) return !refAtt || refAtt === att2;
      // Slot 3: in single-attunement mode (att1 === att2) fall through to the normal weapon
      // slot-3 skill; in dual-attunement mode it is handled by the separate dual-attack loop.
      if (slotNum === 3) return att1 === att2 && (!refAtt || refAtt === att1);
      return false;
    }
    if (!ref.attunement) return true;
    return ref.attunement === effectiveAttunement;
  }

  if (mhData) {
    for (const ref of mhData.skills) {
      const n = parseWeaponSlotNum(ref.slot);
      if (!matchesAttunement(ref, n)) continue;
      if (n >= 1 && n <= 5) {
        const skill = weaponSkillById.get(ref.id);
        if (skill && !slots[n - 1]) {
          // Skip dual-attack skills (dualWield set) for non-Weaver builds, and also for
          // Weaver slot 3 in single-attunement mode (dual-attack has its own separate loop).
          if (skill.dualWield && (!isWeaver || n === 3)) continue;
          slots[n - 1] = skill;
        }
      }
    }
  }
  if (!isTwoHanded && ohId) {
    const ohData = profWeapons[ohId];
    if (ohData) {
      for (const ref of ohData.skills) {
        const n = parseWeaponSlotNum(ref.slot);
        if (!matchesAttunement(ref, n)) continue;
        if (n >= 4 && n <= 5) {
          const skill = weaponSkillById.get(ref.id);
          if (skill && !slots[n - 1]) slots[n - 1] = skill;
        }
      }
    }
  }

  // Weaver slot 3: Dual Attack — only when the two attunements differ. Skills live in
  // weaponSkillById (fetched via profession.weapons). Match by weaponType and the pair of
  // attunements (order-independent). Same-element mode is handled by matchesAttunement above.
  if (isWeaver && mhId && att1 && att2 && att1 !== att2) {
    for (const skill of weaponSkillById.values()) {
      if (!skill.dualWield) continue;
      if ((skill.slot || "") !== "Weapon_3") continue;
      if ((skill.weaponType || "").toLowerCase() !== mhId) continue;
      const sa = (skill.attunement || "").toLowerCase();
      const sd = skill.dualWield.toLowerCase();
      if ((sa === att1 && sd === att2) || (sa === att2 && sd === att1)) {
        slots[2] = skill;
        break;
      }
    }
  }

  return slots;
}

// Antiquary (Thief elite spec, spec 77): Skritt Swipe (F1) randomly draws one offensive artifact
// into F2 and one defensive artifact into F3. Each base pool has four choices.
// Zephyrite Sun Crystal canonical entry 76733 is the F2 API variant; when drawn into F3 (or F4)
// the renderer substitutes the dedicated F3-slot variant (78309) instead.
const ANTIQUARY_OFFENSIVE_ARTIFACTS = [
  76582,  // Metal Legion Guitar
  76550,  // Forged Surfer Dash
  77288,  // Mistburn Mortar
  77192,  // Summon Kryptis Turret
];
const ANTIQUARY_DEFENSIVE_ARTIFACTS = [
  76702,  // Exalted Hammer
  76816,  // Chak Shield
  76800,  // Holo-Dancer Decoy
  76733,  // Zephyrite Sun Crystal (non-F2 slots use variant 78309 instead)
];
// Prolific Plunderer (trait 2346, tier 1): grants an additional artifact slot (F4) on each draw.
const ANTIQUARY_PROLIFIC_PLUNDERER_TRAIT_ID = 2346;

// Returns the offensive and defensive artifact pools for Antiquary's Skritt Swipe.
// Currently the pools are fixed; hook is here for future trait-based modifications.
function getAntiquaryArtifactPools(_catalog, _editor) {
  return {
    offensivePool: [...ANTIQUARY_OFFENSIVE_ARTIFACTS],
    defensivePool: [...ANTIQUARY_DEFENSIVE_ARTIFACTS],
  };
}

// Returns true if Prolific Plunderer (trait 2346) is selected for the Antiquary specialization.
function isAntiquaryProlificPlundererActive(editor) {
  const antiquaryEntry = (editor.specializations || [])
    .find((s) => Number(s.specializationId) === 77);
  return Object.values(antiquaryEntry?.majorChoices || {})
    .some((id) => Number(id) === ANTIQUARY_PROLIFIC_PLUNDERER_TRAIT_ID);
}

// Randomly picks one offensive artifact for F2, one defensive for F3, and (when Prolific
// Plunderer is active) an additional artifact from the combined pool for F4.
// Stores the result in editor.antiquaryArtifacts. Call when the play badge is clicked.
function randomizeAntiquaryArtifacts(catalog, editor) {
  const { offensivePool, defensivePool } = getAntiquaryArtifactPools(catalog, editor);
  const f2Id = offensivePool[Math.floor(Math.random() * offensivePool.length)];
  let f3Id = defensivePool[Math.floor(Math.random() * defensivePool.length)];
  // Zephyrite Sun Crystal canonical ID 76733 is the F2 API variant;
  // when drawn into any non-F2 slot, substitute the F3-slot variant (78309).
  if (f3Id === 76733) f3Id = 78309;

  let f4Id = 0;
  if (isAntiquaryProlificPlundererActive(editor)) {
    // F4 draws from the combined pool, excluding the canonical IDs already in F2/F3.
    const f3Canonical = f3Id === 78309 ? 76733 : f3Id;
    const combined = [...ANTIQUARY_OFFENSIVE_ARTIFACTS, ...ANTIQUARY_DEFENSIVE_ARTIFACTS]
      .filter((id) => id !== f2Id && id !== f3Canonical);
    const pick = combined[Math.floor(Math.random() * combined.length)];
    f4Id = (pick === 76733) ? 78309 : pick;
  }

  editor.antiquaryArtifacts = { f2: f2Id, f3: f3Id, f4: f4Id };
}

// Ranger F1–F3 skills are pet-family-dependent. The GW2 API does not expose pet families,
// and all Ranger Profession_1–3 skills are tagged spec=55 in the API even though they apply
// to Core Ranger, Druid, and Untamed as well. This map provides the authoritative lookup.
// Keys are pet IDs; values are {p1, p2, p3} skill IDs for Profession_1/2/3 (F1/F2/F3).
// p3 is archetype-based (Ferocious/Stout/Deadly/Versatile/Supportive) — same within a family.
// p4 (Eternal Bond 59554) is Soulbeast-only and handled separately via eliteSpecId check.
// F3 (Beast skill) is determined by each pet's individual archetype, not family.
// Archetype → F3 skill: Stout=45797, Deadly=40588, Versatile=43375, Ferocious=40729, Supportive=44626
// F1/F2 are shared per family (from Ranger profession API), except newer pets with unique IDs.
const RANGER_PET_FAMILY_SKILLS = new Map([
  // === Avian (p1: Swoop 44991, p2: 42042) ===
  [44, { p1: 44991, p2: 42042, p3: 40588 }],  // Hawk — Deadly
  [10, { p1: 44991, p2: 42042, p3: 43375 }],  // Raven — Versatile
  [32, { p1: 44991, p2: 42042, p3: 43375 }],  // White Raven — Versatile
  [30, { p1: 44991, p2: 42042, p3: 44626 }],  // Owl — Supportive
  [31, { p1: 44991, p2: 42042, p3: 40729 }],  // Eagle — Ferocious
  [72, { p1: 79203, p2: 78091, p3: 43375 }],  // Raptor Swiftwing (newer) — Versatile
  // === Ursine/Bear (p1: Bite 43136, p2: 43060) ===
  [23, { p1: 43136, p2: 43060, p3: 45797 }],  // Black Bear — Stout
  [20, { p1: 43136, p2: 43060, p3: 40588 }],  // Murellow — Deadly
  [24, { p1: 43136, p2: 43060, p3: 43375 }],  // Polar Bear — Versatile
  [25, { p1: 43136, p2: 43060, p3: 40729 }],  // Arctodus — Ferocious
  [5,  { p1: 43136, p2: 43060, p3: 44626 }],  // Brown Bear — Supportive
  // === Canine (p1: Crippling Leap 43726, p2: 42894) ===
  [8,  { p1: 43726, p2: 42894, p3: 45797 }],  // Alpine Wolf — Stout
  [29, { p1: 43726, p2: 42894, p3: 40588 }],  // Wolf — Deadly
  [4,  { p1: 43726, p2: 42894, p3: 43375 }],  // Krytan Drakehound — Versatile
  [28, { p1: 43726, p2: 42894, p3: 40729 }],  // Hyena — Ferocious
  [22, { p1: 43726, p2: 42894, p3: 44626 }],  // Fern Hound — Supportive
  // === Devourer (p1: Tail Lash 43068, p2: 41461) ===
  [6,  { p1: 43068, p2: 41461, p3: 40588 }],  // Carrion Devourer — Deadly
  [26, { p1: 43068, p2: 41461, p3: 43375 }],  // Whiptail Devourer — Versatile
  [27, { p1: 43068, p2: 41461, p3: 40729 }],  // Lashtail Devourer — Ferocious
  // === Drake (p1: Chomp 41537, p2: 41575) ===
  [18, { p1: 41537, p2: 41575, p3: 45797 }],  // Ice Drake — Stout
  [7,  { p1: 41537, p2: 41575, p3: 40588 }],  // Salamander Drake — Deadly
  [45, { p1: 41537, p2: 41575, p3: 43375 }],  // Reef Drake — Versatile
  [19, { p1: 41537, p2: 41575, p3: 40729 }],  // River Drake — Ferocious
  [12, { p1: 41537, p2: 41575, p3: 44626 }],  // Marsh Drake — Supportive
  // === Feline (p1: Bite 40625, p2: 44514) ===
  [9,  { p1: 40625, p2: 44514, p3: 45797 }],  // Snow Leopard — Stout
  [3,  { p1: 40625, p2: 44514, p3: 40588 }],  // Lynx — Deadly
  [11, { p1: 40625, p2: 44514, p3: 43375 }],  // Jaguar — Versatile
  [54, { p1: 40625, p2: 44514, p3: 43375 }],  // Cheetah — Versatile
  [47, { p1: 40625, p2: 44514, p3: 40729 }],  // Tiger — Ferocious
  [55, { p1: 40625, p2: 44514, p3: 40729 }],  // Sand Lion — Ferocious
  [1,  { p1: 40625, p2: 44514, p3: 44626 }],  // Jungle Stalker — Supportive
  [63, { p1: 40625, p2: 67382, p3: 45797 }],  // White Tiger — Stout, unique F2: Phase Pounce
  [70, { p1: 73733, p2: 73938, p3: 40729 }],  // Warclaw (newer) — Ferocious, unique F1/F2
  // === Jellyfish/aquatic (p1: Healing Cloud 43186, p2: 41837) ===
  [41, { p1: 43186, p2: 41837, p3: 40588 }],  // Blue Jellyfish — Deadly
  [43, { p1: 43186, p2: 41837, p3: 40588 }],  // Rainbow Jellyfish — Deadly
  [42, { p1: 43186, p2: 41837, p3: 43375 }],  // Red Jellyfish — Versatile
  // === Moa (p1: Harmonic Cry 44617, p2: 43548) ===
  [13, { p1: 44617, p2: 43548, p3: 45797 }],  // Blue Moa — Stout
  [15, { p1: 44617, p2: 43548, p3: 43375 }],  // Pink Moa — Versatile
  [16, { p1: 44617, p2: 43548, p3: 43375 }],  // Black Moa — Versatile
  [17, { p1: 44617, p2: 43548, p3: 40729 }],  // Red Moa — Ferocious
  [14, { p1: 44617, p2: 43548, p3: 44626 }],  // White Moa — Supportive
  // === Porcine (p1: Maul 41406, p2: 46432) ===
  [38, { p1: 41406, p2: 46432, p3: 45797 }],  // Siamoth — Stout
  [37, { p1: 41406, p2: 46432, p3: 40588 }],  // Warthog — Deadly
  [2,  { p1: 41406, p2: 46432, p3: 43375 }],  // Boar — Versatile
  [39, { p1: 41406, p2: 46432, p3: 40729 }],  // Pig — Ferocious
  [64, { p1: 0,     p2: 64882, p3: 44626 }],  // Wallow (newer) — Supportive; F1 "Vampiric Bite" missing from API
  // === Spider (p1: Entangling Web 44097, p2: 43671) ===
  [33, { p1: 44097, p2: 43671, p3: 40588 }],  // Forest Spider — Deadly
  [34, { p1: 44097, p2: 43671, p3: 43375 }],  // Jungle Spider — Versatile
  [36, { p1: 44097, p2: 43671, p3: 43375 }],  // Black Widow Spider — Versatile
  [35, { p1: 44097, p2: 43671, p3: 40729 }],  // Cave Spider — Ferocious
  // === Wyvern (p1: Tail Lash 46386, p2: Wing Buffet 41908) ===
  [48, { p1: 46386, p2: 41908, p3: 43375 }],  // Electric Wyvern — Versatile
  [51, { p1: 46386, p2: 41908, p3: 40588 }],  // Fire Wyvern — Deadly
  // === Unique pets ===
  [40, { p1: 42717, p2: 44885, p3: 45797 }],  // Armor Fish — Stout
  [21, { p1: 42797, p2: 44360, p3: 40588 }],  // Shark — Deadly
  [52, { p1: 41206, p2: 45479, p3: 40588 }],  // Bristleback — Deadly
  [61, { p1: 44384, p2: 40111, p3: 40588 }],  // Fanged Iboga — Deadly
  [69, { p1: 72851, p2: 72636, p3: 40588 }],  // Spinegazer (newer) — Deadly
  [71, { p1: 75771, p2: 75814, p3: 40588 }],  // Janthiri Bee (newer) — Deadly
  [67, { p1: 71282, p2: 70889, p3: 43375 }],  // Aether Hunter (newer) — Versatile
  [46, { p1: 42907, p2: 40255, p3: 40729 }],  // Smokescale — Ferocious
  [59, { p1: 41524, p2: 45743, p3: 40729 }],  // Rock Gazelle — Ferocious
  [68, { p1: 71499, p2: 71546, p3: 40729 }],  // Sky-Chak Striker (newer) — Ferocious
  [65, { p1: 64038, p2: 41908, p3: 40729 }],  // Phoenix (newer) — Ferocious
  [57, { p1: 43788, p2: 43701, p3: 44626 }],  // Jacaranda — Supportive
  [66, { p1: 64699, p2: 66258, p3: 44626 }],  // Siege Turtle (newer) — Supportive
]);

function buildMechanicSlotsForRender({
  catalog,
  options,
  editor,
  utilitySelection,
  equippedWeapons,
  mhKey,
  ohKey,
  activeAttunement,
  activeKit,
}) {
  const nextOptions = options;
  const isToolbelt = catalog.skills.some((s) => s.toolbeltSkill > 0);

  let mechSlots;
  const eliteSpecEntry = (editor.specializations || [])
    .find((e) => catalog.specializationById.get(Number(e?.specializationId))?.elite);
  const eliteSpecId = Number(eliteSpecEntry?.specializationId) || 0;
  const isWeaver = eliteSpecId === 56;
  // Ranger and all Ranger elite specs (Druid/Soulbeast/Untamed) use catalog.pets.
  const isRanger = Array.isArray(catalog.pets) && catalog.pets.length > 0;

  // Collect elite spec's static profession mechanic skills (type "Profession", not "Toolbelt").
  // Deduplicate by slot: some skills have multiple contextual variants at the same slot
  // (e.g. Scrapper's "Function Gyro" has 3 toggle-phase variants, Mechanist's F4 has
  // "Crash Down / Mech Support / Recall Mech"). Keep only the first occurrence per slot.
  const eliteSpecOptionsRaw = (nextOptions.profession || []).filter((s) =>
    Number(s.specialization) === eliteSpecId && (s.type || "").toLowerCase() !== "toolbelt"
  );
  const seenSlot = new Set();
  const eliteSpecOptions = eliteSpecOptionsRaw.filter((s) => {
    if (seenSlot.has(s.slot)) return false;
    seenSlot.add(s.slot);
    return true;
  });

  // "Locked" placeholder slots indicate player-selectable morph slots (Amalgam F2–F4).
  // All other unique slots are fixed static mechanics.
  const morphSlotSkills = eliteSpecOptions.filter((s) => s.name.toLowerCase() === "locked");
  const eliteFixedSkills = eliteSpecOptions.filter((s) => s.name.toLowerCase() !== "locked");

  // Mechanist (spec 70) is the only toolbelt engineer whose F1-F3 are trait-gated mech commands
  // rather than toolbelt skills. Detect explicitly by spec ID to avoid false positives from
  // trait skills that may be incorrectly tagged as Profession_1 for other engineer elite specs.
  const eliteOverridesToolbelt = isToolbelt && eliteSpecId === 70;
  const isSelectablePool = isToolbelt && morphSlotSkills.length > 0;

  if (eliteOverridesToolbelt) {
    // Mechanist: F1-F3 are trait-gated mech commands; F4 is Crash Down/Recall toggle.
    // For each tier slot (Profession_1/2/3), use the skill granted by the selected major trait.
    // Fall back to the first available skill in that slot if no trait is selected.
    const mechSpecEntry = (editor.specializations || [])
      .find((e) => Number(e?.specializationId) === eliteSpecId);
    const mechMajorChoices = mechSpecEntry?.majorChoices || {};
    const selectedMajorTraitIds = new Set(Object.values(mechMajorChoices).map(Number).filter(Boolean));

    mechSlots = [];
    for (const tier of [1, 2, 3]) {
      const slot = `Profession_${tier}`;
      const traitsForTier = catalog.traits.filter(
        (t) => t.specialization === eliteSpecId && t.tier === tier
      );
      const selectedTrait = traitsForTier.find((t) => selectedMajorTraitIds.has(t.id));
      let skill = null;
      let mechIconOverride = "";
      if (selectedTrait) {
        const skillId = selectedTrait.traitSkillIds[0];
        skill = catalog.skillById.get(skillId) || null;
        // If skill is missing or has no icon, use the icon embedded in the trait data
        if (skillId && (!skill || !skill.icon)) {
          mechIconOverride = (selectedTrait.traitSkillIcons || {})[skillId] || "";
        }
      }
      if (!skill) {
        // Try skills tagged with the elite spec first, then any unspecced Profession_N skill
        skill = eliteSpecOptions.find((s) => s.slot === slot)
          || (nextOptions.profession || []).find((s) => s.slot === slot)
          || null;
      }
      mechSlots.push({ skill, sourceId: 0, isStatic: true, isSelectable: false, mechIconOverride });
    }
    // F4: Crash Down (first Profession_4 entry)
    const f4 = eliteFixedSkills.find((s) => s.slot === "Profession_4");
    if (f4) mechSlots.push({ skill: f4, sourceId: 0, isStatic: true, isSelectable: false });
  } else if (isSelectablePool) {
    // Amalgam: F1 = heal toolbelt; F2–F4 = "Locked" morph slots (player-selectable); F5 = Evolve
    const healSrc = catalog.skillById.get(Number(editor.skills?.healId) || 0);
    const healToolbelt = healSrc?.toolbeltSkill ? (catalog.skillById.get(healSrc.toolbeltSkill) || null) : null;
    const morphIds = Array.isArray(editor.morphSkillIds)
      ? editor.morphSkillIds.map(Number) : [0, 0, 0];

    mechSlots = [
      { skill: healToolbelt, sourceId: Number(editor.skills?.healId) || 0, isStatic: false, isSelectable: false },
      ...morphSlotSkills.map((lockedSkill, morphIndex) => ({
        // Show the selected morph skill if one is chosen; fall back to "Locked" placeholder
        skill: morphIds[morphIndex] ? (catalog.skillById.get(morphIds[morphIndex]) || lockedSkill) : lockedSkill,
        sourceId: morphIds[morphIndex] || 0,
        isStatic: false,
        isSelectable: true,
        morphIndex,
      })),
    ];
    // Append fixed elite skills (Evolve at Profession_5)
    for (const skill of eliteFixedSkills) {
      mechSlots.push({ skill, sourceId: 0, isStatic: true, isSelectable: false });
    }
  } else if (isToolbelt) {
    // Base Engineer / Scrapper / Holosmith: F1–F4 from toolbelt, optional elite F5
    const toolbeltSourceIds = [
      Number(editor.skills?.healId) || 0,
      Number(utilitySelection[0]) || 0,
      Number(utilitySelection[1]) || 0,
      Number(utilitySelection[2]) || 0,
    ];
    mechSlots = toolbeltSourceIds.map((id) => {
      const src = catalog.skillById.get(id);
      const fskill = src?.toolbeltSkill ? (catalog.skillById.get(src.toolbeltSkill) || null) : null;
      return { skill: fskill, sourceId: id, sourceSkill: src || null, isStatic: false, isSelectable: false };
    });
    // Fixed F5 from elite spec (Scrapper → Function Gyro, Holosmith → Photon Forge)
    const staticF5 = eliteFixedSkills.find((s) => s.slot === "Profession_5");
    if (staticF5) mechSlots.push({ skill: staticF5, sourceId: 0, isStatic: true, isSelectable: false });
  } else if (Array.isArray(catalog.legends) && catalog.legends.length > 0) {
    // Revenant: F1 is SHARED between both legend stances (clicking either swaps to it).
    // The legend stack UI handles F1; mech slots only show elite spec skills F2+.
    const legendSlots = editor.selectedLegends || ["", ""];
    const activeLegendSlot = Number(editor.activeLegendSlot) || 0;
    const activeLegendId = legendSlots[activeLegendSlot] || "";
    const activeLegend = activeLegendId ? catalog.legendById.get(activeLegendId) : null;
    const isAllianceLegendActive = activeLegendId === "Legend7";
    const allianceTacticsForm = Number(editor.allianceTacticsForm) || 0; // 0=Archemorus, 1=Saint Viktor

    const eliteByProfSlot = buildRevenantEliteByProfSlot(
      eliteFixedSkills,
      eliteSpecId,
      isAllianceLegendActive,
      catalog.skillById
    );

    mechSlots = [];
    if (eliteSpecId > 0) {
      for (let n = 2; n <= 5; n++) {
        const slotKey = `Profession_${n}`;
        const eliteSkill = eliteByProfSlot.get(slotKey);
        if (!eliteSkill) continue; // skip gaps (e.g. Vindicator has no Profession_2)
        const isAllianceTactics = eliteSkill.id === 62729;
        if (isAllianceTactics && !isAllianceLegendActive) continue;
        let displaySkill = eliteSkill;
        if (isAllianceTactics && allianceTacticsForm === 1 && eliteSkill.flipSkill) {
          displaySkill = catalog.skillById.get(eliteSkill.flipSkill) || eliteSkill;
        }
        // Conduit (spec 79) F2 — Release Potential: pick the variant matching the active legend.
        if (eliteSpecId === 79 && slotKey === "Profession_2") {
          const activeLegendSwap = activeLegend?.swap || 0;
          const f2Id = activeLegendSwap ? CONDUIT_F2_BY_SWAP.get(activeLegendSwap) : null;
          displaySkill = (f2Id && catalog.skillById.get(f2Id)) || eliteSkill;
        }
        mechSlots.push({ skill: displaySkill, sourceId: eliteSkill.id, isStatic: true, isSelectable: false, fKeyLabel: `F${n}`, isAllianceTactics });
      }
    }

    // Override skill option lists so they show this legend's fixed skills.
    if (activeLegend) {
      const ls = (id) => {
        if (!id) return null;
        const skill = catalog.skillById.get(id);
        if (!skill) return null;
        if (isAllianceLegendActive && allianceTacticsForm === 1 && skill.flipSkill) {
          return catalog.skillById.get(skill.flipSkill) || skill;
        }
        return skill;
      };
      nextOptions.heal = [ls(activeLegend.heal)].filter(Boolean);
      nextOptions.utility = (activeLegend.utilities || []).map(ls).filter(Boolean);
      nextOptions.elite = [ls(activeLegend.elite)].filter(Boolean);
    }
  } else if (isRanger) {
    const activePetSlotKey = editor.activePetSlot === "terrestrial2" ? "terrestrial2" : "terrestrial1";
    const activePetId = Number(editor.selectedPets?.[activePetSlotKey]) || 0;
    const activePet = activePetId && catalog.petById ? catalog.petById.get(activePetId) : null;

    mechSlots = [];
    if (eliteSpecId === 55) {
      const p5SoulbeastSkill = (nextOptions.profession || []).find((s) => s.slot === "Profession_5") || null;
      const beastmodeId = p5SoulbeastSkill?.id || 0;
      const beastmodeActive = beastmodeId > 0 && activeKit === beastmodeId;
      if (beastmodeActive) {
        const petFamilySkills = activePetId ? RANGER_PET_FAMILY_SKILLS.get(activePetId) : null;
        for (const key of ["p1", "p2", "p3"]) {
          const skillId = petFamilySkills?.[key] || null;
          const skill = skillId ? (catalog.skillById.get(skillId) || null) : null;
          mechSlots.push({ skill, sourceId: skill?.id || 0, isStatic: true, isSelectable: false });
        }
      } else {
        mechSlots.push({ skill: null, sourceId: 0, isStatic: true, isSelectable: false, fakeCommand: "attack" });
        const f2Skill = (activePet?.skills || [])[0] || null;
        mechSlots.push({ skill: f2Skill, sourceId: f2Skill?.id || 0, isStatic: true, isSelectable: false });
        mechSlots.push({ skill: null, sourceId: 0, isStatic: true, isSelectable: false, fakeCommand: "return" });
      }
      if (p5SoulbeastSkill) {
        mechSlots.push({
          skill: p5SoulbeastSkill, sourceId: p5SoulbeastSkill.id, isStatic: true, isSelectable: false,
          isBeastmodeToggle: true,
          leaveIcon: "https://wiki.guildwars2.com/images/2/2a/Leave_Beastmode.png",
          fKeyLabel: "F5",
          isF5AboveOrb: true,
        });
      }
    } else {
      mechSlots.push({ skill: null, sourceId: 0, isStatic: true, isSelectable: false, fakeCommand: "attack" });
      const petSkills = activePet?.skills || [];
      const isAquaticSlot = activePetSlotKey === "aquatic1" || activePetSlotKey === "aquatic2";
      const f2SkillIdx = isAquaticSlot && petSkills.length > 1 ? 1 : 0;
      const f2Skill = petSkills[f2SkillIdx] || null;
      mechSlots.push({ skill: f2Skill, sourceId: f2Skill?.id || 0, isStatic: true, isSelectable: false });
      if (eliteSpecId === 72) {
        const envHaze = catalog.skillById.get(63094) || null;
        mechSlots.push({ skill: envHaze, sourceId: envHaze?.id || 0, isStatic: true, isSelectable: false });
      } else {
        mechSlots.push({ skill: null, sourceId: 0, isStatic: true, isSelectable: false, fakeCommand: "return" });
      }
    }
    if (eliteSpecId !== 55) {
      const p5Skill = (nextOptions.profession || []).find((s) => s.slot === "Profession_5") || null;
      if (p5Skill) {
        mechSlots.push({ skill: p5Skill, sourceId: p5Skill.id, isStatic: true, isSelectable: false, fKeyLabel: "F5", isF5AboveOrb: true });
      }
    }
  } else {
    // Non-toolbelt professions (warrior, necro, guardian, mesmer, ele, thief, etc.)
    const activeMainhand = (equippedWeapons[mhKey] || "").toLowerCase();
    const activeOffhand = (equippedWeapons[ohKey] || "").toLowerCase();

    const bySlot = new Map(); // slotKey → skill[]
    for (const skill of (nextOptions.profession || [])) {
      if (!skill.slot) continue;
      if (!bySlot.has(skill.slot)) bySlot.set(skill.slot, []);
      bySlot.get(skill.slot).push(skill);
    }

    const sortedSlotKeys = [...bySlot.keys()]
      .filter((k) => !isWeaver || parseInt(k.replace("Profession_", ""), 10) <= 4)
      .sort((a, b) => {
        const na = parseInt(a.replace("Profession_", ""), 10) || 0;
        const nb = parseInt(b.replace("Profession_", ""), 10) || 0;
        return na - nb;
      });

    // Thief mechanics: Core/Daredevil/Deadeye only have a fixed F1 profession slot.
    // Specter (71) and Antiquary (77) are the only Thief specs with persistent F2+ slots.
    const isThief = (catalog?.profession?.id || editor.profession || "") === "Thief";
    const thiefHasPersistentF2Plus = eliteSpecId === 71 || eliteSpecId === 77;
    const renderSlotKeys = isThief && !thiefHasPersistentF2Plus
      ? sortedSlotKeys.filter((slotKey) => slotKey === "Profession_1")
      : sortedSlotKeys;

    const isWarrior = (catalog?.profession?.id || editor.profession || "") === "Warrior";
    const isBerserker = isWarrior && eliteSpecId === 18;
    // Berserk (F2 toggle for Berserker): resolve the Berserk skill from the Profession_2 slot.
    const berserkSkillId = isBerserker ? (bySlot.get("Profession_2")?.[0]?.id || 0) : 0;
    const berserkActive = berserkSkillId > 0 && activeKit === berserkSkillId;

    mechSlots = renderSlotKeys.map((slotKey) => {
      const candidates = bySlot.get(slotKey);
      let skill;
      if (candidates.length === 1) {
        skill = candidates[0];
      } else {
        // Split into elite-spec and base pools; prefer elite-spec when active.
        // Weaver is excluded: its F skills are the standard ele attunement swaps.
        // Berserker F1: handled separately — core vs primal burst depends on Berserk toggle.
        const isBerserkerBurstSlot = isBerserker && slotKey === "Profession_1";
        const eliteCandidates = eliteSpecId && !isWeaver && !isBerserkerBurstSlot
          ? candidates.filter((s) => Number(s.specialization) === eliteSpecId)
          : [];
        // Sort by ID descending: when the API lists multiple skill variants at the same slot
        // the higher ID is the more recently added/updated skill and should be preferred.
        let pool;
        if (isBerserkerBurstSlot) {
          // When Berserk is active show primal bursts (spec=51); otherwise show core bursts.
          const primalPool = candidates.filter((s) => Number(s.specialization) === 51);
          const corePool = candidates.filter((s) => !Number(s.specialization));
          const base = berserkActive ? primalPool : corePool;
          pool = (base.length > 0 ? base : candidates).sort((a, b) => b.id - a.id);
        } else {
          pool = [...(eliteCandidates.length > 0 ? eliteCandidates : candidates)]
            .sort((a, b) => b.id - a.id);
        }
        const wt = (s) => (s.weaponType || "").toLowerCase();
        const attunementSkill = !isWeaver && activeAttunement
          ? pool.find((s) => s.attunement && s.attunement.toLowerCase() === activeAttunement.toLowerCase())
          : null;
        if (isWeaver) {
          // Weaver F slots are always attunement swap buttons (Fire/Water/Air/Earth).
          const stdName = /^(?:Fire|Water|Air|Earth)\s+Attunement\b/i;
          skill = pool.find((s) => Number(s.specialization) === 56 && stdName.test(s.name || ""))
               || pool.find((s) => stdName.test(s.name || ""))
               || pool[0];
        } else {
          skill = pool.find((s) => wt(s) && wt(s) === activeMainhand)
               || pool.find((s) => wt(s) && wt(s) === activeOffhand)
               || attunementSkill
               || pool.find((s) => !s.weaponType && !s.attunement)
               || pool[0];
        }
      }
      // Warrior: F1 burst slot is blank when no weapon is equipped (all burst skills are
      // weapon-specific; show nothing rather than an arbitrary burst for an empty hand).
      if (isWarrior && slotKey === "Profession_1" && candidates.every((s) => s.weaponType) && !activeMainhand) {
        return { skill: null, sourceId: 0, isStatic: true, isSelectable: false };
      }
      // Berserker: F2 "Berserk" is toggleable — clicking it switches F1 between core and primal burst.
      if (isBerserker && slotKey === "Profession_2") {
        return { skill, sourceId: skill?.id || 0, isStatic: true, isSelectable: false, isBerserkToggle: true };
      }
      // Antiquary (spec=77): F1 gets the randomize play badge; F2/F3 show stored artifact draws.
      if (eliteSpecId === 77) {
        if (slotKey === "Profession_1") {
          return { skill, sourceId: skill?.id || 0, isStatic: true, isSelectable: false, isAntiquarySkritSwipe: true };
        }
        if (slotKey === "Profession_2") {
          const storedId = Number(editor.antiquaryArtifacts?.f2) || 0;
          const storedSkill = storedId ? catalog.skillById.get(storedId) || null : null;
          return { skill: storedSkill, sourceId: storedId, isStatic: true, isSelectable: false };
        }
        if (slotKey === "Profession_3") {
          const storedId = Number(editor.antiquaryArtifacts?.f3) || 0;
          const storedSkill = storedId ? catalog.skillById.get(storedId) || null : null;
          return { skill: storedSkill, sourceId: storedId, isStatic: true, isSelectable: false };
        }
      }
      return { skill, sourceId: skill?.id || 0, isStatic: true, isSelectable: false };
    });

    // Prolific Plunderer (trait 2346): append a virtual F4 artifact slot.
    if (eliteSpecId === 77 && isAntiquaryProlificPlundererActive(editor)) {
      const f4Id = Number(editor.antiquaryArtifacts?.f4) || 0;
      const f4Skill = f4Id ? catalog.skillById.get(f4Id) || null : null;
      mechSlots.push({ skill: f4Skill, sourceId: f4Id, isStatic: true, isSelectable: false });
    }
  }

  return { mechSlots, options: nextOptions, eliteSpecId, isWeaver, isToolbelt, isRanger };
}

function renderSkills() {
  const catalog = state.activeCatalog;
  el.skillsHost.innerHTML = "";
  if (!catalog) return;

  let options = getSkillOptionsByType(catalog, state.editor.specializations);
  const utilitySelection = Array.isArray(state.editor.skills?.utilityIds)
    ? state.editor.skills.utilityIds.map((value) => Number(value) || 0)
    : [0, 0, 0];
  const prevRenderedSkillIconIds = state.renderedSkillIconIds || new Map();
  const nextRenderedSkillIconIds = new Map();
  const markSkillIconRendered = (node, key, skillId) => {
    if (!node || !key) return;
    const prevSig = String(prevRenderedSkillIconIds.get(key) || "");
    const nextSig = String(skillId || "");
    if (prevSig && nextSig && prevSig !== nextSig) {
      node.classList.add("skill-icon--flip-anim");
    }
    nextRenderedSkillIconIds.set(key, nextSig);
  };

  const bar = document.createElement("div");
  bar.className = "skills-bar";

  const activeAttunement = state.editor.activeAttunement || "";
  const activeAttunement2 = state.editor.activeAttunement2 || "";
  const activeKit = Number(state.editor.activeKit) || 0;
  const activeWeaponSet = Number(state.editor.activeWeaponSet) || 1;
  const equippedWeapons = state.editor.equipment?.weapons || {};

  const mhKey = activeWeaponSet === 2 ? "mainhand2" : "mainhand1";
  const ohKey = activeWeaponSet === 2 ? "offhand2" : "offhand1";
  const hasWeaponSet2 = !!(equippedWeapons.mainhand2 || equippedWeapons.offhand2);

  const mechanicState = buildMechanicSlotsForRender({
    catalog,
    options,
    editor: state.editor,
    utilitySelection,
    equippedWeapons,
    mhKey,
    ohKey,
    activeAttunement,
    activeKit,
  });
  const { mechSlots, eliteSpecId, isWeaver, isToolbelt, isRanger } = mechanicState;
  options = mechanicState.options;

  // If activeKit refers to a static shroud/bundle skill, ensure it still exists in current mechSlots.
  // This prevents stale shroud state when switching elite specs (e.g. Reaper → Scourge).
  // Must happen before weapon skill resolution so the weapon bar reflects the correct state.
  if (activeKit) {
    const kitSkill = catalog.skillById.get(activeKit);
    const isStaticBundle = kitSkill?.bundleSkills?.length > 0 &&
      mechSlots.some((s) => s.isStatic && s.skill?.id === activeKit);
    const isToolbeltSource = mechSlots.some((s) => !s.isStatic && s.sourceId === activeKit);
    // Also allow heal/utility/elite slot kits (e.g. Mortar Kit in elite slot, Med Kit in heal slot).
    const equippedIds = new Set([
      Number(state.editor.skills?.healId) || 0,
      ...(state.editor.skills?.utilityIds || []).map(Number),
      Number(state.editor.skills?.eliteId) || 0,
    ].filter(Boolean));
    const isEquippedSlotKit = (kitSkill?.bundleSkills?.length ?? 0) > 0 && equippedIds.has(activeKit);
    // Soulbeast Beastmode has no bundle_skills in the API; allow it to persist via isBeastmodeToggle.
    const isBeastmodeKit = mechSlots.some((s) => s.isBeastmodeToggle && s.skill?.id === activeKit);
    const isBerserkKit = mechSlots.some((s) => s.isBerserkToggle && s.skill?.id === activeKit);
    if (!isStaticBundle && !isToolbeltSource && !isEquippedSlotKit && !isBeastmodeKit && !isBerserkKit) {
      state.editor.activeKit = 0;
    }
  }

  // Resolve weapon skills after kit validation so bundle/shroud state is correct.
  const resolvedKit = Number(state.editor.activeKit) || 0;
  const kitSrcSkill = resolvedKit ? catalog.skillById.get(resolvedKit) : null;
  // Build weapon bar skills for active kit/bundle, or fall back to equipped weapon skills.
  // bundle_skills arrays include both land and aquatic variants with no flags to distinguish them.
  // Group by Weapon_N/Downed_N slot and prefer the lower skill ID per slot — land skills are
  // historically assigned lower IDs than their aquatic counterparts (e.g. Box of Nails 5995
  // vs Box of Piranhas 6175 in Tool Kit).
  let weaponSkills;
  if (kitSrcSkill?.bundleSkills?.length) {
    const slotMap = new Map(); // slot number (1–5) → skill
    for (const id of kitSrcSkill.bundleSkills) {
      const s = catalog.skillById.get(id);
      if (!s) continue;
      const m = /^(?:Weapon|Downed)_(\d)$/.exec(s.slot || "");
      if (!m) continue;
      const slotNum = parseInt(m[1], 10);
      const existing = slotMap.get(slotNum);
      if (!existing || id < existing.id) slotMap.set(slotNum, s);
    }
    weaponSkills = [1, 2, 3, 4, 5].map((n) => slotMap.get(n) || null);
  } else {
    weaponSkills = getEquippedWeaponSkills(catalog, {
      mainhand: equippedWeapons[mhKey] || "",
      offhand: equippedWeapons[ohKey] || "",
    }, activeAttunement, activeAttunement2, isWeaver);
  }

  const weaponGroup = document.createElement("div");
  weaponGroup.className = "skill-group skill-group--weapons";
  for (let i = 0; i < 5; i++) {
    const wSkill = weaponSkills[i];
    const slotEl = document.createElement("div");
    slotEl.className = "skill-slot skill-slot--weapon";
    const iconBtn = document.createElement("button");
    iconBtn.type = "button";
    iconBtn.className = "skill-icon-large skill-icon--weapon" + (wSkill ? "" : " skill-icon--empty");
    iconBtn.disabled = !wSkill;
    if (wSkill?.icon) {
      iconBtn.innerHTML = `<img src="${escapeHtml(wSkill.icon)}" alt="${escapeHtml(wSkill.name || "")}" />`;
      iconBtn.title = wSkill.name || "";
      bindHoverPreview(iconBtn, "skill", () => wSkill);
      iconBtn.addEventListener("click", () => selectDetail("skill", wSkill));
    }
    markSkillIconRendered(iconBtn, `weapon_${i + 1}`, wSkill ? `${wSkill.id}:${wSkill.icon || ""}` : "");
    const wKeyLabel = document.createElement("span");
    wKeyLabel.className = "skill-icon-large__keylabel";
    wKeyLabel.textContent = String(i + 1);
    iconBtn.append(wKeyLabel);
    slotEl.append(iconBtn);
    weaponGroup.append(slotEl);
  }

  const weaponCol = document.createElement("div");
  weaponCol.className = "skills-bar__weapon-col";

  // F5 slot (Celestial Avatar / Beastmode / Unleash / Cyclone Bow) is rendered above the health orb.
  let f5SlotEl = null;

  // Always create the mechBar for Ranger (even core Ranger with empty mechSlots) so the
  // pet selector panel can be shown. Same for Revenant so the legend stack is always rendered.
  const isRevenant = Array.isArray(catalog.legends) && catalog.legends.length > 0;
  if (isRanger || isRevenant || (mechSlots.length > 0 && mechSlots.some((s) => s.skill || s.isSelectable))) {
    const mechBar = document.createElement("div");
    mechBar.className = "profession-mechanics-bar";

    for (let fIdx = 0; fIdx < mechSlots.length; fIdx++) {
      const { skill, sourceId, sourceSkill, isStatic, isSelectable, morphIndex, mechIconOverride, fakeCommand, isBeastmodeToggle, isBerserkToggle, leaveIcon, fKeyLabel, isF5AboveOrb, isAllianceTactics, isAntiquarySkritSwipe } = mechSlots[fIdx];
      const slotEl = document.createElement("div");
      slotEl.className = "skill-slot";
      const iconBtn = document.createElement("button");
      iconBtn.type = "button";

      // Determine if this slot has a kit (bundle weapon skills available to toggle).
      // Toolbelt slots: the SOURCE utility skill must have bundleSkills (i.e. be a kit).
      // Static slots: the skill itself has bundleSkills (shroud, Photon Forge, etc.).
      const srcSkillForKit = (!isStatic && isToolbelt) ? catalog.skillById.get(sourceId) : null;
      const isKit = !isStatic && isToolbelt
        ? (srcSkillForKit?.bundleSkills?.length ?? 0) > 0
        : isStatic && ((skill?.bundleSkills?.length ?? 0) > 0 || !!isBeastmodeToggle || !!isBerserkToggle);

      let isActive = false;
      if (isSelectable) {
        // Amalgam morph slot — always interactive, never "active" in the attunement/kit sense
      } else if (!isStatic && isToolbelt) {
        isActive = isKit && resolvedKit === sourceId;
      } else if (isAllianceTactics) {
        isActive = (Number(state.editor.allianceTacticsForm) || 0) === 1;
      } else if (isStatic && ((skill?.bundleSkills?.length ?? 0) > 0 || isBeastmodeToggle || isBerserkToggle)) {
        // Static bundle skills: shroud, celestial avatar, Photon Forge, beastmode, Berserk, etc.
        isActive = resolvedKit === skill?.id;
      } else if (isStatic && !isToolbelt) {
        // Attunement-keyed skills: check name pattern ("Fire Attunement") or attunement field
        const attunementNameMatch = /^(\w+)\s+Attunement\b/i.exec(skill?.name || "");
        const skillAttunement = attunementNameMatch ? attunementNameMatch[1] : (skill?.attunement || "");
        const sa = skillAttunement.toLowerCase();
        // Weaver: both primary and secondary attunements are highlighted
        isActive = !!skillAttunement && (
          sa === activeAttunement.toLowerCase() ||
          (isWeaver && !!activeAttunement2 && sa === activeAttunement2.toLowerCase())
        );
      }

      iconBtn.className = "skill-icon--profession"
        + (isActive ? " skill-icon--profession-active" : "")
        + (!skill && !fakeCommand ? " skill-icon--profession-empty" : "")
        + (!isKit && !isSelectable && isStatic === false ? " skill-icon--profession-nokit" : "")
        + (fakeCommand ? ` skill-icon--fake-command skill-icon--fake-${fakeCommand}` : "");
      iconBtn.title = fakeCommand === "attack" ? "Attack My Target"
        : fakeCommand === "return" ? "Return to Me"
        : (isActive && leaveIcon) ? "Leave Beastmode"
        : skill?.name || (isSelectable ? "Choose morph skill…" : "");

      let mechIconSignature = "";
      if (fakeCommand) {
        // Ranger client-side pet commands — no API skill, render a placeholder icon
        iconBtn.disabled = true;
        iconBtn.innerHTML = fakeCommand === "attack"
          ? `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
               <circle cx="16" cy="16" r="11" stroke="rgba(160,230,140,0.9)" stroke-width="1.5" fill="none"/>
               <circle cx="16" cy="16" r="3" fill="rgba(160,230,140,0.9)"/>
               <line x1="16" y1="2" x2="16" y2="9" stroke="rgba(160,230,140,0.9)" stroke-width="1.5"/>
               <line x1="16" y1="23" x2="16" y2="30" stroke="rgba(160,230,140,0.9)" stroke-width="1.5"/>
               <line x1="2" y1="16" x2="9" y2="16" stroke="rgba(160,230,140,0.9)" stroke-width="1.5"/>
               <line x1="23" y1="16" x2="30" y2="16" stroke="rgba(160,230,140,0.9)" stroke-width="1.5"/>
             </svg>`
          : `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
               <path d="M26 7 L26 18 C26 22 22 25 18 25 L9 25" stroke="rgba(240,220,100,0.9)" stroke-width="2" fill="none" stroke-linecap="round"/>
               <polyline points="13,19 9,25 15,29" stroke="rgba(240,220,100,0.9)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
             </svg>`;
        mechIconSignature = `fake:${fakeCommand}`;
      } else {
        // When a static bundle skill (e.g. Photon Forge) is active, show the flip_skill icon.
        const flipSkillId = isActive && isStatic && (skill?.flipSkill ?? 0);
        const flipSkill = flipSkillId ? catalog.skillById.get(flipSkillId) : null;
        // Elixir toolbelt skills ("Detonate Elixir X") share a generic icon in the API.
        // Fall back to the source elixir's own icon so each slot looks distinct.
        // All other toolbelt skills (Defense Field, turret actions, etc.) have correct distinct icons.
        const isDetonateElixir = !isKit && !isStatic && /^Detonate Elixir\b/i.test(skill?.name || "");
        const slotIcon = (isDetonateElixir && sourceSkill?.icon)
          ? sourceSkill.icon
          : (skill?.icon || mechIconOverride || "");
        // Beastmode: show Leave Beastmode icon when active (API has no flip_skill for Beastmode).
        const displayIcon = (isActive && leaveIcon) ? leaveIcon : (flipSkill?.icon) || slotIcon;
        const displayName = (isActive && leaveIcon) ? "Leave Beastmode" : (flipSkill?.name) || skill?.name || "";
        if (displayIcon) {
          iconBtn.innerHTML = `<img src="${escapeHtml(displayIcon)}" alt="${escapeHtml(displayName)}" />`;
        }
        mechIconSignature = (isActive && leaveIcon)
          ? `leave:${leaveIcon}`
          : flipSkill
            ? `flip:${flipSkill.id}:${displayIcon || ""}`
            : skill
              ? `${skill.id}:${displayIcon || ""}`
              : "";
        if (flipSkill) {
          bindHoverPreview(iconBtn, "skill", () => flipSkill);
        } else if (skill) {
          bindHoverPreview(iconBtn, "skill", () => skill);
        }
      }

      // F-key label (F1, F2, …) in the bottom-left corner of the slot icon
      const fLabel = document.createElement("span");
      fLabel.className = "skill-icon--profession-flabel";
      fLabel.textContent = fKeyLabel || `F${fIdx + 1}`;
      iconBtn.append(fLabel);
      markSkillIconRendered(iconBtn, `mech_${fIdx + 1}`, mechIconSignature || (skill ? `${skill.id}:${skill.icon || ""}` : ""));

      // Antiquary F1 (Skritt Swipe): play badge randomizes the F2/F3 artifact draws.
      if (isAntiquarySkritSwipe) {
        const rollBadge = document.createElement("span");
        rollBadge.className = "kit-toggle-indicator";
        rollBadge.title = "Draw artifacts";
        rollBadge.textContent = "▸";
        rollBadge.addEventListener("click", (e) => {
          e.stopPropagation();
          randomizeAntiquaryArtifacts(catalog, state.editor);
          renderSkills();
        });
        iconBtn.append(rollBadge);
      }

      // Alliance Tactics F3 gets a toggle badge to show it's clickable.
      if (isAllianceTactics) {
        const toggleBadge = document.createElement("span");
        toggleBadge.className = "kit-toggle-indicator" + (isActive ? " kit-toggle-indicator--active" : "");
        toggleBadge.textContent = isActive ? "✕" : "▸";
        iconBtn.append(toggleBadge);
      }

      // Static kit slots (tomes, Photon Forge, shrouds) get a toggle badge bottom-right.
      if (isKit && isStatic) {
        const toggleBadge = document.createElement("span");
        toggleBadge.className = "kit-toggle-indicator" + (isActive ? " kit-toggle-indicator--active" : "");
        toggleBadge.textContent = isActive ? "✕" : "▸";
        toggleBadge.addEventListener("click", (e) => {
          e.stopPropagation();
          state.editor.activeKit = resolvedKit === skill.id ? 0 : skill.id;
          renderSkills();
        });
        iconBtn.append(toggleBadge);
      }

      if (isSelectable) {
        iconBtn.addEventListener("click", () => {
          const otherSelectedIds = new Set(
            (state.editor.morphSkillIds || [])
              .map((id, i) => (i !== morphIndex ? Number(id) : 0))
              .filter(Boolean)
          );
          // Morph pool: all Profession-type skills for the elite spec that aren't "Locked"/"Evolve"
          const allMorphPool = catalog.skills.filter(
            (s) => s.specialization === eliteSpecId &&
              (s.type || "").toLowerCase() === "profession" &&
              s.name.toLowerCase() !== "locked" &&
              s.name.toLowerCase() !== "evolve"
          );
          const morphItems = [
            { value: "", label: "— None —" },
            ...allMorphPool
              .filter((s) => !otherSelectedIds.has(s.id))
              .map((s) => ({ value: String(s.id), label: s.name, icon: s.icon })),
          ];
          openSlotPicker(iconBtn, String(sourceId || ""), (newVal) => {
            if (!state.editor.morphSkillIds) state.editor.morphSkillIds = [0, 0, 0];
            state.editor.morphSkillIds[morphIndex] = Number(newVal) || 0;
            markEditorChanged();
            renderSkills();
          }, { items: morphItems, searchPlaceholder: "Choose morph skill…" });
          if (skill) selectDetail("skill", skill);
        });
      } else if (!isKit && !isStatic && isToolbelt) {
        // Non-kit toolbelt slot (elixir, gadget, etc.): not interactive, just show skill detail.
        if (skill) iconBtn.addEventListener("click", () => selectDetail("skill", skill));
      } else if (isKit && !isStatic && isToolbelt) {
        // Kit toolbelt slot: clicking shows skill detail. Weapon skill toggling is done via the
        // badge on the utility skill slot itself (see makeSkillSlot).
        if (skill) iconBtn.addEventListener("click", () => selectDetail("skill", skill));
      } else {
        iconBtn.addEventListener("click", () => {
          if (isAllianceTactics) {
            state.editor.allianceTacticsForm = (Number(state.editor.allianceTacticsForm) || 0) === 0 ? 1 : 0;
            syncRevenantSkillsFromLegend(catalog);
            markEditorChanged();
            renderSkills();
            if (skill) selectDetail("skill", skill);
            return;
          }
          if (isStatic && ((skill?.bundleSkills?.length ?? 0) > 0 || isBeastmodeToggle)) {
            // Static bundle skill (shroud, Photon Forge, beastmode, etc.): toggle active state.
            state.editor.activeKit = resolvedKit === skill.id ? 0 : skill.id;
            renderSkills();
            if (skill) selectDetail("skill", skill);
            return;
          } else if (isStatic && !isToolbelt) {
            const attunementNameMatch = /^(\w+)\s+Attunement\b/i.exec(skill?.name || "");
            const skillAttunement = attunementNameMatch ? attunementNameMatch[1] : (skill?.attunement || "");
            if (skillAttunement) {
              if (isWeaver) {
                // Clicked element → mainhand; current mainhand → offhand.
                // Clicking the current mainhand element again sets both to the same element
                // (single-attunement mode). Clicking the current offhand swaps them.
                state.editor.activeAttunement2 = state.editor.activeAttunement;
                state.editor.activeAttunement = skillAttunement;
              } else {
                state.editor.activeAttunement = skillAttunement;
              }
              renderSkills();
            }
          }
          if (skill) selectDetail("skill", skill);
        });
      }

      slotEl.append(iconBtn);
      if (isF5AboveOrb) {
        f5SlotEl = slotEl; // rendered above the health orb, not inside mechBar
      } else {
        mechBar.append(slotEl);
      }
    }
    // Ranger: add pet selector directly inside mechBar (right side, pushed by auto-margin spacer)
    if (Array.isArray(catalog.pets) && catalog.pets.length > 0) {
      const activeSlotKey = state.editor.activePetSlot === "terrestrial2" ? "terrestrial2" : "terrestrial1";
      const inactiveSlotKey = activeSlotKey === "terrestrial1" ? "terrestrial2" : "terrestrial1";
      const activePetId = Number(state.editor.selectedPets?.[activeSlotKey]) || 0;
      const inactivePetId = Number(state.editor.selectedPets?.[inactiveSlotKey]) || 0;
      const activePet = activePetId ? catalog.petById.get(activePetId) : null;

      const spacer = document.createElement("div");
      spacer.className = "pet-panel-spacer";

      const petWrapper = document.createElement("div");
      petWrapper.className = "pet-slot-wrapper";

      const petBtn = document.createElement("button");
      petBtn.type = "button";
      petBtn.className = "pet-slot-btn" + (activePet ? " pet-slot-btn--filled" : "");
      petBtn.title = activePet?.name || `Click to select ${activeSlotKey === "terrestrial1" ? "Pet 1" : "Pet 2"}`;
      if (activePet?.icon) {
        petBtn.innerHTML = `<img src="${escapeHtml(activePet.icon)}" alt="${escapeHtml(activePet.name || "")}" />`;
      }
      petBtn.addEventListener("click", () => openPetPicker(petBtn, activeSlotKey, catalog));

      const petLabel = document.createElement("span");
      petLabel.className = "pet-slot-btn__label";
      petLabel.textContent = activePet?.name?.replace(/^Juvenile\s+/i, "") || (activeSlotKey === "terrestrial1" ? "Pet 1" : "Pet 2");

      petWrapper.append(petBtn, petLabel);

      const petSwapBtn = document.createElement("button");
      petSwapBtn.type = "button";
      petSwapBtn.className = "pet-swap-btn" + (activeSlotKey === "terrestrial2" ? " pet-swap-btn--active" : "");
      petSwapBtn.title = inactivePetId
        ? `Switch to pet ${activeSlotKey === "terrestrial1" ? 2 : 1}`
        : "No second pet equipped";
      petSwapBtn.innerHTML = `<svg viewBox="0 0 18 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="2,3.5 13,3.5"/><polyline points="10,1 13,3.5 10,6"/><polyline points="16,10.5 5,10.5"/><polyline points="8,8 5,10.5 8,13"/></svg>`;
      petSwapBtn.addEventListener("click", () => {
        state.editor.activePetSlot = inactiveSlotKey;
        renderSkills();
      });

      mechBar.append(spacer, petWrapper, petSwapBtn);
    }

    // Revenant: prepend legend buttons into mechBar so they sit inline before any F2+ elite slots.
    // This avoids a separate wrapper div that would stretch to full column width.
    if (Array.isArray(catalog.legends) && catalog.legends.length > 0) {
      const legendSlots = state.editor.selectedLegends || ["", ""];
      const activeLegendSlot = Number(state.editor.activeLegendSlot) || 0;
      const legendStack = document.createElement("div");
      legendStack.className = "legend-stack";

      for (let slotIdx = 0; slotIdx < 2; slotIdx++) {
        const legendId = legendSlots[slotIdx] || "";
        const legend = legendId ? catalog.legendById.get(legendId) : null;
        const swapSkill = legend?.swap ? catalog.skillById.get(legend.swap) : null;
        const legendName = swapSkill?.name || legend?.id || "—";
        const legendIcon = swapSkill?.icon || "";
        const isActive = slotIdx === activeLegendSlot;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "legend-slot-btn" + (isActive ? " legend-slot-btn--active" : "");
        btn.title = legendName + (isActive ? " (active — right-click to change)" : " — click to swap, right-click to change");
        if (legendIcon) {
          btn.innerHTML = `<img src="${escapeHtml(legendIcon)}" alt="${escapeHtml(legendName)}" />`;
        }
        markSkillIconRendered(btn, `legend_${slotIdx + 1}`, legend ? `${legend.swap || 0}:${legendIcon}` : legendId);
        const slotLabel = document.createElement("span");
        slotLabel.className = "legend-slot-btn__label";
        slotLabel.textContent = "F1";
        btn.append(slotLabel);
        btn.addEventListener("click", () => {
          if (isActive || !legendId) {
            openLegendPicker(btn, slotIdx, catalog);
          } else {
            if (!state.editor.selectedLegends) state.editor.selectedLegends = ["", ""];
            state.editor.activeLegendSlot = slotIdx;
            // Reset Alliance form when switching to a non-Alliance legend
            if (legendId !== "Legend7") state.editor.allianceTacticsForm = 0;
            syncRevenantSkillsFromLegend(catalog);
            markEditorChanged();
            renderSkills();
          }
        });
        btn.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          openLegendPicker(btn, slotIdx, catalog);
        });
        legendStack.append(btn);
      }

      mechBar.prepend(legendStack);
    }
    weaponCol.append(mechBar);
  }

  const swapBtn = document.createElement("button");
  swapBtn.type = "button";
  swapBtn.className = "weapon-swap-btn" + (activeWeaponSet === 2 ? " weapon-swap-btn--active" : "");
  swapBtn.disabled = !hasWeaponSet2;
  swapBtn.title = hasWeaponSet2
    ? `Switch to weapon set ${activeWeaponSet === 1 ? 2 : 1}`
    : "No second weapon set equipped";
  swapBtn.innerHTML = `<svg viewBox="0 0 18 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="2,3.5 13,3.5"/><polyline points="10,1 13,3.5 10,6"/>
    <polyline points="16,10.5 5,10.5"/><polyline points="8,8 5,10.5 8,13"/>
  </svg>`;
  swapBtn.addEventListener("click", () => {
    state.editor.activeWeaponSet = activeWeaponSet === 1 ? 2 : 1;
    renderSkills();
  });

  const weaponRow = document.createElement("div");
  weaponRow.className = "skills-bar__weapon-row";
  weaponRow.append(swapBtn, weaponGroup);
  weaponCol.append(weaponRow);

  // Center: health orb
  const profession = state.editor.profession || "";
  const baseHp = PROFESSION_BASE_HP[profession] ?? 0;
  const computed = computeEquipmentStats();
  const totalHp = baseHp > 0 ? baseHp + (computed.Vitality || 0) * 10 : 0;
  const orbEl = document.createElement("div");
  orbEl.className = "health-orb";
  orbEl.innerHTML = `
    <div class="health-orb__fill"></div>
    <div class="health-orb__text">
      <span class="health-orb__hp">${totalHp > 0 ? totalHp.toLocaleString() : "—"}</span>
      <span class="health-orb__label">HP</span>
    </div>
  `;

  // Right: heal, 3 utility, elite
  const utilityGroup = document.createElement("div");
  utilityGroup.className = "skill-group skill-group--utilities";
  const utilitySlots = [
    { key: "healId", label: "Heal", list: options.heal || [], keybind: "6", flipKey: "utility_heal" },
    { key: "utilityIds", index: 0, label: "Utility", list: options.utility || [], keybind: "7", flipKey: "utility_1" },
    { key: "utilityIds", index: 1, label: "Utility", list: options.utility || [], keybind: "8", flipKey: "utility_2" },
    { key: "utilityIds", index: 2, label: "Utility", list: options.utility || [], keybind: "9", flipKey: "utility_3" },
    { key: "eliteId", label: "Elite", list: options.elite || [], keybind: "0", flipKey: "utility_elite" },
  ];
  for (const slot of utilitySlots) {
    utilityGroup.append(makeSkillSlot(slot, catalog, options, utilitySelection, markSkillIconRendered));
  }

  if (f5SlotEl) {
    const orbCol = document.createElement("div");
    orbCol.className = "skills-bar__orb-col";
    orbCol.append(f5SlotEl, orbEl);
    bar.append(weaponCol, orbCol, utilityGroup);
  } else {
    bar.append(weaponCol, orbEl, utilityGroup);
  }
  el.skillsHost.append(bar);
  state.renderedSkillIconIds = nextRenderedSkillIconIds;
}

function openLegendPicker(anchorEl, slotIdx, catalog) {
  const legendSlots = state.editor.selectedLegends || ["", ""];
  const otherLegendId = legendSlots[1 - slotIdx] || "";
  const selectedSpecIds = new Set(
    (state.editor.specializations || []).map((s) => Number(s?.specializationId) || 0).filter(Boolean)
  );
  const items = [
    { value: "", label: "— None —" },
    ...(catalog.legends || []).flatMap((l) => {
      const swapSkill = l.swap ? catalog.skillById.get(l.swap) : null;
      // Elite-spec-only legends: swap skill has a non-zero specialization requirement
      const reqSpec = Number(swapSkill?.specialization) || 0;
      if (reqSpec && !selectedSpecIds.has(reqSpec)) return [];
      return [{ value: l.id, label: swapSkill?.name || l.id, icon: swapSkill?.icon || "" }];
    }).filter((item) => item.value !== otherLegendId),
  ];
  openSlotPicker(anchorEl, legendSlots[slotIdx] || "", (newVal) => {
    if (!state.editor.selectedLegends) state.editor.selectedLegends = ["", ""];
    state.editor.selectedLegends[slotIdx] = newVal || "";
    syncRevenantSkillsFromLegend(catalog);
    markEditorChanged();
    renderSkills();
  }, { items, searchPlaceholder: "Search legends…" });
}

function openPetPicker(anchorEl, petKey, catalog) {
  const currentPetId = Number(state.editor.selectedPets?.[petKey]) || 0;
  const isAquatic = petKey.startsWith("aquatic");
  // Filter pets: aquatic slots show aquatic family pets; terrestrial slots show non-aquatic
  const aquaticFamilies = new Set(["Amphibious", "Aquatic"]);
  const filteredPets = (catalog.pets || []).filter((p) => {
    const isAquaticPet = aquaticFamilies.has(p.type);
    return isAquatic ? isAquaticPet : !isAquaticPet;
  });
  const items = [
    { value: "", label: "— None —" },
    ...filteredPets.map((p) => ({ value: String(p.id), label: p.name, icon: p.icon })),
  ];
  openSlotPicker(anchorEl, currentPetId ? String(currentPetId) : "", (newVal) => {
    if (!state.editor.selectedPets) state.editor.selectedPets = { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 };
    state.editor.selectedPets[petKey] = Number(newVal) || 0;
    markEditorChanged();
    renderSkills();
  }, { items, searchPlaceholder: "Search pets…", className: "slot-picker--pet" });
}

function syncRevenantSkillsFromLegend(catalog) {
  const legendSlots = state.editor.selectedLegends || ["", ""];
  const activeLegendSlot = Number(state.editor.activeLegendSlot) || 0;
  const activeLegendId = legendSlots[activeLegendSlot] || "";
  const activeLegend = activeLegendId ? catalog.legendById.get(activeLegendId) : null;
  if (!activeLegend) return;
  if (!state.editor.skills) state.editor.skills = { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 };
  // Alliance legend: apply Saint Viktor (Luxon) flip skills when form=1
  const useFlip = activeLegendId === "Legend7" && (Number(state.editor.allianceTacticsForm) || 0) === 1;
  const resolveId = (id) => {
    if (!id) return 0;
    if (useFlip) {
      const skill = catalog.skillById.get(id);
      return skill?.flipSkill || id;
    }
    return id;
  };
  state.editor.skills.healId = resolveId(activeLegend.heal) || 0;
  state.editor.skills.utilityIds = [
    ...(activeLegend.utilities || []).slice(0, 3).map(resolveId),
    ...Array(3).fill(0),
  ].slice(0, 3);
  state.editor.skills.eliteId = resolveId(activeLegend.elite) || 0;
}

function renderDetailPanel() {
  const detail = state.detail;
  if (!detail) {
    el.detailHost.innerHTML = `<p class="empty-line">Select a trait or skill to inspect wiki and API details.</p>`;
    return;
  }

  const facts = Array.isArray(detail.facts) ? detail.facts.slice(0, 16) : [];
  const detailDmgStats = (() => {
    if (detail.kindLabel === "Trait") return null;
    const computed = computeEquipmentStats();
    const power = computed.Power || 1000;
    const precision = computed.Precision || 1000;
    const ferocity = computed.Ferocity || 0;
    const activeWeaponSet = Number(state.editor.activeWeaponSet) || 1;
    const mhKey = activeWeaponSet === 2 ? "mainhand2" : "mainhand1";
    const mhId = state.editor?.equipment?.weapons?.[mhKey] || "";
    const weaponStrength = WEAPON_STRENGTH_MIDPOINT[mhId] || 952.5;
    const critChance = Math.min(1, (precision - 895) / 2100);
    const effectivePower = power * (1 + critChance * (0.5 + ferocity / 1500));
    return { weaponStrength, effectivePower };
  })();
  const factsHtml = facts.length
    ? facts
        .map((fact) => {
          const cls = fact.type === "NoData" ? ' class="fact-item--section"' : '';
          return `<li${cls}>${formatFactHtml(fact, detailDmgStats)}</li>`;
        })
        .join("")
    : "<li>No fact entries.</li>";

  const wiki = detail.wiki || {};
  const wikiSummary = wiki.loading
    ? "<p>Loading wiki summary...</p>"
    : wiki.summary
      ? `<p>${escapeHtml(wiki.summary)}</p>`
      : "<p>No wiki summary available.</p>";
  const wikiLink = wiki.url
    ? `<a href="${escapeHtml(wiki.url)}" target="_blank" rel="noreferrer">Open Wiki Page</a>`
    : "";

  el.detailHost.innerHTML = `
    <article class="detail-card">
      <header>
        ${detail.icon
          ? `<img src="${escapeHtml(detail.icon)}" alt="${escapeHtml(detail.title)}" onerror="this.onerror=null;${detail.iconFallback ? `this.src='${escapeHtml(detail.iconFallback)}'` : "this.style.visibility='hidden'"}" />`
          : `<div class="detail-card__icon-placeholder"></div>`}
        <div>
          <h3>${escapeHtml(detail.title)}</h3>
          <p>${escapeHtml(detail.kindLabel)}</p>
        </div>
      </header>
      <section>
        <h4>In-Game Description</h4>
        <p>${escapeHtml(detail.description || "No description.")}</p>
      </section>
      <section>
        <h4>Wiki</h4>
        ${wikiSummary}
        ${wikiLink}
      </section>
      <section>
        <h4>Facts</h4>
        <ul>${factsHtml}</ul>
      </section>
    </article>
  `;
}

function makeTraitButton(trait, active, onClick, options = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  const classNames = ["trait-btn"];
  if (active) classNames.push("trait-btn--active");
  if (options.alwaysSelected) classNames.push("trait-btn--always");
  btn.className = classNames.join(" ");
  btn.title = trait?.name || "Unknown trait";
  if (trait?.icon) {
    const img = document.createElement("img");
    img.src = String(trait.icon);
    img.alt = trait.name || "Trait";
    const fallback = String(trait.iconFallback || "");
    if (fallback) {
      img.addEventListener("error", () => {
        if (img.dataset.fallbackApplied === "1") return;
        img.dataset.fallbackApplied = "1";
        img.src = fallback;
      });
    }
    btn.append(img);
  } else {
    btn.textContent = "?";
  }
  btn.disabled = !trait;
  if (trait && typeof onClick === "function") {
    btn.addEventListener("click", onClick);
  }
  if (trait) {
    bindHoverPreview(btn, "trait", () => trait);
  }
  return btn;
}

function bindHoverPreview(node, kind, entityProvider) {
  if (!node) return;
  const readEntity = () =>
    typeof entityProvider === "function" ? entityProvider() : entityProvider || null;

  node.addEventListener("mouseenter", (event) => {
    const entity = readEntity();
    if (!entity) return;
    showHoverPreview(kind, entity, event.clientX, event.clientY);
  });

  node.addEventListener("mousemove", (event) => {
    if (el.hoverPreview.classList.contains("hidden")) return;
    positionHoverPreview(event.clientX, event.clientY);
  });

  node.addEventListener("mouseleave", () => {
    hideHoverPreview();
  });

  node.addEventListener("focus", () => {
    const entity = readEntity();
    if (!entity) return;
    const rect = node.getBoundingClientRect();
    showHoverPreview(kind, entity, rect.right, rect.top + rect.height / 2);
  });

  node.addEventListener("blur", () => {
    hideHoverPreview();
  });
}

/**
 * Merge base facts with applicable traited_facts for the current build's active traits.
 *
 * GW2 API trait/skill objects have two fact sources:
 *   - `facts[]`: base facts, pre-filtered to exclude entries with requires_trait
 *   - `traitedFacts[]`: conditional overrides, each with:
 *       requires_trait  – ID of the major trait that enables this entry
 *       overrides       – 0-based index into facts[] to replace (required; see below)
 *       …fact fields    – type, text, value, etc.
 *
 * Only traited_facts WITH an `overrides` index are applied — they replace the base fact at
 * that index with an updated value (e.g., a stat that improves when a trait is active).
 * Entries without `overrides` would append extra facts representing conditional gameplay
 * states (e.g., "while in berserk mode") that are too context-dependent for a tooltip and
 * would otherwise cause fact bloat when any matching trait is selected.
 */
function resolveEntityFacts(entity) {
  const baseFacts = Array.isArray(entity.facts) ? entity.facts : [];
  const traitedFacts = Array.isArray(entity.traitedFacts) ? entity.traitedFacts : [];

  // Apply traited_facts overrides when the required trait is active.
  let result = baseFacts;
  if (traitedFacts.length) {
    const activeTraitIds = new Set(
      (state.editor.specializations || [])
        .flatMap((s) => Object.values(s?.majorChoices || {}))
        .map(Number)
        .filter(Boolean)
    );
    if (activeTraitIds.size) {
      result = [...baseFacts];
      for (const tf of traitedFacts) {
        if (!activeTraitIds.has(Number(tf.requires_trait))) continue;
        const { requires_trait: _r, overrides, ...factData } = tf;
        // Only apply replacements (overrides set); skip appended facts.
        if (overrides !== undefined && overrides !== null && overrides >= 0 && overrides < result.length) {
          result[overrides] = factData;
        }
      }
    }
  }

  // Deduplicate — always runs regardless of traitedFacts.
  // The GW2 API places both the base value AND a conditional variant in facts[] without
  // requires_trait markers. After overrides are applied above, the first entry already
  // holds the correct value; later duplicates are conditional variants to be dropped.
  //
  // Two dedup strategies:
  //   Buff/condition facts (status field present): key = status only. The same boon
  //     (e.g. Quickness) can appear with different durations across Buff/PrefixedBuff
  //     types — deduplicate by status regardless of type so both variants collapse.
  //   All other facts: key = text + type + target + source. Distinct facts that happen
  //     to share text (e.g. two AttributeConversion entries for different stats) differ
  //     by target/source and are preserved.
  // NoData facts (section separators) and facts with no identifying field are always kept.
  const seen = new Set();
  return result.filter((f) => {
    if (f.type === "NoData") return true;
    const statusKey = (f.status || "").trim();
    if (statusKey) {
      const key = `status:${statusKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }
    const text = (f.text || "").trim();
    if (!text) return true;
    const key = `${text}|${f.type || ""}|${f.target || ""}|${f.source || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSkillCard(skill, kind, isChained = false, dmgStats = null) {
  const icon = String(skill.icon || skill.iconFallback || "");
  const description = normalizeText(skill.description || "");
  const maxFacts = kind.startsWith("equip-") ? 12 : 16;
  const rawFacts = resolveEntityFacts(skill).slice(0, maxFacts);
  const factsItems = rawFacts
    .map((fact) => {
      const html = formatFactHtml(fact, dmgStats);
      if (!html) return null;
      const cls = fact.type === "NoData" ? ' class="fact-item--section"' : '';
      return `<li${cls}>${html}</li>`;
    })
    .filter(Boolean);
  const meta = getHoverMetaLine(kind, skill);
  return `
    ${isChained ? `<div class="hover-preview__chain-divider">▸</div>` : ""}
    <div class="hover-preview__head${isChained ? " hover-preview__head--chained" : ""}">
      ${icon ? `<img class="hover-preview__icon" src="${escapeHtml(icon)}" alt="${escapeHtml(skill.name || "Icon")}" onerror="this.onerror=null;this.src='${escapeHtml(String(skill.iconFallback || icon))}'" />` : "<div></div>"}
      <div>
        <h4 class="hover-preview__title">${escapeHtml(skill.name || "Unknown")}</h4>
        <p class="hover-preview__meta">${escapeHtml(meta)}</p>
      </div>
    </div>
    ${description ? `<p class="hover-preview__desc">${escapeHtml(description)}</p>` : (!factsItems.length ? `<p class="hover-preview__desc">No description available.</p>` : "")}
    ${factsItems.length ? `<ul class="hover-preview__facts">${factsItems.join("")}</ul>` : ""}
  `;
}

function showHoverPreview(kind, entity, x, y) {
  if (!entity) return;

  // Compute damage stats from the current build for Damage fact calculations.
  // Formula: Damage = WeaponStrength × EffectivePower × Coefficient × Hits / 2597
  // EffectivePower = Power × (1 + CritChance × (0.5 + Ferocity/1500))
  let dmgStats = null;
  if (kind === "skill") {
    const computed = computeEquipmentStats();
    const power = computed.Power || 1000;
    const precision = computed.Precision || 1000;
    const ferocity = computed.Ferocity || 0;
    const activeWeaponSet = Number(state.editor.activeWeaponSet) || 1;
    const mhKey = activeWeaponSet === 2 ? "mainhand2" : "mainhand1";
    const mhId = state.editor?.equipment?.weapons?.[mhKey] || "";
    const weaponStrength = WEAPON_STRENGTH_MIDPOINT[mhId] || 952.5;
    const critChance = Math.min(1, (precision - 895) / 2100);
    const effectivePower = power * (1 + critChance * (0.5 + ferocity / 1500));
    dmgStats = { weaponStrength, effectivePower };
  }

  // For skills, follow flipSkill chain to show chained/charged skills as subsequent cards.
  // Weapon skills live in weaponSkillById; profession/utility skills in skillById — check both.
  const chainCards = [buildSkillCard(entity, kind, false, dmgStats)];
  if (kind === "skill" && entity.flipSkill) {
    const catalog = state.activeCatalog;
    const lookupSkill = (id) => catalog?.skillById?.get(id) || catalog?.weaponSkillById?.get(id);
    const exitPattern = /^(Exit|Leave|Deactivate|Stow)\b/i;
    const seen = new Set([entity.id]);
    const originalSpec = Number(entity.specialization) || 0;
    let cur = lookupSkill(entity.flipSkill);
    while (cur && !seen.has(cur.id) && !exitPattern.test(cur.name || "") && chainCards.length < 5) {
      // Stop if the flip is a same-named activated-state copy (e.g. Luminary F2/F3 virtues).
      if (cur.name === entity.name) break;
      // Stop if the flip jumps to a different specialization (e.g. base Virtue of Justice spec=0
      // or Luminary F1 spec=81 both flip to Dragonhunter Spear of Justice spec=27).
      const curSpec = Number(cur.specialization) || 0;
      if (curSpec && curSpec !== originalSpec) break;
      seen.add(cur.id);
      chainCards.push(buildSkillCard(cur, kind, true, dmgStats));
      cur = cur.flipSkill ? lookupSkill(cur.flipSkill) : null;
    }
  }

  el.hoverPreview.innerHTML = chainCards.join("");
  el.hoverPreview.classList.remove("hidden");
  positionHoverPreview(x, y);
}

function getHoverMetaLine(kind, entity) {
  if (kind === "trait") {
    const tier = Number(entity?.tier) || 0;
    return tier ? `Trait • ${tierLabel(tier)}` : "Trait";
  }
  if (kind === "equip-stat") return `Equipment • ${entity?.slot || ""}`.replace(/ • $/, "");
  if (kind === "equip-weapon") {
    const hand = entity?.hand;
    const handLabel = hand === "two" ? "Two-handed" : hand === "main" ? "Main Hand" : hand === "off" ? "Off Hand" : hand === "either" ? "One-handed" : hand === "aquatic" ? "Aquatic" : "";
    return handLabel ? `Weapon • ${handLabel}` : "Weapon";
  }
  if (kind === "equip-relic") return "Relic";
  if (kind === "spec") return entity?.elite ? "Elite Specialization" : "Specialization";
  const type = String(entity?.type || "").trim();
  const slot = String(entity?.slot || "").trim();
  const showSlot = slot && !/^(Profession|Weapon)_/i.test(slot) && !/^(Heal|Utility|Elite)$/i.test(slot);
  if (type && showSlot) return `Skill • ${type} • ${slot}`;
  if (type) return `Skill • ${type}`;
  return "Skill";
}

function positionHoverPreview(x, y) {
  const node = el.hoverPreview;
  if (!node || node.classList.contains("hidden")) return;
  const pad = 8;
  const offset = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = node.getBoundingClientRect();
  let left = Number(x) + offset;
  let top = Number(y) + offset;
  if (left + rect.width > vw - pad) {
    left = Number(x) - rect.width - offset;
  }
  if (top + rect.height > vh - pad) {
    top = Number(y) - rect.height - offset;
  }
  left = Math.max(pad, Math.min(left, vw - rect.width - pad));
  top = Math.max(46, Math.min(top, vh - rect.height - pad));
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

function hideHoverPreview() {
  el.hoverPreview.classList.add("hidden");
}

async function selectDetail(kind, entity) {
  if (!entity) return;
  const detail = {
    kind,
    kindLabel: kind === "trait" ? "Trait" : "Skill",
    title: entity.name || "Unknown",
    icon: entity.icon || "",
    iconFallback: entity.iconFallback || "",
    description: entity.description || "",
    facts: resolveEntityFacts(entity),
    wiki: { loading: true, summary: "", url: "" },
  };
  state.detail = detail;
  renderDetailPanel();

  const key = `${kind}:${String(entity.name || "").toLowerCase()}`;
  let wiki = state.wikiCache.get(key);
  if (!wiki) {
    try {
      wiki = await window.desktopApi.getWikiSummary(entity.name);
    } catch {
      wiki = { title: entity.name, summary: "", url: "", missing: true };
    }
    state.wikiCache.set(key, wiki);
  }
  if (state.detail === detail) {
    state.detail = {
      ...detail,
      wiki: {
        loading: false,
        summary: wiki?.summary || "",
        url: wiki?.url || "",
      },
    };
    renderDetailPanel();
  }
}

function getMajorTraitsByTier(spec, catalog) {
  const result = { 1: [], 2: [], 3: [] };
  for (const traitId of spec.majorTraits || []) {
    const trait = catalog.traitById.get(Number(traitId));
    if (!trait) continue;
    const tier = Number(trait.tier) || 0;
    if (!result[tier]) continue;
    result[tier].push(trait);
  }
  for (const tier of [1, 2, 3]) {
    result[tier].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }
  return result;
}

function getSkillOptionsByType(catalog, specializationSelections) {
  const selectedSpecIds = new Set(
    (specializationSelections || [])
      .map((entry) => Number(entry?.specializationId) || 0)
      .filter(Boolean)
  );

  const allSkills = Array.isArray(catalog.skills) ? catalog.skills : [];

  // Build a set of flip_skill IDs — in-combat replacement skills (e.g. "Detonate Turret",
  // "Steal Time") that are flip targets and should not appear as base equippable skills.
  const flipSkillIds = new Set(allSkills.flatMap((s) => s.flipSkill ? [s.flipSkill] : []));

  const filtered = allSkills.filter((skill) => {
    if (flipSkillIds.has(skill.id)) return false;
    const lockSpec = Number(skill.specialization) || 0;
    return !lockSpec || selectedSpecIds.has(lockSpec);
  });

  // Profession mechanic skills (F1–F5): slot is "Profession_1" ... "Profession_5"
  // Include unspecced ones plus those locked to a selected spec.
  // Exclude "Exit" / "Leave" variants (e.g. "Exit Reaper's Shroud", "Leave Beastmode") — these are
  // the toggle-off skill IDs that appear as bundleSkills children, not standalone F-slot entries.
  const exitLeavePattern = /^(Exit|Leave)\b/i;
  const profMechanics = allSkills
    .filter((skill) => /^Profession_\d/.test(skill.slot || ""))
    .filter((skill) => !exitLeavePattern.test(skill.name || ""))
    // Exclude flip targets unless they are explicitly in the profession endpoint.
    // Using inProfessionEndpoint (not flipParentIds) as the gate because mutual flip pairs
    // like Deadeye's Mark (43390) ↔ Steal Time would both pass a flipParentIds check, yet
    // "Steal Time" is a transient post-activation state that must not show as a permanent slot.
    .filter((skill) => !flipSkillIds.has(skill.id) || skill.inProfessionEndpoint)
    // Exclude skills that are not tied to any profession.
    .filter((skill) => (skill.professions || []).length > 0)
    // Thief: unspecialized Profession_2+ entries are transient stolen-result outcomes, not
    // permanent profession mechanics. Keep only slot-bound elite mechanics (Specter/Antiquary).
    .filter((skill) => {
      if (catalog?.profession?.id !== "Thief") return true;
      const match = /^Profession_(\d+)$/.exec(skill.slot || "");
      const slotNum = match ? Number(match[1]) : 0;
      if (slotNum <= 1) return true;
      return (Number(skill.specialization) || 0) > 0;
    })
    .filter((skill) => {
      const lockSpec = Number(skill.specialization) || 0;
      return !lockSpec || selectedSpecIds.has(lockSpec);
    })
    .sort((a, b) => {
      const na = parseInt((a.slot || "").replace("Profession_", ""), 10) || 0;
      const nb = parseInt((b.slot || "").replace("Profession_", ""), 10) || 0;
      return na - nb;
    });

  return {
    heal: filtered
      .filter((skill) => (skill.type || "").toLowerCase() === "heal")
      .sort((a, b) => a.name.localeCompare(b.name)),
    utility: filtered
      .filter((skill) => (skill.type || "").toLowerCase() === "utility")
      .sort((a, b) => a.name.localeCompare(b.name)),
    elite: filtered
      .filter((skill) => (skill.type || "").toLowerCase() === "elite")
      .sort((a, b) => a.name.localeCompare(b.name)),
    profession: profMechanics,
  };
}

function resolveSkillSlotType(slot) {
  if (slot.key === "healId") return "heal";
  if (slot.key === "eliteId") return "elite";
  return "utility";
}

function filterSkillList(list, query, selectedId) {
  const source = Array.isArray(list) ? list : [];
  if (!query) return source;
  const normalized = String(query || "").toLowerCase();
  const selected = source.find((skill) => Number(skill.id) === Number(selectedId)) || null;
  const filtered = source.filter((skill) => String(skill.name || "").toLowerCase().includes(normalized));
  if (selected && !filtered.some((skill) => Number(skill.id) === Number(selected.id))) {
    filtered.unshift(selected);
  }
  return filtered;
}

function renderCustomSelect(host, config = {}) {
  if (!host) return;
  const options = Array.isArray(config.options) ? config.options : [];
  const currentValue = String(config.value ?? "");
  const selectedOption =
    options.find((option) => String(option.value) === currentValue) ||
    options.find((option) => !option.disabled) ||
    options[0] ||
    null;

  host.innerHTML = "";
  host.classList.add("cselect-host");

  const root = document.createElement("div");
  root.className = `cselect ${String(config.className || "").trim()}`.trim();

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "cselect__trigger";
  trigger.disabled = Boolean(config.disabled) || !options.length;
  trigger.append(makeCustomSelectValueNode(selectedOption, config.placeholder || "Select"));

  const chevron = document.createElement("span");
  chevron.className = "cselect__chevron";
  chevron.textContent = "▾";
  trigger.append(chevron);

  const menu = document.createElement("div");
  menu.className = "cselect__menu";
  const list = document.createElement("div");
  list.className = "cselect__list";

  if (!options.length) {
    const empty = document.createElement("p");
    empty.className = "cselect__empty";
    empty.textContent = "No options";
    list.append(empty);
  } else {
    for (const option of options) {
      const button = document.createElement("button");
      button.type = "button";
      const isSelected = String(option.value) === String(selectedOption?.value ?? "");
      button.className = `cselect__option ${isSelected ? "cselect__option--selected" : ""}`;
      button.disabled = Boolean(option.disabled);
      button.append(makeCustomSelectValueNode(option, config.placeholder || "Select"));

      if (option.kind && option.entity) {
        bindHoverPreview(button, option.kind, () => option.entity);
      }

      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        closeCustomSelect();
        if (typeof config.onChange === "function") {
          Promise.resolve(config.onChange(option.value, option)).catch((err) => showError(err));
        }
      });
      list.append(button);
    }
  }

  menu.append(list);
  root.append(trigger, menu);
  host.append(root);

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleCustomSelect(root);
  });
}

function makeCustomSelectValueNode(option, placeholder) {
  const value = document.createElement("span");
  value.className = "cselect__value";
  value.append(makeCustomSelectIconNode(option));

  const text = document.createElement("span");
  text.className = "cselect__text";
  const label = document.createElement("span");
  label.className = "cselect__label";
  label.textContent = String(option?.label || placeholder || "Select");
  text.append(label);
  if (option?.meta) {
    const meta = document.createElement("span");
    meta.className = "cselect__meta";
    meta.textContent = String(option.meta);
    text.append(meta);
  }
  value.append(text);
  return value;
}

function makeCustomSelectIconNode(option) {
  if (option?.icon) {
    const img = document.createElement("img");
    img.className = "cselect__icon";
    img.src = String(option.icon);
    img.alt = `${String(option.label || "Option")} icon`;
    return img;
  }
  const fallback = document.createElement("span");
  fallback.className = "cselect__icon cselect__icon--fallback";
  const source = String(option?.iconText || option?.label || option?.meta || "?").trim();
  fallback.textContent = source ? source.slice(0, 1).toUpperCase() : "?";
  return fallback;
}

function getSelectAnchorRect(root) {
  // For spec overlays, always anchor to the visible emblem button
  const card = root.closest(".spec-card");
  if (card) {
    const emblem = card.querySelector(".spec-emblem");
    if (emblem) return emblem.getBoundingClientRect();
  }
  const trigger = root.querySelector(".cselect__trigger");
  return trigger?.getBoundingClientRect() ?? null;
}

function toggleCustomSelect(root) {
  if (!root) return;
  const currentlyOpen = state.openCustomSelect;
  if (currentlyOpen && currentlyOpen !== root) {
    currentlyOpen.classList.remove("cselect--open");
    resetCustomSelectMenuPosition(currentlyOpen.querySelector(".cselect__menu"));
  }
  const shouldOpen = !root.classList.contains("cselect--open");
  if (shouldOpen) {
    const menu = root.querySelector(".cselect__menu");
    const rect = getSelectAnchorRect(root);
    if (rect && menu) {
      const menuEstHeight = 300;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const dropUp = spaceBelow < menuEstHeight + 8 && spaceAbove > spaceBelow;
      menu.style.position = "fixed";
      menu.style.left = `${Math.min(rect.left, window.innerWidth - 200)}px`;
      menu.style.right = "auto";
      if (dropUp) {
        menu.style.top = "auto";
        menu.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      } else {
        menu.style.top = `${rect.bottom + 6}px`;
        menu.style.bottom = "auto";
      }
    }
  } else {
    resetCustomSelectMenuPosition(root.querySelector(".cselect__menu"));
  }
  root.classList.toggle("cselect--open", shouldOpen);
  state.openCustomSelect = shouldOpen ? root : null;
}

function resetCustomSelectMenuPosition(menu) {
  if (!menu) return;
  menu.style.position = "";
  menu.style.top = "";
  menu.style.bottom = "";
  menu.style.left = "";
  menu.style.right = "";
}

function closeCustomSelect() {
  const open = state.openCustomSelect;
  if (!open) return;
  if (open.isConnected) {
    open.classList.remove("cselect--open");
    resetCustomSelectMenuPosition(open.querySelector(".cselect__menu"));
  }
  state.openCustomSelect = null;
}

function confirmDiscardDirty(actionLabel) {
  if (!state.editorDirty) return true;
  return window.confirm(`Unsaved changes will be lost. ${actionLabel}?`);
}

function markEditorChanged(options = {}) {
  state.editorDirty = computeEditorSignature() !== state.editorBaselineSignature;
  if (options.updateBuildList) {
    renderBuildList();
  }
  if (options.updateMeta !== false) {
    renderEditorMeta();
  }
}

function captureEditorBaseline() {
  state.editorBaselineSignature = computeEditorSignature();
  state.editorDirty = false;
  renderEditorMeta();
}

function computeEditorSignature() {
  const editor = state.editor || createEmptyEditor();
  const specializations = (editor.specializations || []).slice(0, 3).map((entry) => ({
    specializationId: Number(entry?.specializationId) || 0,
    majorChoices: {
      1: Number(entry?.majorChoices?.[1]) || 0,
      2: Number(entry?.majorChoices?.[2]) || 0,
      3: Number(entry?.majorChoices?.[3]) || 0,
    },
  }));
  const utilityIds = Array.isArray(editor.skills?.utilityIds)
    ? editor.skills.utilityIds.slice(0, 3).map((value) => Number(value) || 0)
    : [0, 0, 0];
  while (utilityIds.length < 3) utilityIds.push(0);
  const payload = {
    title: String(editor.title || ""),
    profession: String(editor.profession || ""),
    tags: parseTags(editor.tagsText),
    notes: String(editor.notes || ""),
    equipment: {
      statPackage: String(editor.equipment?.statPackage || ""),
      runeSet: String(editor.equipment?.runeSet || ""),
      relic: String(editor.equipment?.relic || ""),
      food: String(editor.equipment?.food || ""),
      utility: String(editor.equipment?.utility || ""),
      slots: editor.equipment?.slots || {},
      weapons: editor.equipment?.weapons || {},
    },
    specializations,
    skills: {
      healId: Number(editor.skills?.healId) || 0,
      utilityIds,
      eliteId: Number(editor.skills?.eliteId) || 0,
    },
  };
  return JSON.stringify(payload);
}

function parseBuildImportPayload(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Clipboard does not contain valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Imported JSON must be an object.");
  }
  const source = parsed.build && typeof parsed.build === "object" ? parsed.build : parsed;
  const profession = resolveImportedProfession(source);
  const skills = normalizeImportedSkills(source);
  const specializations = normalizeImportedSpecializations(source.specializations);
  const notes = String(source.notes || source.description || "");
  const tags = Array.isArray(source.tags)
    ? source.tags
    : typeof source.tagsText === "string"
      ? parseTags(source.tagsText)
      : [];
  return {
    id: "",
    title: String(source.title || source.name || "Imported Build"),
    profession,
    tags,
    notes,
    equipment: {
      statPackage: String(source.equipment?.statPackage || source.stats || ""),
      runeSet: String(source.equipment?.runeSet || source.runes || ""),
      relic: String(source.equipment?.relic || ""),
      food: String(source.equipment?.food || ""),
      utility: String(source.equipment?.utility || ""),
      slots: {
        head: String(source.equipment?.slots?.head || ""),
        shoulders: String(source.equipment?.slots?.shoulders || ""),
        chest: String(source.equipment?.slots?.chest || ""),
        hands: String(source.equipment?.slots?.hands || ""),
        legs: String(source.equipment?.slots?.legs || ""),
        feet: String(source.equipment?.slots?.feet || ""),
        mainhand1: String(source.equipment?.slots?.mainhand1 || ""),
        offhand1: String(source.equipment?.slots?.offhand1 || ""),
        mainhand2: String(source.equipment?.slots?.mainhand2 || ""),
        offhand2: String(source.equipment?.slots?.offhand2 || ""),
        back: String(source.equipment?.slots?.back || ""),
        amulet: String(source.equipment?.slots?.amulet || ""),
        ring1: String(source.equipment?.slots?.ring1 || ""),
        ring2: String(source.equipment?.slots?.ring2 || ""),
        accessory1: String(source.equipment?.slots?.accessory1 || ""),
        accessory2: String(source.equipment?.slots?.accessory2 || ""),
        breather: String(source.equipment?.slots?.breather || ""),
        aquatic1: String(source.equipment?.slots?.aquatic1 || ""),
        aquatic2: String(source.equipment?.slots?.aquatic2 || ""),
      },
      weapons: {
        mainhand1: String(source.equipment?.weapons?.mainhand1 || ""),
        offhand1:  String(source.equipment?.weapons?.offhand1  || ""),
        mainhand2: String(source.equipment?.weapons?.mainhand2 || ""),
        offhand2:  String(source.equipment?.weapons?.offhand2  || ""),
        aquatic1:  String(source.equipment?.weapons?.aquatic1  || ""),
        aquatic2:  String(source.equipment?.weapons?.aquatic2  || ""),
      },
    },
    specializations,
    skills,
  };
}

function resolveImportedProfession(source) {
  const raw = String(source?.profession || source?.professionId || source?.professionName || "").trim();
  if (!raw) return state.editor.profession || state.professions[0]?.id || "";
  if (state.professions.some((entry) => entry.id === raw)) return raw;
  const lower = raw.toLowerCase();
  const byName = state.professions.find((entry) => entry.name.toLowerCase() === lower);
  return byName?.id || raw;
}

function normalizeImportedSpecializations(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((entry) => ({
    id: Number(entry?.id || entry?.specializationId) || 0,
    specializationId: Number(entry?.specializationId || entry?.id) || 0,
    majorChoices: {
      1: Number(entry?.majorChoices?.[1] || entry?.majorChoices?.adept) || 0,
      2: Number(entry?.majorChoices?.[2] || entry?.majorChoices?.master) || 0,
      3: Number(entry?.majorChoices?.[3] || entry?.majorChoices?.grandmaster) || 0,
    },
  }));
}

function normalizeImportedSkills(source) {
  const skills = source?.skills && typeof source.skills === "object" ? source.skills : {};
  const healId = extractSkillId(skills.healId ?? skills.heal ?? source?.healId);
  const eliteId = extractSkillId(skills.eliteId ?? skills.elite ?? source?.eliteId);
  const utilityRaw = Array.isArray(skills.utilityIds)
    ? skills.utilityIds
    : Array.isArray(skills.utility)
      ? skills.utility
      : Array.isArray(source?.utilityIds)
        ? source.utilityIds
        : [];
  const utilityIds = utilityRaw
    .slice(0, 3)
    .map((entry) => extractSkillId(entry))
    .filter((value) => value > 0);
  return {
    heal: healId ? { id: healId } : null,
    utility: utilityIds.map((id) => ({ id })),
    elite: eliteId ? { id: eliteId } : null,
  };
}

function extractSkillId(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number" || typeof value === "string") return Number(value) || 0;
  if (typeof value === "object") {
    return Number(value.id || value.skillId || value.value) || 0;
  }
  return 0;
}

async function reloadBuilds() {
  state.builds = await window.desktopApi.listBuilds();
  renderBuildList();
}

async function loadBuildIntoEditor(build, options = {}) {
  const profession = resolveLoadedBuildProfession(build);
  state.editor = {
    id: build.id || "",
    title: String(build.title || ""),
    profession,
    tagsText: Array.isArray(build.tags) ? build.tags.join(", ") : "",
    notes: String(build.notes || ""),
    equipment: {
      statPackage: String(build.equipment?.statPackage || ""),
      runeSet: String(build.equipment?.runeSet || ""),
      relic: String(build.equipment?.relic || ""),
      food: String(build.equipment?.food || ""),
      utility: String(build.equipment?.utility || ""),
      slots: {
        head: String(build.equipment?.slots?.head || ""),
        shoulders: String(build.equipment?.slots?.shoulders || ""),
        chest: String(build.equipment?.slots?.chest || ""),
        hands: String(build.equipment?.slots?.hands || ""),
        legs: String(build.equipment?.slots?.legs || ""),
        feet: String(build.equipment?.slots?.feet || ""),
        mainhand1: String(build.equipment?.slots?.mainhand1 || ""),
        offhand1: String(build.equipment?.slots?.offhand1 || ""),
        mainhand2: String(build.equipment?.slots?.mainhand2 || ""),
        offhand2: String(build.equipment?.slots?.offhand2 || ""),
        back: String(build.equipment?.slots?.back || ""),
        amulet: String(build.equipment?.slots?.amulet || ""),
        ring1: String(build.equipment?.slots?.ring1 || ""),
        ring2: String(build.equipment?.slots?.ring2 || ""),
        accessory1: String(build.equipment?.slots?.accessory1 || ""),
        accessory2: String(build.equipment?.slots?.accessory2 || ""),
        breather: String(build.equipment?.slots?.breather || ""),
        aquatic1: String(build.equipment?.slots?.aquatic1 || ""),
        aquatic2: String(build.equipment?.slots?.aquatic2 || ""),
      },
      weapons: {
        mainhand1: String(build.equipment?.weapons?.mainhand1 || ""),
        offhand1:  String(build.equipment?.weapons?.offhand1  || ""),
        mainhand2: String(build.equipment?.weapons?.mainhand2 || ""),
        offhand2:  String(build.equipment?.weapons?.offhand2  || ""),
        aquatic1:  String(build.equipment?.weapons?.aquatic1  || ""),
        aquatic2:  String(build.equipment?.weapons?.aquatic2  || ""),
      },
    },
    specializations: Array.isArray(build.specializations)
      ? build.specializations.slice(0, 3).map((entry) => ({
          specializationId: Number(entry?.id) || Number(entry?.specializationId) || 0,
          majorChoices: {
            1: Number(entry?.majorChoices?.[1]) || 0,
            2: Number(entry?.majorChoices?.[2]) || 0,
            3: Number(entry?.majorChoices?.[3]) || 0,
          },
        }))
      : [],
    skills: {
      healId: Number(build.skills?.heal?.id) || 0,
      utilityIds: Array.isArray(build.skills?.utility)
        ? build.skills.utility.slice(0, 3).map((entry) => Number(entry?.id) || 0)
        : [0, 0, 0],
      eliteId: Number(build.skills?.elite?.id) || 0,
    },
    activeAttunement: "",
    activeAttunement2: "",
    activeKit: 0,
    activeWeaponSet: 1,
    antiquaryArtifacts: { f2: 0, f3: 0, f4: 0 },
    morphSkillIds: Array.isArray(build.morphSkillIds)
      ? build.morphSkillIds.slice(0, 3).map(Number)
      : [0, 0, 0],
    selectedLegends: Array.isArray(build.selectedLegends)
      ? build.selectedLegends.slice(0, 2).map(String)
      : ["", ""],
    activeLegendSlot: Number(build.activeLegendSlot) || 0,
    selectedPets: {
      terrestrial1: Number(build.selectedPets?.terrestrial1) || 0,
      terrestrial2: Number(build.selectedPets?.terrestrial2) || 0,
      aquatic1: Number(build.selectedPets?.aquatic1) || 0,
      aquatic2: Number(build.selectedPets?.aquatic2) || 0,
    },
    activePetSlot: build.activePetSlot === "terrestrial2" ? "terrestrial2" : "terrestrial1",
  };

  if (profession) {
    await setProfession(profession, { preserveSelections: true });
  }
  enforceEditorConsistency();
  if (options.captureBaseline !== false) {
    captureEditorBaseline();
  } else {
    markEditorChanged();
  }
}

function resolveLoadedBuildProfession(build) {
  const raw = String(build?.profession || "").trim();
  if (raw && state.professions.some((entry) => entry.id === raw)) return raw;
  if (raw) {
    const byName = state.professions.find((entry) => entry.name.toLowerCase() === raw.toLowerCase());
    if (byName) return byName.id;
  }
  return state.professions[0]?.id || "";
}

function serializeEditorToBuild() {
  const catalog = state.activeCatalog;
  const specById = catalog?.specializationById || new Map();
  const traitById = catalog?.traitById || new Map();
  const skillById = catalog?.skillById || new Map();

  const specializations = (state.editor.specializations || []).map((entry) => {
    const spec = specById.get(Number(entry.specializationId));
    const majorTraitsByTier = spec ? getMajorTraitsByTier(spec, catalog) : { 1: [], 2: [], 3: [] };
    return {
      id: Number(spec?.id || entry.specializationId || 0),
      name: spec?.name || "",
      elite: Boolean(spec?.elite),
      icon: spec?.icon || "",
      background: spec?.background || "",
      minorTraits: (spec?.minorTraits || []).map((traitId) => simplifyTrait(traitById.get(Number(traitId)))),
      majorChoices: {
        1: Number(entry.majorChoices?.[1]) || 0,
        2: Number(entry.majorChoices?.[2]) || 0,
        3: Number(entry.majorChoices?.[3]) || 0,
      },
      majorTraitsByTier: {
        1: (majorTraitsByTier[1] || []).map((trait) => simplifyTrait(trait)),
        2: (majorTraitsByTier[2] || []).map((trait) => simplifyTrait(trait)),
        3: (majorTraitsByTier[3] || []).map((trait) => simplifyTrait(trait)),
      },
    };
  });

  const heal = simplifySkill(skillById.get(Number(state.editor.skills.healId)));
  const elite = simplifySkill(skillById.get(Number(state.editor.skills.eliteId)));
  const utility = (state.editor.skills.utilityIds || [])
    .slice(0, 3)
    .map((skillId) => simplifySkill(skillById.get(Number(skillId))))
    .filter(Boolean);

  return {
    id: state.editor.id || undefined,
    title: String(state.editor.title || "Untitled Build"),
    profession: String(state.editor.profession || ""),
    specializations,
    skills: {
      heal,
      utility,
      elite,
    },
    equipment: {
      statPackage: String(state.editor.equipment.statPackage || ""),
      runeSet: String(state.editor.equipment.runeSet || ""),
      relic: String(state.editor.equipment.relic || ""),
      food: String(state.editor.equipment.food || ""),
      utility: String(state.editor.equipment.utility || ""),
      slots: {
        head: String(state.editor.equipment.slots?.head || ""),
        shoulders: String(state.editor.equipment.slots?.shoulders || ""),
        chest: String(state.editor.equipment.slots?.chest || ""),
        hands: String(state.editor.equipment.slots?.hands || ""),
        legs: String(state.editor.equipment.slots?.legs || ""),
        feet: String(state.editor.equipment.slots?.feet || ""),
        mainhand1: String(state.editor.equipment.slots?.mainhand1 || ""),
        offhand1: String(state.editor.equipment.slots?.offhand1 || ""),
        mainhand2: String(state.editor.equipment.slots?.mainhand2 || ""),
        offhand2: String(state.editor.equipment.slots?.offhand2 || ""),
        back: String(state.editor.equipment.slots?.back || ""),
        amulet: String(state.editor.equipment.slots?.amulet || ""),
        ring1: String(state.editor.equipment.slots?.ring1 || ""),
        ring2: String(state.editor.equipment.slots?.ring2 || ""),
        accessory1: String(state.editor.equipment.slots?.accessory1 || ""),
        accessory2: String(state.editor.equipment.slots?.accessory2 || ""),
        breather: String(state.editor.equipment.slots?.breather || ""),
        aquatic1: String(state.editor.equipment.slots?.aquatic1 || ""),
        aquatic2: String(state.editor.equipment.slots?.aquatic2 || ""),
      },
      weapons: {
        mainhand1: String(state.editor.equipment.weapons?.mainhand1 || ""),
        offhand1:  String(state.editor.equipment.weapons?.offhand1  || ""),
        mainhand2: String(state.editor.equipment.weapons?.mainhand2 || ""),
        offhand2:  String(state.editor.equipment.weapons?.offhand2  || ""),
        aquatic1:  String(state.editor.equipment.weapons?.aquatic1  || ""),
        aquatic2:  String(state.editor.equipment.weapons?.aquatic2  || ""),
      },
    },
    tags: parseTags(state.editor.tagsText),
    notes: String(state.editor.notes || ""),
    morphSkillIds: Array.isArray(state.editor.morphSkillIds)
      ? state.editor.morphSkillIds.map(Number)
      : [0, 0, 0],
    selectedLegends: Array.isArray(state.editor.selectedLegends)
      ? state.editor.selectedLegends.slice(0, 2).map(String)
      : ["", ""],
    activeLegendSlot: Number(state.editor.activeLegendSlot) || 0,
    selectedPets: {
      terrestrial1: Number(state.editor.selectedPets?.terrestrial1) || 0,
      terrestrial2: Number(state.editor.selectedPets?.terrestrial2) || 0,
      aquatic1: Number(state.editor.selectedPets?.aquatic1) || 0,
      aquatic2: Number(state.editor.selectedPets?.aquatic2) || 0,
    },
    activePetSlot: state.editor.activePetSlot === "terrestrial2" ? "terrestrial2" : "terrestrial1",
  };
}

function simplifyTrait(trait) {
  if (!trait) return null;
  return {
    id: Number(trait.id) || 0,
    name: String(trait.name || ""),
    icon: String(trait.icon || ""),
    description: String(trait.description || ""),
    tier: Number(trait.tier) || 0,
  };
}

function simplifySkill(skill) {
  if (!skill) return null;
  return {
    id: Number(skill.id) || 0,
    name: String(skill.name || ""),
    icon: String(skill.icon || ""),
    description: String(skill.description || ""),
    slot: String(skill.slot || ""),
    type: String(skill.type || ""),
    specialization: Number(skill.specialization) || 0,
  };
}

function parseTags(input) {
  return String(input || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function runPagesBuildPoll() {
  state.pagesPoll.active = true;
  state.pagesPoll.status = "queued";
  state.pagesPoll.error = null;
  renderSetupGate();

  try {
    for (let i = 0; i < 120; i += 1) {
      const poll = await window.desktopApi.pollPagesStatus();
      state.pagesPoll.status = poll.status || "unknown";
      state.pagesPoll.error = poll.error || null;
      renderSetupGate();

      if (poll.ready && poll.pagesUrl) return;
      if (poll.status === "errored" || poll.status === "error") {
        throw new Error(poll.error || "GitHub Pages build failed.");
      }
      await delay(3000);
    }
    throw new Error("Timed out waiting for GitHub Pages to finish building.");
  } finally {
    state.pagesPoll.active = false;
    renderSetupGate();
  }
}

async function startLoginFlow() {
  state.loginFlow.pending = true;
  state.loginFlow.waitingForApproval = true;
  renderSetupGate();
  try {
    const beginData = await window.desktopApi.beginLogin();
    state.loginFlow.beginData = beginData;
    renderSetupGate();
    await window.desktopApi.completeLogin(beginData);
  } finally {
    state.loginFlow.waitingForApproval = false;
    state.loginFlow.pending = false;
  }
}

function makeButton(label, variant, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.className = `btn btn-${variant}`;
  btn.addEventListener("click", onClick);
  return btn;
}

function getSelectedTarget() {
  if (!state.targets.length) return null;
  return state.selectedTarget || state.targets[0];
}

function tierLabel(tier) {
  if (tier === 1) return "Adept";
  if (tier === 2) return "Master";
  return "Grandmaster";
}

function formatPagesStatus(status) {
  if (!status) return "unknown";
  if (status === "queued") return "Queued";
  if (status === "building") return "Building";
  if (status === "built") return "Built";
  if (status === "errored" || status === "error") return "Error";
  return status;
}

function setPublishStatus(message) {
  el.publishStatus.textContent = message || "";
}

function matchesBuildQuery(build, query) {
  if (!query) return true;
  const haystack = [
    build.title || "",
    build.profession || "",
    build.notes || "",
    ...(build.tags || []),
    ...((build.specializations || []).map((entry) => entry.name || "")),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function createEmptyEditor(profession = "") {
  return {
    id: "",
    title: "",
    profession,
    tagsText: "",
    notes: "",
    equipment: {
      statPackage: "",
      runeSet: "",
      relic: "",
      food: "",
      utility: "",
      slots: {
        head: "", shoulders: "", chest: "", hands: "", legs: "", feet: "",
        mainhand1: "", offhand1: "", mainhand2: "", offhand2: "",
        back: "", amulet: "", ring1: "", ring2: "", accessory1: "", accessory2: "",
        breather: "", aquatic1: "", aquatic2: "",
      },
      weapons: {
        mainhand1: "", offhand1: "", mainhand2: "", offhand2: "", aquatic1: "", aquatic2: "",
      },
    },
    specializations: [],
    skills: {
      healId: 0,
      utilityIds: [0, 0, 0],
      eliteId: 0,
    },
    activeAttunement: "",
    activeAttunement2: "",
    activeKit: 0,
    activeWeaponSet: 1,
    morphSkillIds: [0, 0, 0],
    // Revenant: two legend slots (active/inactive), identified by legend string ID (e.g. "Legend1")
    selectedLegends: ["", ""],
    activeLegendSlot: 0,           // 0 = first legend active, 1 = second legend active
    // Ranger/Soulbeast: two pet slots (terrestrial + aquatic) per legend slot (A/B)
    selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
    activePetSlot: "terrestrial1",  // "terrestrial1" or "terrestrial2"
    allianceTacticsForm: 0,         // Vindicator: 0 = Archemorus/Kurzick, 1 = Saint Viktor/Luxon
    antiquaryArtifacts: { f2: 0, f3: 0, f4: 0 }, // Antiquary: stored artifact draws (0 = not yet drawn)
  };
}

function formatDate(value) {
  if (!value) return "unknown";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString();
}

function formatBuffConditionText(fact) {
  const name = String(fact.status || fact.text || "Unknown");
  const count = Number(fact.apply_count) || 0;
  const stackPart = count > 1 ? ` ×${count}` : "";
  const duration = fact.duration != null ? ` (${fact.duration}s)` : "";
  return `${name}${stackPart}${duration}`;
}

function formatFact(fact, dmgStats = null) {
  if (!fact || typeof fact !== "object") return "Unknown fact";
  const label = String(fact.text || fact.type || "Fact");
  if (fact.type === "Damage" && fact.dmg_multiplier != null) {
    const hits = Number(fact.hit_count) || 1;
    const coeff = (Number(fact.dmg_multiplier) * hits).toFixed(2);
    let text = hits > 1 ? `${label}: ×${coeff} (${hits} hits)` : `${label}: ×${coeff}`;
    if (dmgStats) {
      const dmg = Math.round(dmgStats.weaponStrength * dmgStats.effectivePower * Number(fact.dmg_multiplier) * hits / 2597);
      text += ` ≈ ${dmg.toLocaleString()}`;
    }
    return text;
  }
  if (BUFF_FACT_TYPES.has(fact.type)) return formatBuffConditionText(fact);
  const value =
    fact.value ??
    fact.percent ??
    fact.distance ??
    fact.duration ??
    fact.hit_count ??
    fact.apply_count ??
    fact.status ??
    fact.description ??
    "";
  return value === "" ? label : `${label}: ${value}`;
}

// Render CDN icon URLs for boons and conditions, used as fallback when fact.icon is absent.
const _RW_BOONS = `${_RW}`;
const BOON_CONDITION_ICONS = {
  // Boons
  Aegis:          `${_RW_BOONS}/DFB4D1B50AE4D6A275B349E15B179261EE3EB0AF/102854.png`,
  Alacrity:       `${_RW_BOONS}/4FDAC2113B500104121753EF7E026E45C141E94D/1938787.png`,
  Fury:           `${_RW_BOONS}/96D90DF84CAFE008233DD1C2606A12C1A0E68048/102842.png`,
  Might:          `${_RW_BOONS}/2FA9DF9D6BC17839BBEA14723F1C53D645DDB5E1/102852.png`,
  Protection:     `${_RW_BOONS}/CD77D1FAB7B270223538A8F8ECDA1CFB044D65F4/102834.png`,
  Quickness:      `${_RW_BOONS}/D4AB6401A6D6917C3D4F230764452BCCE1035B0D/1012835.png`,
  Regeneration:   `${_RW_BOONS}/F69996772B9E18FD18AD0AABAB25D7E3FC42F261/102835.png`,
  Resistance:     `${_RW_BOONS}/50BAC1B8E10CFAB9E749A5D910D4A9DCF29EBB7C/961398.png`,
  Resolution:     `${_RW_BOONS}/D104A6B9344A2E2096424A3C300E46BC2926E4D7/2440718.png`,
  Stability:      `${_RW_BOONS}/3D3A1C2D6D791C05179AB871902D28782C65C244/415959.png`,
  Swiftness:      `${_RW_BOONS}/20CFC14967E67F7A3FD4A4B8722B4CF5B8565E11/102836.png`,
  Vigor:          `${_RW_BOONS}/58E92EBAF0DB4DA7C4AC04D9B22BCA5ECF0100DE/102843.png`,
  // Conditions
  Bleeding:       `${_RW_BOONS}/79FF0046A5F9ADA3B4C4EC19ADB4CB124D5F0021/102848.png`,
  Blinded:        `${_RW_BOONS}/09770136BB76FD0DBE1CC4267DEED54774CB20F6/102837.png`,
  Burning:        `${_RW_BOONS}/B47BF5803FED2718D7474EAF9617629AD068EE10/102849.png`,
  Chilled:        `${_RW_BOONS}/28C4EC547A3516AF0242E826772DA43A5EAC3DF3/102839.png`,
  Confusion:      `${_RW_BOONS}/289AA0A4644F0E044DED3D3F39CED958E1DDFF53/102880.png`,
  Crippled:       `${_RW_BOONS}/070325E519C178D502A8160523766070D30C0C19/102838.png`,
  Fear:           `${_RW_BOONS}/30307A6E766D74B6EB09EDA12A4A2DE50E4D76F4/102869.png`,
  Immobile:       `${_RW_BOONS}/397A613651BFCA2832B6469CE34735580A2C120E/102844.png`,
  Poisoned:       `${_RW_BOONS}/559B0AF9FB5E1243D2649FAAE660CCB338AACC19/102840.png`,
  Slow:           `${_RW_BOONS}/F60D1EF5271D7B9319610855676D320CD25F01C6/961397.png`,
  Taunt:          `${_RW_BOONS}/02EED459AD65FAF7DF32A260E479C625070841B9/1228472.png`,
  Torment:        `${_RW_BOONS}/10BABF2708CA3575730AC662A2E72EC292565B08/598887.png`,
  Vulnerability:  `${_RW_BOONS}/3A394C1A0A3257EB27A44842DDEEF0DF000E1241/102850.png`,
  Weakness:       `${_RW_BOONS}/6CB0E64AF9AA292E332A38C1770CE577E2CDE0E8/102853.png`,
};

// Fact types where the icon represents the boon/condition being applied.
const BUFF_FACT_TYPES = new Set(["Buff", "ApplyBuffCondition", "PrefixedBuff"]);

function formatFactHtml(fact, dmgStats = null) {
  if (!fact || typeof fact !== "object") return "Unknown fact";
  // NoData facts are section headers (e.g. conditional legend-stance effects).
  if (fact.type === "NoData") {
    return `<span class="fact-section-header">${escapeHtml(String(fact.text || ""))}</span>`;
  }
  if (fact.type === "Damage" && fact.dmg_multiplier != null) {
    const label = String(fact.text || fact.type || "Fact");
    const hits = Number(fact.hit_count) || 1;
    const coeff = (Number(fact.dmg_multiplier) * hits).toFixed(2);
    let text = hits > 1 ? `${label}: ×${coeff} (${hits} hits)` : `${label}: ×${coeff}`;
    if (dmgStats) {
      const dmg = Math.round(dmgStats.weaponStrength * dmgStats.effectivePower * Number(fact.dmg_multiplier) * hits / 2597);
      text += ` ≈ ${dmg.toLocaleString()}`;
    }
    const iconUrl = fact.icon || "";
    return iconUrl ? `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml(text)}` : escapeHtml(text);
  }
  if (BUFF_FACT_TYPES.has(fact.type)) {
    const text = formatBuffConditionText(fact);
    const iconUrl = fact.icon || (fact.status && BOON_CONDITION_ICONS[fact.status]) || "";
    return iconUrl ? `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml(text)}` : escapeHtml(text);
  }
  // AttributeConversion: converts a % of one attribute into another (e.g. Precision → Ferocity).
  // API fields: source, target, percent. text is often the raw type name.
  // Detect by structure (source + target present) as well as by type — the API sometimes
  // omits or varies the type field for these facts.
  if (fact.type === "AttributeConversion" || (fact.source && fact.target)) {
    const toWords = (s) => String(s || "").replace(/([A-Z])/g, " $1").trim();
    const source = toWords(fact.source);
    const target = toWords(fact.target);
    const pct = fact.percent ?? "";
    const label = source && target
      ? `Gain ${target} Based on a Percentage of ${source}`
      : (fact.text && fact.text !== "AttributeConversion" ? fact.text : "Attribute Conversion");
    const text = pct === "" ? label : `${label}: ${pct}%`;
    const iconUrl = fact.icon || "";
    return iconUrl ? `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml(text)}` : escapeHtml(text);
  }
  // AttributeAdjust: the API sometimes gives the raw type name as text instead of a
  // human-readable label. Build one from the target attribute (e.g. "ConditionDamage" → "Condition Damage").
  if (fact.type === "AttributeAdjust") {
    const rawTarget = String(fact.target || "");
    const targetLabel = rawTarget.replace(/([A-Z])/g, " $1").trim();
    const label = (fact.text && fact.text !== "AttributeAdjust") ? fact.text : (targetLabel || "Attribute");
    const val = fact.value ?? "";
    const text = val === "" ? label : `${label}: ${val > 0 ? "+" : ""}${val}`;
    const iconUrl = fact.icon || "";
    return iconUrl ? `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml(text)}` : escapeHtml(text);
  }
  const label = String(fact.text || fact.type || "Fact");
  const value =
    fact.value ??
    fact.percent ??
    fact.distance ??
    fact.duration ??
    fact.hit_count ??
    fact.apply_count ??
    fact.status ??
    fact.description ??
    "";
  const text = value === "" ? label : `${label}: ${value}`;
  const iconUrl = fact.icon || "";
  if (!iconUrl) return escapeHtml(text);
  return `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml(text)}`;
}

function normalizeText(input) {
  const raw = String(input || "");
  const noTags = raw.replace(/<[^>]*>/g, " ");
  const entityDecoded = decodeHtmlEntities(noTags);
  return entityDecoded.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  const node = document.createElement("textarea");
  node.innerHTML = String(value || "");
  return node.value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function showError(err) {
  const message = err instanceof Error ? err.message : String(err);
  setPublishStatus(`Error: ${message}`);
  await window.desktopApi.showError("GW2Builds Error", message);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports.__testOnly = {
    buildMechanicSlotsForRender,
    buildRevenantEliteByProfSlot,
    getSkillOptionsByType,
    getEquippedWeaponSkills,
    resolveEntityFacts,
    _state: state,
  };
}
