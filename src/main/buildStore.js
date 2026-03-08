const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

class BuildStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.buildsPath = path.join(baseDir, "builds.json");
    this.authPath = path.join(baseDir, "auth.json");
  }

  async init() {
    await fs.mkdir(this.baseDir, { recursive: true });
    await this.#ensureFile(this.buildsPath, []);
    await this.#ensureFile(this.authPath, {});
  }

  async listBuilds() {
    const data = await this.#readJson(this.buildsPath, []);
    return Array.isArray(data) ? data : [];
  }

  async upsertBuild(input) {
    const builds = await this.listBuilds();
    const now = new Date().toISOString();
    const id = input.id || crypto.randomUUID();
    const next = {
      id,
      title: input.title?.trim() || "Untitled Build",
      profession: input.profession?.trim() || "",
      buildUrl: input.buildUrl?.trim() || "",
      tags: Array.isArray(input.tags) ? input.tags.map((x) => String(x).trim()).filter(Boolean) : [],
      notes: input.notes?.trim() || "",
      updatedAt: now,
      createdAt: input.createdAt || now,
    };

    const idx = builds.findIndex((b) => b.id === id);
    if (idx >= 0) {
      next.createdAt = builds[idx].createdAt || next.createdAt;
      builds[idx] = next;
    } else {
      builds.push(next);
    }

    await this.#writeJson(this.buildsPath, builds);
    return next;
  }

  async deleteBuild(id) {
    const builds = await this.listBuilds();
    const filtered = builds.filter((b) => b.id !== id);
    await this.#writeJson(this.buildsPath, filtered);
  }

  async getAuth() {
    return this.#readJson(this.authPath, {});
  }

  async saveAuth(auth) {
    await this.#writeJson(this.authPath, auth || {});
  }

  async clearAuth() {
    await this.#writeJson(this.authPath, {});
  }

  async #ensureFile(filePath, fallback) {
    try {
      await fs.access(filePath);
    } catch {
      await this.#writeJson(filePath, fallback);
    }
  }

  async #readJson(filePath, fallback) {
    try {
      const text = await fs.readFile(filePath, "utf8");
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }

  async #writeJson(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  }
}

module.exports = { BuildStore };
