# Skeleton Loading Design

## Problem

On first launch (and when switching professions/game modes), the app takes 1-3 seconds to fetch data from the GW2 API. During this time, panels are blank, making the app feel broken or unresponsive.

## Solution

Facebook-style skeleton placeholders with a pulse glow animation that mimic the structure of each panel while data loads. Skeletons appear on every data load for consistency, with a 150ms CSS animation-delay to prevent flashes on warm cache (~50ms).

## Decisions

- **When:** Every data load (initial launch, profession switch, game mode toggle)
- **Animation:** Pulse glow (opacity 0 → 1.0, 1.8s cycle) — calmer on dark backgrounds than sweep shimmer
- **Flash prevention:** 150ms CSS `animation-delay` + `opacity: 0` initial state so warm-cache loads never show skeletons
- **Panels covered:** Skill bar, specializations, equipment, detail panel, toolbar profession dropdown

## Architecture

### Hybrid approach: static HTML + JS re-injection

1. **Static skeletons in `index.html`** — pre-populated inside each panel's host element for instant first paint (zero JS dependency)
2. **`src/renderer/modules/skeleton.js`** — exports skeleton HTML templates per panel + `injectSkeleton(el, panelName)` function for re-injection before data fetches
3. **Existing render functions** already do `el.innerHTML = ...` which naturally clears skeletons when data arrives — no teardown logic needed

### New files

| File | Purpose |
|------|---------|
| `src/renderer/styles/skeleton.css` | Pulse keyframes + skeleton shape classes |
| `src/renderer/modules/skeleton.js` | HTML templates + `injectSkeleton()` API |

### CSS classes

- `.skel` — base: `background: #1a2744; border-radius: 4px;`
- Animation: `animation: skel-pulse 1.8s ease-in-out infinite; animation-delay: 150ms; opacity: 0; animation-fill-mode: both;`
- Keyframe starts at `opacity: 0` (not 0.4) to provide a smooth fade-in from the invisible delay state, avoiding a visual snap
- `.skel-hex` — hexagonal clip-path: `polygon(25% 5%, 75% 5%, 96% 50%, 75% 95%, 25% 95%, 4% 50%)` (matches existing `specializations.css` minor trait clip-path)
- `.skel-square` — rounded-rect `border-radius: 4px` (for major traits)
- `.skel-delay-N` — staggered delays in 50ms increments (not 150ms) so all elements are visible for a meaningful duration on typical 1.5-3s cold loads

### Skeleton shapes per panel

**Toolbar (profession dropdown only):**
- Skeleton placeholder inside `#professionSelect` matching the custom-select trigger shape (rounded rect). The Build Title and Tags inputs are already visible as empty inputs in static HTML — no skeletons needed.

**Skill bar (`#skillsHost`):**
- Row of 5 rounded-square slots (weapons) | separator | 5 slots (heal/util/elite) | separator | 4 slots (profession mechanics — approximate; actual count varies by profession but 4 is a reasonable default)
- Each slot: 44×44px rounded rect

**Specializations (`#specializationsHost`):**
- 3 stacked spec cards, each containing:
  - 1 hexagonal emblem (`calc(40px * var(--spec-scale))` = ~44px, matching existing `specializations.css`)
  - 3 tiers of: major column (3 × `calc(32px * var(--spec-scale))` = ~35px squares) — minor hexagon (`calc(26px * var(--spec-scale))` = ~29px) — repeating
  - Connector lines between columns
- Pattern per card: `emblem — [major×3] — minor — [major×3] — minor — [major×3]`

**Equipment (`#equipmentPanel`):**
- 3-column layout matching `equip-layout`:
  - Left: 6 armor slot rows (32px icon + 2 text bars each)
  - Center: concept art placeholder (full-height rounded rect)
  - Right: stat rows (label + value pairs) + trinket grid (40px squares, matching `equipment.css` icon sizing)

**Detail panel (`#detailHost`):**
- Header: 40px circle + 2 text bars (title + meta)
- Description section: 3 text bars at varying widths
- Facts section: 4 icon+text rows (small circle + text bar) to match the actual icon+text fact layout

### Integration points

**`renderer.js` — `setProfession()` / `setGameMode()`:**
Before calling `getProfessionCatalog()`, call `injectSkeleton()` on each panel to show placeholders:
```js
import { injectSkeleton } from "./modules/skeleton.js";

// Before fetch:
injectSkeleton(el.skillsHost, "skills");
injectSkeleton(el.specializationsHost, "specs");
injectSkeleton(el.equipmentPanel, "equipment");
injectSkeleton(el.detailHost, "detail");
```

Note: On cache hits, `getProfessionCatalog()` returns synchronously from `state.catalogCache`. The 150ms animation-delay means the skeleton never becomes visible in this case — it's cleared by `innerHTML = ...` before the delay period ends. Do NOT skip injection for cached calls; the delay handles it automatically.

**`index.html` — static first-paint skeletons:**
Each host element is pre-populated with skeleton HTML so the first render shows placeholders immediately without waiting for JS module initialization.

### Flash prevention

The 150ms delay works because:
- Warm cache loads complete in ~50ms → skeleton never becomes visible (still in delay phase, opacity 0)
- Cold loads take 1.5-3s → skeleton smoothly fades in after 150ms (keyframe starts at opacity 0, rises to 1.0)
- `animation-fill-mode: both` ensures opacity stays 0 during the delay period
- The keyframe going `0% { opacity: 0 } → 50% { opacity: 1 } → 100% { opacity: 0 }` provides a natural fade-in from the invisible state, avoiding any snap
