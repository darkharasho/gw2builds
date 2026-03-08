const state = {
  user: null,
  builds: [],
  query: "",
  sortBy: "updated",
  onboarding: null,
  loginFlow: {
    pending: false,
    beginData: null,
    waitingForApproval: false,
  },
};

const el = {
  setupGate: document.querySelector("#setupGate"),
  authRow: document.querySelector("#authRow"),
  onboarding: document.querySelector("#onboarding"),
  buildForm: document.querySelector("#buildForm"),
  buildList: document.querySelector("#buildList"),
  search: document.querySelector("#search"),
  sortBy: document.querySelector("#sortBy"),
  frame: document.querySelector("#buildsiteFrame"),
  winMin: document.querySelector("#winMin"),
  winMax: document.querySelector("#winMax"),
  winClose: document.querySelector("#winClose"),
  titlebar: document.querySelector("#titlebar"),
};

init().catch((err) => showError(err));

async function init() {
  const [config, builds] = await Promise.all([window.desktopApi.getConfig(), window.desktopApi.listBuilds()]);
  state.builds = Array.isArray(builds) ? builds : [];
  el.frame.src = config.buildSiteUrl;
  await refreshOnboardingStatus();
  wireEvents();
  await refreshWindowControls();
  render();
}

function wireEvents() {
  wireWindowControls();

  el.buildForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(el.buildForm);
    const payload = {
      title: String(fd.get("title") || ""),
      profession: String(fd.get("profession") || ""),
      buildUrl: String(fd.get("buildUrl") || ""),
      tags: String(fd.get("tags") || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      notes: String(fd.get("notes") || ""),
    };
    await window.desktopApi.saveBuild(payload);
    el.buildForm.reset();
    await reloadBuilds();
  });

  el.search.addEventListener("input", () => {
    state.query = el.search.value.trim().toLowerCase();
    renderBuilds();
  });

  el.sortBy.addEventListener("change", () => {
    state.sortBy = el.sortBy.value;
    renderBuilds();
  });
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

function render() {
  renderSetupGate();
  renderAuth();
  renderOnboarding();
  renderBuilds();
}

function renderAuth() {
  el.authRow.innerHTML = "";
  if (state.user) {
    const who = document.createElement("span");
    who.className = "rounded-full border border-slate-600 px-2 py-1 text-xs text-slate-200";
    who.textContent = `Signed in: ${state.user.login}`;
    const logout = button("Log out", "secondary", async () => {
      await window.desktopApi.logout();
      state.loginFlow.beginData = null;
      await refreshOnboardingStatus();
      render();
    });
    el.authRow.append(who, logout);
    return;
  }

  const loginBtn = button("Login with GitHub", "primary", async () => {
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
      title: "Create fork + enable Pages",
      done: status.forkReady && status.pagesReady,
      actionLabel: status.forkReady && status.pagesReady ? "Re-run Setup" : "Setup",
      canRun: status.isAuthenticated,
      action: async () => {
        await window.desktopApi.setupForkPages();
        await refreshOnboardingStatus();
        render();
      },
    },
    {
      title: "Sync and run local buildsite",
      done: status.localReady,
      actionLabel: status.localReady ? "Re-sync" : "Sync",
      canRun: status.isAuthenticated && status.forkReady && status.pagesReady,
      action: async () => {
        await window.desktopApi.syncLocalSite();
        await refreshOnboardingStatus();
        render();
      },
    },
  ];

  for (const step of steps) {
    const card = document.createElement("article");
    card.className = `rounded-lg border p-2 ${step.done ? "border-emerald-500/50 bg-emerald-500/10" : "border-slate-700 bg-slatebrand-900/80"}`;
    const title = document.createElement("h3");
    title.className = "text-sm font-medium";
    title.textContent = step.title;
    const body = document.createElement("p");
    body.className = "mt-1 text-xs text-slate-300";
    body.textContent = step.done ? "Completed" : "Required";
    card.append(title, body);

    if (step.canRun) {
      const btn = button(step.actionLabel, "primary", async () => {
        try {
          btn.disabled = true;
          await step.action();
        } catch (err) {
          showError(err);
        } finally {
          btn.disabled = false;
        }
      });
      btn.classList.add("mt-2");
      card.append(btn);
    }
    el.onboarding.append(card);
  }
}

