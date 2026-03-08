# GW2 Buildsite Desktop

Electron wrapper for [`pyrogw2/buildsite`](https://github.com/pyrogw2/buildsite) with:

- GitHub OAuth (device flow) login
- First-time onboarding (auth -> fork/pages -> local sync)
- Local build storage
- Search and sorting
- Publish builds to `builds/*.json` in your fork of `pyrogw2/buildsite`

## Setup

1. Create a GitHub OAuth App:
   - Application type: OAuth App
   - Homepage URL: any valid URL
   - Callback URL: any valid URL (not used in device flow)
2. Copy the OAuth **Client ID**.
3. Create `.env` from example and set your client ID:

```bash
cp .env.example .env
```

4. Install dependencies:

```bash
npm install
```

5. Run app:

```bash
npm start
```

6. Development with live updates (Vite + Electron):

```bash
npm run dev
```

## First-Time Flow

On first launch, use the in-app setup steps:

1. Authenticate with GitHub
   - The app shows your GitHub device code in-app
2. Create/check your `buildsite` fork and enable GitHub Pages
3. Sync the fork locally and run it in-app via a local server

## Notes

- On first publish, the app creates a fork of `pyrogw2/buildsite` under your GitHub account.
- After local sync, the app loads your local buildsite copy in the embedded frame instead of the public URL.
- Build data is stored in Electron `userData` under `data/builds.json`.
- OAuth token is currently stored in `data/auth.json` in the same directory.
