function buildSiteBundle(builds) {
  const normalizedBuilds = normalizeBuildsForSite(builds);
  const payload = {
    generatedAt: new Date().toISOString(),
    builds: normalizedBuilds,
  };

  return {
    "site/index.html": SITE_INDEX_HTML,
    "site/styles.css": SITE_STYLES_CSS,
    "site/app.js": SITE_APP_JS,
    "site/data/builds.json": `${JSON.stringify(payload, null, 2)}\n`,
    "site/.nojekyll": "\n",
  };
}

function normalizeBuildsForSite(builds) {
  if (!Array.isArray(builds)) return [];
  return builds.map((build) => ({
    id: String(build?.id || ""),
    title: String(build?.title || "Untitled Build"),
    profession: String(build?.profession || ""),
    updatedAt: String(build?.updatedAt || ""),
    createdAt: String(build?.createdAt || ""),
    notes: String(build?.notes || ""),
    tags: Array.isArray(build?.tags) ? build.tags.map((tag) => String(tag)) : [],
    equipment: normalizeEquipment(build?.equipment),
    specializations: Array.isArray(build?.specializations)
      ? build.specializations.map((spec) => ({
          id: Number(spec?.id) || 0,
          name: String(spec?.name || ""),
          icon: String(spec?.icon || ""),
          background: String(spec?.background || ""),
          majorChoices: {
            1: Number(spec?.majorChoices?.[1]) || 0,
            2: Number(spec?.majorChoices?.[2]) || 0,
            3: Number(spec?.majorChoices?.[3]) || 0,
          },
          majorTraitsByTier: normalizeMajorTraitsByTier(spec?.majorTraitsByTier),
        }))
      : [],
    skills: normalizeSkills(build?.skills),
  }));
}

function normalizeEquipment(equipment) {
  const source = equipment && typeof equipment === "object" ? equipment : {};
  return {
    statPackage: String(source.statPackage || ""),
    relic: String(source.relic || ""),
    food: String(source.food || ""),
    utility: String(source.utility || ""),
    enrichment: String(source.enrichment || ""),
  };
}

function normalizeSkills(skills) {
  const source = skills && typeof skills === "object" ? skills : {};
  return {
    heal: normalizeSkill(source.heal),
    utility: Array.isArray(source.utility) ? source.utility.map((skill) => normalizeSkill(skill)) : [],
    elite: normalizeSkill(source.elite),
  };
}

function normalizeSkill(skill) {
  if (!skill || typeof skill !== "object") return null;
  return {
    id: Number(skill.id) || 0,
    name: String(skill.name || ""),
    icon: String(skill.icon || ""),
    description: String(skill.description || ""),
    type: String(skill.type || ""),
    slot: String(skill.slot || ""),
  };
}

function normalizeMajorTraitsByTier(value) {
  const source = value && typeof value === "object" ? value : {};
  const tiers = [1, 2, 3];
  const out = {};
  for (const tier of tiers) {
    const list = Array.isArray(source[tier]) ? source[tier] : [];
    out[tier] = list.map((trait) => ({
      id: Number(trait?.id) || 0,
      name: String(trait?.name || ""),
      icon: String(trait?.icon || ""),
    }));
  }
  return out;
}

const SITE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>AxiForge</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="site-shell">
      <header class="site-header">
        <p class="eyebrow">Guild Wars 2</p>
        <h1>Build Library</h1>
        <p class="subtitle">Published from AxiForge desktop.</p>
      </header>
      <section class="controls">
        <label class="search-wrap">
          <span>Search Builds</span>
          <input id="searchInput" type="search" placeholder="profession, tags, notes..." />
        </label>
      </section>
      <section id="buildGrid" class="build-grid" aria-live="polite"></section>
      <footer id="generatedAt" class="site-footer"></footer>
    </main>
    <script src="./app.js" defer></script>
  </body>
