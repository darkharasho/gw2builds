---
name: axiforge build configuration
description: Build system, commands, output paths, and artifact naming conventions for AxiForge Electron app
type: project
---

Build system is electron-builder (v26) with Vite as the renderer bundler.

**Build commands (per build-local.md):**
- Both platforms in one pass: `npm run build:renderer && npx electron-builder --linux --win --publish never`
- Linux only: `npm run build:app:linux`
- Windows only: `npm run build:app:win`

**Beta version stamping (required before build):** Use the inline node script from build-local.md to write a `0.1.0-beta.YYYYMMDDTHHmm` version into `package.json`, then restore with `git checkout package.json` after the build completes.

**Output directory:** `dist_out/` (configured via `build.directories.output` in package.json)

**Artifact naming pattern:** `AxiForge-${version}.${ext}` — beta example: `AxiForge-0.1.0-beta.20260313T1823.AppImage` and `AxiForge-0.1.0-beta.20260313T1823.exe`

**Renderer output:** `dist/renderer/` (not `dist_out/`)

**Last build marker:** `.last-build-commit` in project root — stores the full commit SHA of HEAD at build time. Updated after every successful build.

**GitHub release:** Created with `gh release create v{version} --repo darkharasho/axiforge --title v{version} --notes "{notes}" --latest dist_out/*.AppImage dist_out/*.exe`

**Discord posting:** Post text-only via JSON payload (`content` field). Use Python/json.dumps for safe serialization — raw shell string interpolation causes HTTP 400. Artifacts are too large to attach (see discord limits memory).

**Why:** Electron-builder targets are linux AppImage and win nsis. Wine on Linux handles Windows cross-compilation.

**How to apply:** Follow build-local.md exactly: validate, stamp, clean, build both platforms, restore, create GitHub release, post Discord text with release URL, update .last-build-commit.
