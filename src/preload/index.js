const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
  getConfig: () => ipcRenderer.invoke("app:get-config"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  isMaximizedWindow: () => ipcRenderer.invoke("window:is-maximized"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  writeClipboardText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  getSession: () => ipcRenderer.invoke("auth:get-session"),
  login: () => ipcRenderer.invoke("auth:login"),
  beginLogin: () => ipcRenderer.invoke("auth:begin-login"),
  completeLogin: (beginData) => ipcRenderer.invoke("auth:complete-login", beginData),
  logout: () => ipcRenderer.invoke("auth:logout"),
  getOnboardingStatus: () => ipcRenderer.invoke("onboarding:status"),
  setupForkPages: () => ipcRenderer.invoke("onboarding:setup-fork-pages"),
  syncLocalSite: () => ipcRenderer.invoke("onboarding:sync-local-site"),
  listBuilds: () => ipcRenderer.invoke("builds:list"),
  saveBuild: (build) => ipcRenderer.invoke("builds:save", build),
  deleteBuild: (id) => ipcRenderer.invoke("builds:delete", id),
  publishBuild: (build) => ipcRenderer.invoke("builds:publish", build),
  showError: (title, body) => ipcRenderer.invoke("dialog:error", title, body),
});
