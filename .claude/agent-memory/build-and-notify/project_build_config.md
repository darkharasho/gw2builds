---
name: axiforge build configuration
description: Build system, commands, output paths, and artifact naming conventions for AxiForge Electron app
type: project
---

Build system is electron-builder (v26) with Vite as the renderer bundler.

**Build commands:**
- Linux AppImage: `npm run build:app:linux` (runs `vite build` then `electron-builder --linux --publish never`)
- Windows NSIS installer: `npm run build:app:win` (runs `vite build` then `electron-builder --win --publish never`)
- Both platforms: `npm run build:app`

**Output directory:** `dist_out/` (configured via `build.directories.output` in package.json)

**Artifact naming pattern:** `AxiForge-${version}.${ext}` where version comes from `package.json`. Example: `AxiForge-0.1.0-2026-03-13-1.AppImage` and `AxiForge-0.1.0-2026-03-13-1.exe`

**Version format:** `0.1.0-YYYY-MM-DD-N` (e.g. `0.1.0-2026-03-13-1`)

**Renderer output:** `dist/renderer/` (not `dist_out/`)

**Last build marker:** `.last-build-commit` in project root — stores the full commit SHA of the HEAD at build time.

**Why:** Electron-builder targets are linux AppImage and win nsis. The build first compiles the Vite renderer, then packages with electron-builder.

**How to apply:** Always run platform-specific build commands separately (`build:app:linux`, `build:app:win`) to get both artifacts. Check `dist_out/` for outputs after build.
