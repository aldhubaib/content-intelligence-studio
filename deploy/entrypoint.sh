#!/bin/sh
# CI: container entrypoint for the hosted Studio image (Track E3c Part E; S-11 / INC-18).
#
# Contract
#   * nginx is the container's life. Its own entrypoint renders the site template
#     with envsubst and runs `nginx -g 'daemon off;'` in the foreground; it serves
#     the editor (`dist/`) and proxies `/internal/` to the sidecar. The container
#     exits ONLY when nginx exits — and then with code 1 even when nginx returned
#     0, so the platform's restart policy (`railway.json`: ALWAYS) brings a fresh
#     container.
#   * the render sidecar (Bun, 127.0.0.1:${STUDIO_RENDER_PORT}) is SUPERVISED.
#     When it exits — recycle after STUDIO_RENDER_MAX_RENDERS (0), heap
#     exhaustion (70), a crash — this script logs
#     {"event":"sidecar-exited","code":N,"uptimeSec":S,"restartInMs":M} and starts
#     it again: at once after a clean exit (a recycle), otherwise after a backoff
#     of 1 s doubling to 30 s that resets once a sidecar has lived 5 minutes.
#     While it is down nginx answers 503 `render_unavailable` for `/internal/`
#     (studio.conf.template), which the app's `studio` renderer defers on
#     without spending an attempt; `/healthz/render` says `ok: false`.
#   * TERM / INT are forwarded to both processes; the sidecar is not restarted
#     once a stop was requested.
#
# INC-18: the previous contract ("the container dies with the sidecar") met a
# `restartPolicyType: ON_FAILURE` — a recycle's exit 0 was not a failure, the
# container stayed dead for four hours and the editor with it.
#
# Overridable for tests (never set in the image): STUDIO_HOME, NGINX_ENTRYPOINT,
# STUDIO_SIDECAR_BACKOFF_MIN_S / _MAX_S / _RESET_S.
set -u

: "${STUDIO_RENDER_PORT:=8788}"
: "${STUDIO_RENDER_HOST:=127.0.0.1}"
: "${STUDIO_HOME:=/studio}"
: "${NGINX_ENTRYPOINT:=/docker-entrypoint.sh}"
: "${STUDIO_SIDECAR_BACKOFF_MIN_S:=1}"
: "${STUDIO_SIDECAR_BACKOFF_MAX_S:=30}"
: "${STUDIO_SIDECAR_BACKOFF_RESET_S:=300}"
export STUDIO_RENDER_PORT STUDIO_RENDER_HOST

now() { date +%s; }

# log <event> [<json fields prefixed with a comma>]
log() {
  echo "{\"service\":\"studio-entrypoint\",\"event\":\"$1\"${2:-}}"
}

if [ -z "${STUDIO_INTERNAL_SECRET:-}" ]; then
  log warning ',"message":"STUDIO_INTERNAL_SECRET is unset; /internal/render answers 503"'
fi

sidecar_pid=""
sidecar_started=0
sidecar_starts=0
backoff=$STUDIO_SIDECAR_BACKOFF_MIN_S
restart_at=0
stopping=0

start_sidecar() {
  bun studio-render/server.ts &
  sidecar_pid=$!
  sidecar_started=$(now)
  sidecar_starts=$((sidecar_starts + 1))
  log sidecar-started ",\"pid\":$sidecar_pid,\"starts\":$sidecar_starts"
}

# The sidecar exited: log it and decide when it comes back.
sidecar_exited() {
  code=$1
  uptime=$(( $(now) - sidecar_started ))
  sidecar_pid=""
  if [ "$stopping" -eq 1 ]; then
    log sidecar-exited ",\"code\":$code,\"uptimeSec\":$uptime,\"restartInMs\":null"
    return
  fi
  if [ "$code" -eq 0 ]; then
    delay=0
  else
    if [ "$uptime" -ge "$STUDIO_SIDECAR_BACKOFF_RESET_S" ]; then
      backoff=$STUDIO_SIDECAR_BACKOFF_MIN_S
    fi
    delay=$backoff
    backoff=$((backoff * 2))
    if [ "$backoff" -gt "$STUDIO_SIDECAR_BACKOFF_MAX_S" ]; then
      backoff=$STUDIO_SIDECAR_BACKOFF_MAX_S
    fi
  fi
  restart_at=$(( $(now) + delay ))
  log sidecar-exited ",\"code\":$code,\"uptimeSec\":$uptime,\"restartInMs\":$((delay * 1000))"
  if [ "$delay" -eq 0 ]; then
    start_sidecar
  fi
}

on_signal() {
  stopping=1
  log stopping
  if [ -n "$sidecar_pid" ]; then kill -TERM "$sidecar_pid" 2>/dev/null || true; fi
  kill -TERM "$nginx_pid" 2>/dev/null || true
}
trap on_signal TERM INT

cd "$STUDIO_HOME" || exit 1

"$NGINX_ENTRYPOINT" "$@" &
nginx_pid=$!

start_sidecar

while :; do
  if [ -n "$sidecar_pid" ] && ! kill -0 "$sidecar_pid" 2>/dev/null; then
    wait "$sidecar_pid"
    sidecar_exited $?
  elif [ -z "$sidecar_pid" ] && [ "$stopping" -eq 0 ] && [ "$(now)" -ge "$restart_at" ]; then
    start_sidecar
  fi

  if ! kill -0 "$nginx_pid" 2>/dev/null; then
    wait "$nginx_pid"
    code=$?
    log nginx-exited ",\"code\":$code"
    if [ -n "$sidecar_pid" ]; then
      kill -TERM "$sidecar_pid" 2>/dev/null || true
      wait "$sidecar_pid" 2>/dev/null
    fi
    # Never 0: the editor is gone, the platform must replace the container.
    exit 1
  fi

  sleep 1
done
