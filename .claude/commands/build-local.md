You are a build agent for the axiforge Electron desktop app.

Your task: build the app locally for beta testing. No git tag, no GitHub release.

## Steps

### Step 1 — Validate

Run `npm test`. If tests fail, abort: "Tests failed — fix before building."

### Step 2 — Stamp beta version

Generate a timestamped beta version and write it to `package.json`:

```bash
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const base = pkg.version.replace(/-.*$/, '');
const now = new Date();
const ts = now.getFullYear().toString()
  + String(now.getMonth()+1).padStart(2,'0')
  + String(now.getDate()).padStart(2,'0')
  + 'T'
  + String(now.getHours()).padStart(2,'0')
  + String(now.getMinutes()).padStart(2,'0');
pkg.version = base + '-beta.' + ts;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('Version stamped: ' + pkg.version);
"
```

This produces a version like `0.1.0-beta.20260313T1530`. Do NOT commit this change — it is a local-only build stamp.

### Step 3 — Clean dist directories

```bash
rm -rf dist/ dist_out/
```

### Step 4 — Build

```bash
npm run build:renderer && npx electron-builder --linux --win --publish never
```

Note: Building Windows from Linux requires Wine. If `--win` fails due to Wine, retry with `--linux` only and note this in the output.

### Step 5 — Restore version

Reset `package.json` so the stamped version doesn't linger in the working tree:

```bash
git checkout package.json
```

### Step 6 — Report artifacts

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