</html>
`;

const SITE_STYLES_CSS = `:root{
  color-scheme: dark;
  --bg:#04070f;
  --surface:#0b1223;
  --surface-2:#101a33;
  --line:#1f3157;
  --text:#e8f0ff;
  --muted:#9bb0d9;
  --accent:#45d18f;
  --accent-2:#4aa7ff;
}
*{box-sizing:border-box}
body{
  margin:0;
  min-height:100vh;
  font-family:"Segoe UI",ui-sans-serif,system-ui,-apple-system,sans-serif;
  background:
    radial-gradient(1200px 500px at 0 -20%, rgba(69,209,143,0.2), transparent 60%),
    radial-gradient(1000px 500px at 100% 0, rgba(74,167,255,0.2), transparent 55%),
    var(--bg);
  color:var(--text);
}
.site-shell{
  width:min(1200px,94vw);
  margin:32px auto 48px;
}
.site-header h1{margin:4px 0 8px;font-size:2.1rem}
.eyebrow{margin:0;color:var(--accent);font-size:.78rem;letter-spacing:.22em;text-transform:uppercase}
.subtitle{margin:0;color:var(--muted)}
.controls{
  margin-top:20px;
  padding:14px;
  border:1px solid var(--line);
  border-radius:14px;
  background:rgba(16,26,51,.75);
}
.search-wrap{
  display:grid;
  gap:8px;
  font-size:.78rem;
  text-transform:uppercase;
  letter-spacing:.08em;
  color:var(--muted);
}
.search-wrap input{
  border:1px solid #2a3f6b;
  border-radius:10px;
  background:#070d1a;
  color:var(--text);
  padding:10px 12px;
}
.build-grid{
  margin-top:18px;
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(300px,1fr));
  gap:12px;
}
.build-card{
  border:1px solid var(--line);
  border-radius:14px;
  background:linear-gradient(180deg, rgba(16,26,51,.96), rgba(10,17,34,.98));
  padding:14px;
}
.build-card h2{margin:0 0 6px;font-size:1.1rem}
.meta{margin:0;color:var(--muted);font-size:.86rem}
.section{margin-top:10px}
.section h3{
  margin:0 0 6px;
  color:var(--accent-2);
  font-size:.72rem;
  letter-spacing:.08em;
  text-transform:uppercase;
}
.token-row{
  display:flex;
  flex-wrap:wrap;
  gap:6px;
}
.token{
  border:1px solid #2b4577;
  background:#0c152a;
  border-radius:999px;
  padding:4px 8px;
  font-size:.74rem;
  color:#c6d7fa;
}
.skill{
  display:grid;
  grid-template-columns:30px 1fr;
  gap:8px;
  align-items:center;
  font-size:.8rem;
  margin:4px 0;
}
.skill img{
  width:30px;
  height:30px;
  border-radius:6px;
  border:1px solid #2d3b60;
  background:#0a1020;
}
.site-footer{
  margin-top:18px;
  color:var(--muted);
  font-size:.78rem;
}
`;

const SITE_APP_JS = `const grid = document.getElementById("buildGrid");
const searchInput = document.getElementById("searchInput");
const generatedAt = document.getElementById("generatedAt");

let allBuilds = [];

init().catch((err) => {
  grid.innerHTML = '<article class="build-card"><h2>Failed To Load</h2><p class="meta">' + escapeHtml(err?.message || String(err)) + "</p></article>";
});

async function init() {
  const res = await fetch("./data/builds.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load builds data.");
  const payload = await res.json();
  allBuilds = Array.isArray(payload?.builds) ? payload.builds : [];
  generatedAt.textContent = payload?.generatedAt ? "Generated: " + formatDate(payload.generatedAt) : "";
  render();
  searchInput.addEventListener("input", render);
}

function render() {
  const query = (searchInput.value || "").trim().toLowerCase();
  const builds = allBuilds.filter((build) => matchesQuery(build, query));
  grid.innerHTML = "";
  if (!builds.length) {
    grid.innerHTML = '<article class="build-card"><h2>No Builds</h2><p class="meta">No build matches your search.</p></article>';
    return;
  }
  for (const build of builds) {
    const card = document.createElement("article");
    card.className = "build-card";
    const specNames = (build.specializations || []).map((spec) => spec.name).filter(Boolean);
    const equip = build.equipment || {};

    card.innerHTML = [
      '<h2>' + escapeHtml(build.title || "Untitled Build") + "</h2>",
      '<p class="meta">' + escapeHtml(build.profession || "Unknown Profession") + " | Updated " + escapeHtml(formatDate(build.updatedAt)) + "</p>",
      section("Specializations", specNames.map((name) => token(name)).join("")),
      section("Skills", skillRows(build.skills)),
      section("Equipment", equipmentTokens(equip)),
      build.notes ? section("Notes", '<p class="meta">' + escapeHtml(build.notes) + "</p>") : "",
      Array.isArray(build.tags) && build.tags.length ? section("Tags", build.tags.map((tag) => token(tag)).join("")) : "",
    ].join("");

    grid.append(card);
  }
}

function skillRows(skills) {
  const list = [];
  if (skills?.heal) list.push(skills.heal);
  if (Array.isArray(skills?.utility)) {
    for (const item of skills.utility) {
      if (item) list.push(item);
    }
  }
  if (skills?.elite) list.push(skills.elite);
  if (!list.length) return '<p class="meta">No skills selected.</p>';
  return list.map((skill) => {
    const icon = skill.icon ? '<img src="' + escapeAttr(skill.icon) + '" alt="" loading="lazy" />' : '<div></div>';
    return '<div class="skill">' + icon + '<span>' + escapeHtml(skill.name || "Unknown Skill") + "</span></div>";
  }).join("");
}

function equipmentTokens(equipment) {
  const tokens = [];
  if (equipment.statPackage) tokens.push(token("Stats: " + equipment.statPackage));
  if (equipment.relic) tokens.push(token("Relic: " + equipment.relic));
  if (equipment.food) tokens.push(token("Food: " + equipment.food));
  if (equipment.utility) tokens.push(token("Utility: " + equipment.utility));
  return tokens.length ? tokens.join("") : '<p class="meta">Not specified.</p>';
}

function section(title, body) {
  return '<section class="section"><h3>' + escapeHtml(title) + '</h3><div class="token-row">' + body + "</div></section>";
}

function token(label) {
  return '<span class="token">' + escapeHtml(label) + "</span>";
}

function matchesQuery(build, query) {
  if (!query) return true;
  const haystack = [
    build.title || "",
    build.profession || "",
    build.notes || "",
    ...(build.tags || []),
    ...((build.specializations || []).map((spec) => spec.name || "")),
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function formatDate(value) {
  if (!value) return "unknown";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
`;

module.exports = {
  buildSiteBundle,
};