function renderSetupGate() {
  const status = state.onboarding;
  if (!status) return;
  const isReady = status.isAuthenticated && status.forkReady && status.pagesReady && status.localReady;
  if (isReady) {
    el.setupGate.classList.add("hidden");
    return;
  }

  el.setupGate.classList.remove("hidden");
  const flow = state.loginFlow;
  const codeBlock = flow.beginData
    ? `
      <article class="rounded-xl border border-slate-700 bg-slatebrand-900/80 p-4">
        <h3 class="text-sm font-medium">GitHub Device Code</h3>
        <p class="mt-1 text-sm text-slate-300">Enter the code displayed in the app or on the device you're signing in to. Never use a code sent by someone else.</p>
        <div class="mt-3 rounded-lg border border-slate-600 bg-slatebrand-950 px-4 py-3 text-center font-mono text-3xl tracking-[0.3em] text-mint-400">${escapeHtml(flow.beginData.userCode || "")}</div>
        <div class="mt-3">
          <button id="copyDeviceCode" class="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:bg-slate-600">Copy Code</button>
        </div>
        <p class="mt-3 text-xs text-slate-300">Open <a href="${escapeHtml(flow.beginData.verificationUri)}" target="_blank" rel="noreferrer" class="text-skybrand-400 underline">${escapeHtml(flow.beginData.verificationUri)}</a> and approve access.</p>
      </article>
    `
    : "";

  el.setupGate.innerHTML = `
    <div class="mx-auto grid w-full max-w-3xl gap-4 rounded-2xl border border-slate-700 bg-slatebrand-800/80 p-6 shadow-2xl">
      <div>
        <h1 class="text-2xl font-semibold">Finish First-Time Setup</h1>
        <p class="mt-1 text-sm text-slate-300">The app stays locked until authentication, fork/pages setup, and local sync are complete.</p>
      </div>
      ${codeBlock}
      <div id="setupGateSteps" class="grid gap-2"></div>
    </div>
  `;

  const host = el.setupGate.querySelector("#setupGateSteps");
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
      title: "2. Create fork and enable Pages",
      done: status.forkReady && status.pagesReady,
      actionLabel: status.forkReady && status.pagesReady ? "Re-run Fork + Pages" : "Setup Fork + Pages",
      canRun: status.isAuthenticated,
      action: async () => {
        await window.desktopApi.setupForkPages();
        await refreshOnboardingStatus();
        render();
      },
    },
    {
      title: "3. Sync and run local buildsite",
      done: status.localReady,
      actionLabel: status.localReady ? "Re-sync Local Buildsite" : "Sync Local Buildsite",
      canRun: status.isAuthenticated && status.forkReady && status.pagesReady,
      action: async () => {
        await window.desktopApi.syncLocalSite();
        await refreshOnboardingStatus();
        render();
      },
    },
  ];

  for (const step of steps) {
    const card = document.createElement("article");
    card.className = `rounded-lg border p-3 ${step.done ? "border-emerald-500/50 bg-emerald-500/10" : "border-slate-700 bg-slatebrand-900/80"}`;
    card.innerHTML = `<h3 class="text-sm font-medium">${escapeHtml(step.title)}</h3><p class="mt-1 text-xs text-slate-300">${step.done ? "Completed" : "Required"}</p>`;
    if (step.canRun) {
      const btn = button(step.actionLabel, "primary", async () => {
        try {
          btn.disabled = true;
          await step.action();
        } catch (err) {
          showError(err);
        } finally {
          btn.disabled = false;
        }
      });
      btn.classList.add("mt-3");
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
        copyBtn.textContent = "Copy Code";
      }, 1000);
    });
  }
}

function renderBuilds() {
  const filtered = state.builds
    .filter(matchesQuery)
    .sort((a, b) => compareBuilds(a, b, state.sortBy));

  el.buildList.innerHTML = "";
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "rounded-lg border border-slate-700 bg-slatebrand-900/70 p-3 text-sm text-slate-400";
    empty.textContent = "No builds yet.";
    el.buildList.append(empty);
    return;
  }

  for (const build of filtered) {
    const card = document.createElement("article");
    card.className = "rounded-lg border border-slate-700 bg-slatebrand-900/80 p-3";
    card.innerHTML = `
      <h3 class="text-sm font-semibold">${escapeHtml(build.title || "Untitled Build")}</h3>
      <p class="mt-1 text-xs text-slate-300">${escapeHtml(build.profession || "Unknown Profession")} • Updated ${formatDate(build.updatedAt)}</p>
      <p class="mt-2 line-clamp-3 text-xs text-slate-400">${escapeHtml(build.notes || "")}</p>
    `;

    const actions = document.createElement("div");
    actions.className = "mt-3 grid grid-cols-3 gap-2";

    const openBtn = button("Open URL", "secondary", () => {
      if (build.buildUrl) {
        window.open(build.buildUrl, "_blank", "noopener");
      }
    });
    const publishBtn = button("Publish", "primary", async () => {
      try {
        if (!state.user) throw new Error("Log in with GitHub before publishing.");
        const result = await window.desktopApi.publishBuild(build);
        window.open(result.htmlUrl, "_blank", "noopener");
      } catch (err) {
        showError(err);
      }
    });
    const deleteBtn = button("Delete", "danger", async () => {
      await window.desktopApi.deleteBuild(build.id);
      await reloadBuilds();
    });

    actions.append(openBtn, publishBtn, deleteBtn);
    card.append(actions);
    el.buildList.append(card);
  }
}

function matchesQuery(build) {
  if (!state.query) return true;
  const haystack = [build.title || "", build.profession || "", build.notes || "", ...(build.tags || [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(state.query);
}

function compareBuilds(a, b, sortBy) {
  if (sortBy === "title") return (a.title || "").localeCompare(b.title || "");
  if (sortBy === "profession") return (a.profession || "").localeCompare(b.profession || "");
  if (sortBy === "created") return (b.createdAt || "").localeCompare(a.createdAt || "");
  return (b.updatedAt || "").localeCompare(a.updatedAt || "");
}

async function reloadBuilds() {
  state.builds = await window.desktopApi.listBuilds();
  renderBuilds();
}

async function refreshOnboardingStatus() {
  const status = await window.desktopApi.getOnboardingStatus();
  state.onboarding = status;
  state.user = status.viewer;
  if (status.localUrl) {
    el.frame.src = status.localUrl;
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

function button(label, variant, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.className =
    "rounded-md px-2 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 " +
    (variant === "primary"
      ? "bg-skybrand-500 text-white hover:bg-skybrand-400"
      : variant === "danger"
        ? "bg-rose-600 text-white hover:bg-rose-500"
        : "bg-slate-700 text-slate-100 hover:bg-slate-600");
  btn.addEventListener("click", onClick);
  return btn;
}

async function showError(err) {
  const message = err instanceof Error ? err.message : String(err);
  await window.desktopApi.showError("Buildsite Desktop Error", message);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(iso) {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString();
}
