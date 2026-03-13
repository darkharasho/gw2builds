import { formatFactHtml } from "./detail-panel.js";
import { getProfessionSvg } from "./profession-icons.js";
import { escapeHtml } from "./utils.js";

// Module-level singleton — one modal for the app lifetime
let _overlay = null;
let _el = {};
let _escHandler = null;

export function initDetailModal() {
  if (typeof document === "undefined") return;
  if (_overlay) return;

  _overlay = document.createElement("div");
  _overlay.className = "detail-modal-overlay detail-modal-overlay--hidden";
  _overlay.innerHTML = `
    <div class="detail-modal">
      <div class="detail-modal-toolbar">
        <span class="detail-modal-title" id="dm-title"></span>
        <button class="wiki-modal-btn" id="dm-wiki-btn">Open Wiki Page</button>
        <button class="wiki-modal-btn wiki-modal-btn--close" id="dm-close">&#x2715;</button>
      </div>
      <div class="detail-modal-body" id="dm-body">
        <div class="dm-hero">
          <img class="dm-hero__icon" id="dm-icon" src="" alt="" />
          <div class="dm-hero__prof-icon" id="dm-prof-icon"></div>
          <div class="dm-hero__text">
            <h2 class="dm-hero__name" id="dm-name"></h2>
            <p class="dm-hero__meta" id="dm-meta"></p>
            <p class="dm-hero__desc" id="dm-desc"></p>
          </div>
        </div>
        <section class="dm-section" id="dm-facts-section">
          <h3 class="dm-section__heading">Facts</h3>
          <ul class="dm-facts-grid" id="dm-facts"></ul>
        </section>
        <section class="dm-section dm-section--loading" id="dm-related-skills-section">
          <h3 class="dm-section__heading">Related Skills</h3>
          <div class="dm-spinner" id="dm-skills-spinner"></div>
          <ul class="dm-related-list dm-related-list--hidden" id="dm-related-skills"></ul>
        </section>
        <section class="dm-section dm-section--loading" id="dm-related-traits-section">
          <h3 class="dm-section__heading">Related Traits</h3>
          <div class="dm-spinner" id="dm-traits-spinner"></div>
          <div class="dm-related-list--hidden" id="dm-related-traits"></div>
        </section>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  _el = {
    title:          document.getElementById("dm-title"),
    wikiBtn:        document.getElementById("dm-wiki-btn"),
    close:          document.getElementById("dm-close"),
    body:           document.getElementById("dm-body"),
    icon:           document.getElementById("dm-icon"),
    profIcon:       document.getElementById("dm-prof-icon"),
    name:           document.getElementById("dm-name"),
    meta:           document.getElementById("dm-meta"),
    desc:           document.getElementById("dm-desc"),
    facts:          document.getElementById("dm-facts"),
    skillsSection:  document.getElementById("dm-related-skills-section"),
    traitsSection:  document.getElementById("dm-related-traits-section"),
    skillsSpinner:  document.getElementById("dm-skills-spinner"),
    traitsSpinner:  document.getElementById("dm-traits-spinner"),
    skillsList:     document.getElementById("dm-related-skills"),
    traitsList:     document.getElementById("dm-related-traits"),
  };

  _el.close.addEventListener("click", closeDetailModal);

  _el.wikiBtn.addEventListener("click", () => {
    const url = _el.wikiBtn.dataset.url;
    if (url) window.open(url, "_blank");
  });
}

export function openDetailModal(detail, catalog, professionName) {
  if (!_overlay || !detail) return;

  // ── Hero ──────────────────────────────────────────────────────────────────
  _el.title.textContent = detail.title;
  _el.name.textContent = detail.title;
  _el.desc.textContent = detail.description || "";

  // Spec name: find matching specialization by entity ID (works for traits;
  // skills fall back to professionName)
  const specializations = catalog?.specializations || [];
  const spec = specializations.find((s) => s.id === detail.entityId);
  const specName = spec?.name || professionName || "";
  const kindLabel = detail.kindLabel || detail.kind || "";
  _el.meta.textContent = specName ? `${specName} · ${kindLabel}` : kindLabel;

  // Icon
  if (detail.icon) {
    _el.icon.style.visibility = "";   // reset in case previous item had no icon
    _el.icon.src = detail.icon;
    _el.icon.alt = detail.title;
    _el.icon.onerror = () => {
      _el.icon.onerror = null;
      if (detail.iconFallback) _el.icon.src = detail.iconFallback;
      else _el.icon.style.visibility = "hidden";
    };
  } else {
    _el.icon.style.visibility = "hidden";
  }

  // Profession SVG — try spec name first, then profession name
  const svg = getProfessionSvg(specName) ?? getProfessionSvg(professionName) ?? "";
  _el.profIcon.innerHTML = svg;

  // Wiki button
  const wikiUrl = detail.wiki?.url || "";
  _el.wikiBtn.dataset.url = wikiUrl;
  _el.wikiBtn.style.display = wikiUrl ? "" : "none";

  // ── Facts ─────────────────────────────────────────────────────────────────
  const facts = Array.isArray(detail.facts) ? detail.facts : [];
  _el.facts.innerHTML = facts
    .map((fact) => `<li>${formatFactHtml(fact, null)}</li>`)
    .join("") || "<li>No facts.</li>";

  // ── Related sections — show with spinners, hide lists ────────────────────
  _el.skillsSection.className = "dm-section dm-section--loading";
  _el.traitsSection.className = "dm-section dm-section--loading";
  _el.skillsList.innerHTML = "";
  _el.traitsList.innerHTML = "";

  // ── Show modal ────────────────────────────────────────────────────────────
  _overlay.classList.remove("detail-modal-overlay--hidden");
  _el.body.scrollTop = 0;
  _escHandler = (e) => { if (e.key === "Escape") closeDetailModal(); };
  document.addEventListener("keydown", _escHandler);

  // ── Async: fetch related data ─────────────────────────────────────────────
  window.desktopApi?.getWikiRelatedData(detail.title).then((related) => {
    _renderRelatedSkills(related.relatedSkills, catalog);
    _renderRelatedTraits(related.relatedTraits, catalog);
  }).catch(() => {
    _showRelatedError(_el.skillsSection, _el.skillsSpinner, _el.skillsList);
    _showRelatedError(_el.traitsSection, _el.traitsSpinner, _el.traitsList);
  });
}

export function closeDetailModal() {
  if (!_overlay) return;
  _overlay.classList.add("detail-modal-overlay--hidden");
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
}

// ── Private rendering helpers ─────────────────────────────────────────────

function _showRelatedError(section, spinner, list) {
  section.className = "dm-section";
  spinner.style.display = "none";
  list.innerHTML = '<p class="dm-related-error">Could not load related data.</p>';
  list.className = list.className.replace("dm-related-list--hidden", "dm-related-list");
}

function _renderRelatedSkills(items, catalog) {
  if (!items || items.length === 0) {
    _el.skillsSection.className = "dm-section dm-section--hidden";
    return;
  }
  const skillMap = _buildNameMap(catalog?.skills);
  _el.skillsList.innerHTML = items.map((item) => {
    const icon = skillMap.get(item.name)?.icon || "";
    return _relatedItemHtml(item.name, item.context, icon);
  }).join("");
  _el.skillsSection.className = "dm-section";
  _el.skillsSpinner.style.display = "none";
  _el.skillsList.className = "dm-related-list";
}

function _renderRelatedTraits(groups, catalog) {
  if (!groups || groups.length === 0) {
    _el.traitsSection.className = "dm-section dm-section--hidden";
    return;
  }
  const traitMap = _buildNameMap(catalog?.traits);
  const specMap = new Map((catalog?.specializations || []).map((s) => [s.name, s]));

  _el.traitsList.innerHTML = groups.map((group) => {
    const spec = specMap.get(group.groupName);
    const specIconHtml = spec?.icon
      ? `<img class="dm-trait-group__spec-icon" src="${escapeHtml(spec.icon)}" alt="${escapeHtml(group.groupName)}" />`
      : "";
    const itemsHtml = group.items.map((item) => {
      const icon = traitMap.get(item.name)?.icon || "";
      return _relatedItemHtml(item.name, item.desc || item.context || "", icon);
    }).join("");
    return `
      <div class="dm-trait-group">
        <div class="dm-trait-group__header">
          ${specIconHtml}
          <span class="dm-trait-group__name">${escapeHtml(group.groupName)}</span>
        </div>
        <ul class="dm-related-list">${itemsHtml}</ul>
      </div>`;
  }).join("");

  _el.traitsSection.className = "dm-section";
  _el.traitsSpinner.style.display = "none";
  _el.traitsList.className = "";
}

function _buildNameMap(arr) {
  const map = new Map();
  if (!Array.isArray(arr)) return map;
  for (const item of arr) {
    if (item.name) map.set(item.name, item);
  }
  return map;
}

function _relatedItemHtml(name, context, iconUrl) {
  const iconEl = iconUrl
    ? `<img class="dm-related-item__icon" src="${escapeHtml(iconUrl)}" alt="${escapeHtml(name)}" onerror="this.style.visibility='hidden'" />`
    : `<div class="dm-related-item__icon dm-related-item__icon--missing"></div>`;
  return `
    <li class="dm-related-item">
      ${iconEl}
      <span class="dm-related-item__name">${escapeHtml(name)}</span>
      ${context ? `<span class="dm-related-item__context">${escapeHtml(context)}</span>` : ""}
    </li>`;
}
