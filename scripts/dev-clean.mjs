import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
const appName = pkg.name || "gw2-buildsite-desktop";
const devDir = path.join(getAppDataDir(), `${appName}-dev`);

await fs.rm(devDir, { recursive: true, force: true });
console.log(`Removed dev profile data: ${devDir}`);

function getAppDataDir() {
  if (process.platform === "win32") {
    return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}
