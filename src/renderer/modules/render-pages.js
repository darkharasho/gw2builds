import { state, createEmptyEditor } from "./state.js";
import { escapeHtml, formatDate, formatPagesStatus, makeButton, matchesBuildQuery, delay } from "./utils.js";
import { renderCustomSelect } from "./custom-select.js";
import { closeCustomSelect } from "./custom-select.js";
import { hideHoverPreview } from "./detail-panel.js";

// ---------------------------------------------------------------------------
// DOM refs — injected by the host (renderer.js) after DOM is ready
// ---------------------------------------------------------------------------
let _el = {};
export function initRenderPagesDom(el) { _el = el; }

// ---------------------------------------------------------------------------
// Cross-module callbacks — injected by the host
// ---------------------------------------------------------------------------
let _callbacks = {};
export function initRenderPagesCallbacks(callbacks) { _callbacks = callbacks; }

// ---------------------------------------------------------------------------
// render — top-level page refresh
// ---------------------------------------------------------------------------
export function render() {
  hideHoverPreview();
  closeCustomSelect();
  renderAuth();
  renderOnboarding();
  renderBuildList();
  renderEditor();
  // Update titlebar user display
  const titlebarUser = document.querySelector("#titlebarUser");
  if (titlebarUser) {
    titlebarUser.textContent = state.user ? state.user.login : "Sign in";
  }
  if (_el.workspaceBtn) {
    _el.workspaceBtn.title = state.user ? `Workspace (${state.user.login})` : "Workspace (not signed in)";
    _el.workspaceBtn.classList.toggle("titlebar__workspace-btn--active", Boolean(state.user));
  }
}

// ---------------------------------------------------------------------------
// renderAuth
// ---------------------------------------------------------------------------
export function renderAuth() {
  _el.authRow.innerHTML = "";

  const status = state.onboarding;
  const target = getSelectedTarget();

  if (state.user) {
    const who = document.createElement("div");
    who.className = "workspace-menu__user";
    who.textContent = `Signed in as ${state.user.login}`;
    _el.authRow.append(who);

    const reauth = makeButton("Re-authenticate", "secondary", async () => {
      try {
        await startLoginFlow();
        await _callbacks.refreshOnboardingStatus();
        render();
      } catch (err) { showError(err); }
    });

    const rerunSetup = makeButton("Re-run Setup", "secondary", async () => {
      try {
        if (!target) throw new Error("No target selected.");
        await window.desktopApi.setupRepoPages(target.login, target.type);
        await runPagesBuildPoll();
        await _callbacks.refreshOnboardingStatus();
        render();
      } catch (err) { showError(err); }
    });
    rerunSetup.disabled = !status?.isAuthenticated || !target;

    const logout = makeButton("Log out", "danger", async () => {
      await window.desktopApi.logout();
      state.loginFlow.beginData = null;
      await _callbacks.refreshOnboardingStatus();
      render();
    });

    _el.authRow.append(who, reauth, rerunSetup, logout);
    return;
  }

  const loginBtn = makeButton("Login with GitHub", "primary", async () => {
    try {
      await startLoginFlow();
      await _callbacks.refreshOnboardingStatus();
      render();
    } catch (err) {
      showError(err);
    }
  });
  _el.authRow.append(loginBtn);
}

// ---------------------------------------------------------------------------
// renderOnboarding
// ---------------------------------------------------------------------------
export function renderOnboarding() {
  const status = state.onboarding;
  _el.onboarding.innerHTML = "";
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
        await _callbacks.refreshOnboardingStatus();
        render();
      },
    },
    {
      title: "Create axiforge + enable Pages",
      done: status.repoReady && status.pagesReady,
      actionLabel: status.repoReady && status.pagesReady ? "Re-run setup" : "Setup",
      canRun: status.isAuthenticated && Boolean(target),
      action: async () => {
        await window.desktopApi.setupRepoPages(target.login, target.type);
        await runPagesBuildPoll();
        await _callbacks.refreshOnboardingStatus();
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
      step.title.includes("axiforge") && !step.done ? targetHint : step.done ? "Completed" : "Required";
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
    _el.onboarding.append(card);
  }
}

