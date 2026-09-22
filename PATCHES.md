# PATCHES — Content Intelligence Studio against OpenPencil v0.15.1

Every divergence from upstream `open-pencil/open-pencil@v0.15.1` is listed
here so the next rebase is a checklist, not an archaeology dig. Added files
carry a `// CI:` (or `<!-- CI: -->`) first-line comment; edits to upstream
files are one `// CI:` comment above the changed lines. Nothing in this
list is needed by upstream — every entry is either a hosted-mode addition
or an upstream-able fix, marked as such.

Rebase rule: `git rebase v<next>` on `studio-main`, resolve only the files
below, re-run `VITE_CI_STUDIO=1 bun run build` and `bun run check`, update
the version in the header of this file.

## Upstream-able fixes

| # | File | Change | Upstream status |
| --- | --- | --- | --- |
| U-1 | `packages/core/src/io/formats/raster/headless.ts` | `binDir` is `decodeURIComponent`-ed so a checkout path containing a space (`Nizek%20Projects`) still resolves `canvaskit.wasm` in headless export. Mirrors `packages/core/src/canvaskit.ts`, which already decodes. | To be offered upstream. |

## Hosted-mode build flag (`VITE_CI_STUDIO=1`)

The compile-time flag lives in `src/app/ci/flags.ts` (`CI_STUDIO`). Vite
inlines the literal, so upstream builds fold every guard away and ship the
unmodified surface.

| # | File | Change |
| --- | --- | --- |
| F-1 | `src/app/ci/flags.ts`, `src/app/ci/env.d.ts` | **Added.** `CI_STUDIO` constant + typed `VITE_CI_STUDIO`. |
| F-2 | `src/router.ts` | `/demo` and `/share/:roomId` routes exist only when `!CI_STUDIO`; the hosted build redirects unknown paths to `/`. |
| F-3 | `src/components/editor/EditorWorkspace.vue` | `CollabPanel` (avatars + Share) is not rendered when `CI_STUDIO`. |
| F-4 | `src/components/settings/SettingsDialog.vue` | Settings sections **Storage** (cloud accounts) and **MCP** are filtered out when `CI_STUDIO`. |
| F-5 | `vite/pwa.ts` | `VitePWA({ disable })` when `VITE_CI_STUDIO=1` — the hosted Studio is an iframe with immutable hashed assets; a service worker would pin a stale bundle against a newer host protocol. |

## Hosted service files (no upstream counterpart)

| # | File | Purpose |
| --- | --- | --- |
| S-1 | `Dockerfile`, `.dockerignore` | Two-stage image: `oven/bun:1.4.2` builds with `VITE_CI_STUDIO=1`; `nginx:1.27-alpine` serves `dist/`. |
| S-2 | `deploy/nginx/studio.conf.template` | nginx site rendered by envsubst (`PORT`, `STUDIO_APP_ORIGIN`): CSP with `frame-ancestors ${STUDIO_APP_ORIGIN}`, `connect-src` / `font-src` limited to self + the app, `wasm-unsafe-eval` for CanvasKit, immutable `/assets/`, `no-cache` shell, `/healthz`, `/internal/` → render sidecar on 127.0.0.1:8788 (Track E3c Part E). |
| S-3 | `railway.json` | Railway builds the Dockerfile, health-checks `/healthz`. |
| S-4 | `NOTICE` | Fork attribution (MIT). |
| S-5 | `PATCHES.md` | This file. |
| S-6 | `README.md` § "Content Intelligence Studio" | Fork header: what changed, how to build, how to rebase. |

## Environment

| Variable | Where | Meaning |
| --- | --- | --- |
| `VITE_CI_STUDIO` | build | `1` → hosted Studio bundle (F-1 … F-5). Unset → upstream OpenPencil. |
| `PORT` | runtime | nginx listen port (Railway injects it; image default 8080). |
| `STUDIO_APP_ORIGIN` | runtime | The one origin allowed to embed the Studio and to be called from it (Content Intelligence app). |
