// GW2Builds Renderer — Entry Point
// Imports all feature modules and wires them together via init callbacks.
// Application-level orchestration (init, wireEvents, setProfession, etc.) lives here.

import { state, createEmptyEditor } from "./modules/state.js";
import { delay } from "./modules/utils.js";

let _lastGameMode = "pve";
import { initCustomSelect, closeCustomSelect } from "./modules/custom-select.js";
import {
  initDetailPanel, bindHoverPreview, hideHoverPreview,
  renderDetailPanel, selectDetail,
} from "./modules/detail-panel.js";
import {
  initSpecializations, initSpecializationsCallbacks, renderSpecializations,
} from "./modules/specializations.js";
import {
  initSkills, initSkillsCallbacks, renderSkills, syncRevenantSkillsFromLegend,
  buildMechanicSlotsForRender, getSkillOptionsByType, getEquippedWeaponSkills,
  buildRevenantEliteByProfSlot,
} from "./modules/skills.js";
import {
  initEquipment, initEquipmentCallbacks, renderEquipmentPanel, openSlotPicker,
} from "./modules/equipment.js";
import {
  initEditorCallbacks, enforceEditorConsistency, markEditorChanged, captureEditorBaseline,
  loadBuildIntoEditor, serializeEditorToBuild, parseBuildImportPayload, confirmDiscardDirty,
  createDefaultSpecializationSelections, createDefaultSkillSelections,
  computeEditorSignature,
} from "./modules/editor.js";
import {
  initRenderPagesDom, initRenderPagesCallbacks,
  render, renderEditor, renderEditorForm, renderEditorMeta, renderBuildList,
  setPublishStatus, showError, runPagesBuildPoll, getSelectedTarget,
} from "./modules/render-pages.js";
import { resolveEntityFacts } from "./modules/detail-panel.js";

// ── DOM element cache ────────────────────────────────────────────────────────

function q(selector) {
  return typeof document !== "undefined" ? document.querySelector(selector) : null;
}

const el = {
  setupGate:         q("#setupGate"),
  authRow:           q("#authRow"),
  onboarding:        q("#onboarding"),
  workspaceBtn:      q("#workspaceBtn"),
  workspaceMenu:     q("#workspaceMenu"),
  subnav:            q("#subnav"),
  appLayout:         q(".app-layout"),
  buildList:         q("#buildList"),
  buildSearch:       q("#buildSearch"),
  editorTitle:       q("#editorTitle"),
  professionSelect:  q("#professionSelect"),
  tagsInput:         q("#tagsInput"),
  equipmentPanel:    q("#equipmentPanel"),
  newBuildBtn:       q("#newBuildBtn"),
  saveBuildBtn:      q("#saveBuildBtn"),
  duplicateBuildBtn: q("#duplicateBuildBtn"),
  copyBuildBtn:      q("#copyBuildBtn"),
  pasteBuildBtn:     q("#pasteBuildBtn"),
  editorDirtyBadge:  q("#editorDirtyBadge"),
  buildSummary:      q("#buildSummary"),
  publishSiteBtn:    q("#publishSiteBtn"),
  specializationsHost: q("#specializationsHost"),
  skillsHost:        q("#skillsHost"),
  detailHost:        q("#detailHost"),
  publishStatus:     q("#publishStatus"),
  hoverPreview:      q("#hoverPreview"),
  winMin:            q("#winMin"),
  winMax:            q("#winMax"),
  winClose:          q("#winClose"),
  titlebar:          q("#titlebar"),
};

// ── Module initialization ────────────────────────────────────────────────────
// Pass DOM refs and cross-module callbacks to all feature modules.

initCustomSelect({ bindHoverPreview, onError: showError });

initDetailPanel({ detailHost: el.detailHost, hoverPreview: el.hoverPreview });

initSpecializations({ specializationsHost: el.specializationsHost });
initSpecializationsCallbacks({
  enforceEditorConsistency,
  markEditorChanged,
  renderEditor,
  renderSkills,
});

initSkills({ skillsHost: el.skillsHost });
initSkillsCallbacks({
  renderEditor,
  markEditorChanged,
  enforceEditorConsistency,
  openSlotPicker,
});

initEquipment({ equipmentPanel: el.equipmentPanel });
initEquipmentCallbacks({
  markEditorChanged,
  render,
  renderSkills,
});

initEditorCallbacks({
  render,
  renderEditorMeta,
  renderSpecializations,
  renderSkills,
  renderEquipmentPanel,
  syncRevenantSkillsFromLegend,
  getSkillOptionsByType,
  setProfession: (id, opts) => setProfession(id, opts),
  reloadBuilds,
  renderBuildList,
});

initRenderPagesDom(el);
initRenderPagesCallbacks({
  refreshOnboardingStatus,
  confirmDiscardDirty,
  loadBuildIntoEditor,
  reloadBuilds,
  setProfession: (id, opts) => setProfession(id, opts),
  captureEditorBaseline,
  markEditorChanged,
  renderSpecializations,
  renderSkills,
  renderEquipmentPanel,
  renderDetailPanel,
  serializeEditorToBuild,
  parseBuildImportPayload,
  enforceEditorConsistency,
  startNewBuild,
  saveCurrentBuild,
  duplicateCurrentBuild,
  copyBuildJsonToClipboard,
  importBuildJsonFromClipboard,
  runPagesBuildPoll,
  showError,
  setPublishStatus,
});

