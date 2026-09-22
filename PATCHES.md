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

Formatting: every touched file is run through the repo's `oxfmt` so the
diff against upstream is the guarded lines only.

## Hosted mode (`?doc=…&ws=…&token=…&api=…`, runtime)

Hosted mode is a runtime state read from the URL by `src/app/ci/hosted.ts`;
without `?doc` the page is upstream OpenPencil (`bun run dev` still works).
Everything under `src/app/ci/` and `src/components/ci/` is ours; the
upstream files below carry one guarded call each.

| # | File | Change |
| --- | --- | --- |
| H-1 | `src/app/ci/hosted.ts` | **Added.** Parses / validates the hosted URL parameters, scrubs `token` from the address bar, holds the live bearer (`hostedToken`). |
| H-2 | `src/app/ci/protocol.ts` | **Added.** Typed `postMessage` protocol Studio ⇄ host, origin-checked both ways (`studio:ready` / `dirty` / `saved` / `error` / `token-expiring` / `close-ok` / `close-blocked`; `host:token` / `save-version` / `request-close`). |
| H-3 | `src/app/ci/api.ts` | **Added.** `StudioAPI` over the app's `GET|PUT /api/studio/templates/{id}` with the bearer, typed `409` / `401` errors, same-origin `fetchBytes`. Binds the native `fetch` at module load — the engine's web-font manager swaps `globalThis.fetch` for a host-checked proxy during provider calls. |
| H-4 | `src/app/ci/document.ts` | **Added.** The app's `openpencil-scene-graph` JSON envelope (ADR-058 §5): `serializeGraph` / `deserializeGraph` / `resolveBrandStrings`. No `.fig` on the wire. |
| H-5 | `src/app/ci/fonts.ts` | **Added.** Brand fonts from `fonts[]` only (FB-33): online providers off, host font loader over the app API, Arabic fallback chain = brand Arabic family → bundled Noto Naskh Arabic (served from this origin). |
| H-6 | `src/app/ci/brand-library.ts` | **Added.** Brand kit → one component library per workspace (logo light / dark, photos as image components) + one variables collection (five colours, Arabic + Latin font names). |
| H-7 | `src/app/ci/slots.ts`, `src/components/ci/SlotsPanel.vue` | **Added.** `slot:<name>` bindings from plugin data / layer names over the fixed vocabulary; the **Slots** side panel with jump-to and the missing-required / duplicate warnings. (Placed under `src/components/ci/` because upstream keeps Vue components out of `src/app/`.) |
| H-8 | `src/app/ci/session.ts`, `src/app/ci/boot.ts`, `src/app/ci/save-override.ts`, `src/app/ci/menu.ts` | **Added.** The hosted session: load → autosave `draft` every 30 s while dirty → **Save version** (⌘S) → `409` conflict copy; boot from `WorkspaceView`; the hosted save handler the upstream save actions defer to; hidden / relabelled menu ids. |
| H-9 | `src/main.ts` | `preloadFonts()` is skipped when hosted — no CDN font preload before the session disables the providers. |
| H-10 | `src/views/WorkspaceView.vue` | No home tab when hosted; `bootHostedStudio(store)` after the first tab exists. |
| H-11 | `src/app/document/io/save.ts` | `saveFigFile` / `saveFigFileAs` defer to `hostedSaveHandler()` when one is registered (hosted mode). |
| H-12 | `src/app/shell/menu/app-menu.ts` | Menu entries consult `hostedHidesMenuItem` / `hostedMenuLabel` (hidden ids: `new`, `open`, `open-recent`, `open-storage-workspace`, `save-as`, `export-fig`, `autosave`, `close`; **Save** → **Save version**). |
| H-13 | `src/components/editor/EditorWorkspace.vue` | `SlotsPanel` mounted above the design panel when hosted. |

Tests: `tests/engine/app/ci/*.test.ts` (unit, `bun test tests/engine/app/ci`)
and `tests/e2e/ci/hosted.spec.ts` (Playwright smoke over an intercepted app
API; fixture `tests/fixtures/ci/hosted-template.json`).

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
