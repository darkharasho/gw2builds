const { autoUpdater } = require("electron-updater");
const { app, ipcMain } = require("electron");

const RETRY_ERRORS = [
  "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EPIPE",
  "socket hang up", "ERR_HTTP2_SERVER_REFUSED_STREAM",
];
const RETRY_HTTP_CODES = [502, 503, 504];
const CHECK_DELAY_MS = 3000;
const CHECK_TIMEOUT_MS = 30000;
const RETRY_DELAY_MS = 2000;

let mainWindow = null;
let retryAttempts = 0;

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function isRetryableError(err) {
  const msg = String(err?.message || err || "");
  const code = err?.code || "";
  if (RETRY_ERRORS.some((e) => msg.includes(e) || code.includes(e))) return true;
  if (RETRY_HTTP_CODES.some((c) => msg.includes(String(c)))) return true;
  return false;
}

function checkWithTimeout() {
  return Promise.race([
    autoUpdater.checkForUpdates(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Update check timed out")), CHECK_TIMEOUT_MS)
    ),
  ]);
}

function initAutoUpdate(win) {
  mainWindow = win;

  // Dev mode — skip entirely, send fake "not available"
  if (!app.isPackaged) {
    send("update-not-available", { version: app.getVersion() });
    return;
  }

  // Linux without AppImage — auto-update will error
  if (process.platform === "linux" && !process.env.APPIMAGE) {
    send("update-not-available", { version: app.getVersion() });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    send("update-available", {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    send("update-not-available", { version: info.version });
  });

  autoUpdater.on("error", (err) => {
    if (isRetryableError(err) && retryAttempts < 1) {
      retryAttempts++;
      setTimeout(() => {
        checkWithTimeout().catch(() => {});
      }, RETRY_DELAY_MS);
      return;
    }
    send("update-error", { message: String(err?.message || err) });
  });

  autoUpdater.on("download-progress", (progress) => {
    send("download-progress", {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    send("update-downloaded", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  // IPC handlers
  ipcMain.on("updater:check", () => {
    retryAttempts = 0;
    checkWithTimeout().catch(() => {});
  });

  ipcMain.on("updater:restart", () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle("updater:get-version", () => {
    return app.getVersion();
  });

  // Auto-check after delay
  setTimeout(() => {
    checkWithTimeout().catch(() => {});
  }, CHECK_DELAY_MS);
}

module.exports = { initAutoUpdate };