// ── Entry point ──────────────────────────────────────────────────────────────

if (typeof window !== "undefined" && !window.__GW2_RENDERER_TEST__) {
  init().catch((err) => showError(err));
}

async function init() {
  wireWindowControls();
  wireEvents();

  try { _lastGameMode = (await window.desktopApi.getSetting("lastGameMode")) || "pve"; } catch { /* first run */ }
  syncGameModeToggleUI(_lastGameMode);

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
    state.editor = createEmptyEditor(state.professions[0].id, _lastGameMode);
    await setProfession(state.professions[0].id, { preserveSelections: false });
    captureEditorBaseline();
  }

  await refreshWindowControls();
  render();
  syncGameModeToggleUI(state.editor.gameMode || "pve");
}

// ── Build operations ─────────────────────────────────────────────────────────

async function reloadBuilds() {
  const builds = await window.desktopApi.listBuilds();
  state.builds = Array.isArray(builds) ? builds : [];
}

async function startNewBuild() {
  if (!confirmDiscardDirty("Start a new build")) return;
  const profession = state.editor.profession || state.professions[0]?.id || "";
  state.editor = createEmptyEditor(profession, _lastGameMode);
  if (profession) {
    await setProfession(profession, { preserveSelections: false });
  }
  state.detail = null;
  captureEditorBaseline();
  render();
  syncGameModeToggleUI(state.editor.gameMode || "pve");
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
    syncGameModeToggleUI(state.editor.gameMode || "pve");
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
    syncGameModeToggleUI(state.editor.gameMode || "pve");
    setPublishStatus("Imported build JSON from clipboard. Save to keep it locally.");
  } catch (err) {
    showError(err);
  }
}

// ── Profession / catalog management ─────────────────────────────────────────

async function setProfession(professionId, options = {}) {
  const selected = String(professionId || "");
  if (!selected) return;

  const catalog = await getCatalog(selected, state.editor.gameMode || "pve");
  state.activeCatalog = catalog;
  state.editor.profession = selected;

  if (!options.preserveSelections) {
    state.editor.specializations = createDefaultSpecializationSelections(catalog);
    state.editor.skills = createDefaultSkillSelections(catalog, state.editor.specializations);
  }

  enforceEditorConsistency({ preferredEliteSlot: options.preferredEliteSlot });
  renderEditor();
}

async function getCatalog(professionId, gameMode = "pve") {
  const cacheKey = `${professionId}_${gameMode}`;
  if (state.catalogCache.has(cacheKey)) return state.catalogCache.get(cacheKey);
  const raw = await window.desktopApi.getProfessionCatalog(professionId, gameMode);
  const catalog = {
    ...raw,
    specializationById: new Map((raw.specializations || []).map((entry) => [Number(entry.id), entry])),
    traitById: new Map((raw.traits || []).map((entry) => [Number(entry.id), entry])),
    skillById: new Map((raw.skills || []).map((entry) => [Number(entry.id), entry])),
    weaponSkillById: new Map((raw.weaponSkills || []).map((entry) => [Number(entry.id), entry])),
    legendById: new Map((raw.legends || []).map((entry) => [String(entry.id), entry])),
    petById: new Map((raw.pets || []).map((entry) => [Number(entry.id), entry])),
  };
  state.catalogCache.set(cacheKey, catalog);

  // Pre-load all spec background images so they're cached before the user switches specs
  for (const spec of catalog.specializations || []) {
    const wikiUrl = `https://wiki.guildwars2.com/wiki/Special:FilePath/${encodeURIComponent(`${spec.name || ""} specialization.png`)}`;
    const img = new Image();
    img.src = wikiUrl;
  }

  return catalog;
}

function syncGameModeToggleUI(mode) {
  document.querySelectorAll(".game-mode-toggle__btn").forEach((btn) => {
    btn.classList.toggle("game-mode-toggle__btn--active", btn.dataset.mode === mode);
  });
}

// ── Auth / onboarding helpers ────────────────────────────────────────────────

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

// ── Window controls ──────────────────────────────────────────────────────────

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

// ── Event wiring ─────────────────────────────────────────────────────────────

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
      syncGameModeToggleUI(state.editor.gameMode || "pve");
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

  // Game mode toggle
  document.querySelectorAll(".game-mode-toggle__btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const mode = btn.dataset.mode;
        if (!mode || mode === state.editor.gameMode) return;

        state.editor.gameMode = mode;
        _lastGameMode = mode;
        window.desktopApi.setSetting("lastGameMode", mode);

        // Re-fetch catalog for the new mode (cache key includes mode)
        if (state.editor.profession) {
          const catalog = await getCatalog(state.editor.profession, mode);
          state.activeCatalog = catalog;
          enforceEditorConsistency();
        }

        markEditorChanged();
        syncGameModeToggleUI(mode);
        renderEditor();
      } catch (err) {
        console.error("Game mode toggle error:", err);
        showError(err);
      }
    });
  });
}

// ── Test-only exports (CommonJS compat for Jest) ─────────────────────────────
// Tests now import directly from module files. This shim remains for any legacy
// test that still requires renderer.__testOnly during the transition.

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
