#!/bin/sh
# CI: container entrypoint for the hosted Studio image (Track E3c Part E).
#
# Starts the render sidecar (Bun, 127.0.0.1:${STUDIO_RENDER_PORT}) in the
# background, then hands over to nginx's own entrypoint, which renders the
# site template with envsubst and runs nginx in the foreground. If the
# sidecar dies the container dies with it (Railway restarts on failure), so a
# broken engine never hides behind a healthy nginx.
set -eu

: "${STUDIO_RENDER_PORT:=8788}"
: "${STUDIO_RENDER_HOST:=127.0.0.1}"
export STUDIO_RENDER_PORT STUDIO_RENDER_HOST

if [ -z "${STUDIO_INTERNAL_SECRET:-}" ]; then
  echo '{"service":"studio-entrypoint","event":"warning","message":"STUDIO_INTERNAL_SECRET is unset; /internal/render answers 503"}'
fi

cd /studio
bun studio-render/server.ts &
sidecar_pid=$!

forward() {
  kill -TERM "$sidecar_pid" 2>/dev/null || true
  kill -TERM "$nginx_pid" 2>/dev/null || true
}
trap forward TERM INT

/docker-entrypoint.sh "$@" &
nginx_pid=$!

# Wait for either process; exit with the code of the one that stopped first.
set +e
while :; do
  if ! kill -0 "$sidecar_pid" 2>/dev/null; then
    wait "$sidecar_pid"; code=$?
    echo "{\"service\":\"studio-entrypoint\",\"event\":\"sidecar-exited\",\"code\":$code}"
    kill -TERM "$nginx_pid" 2>/dev/null || true
    wait "$nginx_pid" 2>/dev/null
    exit "${code:-1}"
  fi
  if ! kill -0 "$nginx_pid" 2>/dev/null; then
    wait "$nginx_pid"; code=$?
    echo "{\"service\":\"studio-entrypoint\",\"event\":\"nginx-exited\",\"code\":$code}"
    kill -TERM "$sidecar_pid" 2>/dev/null || true
    wait "$sidecar_pid" 2>/dev/null
    exit "${code:-1}"
  fi
  sleep 1
done
