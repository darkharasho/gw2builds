const path = require("node:path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
const { app, BrowserWindow, ipcMain, dialog, clipboard } = require("electron");
const { BuildStore } = require("./buildStore");
const {
  startGitHubDeviceAuth,
  beginGitHubDeviceAuth,
  completeGitHubDeviceAuth,
} = require("./githubAuth");
const { getViewer, ensureFork, ensurePages, getRepo, publishBuildToFork } = require("./githubApi");
const { LocalBuildsiteHost } = require("./localSite");

const BUILD_SITE_URL = "https://pyrogw2.github.io/buildsite/";
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "";
const store = new BuildStore(path.join(app.getPath("userData"), "data"));
const localSite = new LocalBuildsiteHost(path.join(app.getPath("userData"), "buildsite-local"));
let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1080,
    minHeight: 720,
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    backgroundColor: "#0b1220",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "../preload/index.js"),
    },
  });
  mainWindow = win;

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

async function getSession() {
  const auth = await store.getAuth();
  if (!auth.token) {
    return null;
  }
  try {
    const viewer = await getViewer(auth.token);
    return { token: auth.token, viewer };
  } catch {
    await store.clearAuth();
    return null;
  }
}

async function getAuthRecord() {
  return store.getAuth();
}

async function patchAuthRecord(patch) {
  const current = await getAuthRecord();
  const next = {
    ...current,
    ...patch,
    onboarding: {
      ...(current.onboarding || {}),
      ...((patch && patch.onboarding) || {}),
    },
  };
  await store.saveAuth(next);
  return next;
}

async function getOnboardingStatus() {
  const auth = await getAuthRecord();
  const session = await getSession();
  const localUrl = await localSite.ensureStarted();
  const onboarding = auth.onboarding || {};
  return {
    isAuthenticated: Boolean(session),
    viewer: session?.viewer || null,
    forkReady: Boolean(onboarding.forkReady),
    pagesReady: Boolean(onboarding.pagesReady),
    localReady: Boolean(localUrl),
    localUrl: localUrl || null,
    pagesUrl: onboarding.pagesUrl || null,
  };
}

app.whenReady().then(async () => {
  await store.init();
  createWindow();

  ipcMain.handle("app:get-config", async () => {
    const localUrl = await localSite.ensureStarted();
    return { buildSiteUrl: localUrl || BUILD_SITE_URL };
  });

  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
    return true;
  });
  ipcMain.handle("window:toggle-maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    return win.isMaximized();
  });
  ipcMain.handle("window:is-maximized", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() || false;
  });
  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
    return true;
  });
  ipcMain.handle("clipboard:write-text", (_event, text) => {
    clipboard.writeText(String(text || ""));
    return true;
  });

  ipcMain.handle("auth:get-session", async () => getSession());

  ipcMain.handle("auth:login", async () => {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID || "";
    const authResult = await startGitHubDeviceAuth(clientId);
    const viewer = await getViewer(authResult.token);
    const previous = await getAuthRecord();
    await store.saveAuth({
      ...previous,
      token: authResult.token,
      viewer,
      onboarding: previous.onboarding || {},
    });
    return { viewer, userCode: authResult.userCode, verificationUri: authResult.verificationUri };
  });

  ipcMain.handle("auth:begin-login", async () => {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID || "";
    return beginGitHubDeviceAuth(clientId);
  });

  ipcMain.handle("auth:complete-login", async (_e, beginData) => {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID || "";
    const token = await completeGitHubDeviceAuth(
      clientId,
      beginData?.deviceCode,
      beginData?.interval,
      beginData?.expiresIn
    );
    const viewer = await getViewer(token);
    const previous = await getAuthRecord();
    await store.saveAuth({
      ...previous,
      token,
      viewer,
      onboarding: previous.onboarding || {},
    });
    return { viewer };
  });

  ipcMain.handle("auth:logout", async () => {
    await store.clearAuth();
    return true;
  });

  ipcMain.handle("builds:list", async () => store.listBuilds());
  ipcMain.handle("builds:save", async (_e, build) => store.upsertBuild(build));
  ipcMain.handle("builds:delete", async (_e, id) => {
    await store.deleteBuild(id);
    return true;
  });

  ipcMain.handle("builds:publish", async (_e, build) => {
    const session = await getSession();
    if (!session) {
      throw new Error("You must log in with GitHub before publishing.");
    }

    const auth = await getAuthRecord();
    const branch = auth?.onboarding?.branch || "main";
    return publishBuildToFork(session.token, session.viewer.login, build, branch);
  });

  ipcMain.handle("onboarding:status", async () => getOnboardingStatus());

  ipcMain.handle("onboarding:setup-fork-pages", async () => {
    const session = await getSession();
    if (!session) {
      throw new Error("Authenticate with GitHub before continuing setup.");
    }

    await ensureFork(session.token, session.viewer.login);
    const repo = await getRepo(session.token, session.viewer.login, "buildsite");
    const defaultBranch = repo.default_branch || "main";
    const pages = await ensurePages(session.token, session.viewer.login, defaultBranch);

    await patchAuthRecord({
      onboarding: {
        forkReady: true,
        pagesReady: true,
        pagesUrl: pages.htmlUrl || null,
        branch: defaultBranch,
      },
    });

    return getOnboardingStatus();
  });

  ipcMain.handle("onboarding:sync-local-site", async () => {
    const session = await getSession();
    if (!session) {
      throw new Error("Authenticate with GitHub before syncing local buildsite.");
    }

    const auth = await getAuthRecord();
    const branch = auth?.onboarding?.branch || "main";
    await localSite.syncFromGitHub(session.token, session.viewer.login, "buildsite", branch);
    const localUrl = await localSite.ensureStarted();
    await patchAuthRecord({
      onboarding: {
        localReady: true,
        localLastSyncAt: new Date().toISOString(),
      },
    });

    return { localUrl };
  });

  ipcMain.handle("dialog:error", async (_e, title, body) => {
    await dialog.showMessageBox({
      type: "error",
      title: title || "Error",
      message: body || "Unknown error",
    });
    return true;
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
