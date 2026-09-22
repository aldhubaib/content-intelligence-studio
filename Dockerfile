# CI: Content Intelligence Studio — hosted OpenPencil editor + render sidecar (ADR-058 §8).
#
# One image, three stages:
#   1. `build`   — Bun 1.4.2 builds the Vite bundle with `VITE_CI_STUDIO=1`
#                  (collab / share, cloud storage accounts, MCP, demo route and the
#                  service worker are compiled out; see PATCHES.md) and the
#                  workspace packages' `dist/` the sidecar imports.
#   2. `deps`    — production-only `node_modules` (no Vite, Storybook, Playwright…)
#                  for the sidecar: `@open-pencil/core` + `canvaskit-wasm` and their
#                  runtime dependencies.
#   3. `runtime` — nginx serves `dist/` with immutable hashed assets, a CSP whose
#                  `frame-ancestors` is the Content Intelligence app origin, a
#                  `/healthz` probe and a `/internal/` proxy to the **render sidecar**
#                  (`studio-render/server.ts`, Bun, 127.0.0.1:8788) that runs in
#                  the same container (Track E3c Part E).
#
# Railway builds this file (`railway.json`) and injects:
#   PORT                    — listening port (Railway sets it; 8080 by default)
#   STUDIO_APP_ORIGIN       — the app origin allowed to embed the Studio, e.g.
#                             https://content-intelligence.up.railway.app
#   STUDIO_INTERNAL_SECRET  — bearer the app presents to POST /internal/render
#                             (= CONTENT_INTELLIGENCE_STUDIO_INTERNAL_SECRET on the app)
#
# Build locally:  docker build -t ci-studio .
# Run locally:    docker run --rm -p 8080:8080 -e STUDIO_APP_ORIGIN=http://localhost:3000 \
#                   -e STUDIO_INTERNAL_SECRET=local-dev-secret-0123456789 ci-studio

# ---------- 1. build -------------------------------------------------------
FROM oven/bun:1.4.2 AS build
WORKDIR /studio

# Dependency layer first so source edits do not re-run `bun install`.
COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
COPY tools ./tools
RUN bun install --frozen-lockfile

COPY . .
ENV VITE_CI_STUDIO=1
RUN bun run build

# ---------- 2. production dependencies for the sidecar ---------------------
FROM oven/bun:1.4.2 AS deps
WORKDIR /studio
COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
COPY tools ./tools
RUN bun install --frozen-lockfile --production

# ---------- 3. runtime -----------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Bun (musl build) next to nginx; libstdc++ / libgcc are Bun's only runtime libs.
RUN apk add --no-cache libstdc++ libgcc
COPY --from=oven/bun:1.4.2-alpine /usr/local/bin/bun /usr/local/bin/bun

# nginx's own entrypoint renders /etc/nginx/templates/*.template with envsubst
# (only defined environment variables are substituted; `$uri`-style nginx
# variables survive because they are not in the environment).
ENV PORT=8080
ENV STUDIO_APP_ORIGIN=http://localhost:3000
ENV STUDIO_RENDER_PORT=8788
ENV STUDIO_RENDER_HOST=127.0.0.1

RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx/studio.conf.template /etc/nginx/templates/studio.conf.template
COPY --from=build /studio/dist /usr/share/nginx/html

# The render sidecar: sources + the built workspace packages + production node_modules.
# `packages` comes from `build` (for each package's `dist/`) and is then overlaid
# with `deps` so the per-package `node_modules` links point at the production tree.
WORKDIR /studio
COPY --from=deps /studio/node_modules ./node_modules
COPY --from=build /studio/package.json /studio/bunfig.toml /studio/tsconfig.json ./
COPY --from=build /studio/packages ./packages
COPY --from=deps /studio/packages ./packages
COPY --from=build /studio/src/app/ci ./src/app/ci
COPY --from=build /studio/studio-render ./studio-render

COPY deploy/entrypoint.sh /usr/local/bin/studio-entrypoint.sh
RUN chmod +x /usr/local/bin/studio-entrypoint.sh

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null \
   && wget -qO- "http://127.0.0.1:${STUDIO_RENDER_PORT}/healthz" >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/studio-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
