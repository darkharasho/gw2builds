const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const AdmZip = require("adm-zip");

const GH_REST = "https://api.github.com";
const USER_AGENT = "gw2-buildsite-desktop";

class LocalBuildsiteHost {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.siteRoot = null;
    this.server = null;
    this.port = null;
  }

  async hasLocalSite() {
    const root = await this.#resolveServedRoot(path.join(this.baseDir, "site"));
    try {
      await fs.access(path.join(root, "index.html"));
      this.siteRoot = root;
      return true;
    } catch {
      return false;
    }
  }

  async syncFromGitHub(token, owner, repo, branch = "main") {
    await fs.mkdir(this.baseDir, { recursive: true });
    const zipUrl = `${GH_REST}/repos/${owner}/${repo}/zipball/${encodeURIComponent(branch)}`;
    const res = await fetch(zipUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
    });

    if (!res.ok) {
      throw new Error(`Failed to download fork zip (${res.status}).`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = new AdmZip(buffer);
    const tmpExtract = path.join(this.baseDir, "_tmp_extract");
    await fs.rm(tmpExtract, { recursive: true, force: true });
    await fs.mkdir(tmpExtract, { recursive: true });
    zip.extractAllTo(tmpExtract, true);

    const entries = await fs.readdir(tmpExtract, { withFileTypes: true });
    const rootDir = entries.find((e) => e.isDirectory());
    if (!rootDir) {
      throw new Error("Downloaded repository archive was empty.");
    }

    const extractedRoot = path.join(tmpExtract, rootDir.name);
    const finalSiteBase = path.join(this.baseDir, "site");
    await fs.rm(finalSiteBase, { recursive: true, force: true });
    await fs.rename(extractedRoot, finalSiteBase);
    await fs.rm(tmpExtract, { recursive: true, force: true });

    await this.#ensureBuildOutput(finalSiteBase);
    this.siteRoot = await this.#resolveServedRoot(finalSiteBase);
  }

  async ensureStarted() {
    if (!this.siteRoot) {
      const ok = await this.hasLocalSite();
      if (!ok) {
        return null;
      }
    }
    if (this.server && this.port) {
      return `http://127.0.0.1:${this.port}/`;
    }

    this.server = http.createServer((req, res) => this.#handle(req, res));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => resolve());
    });
    this.port = this.server.address().port;
    return `http://127.0.0.1:${this.port}/`;
  }

  async #handle(req, res) {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const cleanPath = path.posix.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
    const relativePath = cleanPath === "/" ? "index.html" : cleanPath.replace(/^\/+/, "");
    const fsPath = path.join(this.siteRoot, relativePath);

    try {
      const stat = await fs.stat(fsPath).catch(() => null);
      if (stat && stat.isFile()) {
        const content = await fs.readFile(fsPath);
        res.statusCode = 200;
        res.setHeader("Content-Type", contentType(fsPath));
        res.end(content);
        return;
      }

      const indexPath = path.join(this.siteRoot, "index.html");
      const html = await fs.readFile(indexPath);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
    } catch {
      res.statusCode = 404;
      res.end("Not found");
    }
  }

  async #resolveServedRoot(basePath) {
    const distPath = path.join(basePath, "dist");
    const distIndex = path.join(distPath, "index.html");
    try {
      await fs.access(distIndex);
      return distPath;
    } catch {
      return basePath;
    }
  }

  async #ensureBuildOutput(siteBasePath) {
    const indexPath = path.join(siteBasePath, "index.html");
    const indexText = await fs.readFile(indexPath, "utf8").catch(() => "");
    const appearsToNeedBuild = indexText.includes('src="/src/') || indexText.includes("type=\"module\"");
    if (!appearsToNeedBuild) {
      return;
    }

    const nodeModulesPath = path.join(siteBasePath, "node_modules");
    const hasNodeModules = await fs
      .access(nodeModulesPath)
      .then(() => true)
      .catch(() => false);

    if (!hasNodeModules) {
      await runCommand("npm", ["install", "--no-audit", "--no-fund"], siteBasePath);
    }
    await runCommand("npm", ["run", "build"], siteBasePath);

    const distIndex = path.join(siteBasePath, "dist", "index.html");
    const hasDist = await fs
      .access(distIndex)
      .then(() => true)
      .catch(() => false);
    if (!hasDist) {
      throw new Error("Local buildsite build completed without a dist/index.html output.");
    }
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      stdio: "pipe",
      shell: false,
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} ${args.join(" ")} failed (${code}): ${stderr.trim()}`));
      }
    });
  });
}

module.exports = { LocalBuildsiteHost };
