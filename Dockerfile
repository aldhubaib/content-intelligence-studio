# CI: Content Intelligence Studio — hosted OpenPencil editor (ADR-058 §8).
#
# One image, two stages:
#   1. `build`  — Bun 1.4.2 builds the Vite bundle with `VITE_CI_STUDIO=1`
#                 (collab / share, cloud storage accounts, MCP, demo route and the
#                 service worker are compiled out; see PATCHES.md).
#   2. `runtime` — nginx serves `dist/` with immutable hashed assets, a CSP whose
#                 `frame-ancestors` is the Content Intelligence app origin, a
#                 `/healthz` probe and a `/internal/` proxy for the render sidecar
#                 (Part E of Track E3c adds the process; until then it answers 502).
#
# Railway builds this file (`railway.json`) and injects:
#   PORT               — listening port (Railway sets it; 8080 by default)
#   STUDIO_APP_ORIGIN  — the app origin allowed to embed the Studio, e.g.
#                        https://content-intelligence.up.railway.app
#
# Build locally:  docker build -t ci-studio .
# Run locally:    docker run --rm -p 8080:8080 -e STUDIO_APP_ORIGIN=http://localhost:3000 ci-studio

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

# ---------- 2. runtime -----------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# nginx's own entrypoint renders /etc/nginx/templates/*.template with envsubst
# (only defined environment variables are substituted; `$uri`-style nginx
# variables survive because they are not in the environment).
ENV PORT=8080
ENV STUDIO_APP_ORIGIN=http://localhost:3000

RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx/studio.conf.template /etc/nginx/templates/studio.conf.template
COPY --from=build /studio/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
