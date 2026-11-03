#!/usr/bin/env bash
# Build and run the LinkyRSS test stack (redis, crawler web app, crawler job workers)
# from any git branch, on the local docker daemon or a remote one.
#
# Usage: scripts/test-env.sh [up|down|logs|ps] [--branch <ref>] [--host <docker host>] [--port <port>]
#
#   up      build the branch and start the stack (default)
#   down    stop the stack and remove its volumes
#   logs    follow the logs of the stack
#   ps      show the stack's containers
#
#   --branch <ref>   git branch, tag or commit to build (default: the working tree as it is)
#   --host <host>    docker host to run on, e.g. ssh://user@server (default: $DOCKER_HOST or local)
#   --port <port>    host port for the web app (default: 3000)
#
# OPENAI_API_KEY is passed through to the containers; summarising needs it.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cmd=up
branch=""
port="${LINKYRSS_PORT:-3000}"

while [ $# -gt 0 ]; do
  case "$1" in
    up|down|logs|ps) cmd="$1" ;;
    --branch) branch="$2"; shift ;;
    --host) export DOCKER_HOST="$2"; shift ;;
    --port) port="$2"; shift ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# one compose project per branch, so several branches can run side by side
name="${branch:-worktree}"
project="linkyrss-$(printf '%s' "$name" | tr -c 'a-zA-Z0-9' '-' | tr 'A-Z' 'a-z' | cut -c1-40)"
export LINKYRSS_PORT="$port"
export LINKYRSS_TAG="${project#linkyrss-}"
export LINKYRSS_DOCKERFILE="$root/docker/crawler.Dockerfile"
export LINKYRSS_SRC="$root/src"

workdir=""
cleanup() { [ -n "$workdir" ] && rm -rf "$workdir"; }
trap cleanup EXIT

if [ "$cmd" = up ] && [ -n "$branch" ]; then
  git -C "$root" fetch --quiet origin "$branch" 2>/dev/null || true
  ref="$branch"
  git -C "$root" rev-parse --verify --quiet "$ref^{commit}" >/dev/null || ref="origin/$branch"
  git -C "$root" rev-parse --verify --quiet "$ref^{commit}" >/dev/null \
    || { echo "cannot find branch or commit: $branch" >&2; exit 1; }
  echo "building $ref ($(git -C "$root" rev-parse --short "$ref"))"
  workdir="$(mktemp -d)"
  git -C "$root" archive "$ref" src | tar -x -C "$workdir"
  export LINKYRSS_SRC="$workdir/src"
fi

compose() { docker compose -f "$root/docker-compose.yml" -p "$project" "$@"; }

case "$cmd" in
  up)
    if [ -z "${OPENAI_API_KEY:-}" ]; then
      echo "warning: OPENAI_API_KEY is not set; crawling works but summaries will fail" >&2
    fi
    compose build
    compose up -d
    echo "LinkyRSS ($name) is starting on ${DOCKER_HOST:-localhost} port $port"
    echo "  feeds:  http://localhost:$port/"
    echo "  queues: http://localhost:$port/admin/queues"
    echo "stop it with: $0 down${branch:+ --branch $branch}"
    ;;
  down) compose down -v ;;
  logs) compose logs -f ;;
  ps) compose ps ;;
esac
