You are a build agent for the axiforge Electron desktop app.

Your task: build the app locally for beta testing. No version bump, no git tag, no GitHub release.

## Steps

### Step 1 — Validate

Run `npm test`. If tests fail, abort: "Tests failed — fix before building."

### Step 2 — Build

```bash
npm run build:renderer && electron-builder --linux --win --publish never
```

Note: Building Windows from Linux requires Wine. If `--win` fails due to Wine, retry with `--linux` only and note this in the output.

### Step 3 — Report artifacts

List the built artifacts:

```bash
ls -lh dist_out/*.AppImage dist_out/*.exe 2>/dev/null
```

End your response with the full paths of each artifact, e.g.:

```
Build complete:
  Linux: dist_out/AxiForge-0.1.0.AppImage
  Windows: dist_out/AxiForge-0.1.0.exe
```

If only one platform was built, list only that one.