// ---------------------------------------------------------------------------
// renderTargetPicker
// ---------------------------------------------------------------------------
export function renderTargetPicker(container) {
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

// ---------------------------------------------------------------------------
// renderBuildList
// ---------------------------------------------------------------------------
export function renderBuildList() {
  const query = state.buildSearch;
  const visible = state.builds
    .filter((build) => matchesBuildQuery(build, query))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  _el.buildList.innerHTML = "";
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty-line";
    empty.textContent = "No local builds yet.";
    _el.buildList.append(empty);
    return;
  }

  for (const build of visible) {
    const card = document.createElement("article");
    const active = build.id && build.id === state.editor.id;
    const dirtySuffix = active && state.editorDirty ? " | Unsaved edits" : "";
    card.className = `build-card ${active ? "build-card--active" : ""}`;
    card.innerHTML = `
      <h3>${escapeHtml(build.title || "Untitled Build")}</h3>
      <p>${escapeHtml(build.profession || "Unknown Profession")} | ${escapeHtml((build.gameMode || "pve").toUpperCase())} | Updated ${escapeHtml(formatDate(build.updatedAt))}${escapeHtml(dirtySuffix)}</p>
    `;

    const actions = document.createElement("div");
    actions.className = "build-card__actions";

    const loadBtn = makeButton("Load", "secondary", async () => {
      if (!_callbacks.confirmDiscardDirty("Load a different build")) return;
      await _callbacks.loadBuildIntoEditor(build);
      render();
    });
    const deleteBtn = makeButton("Delete", "danger", async () => {
      await window.desktopApi.deleteBuild(build.id);
      await _callbacks.reloadBuilds();
      if (state.editor.id === build.id) {
        const next = state.builds[0] || null;
        if (next) await _callbacks.loadBuildIntoEditor(next);
        else {
          const profession = state.professions[0]?.id || "";
          state.editor = createEmptyEditor(profession);
          if (profession) {
            await _callbacks.setProfession(profession, { preserveSelections: false });
          }
          _callbacks.captureEditorBaseline();
        }
      }
      render();
    });
    actions.append(loadBtn, deleteBtn);
    card.append(actions);
    _el.buildList.append(card);
  }
}

// ---------------------------------------------------------------------------
// renderEditor
// ---------------------------------------------------------------------------
export function renderEditor() {
  closeCustomSelect();
  hideHoverPreview();
  renderEditorForm();
  renderEditorMeta();
  _callbacks.renderSpecializations();
  _callbacks.renderSkills();
  _callbacks.renderEquipmentPanel();
  _callbacks.renderDetailPanel();
}

// ---------------------------------------------------------------------------
// renderEditorForm
// ---------------------------------------------------------------------------
export function renderEditorForm() {
  renderCustomSelect(_el.professionSelect, {
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
      await _callbacks.setProfession(professionId, { preserveSelections: false });
      state.detail = null;
      _callbacks.markEditorChanged({ updateBuildList: true });
      renderEditor();
    },
  });

  _el.editorTitle.value = state.editor.title || "";
  _el.tagsInput.value = state.editor.tagsText || "";

  const status = state.onboarding;
  const canPublish = Boolean(status?.isAuthenticated && status?.repoReady);
  _el.publishSiteBtn.disabled = !canPublish;
  _el.copyBuildBtn.disabled = !state.editor.profession;
  _el.duplicateBuildBtn.disabled = !state.editor.profession;
}

// ---------------------------------------------------------------------------
// renderEditorMeta
// ---------------------------------------------------------------------------
export function renderEditorMeta() {
  _el.saveBuildBtn.textContent = state.editorDirty ? "Save Build*" : "Save Build";
  if (state.editorDirty) {
    _el.editorDirtyBadge.classList.remove("hidden");
  } else {
    _el.editorDirtyBadge.classList.add("hidden");
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
  _el.buildSummary.innerHTML = summaryRows
    .map(
      (row) =>
        `<div class="build-summary__row"><span class="build-summary__label">${escapeHtml(row.label)}</span><span class="build-summary__value">${escapeHtml(row.value)}</span></div>`
    )
    .join("");
}

// ---------------------------------------------------------------------------
// runPagesBuildPoll
// ---------------------------------------------------------------------------
export async function runPagesBuildPoll() {
  state.pagesPoll.active = true;
  state.pagesPoll.status = "queued";
  state.pagesPoll.error = null;
  renderOnboarding();

  try {
    for (let i = 0; i < 120; i += 1) {
      const poll = await window.desktopApi.pollPagesStatus();
      state.pagesPoll.status = poll.status || "unknown";
      state.pagesPoll.error = poll.error || null;
      renderOnboarding();

      if (poll.ready && poll.pagesUrl) return;
      if (poll.status === "errored" || poll.status === "error") {
        throw new Error(poll.error || "GitHub Pages build failed.");
      }
      await delay(3000);
    }
    throw new Error("Timed out waiting for GitHub Pages to finish building.");
  } finally {
    state.pagesPoll.active = false;
    renderOnboarding();
  }
}

// ---------------------------------------------------------------------------
// startLoginFlow
// ---------------------------------------------------------------------------
export async function startLoginFlow() {
  state.loginFlow.pending = true;
  state.loginFlow.waitingForApproval = true;
  renderOnboarding();
  try {
    const beginData = await window.desktopApi.beginLogin();
    state.loginFlow.beginData = beginData;
    renderOnboarding();
    await window.desktopApi.completeLogin(beginData);
  } finally {
    state.loginFlow.waitingForApproval = false;
    state.loginFlow.pending = false;
  }
}

// ---------------------------------------------------------------------------
// setPublishStatus
// ---------------------------------------------------------------------------
export function setPublishStatus(message) {
  _el.publishStatus.textContent = message || "";
}

// ---------------------------------------------------------------------------
// getSelectedTarget
// ---------------------------------------------------------------------------
export function getSelectedTarget() {
  if (!state.targets.length) return null;
  return state.selectedTarget || state.targets[0];
}

// ---------------------------------------------------------------------------
// showError
// ---------------------------------------------------------------------------
export async function showError(err) {
  const message = err instanceof Error ? err.message : String(err);
  setPublishStatus(`Error: ${message}`);
  await window.desktopApi.showError("AxiForge Error", message);
}
