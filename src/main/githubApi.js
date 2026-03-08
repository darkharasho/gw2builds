const GH_REST = "https://api.github.com";
const UPSTREAM_OWNER = "pyrogw2";
const UPSTREAM_REPO = "buildsite";
const USER_AGENT = "gw2-buildsite-desktop";

async function apiFetch(path, token, init = {}) {
  const res = await fetch(`${GH_REST}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
      ...(init.headers || {}),
    },
  });

  const text = await res.text();
  const data = text ? tryParseJson(text) : null;
  if (!res.ok) {
    const err = new Error(data?.message || `GitHub API error ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function getViewer(token) {
  const me = await apiFetch("/user", token);
  return { login: me.login, id: me.id, avatarUrl: me.avatar_url, htmlUrl: me.html_url };
}

async function ensureFork(token, owner) {
  try {
    await apiFetch(`/repos/${owner}/${UPSTREAM_REPO}`, token);
    return;
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
  }

  await apiFetch(`/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/forks`, token, { method: "POST" });

  for (let i = 0; i < 20; i += 1) {
    await delay(1500);
    try {
      await apiFetch(`/repos/${owner}/${UPSTREAM_REPO}`, token);
      return;
    } catch (err) {
      if (i === 19) {
        throw new Error("Fork creation did not finish in time.");
      }
    }
  }
}

async function ensurePages(token, owner, branch = "main") {
  try {
    const page = await apiFetch(`/repos/${owner}/${UPSTREAM_REPO}/pages`, token);
    return { htmlUrl: page.html_url, branch };
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
  }

  await apiFetch(`/repos/${owner}/${UPSTREAM_REPO}/pages`, token, {
    method: "POST",
    body: JSON.stringify({
      source: { branch, path: "/" },
      build_type: "legacy",
    }),
  });

  for (let i = 0; i < 15; i += 1) {
    await delay(2000);
    try {
      const page = await apiFetch(`/repos/${owner}/${UPSTREAM_REPO}/pages`, token);
      return { htmlUrl: page.html_url, branch };
    } catch (err) {
      if (i === 14) {
        throw new Error("GitHub Pages setup did not finish in time.");
      }
    }
  }
}

async function getRepo(token, owner, repo = UPSTREAM_REPO) {
  return apiFetch(`/repos/${owner}/${repo}`, token);
}

async function publishBuildToFork(token, owner, build, branch = "main") {
  await ensureFork(token, owner);

  const safeSlug = slugify(build.title || build.id || "build");
  const path = `builds/${safeSlug}.json`;
  const payload = JSON.stringify(build, null, 2) + "\n";
  let existingSha;

  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  try {
    const current = await apiFetch(`/repos/${owner}/${UPSTREAM_REPO}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`, token);
    existingSha = current.sha;
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
  }

  const body = {
    message: `Publish build: ${build.title || build.id}`,
    content: Buffer.from(payload, "utf8").toString("base64"),
    branch,
  };
  if (existingSha) {
    body.sha = existingSha;
  }

  const result = await apiFetch(`/repos/${owner}/${UPSTREAM_REPO}/contents/${encodedPath}`, token, {
    method: "PUT",
    body: JSON.stringify(body),
  });

  return {
    commitSha: result.commit?.sha,
    filePath: path,
    htmlUrl: `https://github.com/${owner}/${UPSTREAM_REPO}/blob/${branch}/${path}`,
  };
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "build";
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { getViewer, ensureFork, ensurePages, getRepo, publishBuildToFork };
