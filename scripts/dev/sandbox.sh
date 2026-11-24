#!/usr/bin/env bash
# Isolated, disposable OutcomeGo stack for testing first-run setup with hot reload.
#
#   scripts/dev/sandbox.sh up        start everything (parts that already run are kept)
#   scripts/dev/sandbox.sh status    show what runs and where
#   scripts/dev/sandbox.sh logs [server|worker|computer|web]   follow a log (default: server)
#   scripts/dev/sandbox.sh reset     fresh first run: new empty database and owner, same processes
#   scripts/dev/sandbox.sh down      stop everything and delete the sandbox data
#
# Cost: one 256 MB Postgres container on a RAM disk, plus bun --watch for server, worker and
# computer, plus one Vite dev server. No Electron, no turbo, no computer image.
#
# Isolation: every process starts under `env -i` with --no-env-file, so nothing is read from the
# repo's .env (it points at the shared debug database). The sandbox has its own database, tokens,
# data directories and ports, and never touches ~/.pi, the remote debug host or the
# openteam-debug/openteam-dev compose projects. Database, server, proxy and the app listen on
# 127.0.0.1 only. The computer hard-codes 0.0.0.0 (apps/computer/src/main.ts), so its port is
# reachable from the LAN; everything except /health/live needs the sandbox's random control token.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
dir=${OUTCOMEGO_SANDBOX_DIR:-/tmp/outcomego-sandbox}
web_port=15173
server_port=18787
computer_port=18790
proxy_port=18791
db_port=15432
db_container=outcomego-sandbox-pg
db_image=postgres:17-alpine
owner_user=sandbox

die() { echo "error: $*" >&2; exit 1; }

port_pid() { lsof -t -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -n 1 || true; }

# One file holds the sandbox's own secrets; it is created once and never printed except the
# owner login, which the person testing needs.
load_secrets() {
  mkdir -p "$dir"/{logs,pids,home,workspace,agent-data,sand-data,assets,box-store,pi-agent}
  if [[ ! -f $dir/secrets.env ]]; then
    ( umask 077
      {
        echo "DB_PASSWORD=$(openssl rand -hex 16)"
        echo "CONTROL_TOKEN=$(openssl rand -hex 24)"
        echo "AUTH_SECRET=$(openssl rand -hex 32)"
        echo "OWNER_PASSWORD=$(openssl rand -hex 8)"
      } >"$dir/secrets.env" )
  fi
  # shellcheck disable=SC1091
  . "$dir/secrets.env"
  database_url="postgresql://outcomego:$DB_PASSWORD@127.0.0.1:$db_port/outcomego"
  version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$root/apps/server/package.json" | head -n 1)
  [[ -n $version ]] || die "cannot read the version from apps/server/package.json"

  common=(
    "PATH=$PATH" "HOME=$dir/home" "TMPDIR=${TMPDIR:-/tmp}" "LANG=en_US.UTF-8"
    "DATABASE_URL=$database_url"
    "OUTCOMEGO_VERSION=$version+dev"
    "OUTCOMEGO_CONTROL_TOKEN=$CONTROL_TOKEN"
    "OUTCOMEGO_AUTH_SECRET=$AUTH_SECRET"
    "OUTCOMEGO_AUTH_MODE=required"
    "OUTCOMEGO_ACCESS_MODE=local"
    "OUTCOMEGO_OUTCOMES_ENABLED=true"
    "OUTCOMEGO_COMPUTER_URL=http://127.0.0.1:$computer_port"
    "OUTCOMEGO_SERVER_URL=http://127.0.0.1:$server_port"
    "OUTCOMEGO_PUBLIC_URL=http://127.0.0.1:$server_port"
    "OUTCOMEGO_WORKSPACE_ROOT=$dir/workspace"
    "OUTCOMEGO_AGENT_DATA_ROOT=$dir/agent-data"
    "OUTCOMEGO_ASSET_ROOT=$dir/assets"
  )
}

launch() { # launch <name> <cwd> <env...> -- <command...>
  local name=$1 cwd=$2; shift 2
  local extra=()
  while [[ $1 != -- ]]; do extra+=("$1"); shift; done
  shift
  cd "$cwd"
  nohup env -i "${common[@]}" "${extra[@]}" "$@" >"$dir/logs/$name.log" 2>&1 &
  echo $! >"$dir/pids/$name"
  cd "$root"
}

running() { # running <name>
  local pid; pid=$(cat "$dir/pids/$1" 2>/dev/null || true)
  [[ -n $pid ]] && kill -0 "$pid" 2>/dev/null
}

stop_one() { # stop_one <name> <port>
  local name=$1 port=$2 pid
  pid=$(cat "$dir/pids/$name" 2>/dev/null || true)
  if [[ -n $pid ]]; then
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
  fi
  [[ $port -gt 0 ]] || { rm -f "$dir/pids/$name"; return 0; }
  # bun --watch re-executes itself, so the listener can outlive the recorded pid.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pid=$(port_pid "$port"); [[ -z $pid ]] && break
    kill -TERM "$pid" 2>/dev/null || true; sleep 0.3
  done
  pid=$(port_pid "$port"); [[ -n $pid ]] && kill -KILL "$pid" 2>/dev/null || true
  rm -f "$dir/pids/$name"
}

wait_for() { # wait_for <label> <seconds> <command...>
  local label=$1 seconds=$2; shift 2
  local deadline=$((SECONDS + seconds))
  until "$@" >/dev/null 2>&1; do
    ((SECONDS < deadline)) || { echo "timed out waiting for $label; see $dir/logs" >&2; return 1; }
    sleep 0.5
  done
}

ensure_ports_free() {
  local name port
  for entry in "web:$web_port" "server:$server_port" "computer:$computer_port" "proxy:$proxy_port"; do
    name=${entry%%:*}; port=${entry##*:}
    running "${name/proxy/computer}" 2>/dev/null && continue
    [[ -z $(port_pid "$port") ]] || die "port $port ($name) is already used by pid $(port_pid "$port"); not touching it"
  done
}

start_database() {
  if docker ps --format '{{.Names}}' | grep -qx "$db_container"; then return; fi
  docker rm -f "$db_container" >/dev/null 2>&1 || true
  [[ -z $(port_pid "$db_port") ]] || die "port $db_port is already in use"
  # RAM-disk data and relaxed durability: this database is thrown away by design.
  docker run -d --name "$db_container" --memory 256m --cpus 1 \
    -p "127.0.0.1:$db_port:5432" --tmpfs /var/lib/postgresql/data:rw,size=160m \
    -e POSTGRES_DB=outcomego -e POSTGRES_USER=outcomego -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    "$db_image" -c fsync=off -c synchronous_commit=off -c full_page_writes=off \
    -c shared_buffers=24MB -c max_connections=30 >/dev/null
  wait_for "postgres" 60 docker exec "$db_container" pg_isready -h 127.0.0.1 -U outcomego -d outcomego
}

prepare_database() {
  # deploy-schema loads the repo .env through dotenv but never overrides what is already set,
  # and DATABASE_URL always is; the guard makes that explicit.
  [[ $database_url == *"127.0.0.1:$db_port/"* ]] || die "refusing to deploy: DATABASE_URL is not the sandbox database"
  ( cd "$root/packages/db" && env -i "${common[@]}" bun --no-env-file scripts/deploy-schema.ts ) \
    >"$dir/logs/db.log" 2>&1 || { cat "$dir/logs/db.log" >&2; die "schema deploy failed"; }
  ( cd "$root/apps/server" && printf '{"operation":"setup","username":"%s","password":"%s"}' "$owner_user" "$OWNER_PASSWORD" \
      | env -i "${common[@]}" bun --no-env-file src/main.ts owner-credentials ) \
    >>"$dir/logs/db.log" 2>&1 || { cat "$dir/logs/db.log" >&2; die "owner creation failed"; }
  touch "$dir/db-prepared"
}

server_ready() {
  [[ $(curl -fsS -m 3 "http://127.0.0.1:$server_port/api/v0/health" | sed -n 's/.*"status" *: *"\([a-z]*\)".*/\1/p') == ready ]]
}

start_stack() {
  # Generated plugin registry, then the three bun --watch services and the renderer.
  ( cd "$root/apps/server" && env -i "${common[@]}" bun --no-env-file ../../packages/plugins/scripts/generate.ts ) >"$dir/logs/prepare.log" 2>&1
  ( cd "$root/apps/computer" && env -i "${common[@]}" bun --no-env-file run build:browser-network ) >>"$dir/logs/prepare.log" 2>&1

  running computer || launch computer "$root/apps/computer" \
    "OUTCOMEGO_COMPUTER_PORT=$computer_port" "OUTCOMEGO_BROWSER_PROXY_PORT=$proxy_port" \
    "OUTCOMEGO_PI_AGENT_DIR=$dir/pi-agent" "OUTCOMEGO_AGENT_DATA_CANONICAL_ROOT=$dir/sand-data" \
    "OUTCOMEGO_BOX_STORE_ROOT=$dir/box-store" -- bun --no-env-file --watch src/main.ts
  wait_for "computer" 90 curl -fsS -m 2 "http://127.0.0.1:$computer_port/health/live" \
    || { tail -n 25 "$dir/logs/computer.log" >&2; return 1; }

  running server || launch server "$root/apps/server" \
    "OUTCOMEGO_PORT=$server_port" "OUTCOMEGO_SERVER_HOST=127.0.0.1" "OUTCOMEGO_SCREEN_VIEWER_HOST=127.0.0.1" \
    -- bun --no-env-file --watch src/main.ts
  running worker || launch worker "$root/apps/worker" "OUTCOMEGO_WORKER_CONCURRENCY=2" \
    -- bun --no-env-file --watch src/main.ts
  wait_for "server" 90 curl -sS -m 2 -o /dev/null "http://127.0.0.1:$server_port/api/v0/health" \
    || { tail -n 25 "$dir/logs/server.log" >&2; return 1; }

  # No VITE_OUTCOMEGO_API_URL: the page's own origin is the API, and Vite proxies /api to the
  # sandbox server. That keeps the app's saved server address separate from every other origin.
  running web || launch web "$root/apps/desktop" "OUTCOMEGO_DEV_HOST=127.0.0.1" \
    "OUTCOMEGO_SANDBOX_VITE_CACHE=$dir/vite-cache" \
    -- ./node_modules/.bin/vite --config "$root/scripts/dev/sandbox-vite.config.ts" \
    --host 127.0.0.1 --port "$web_port" --strictPort
  wait_for "web" 120 curl -fsS -m 3 "http://127.0.0.1:$web_port/" \
    || { tail -n 25 "$dir/logs/web.log" >&2; return 1; }
}

show() {
  cat <<EOF

Sandbox is up (data in $dir)
  App (hot reload)   http://127.0.0.1:$web_port/
  Server API         http://127.0.0.1:$server_port/
  Owner login        $owner_user / $OWNER_PASSWORD
  Logs               scripts/dev/sandbox.sh logs [server|worker|computer|web]
  Fresh first run    scripts/dev/sandbox.sh reset
  Stop and delete    scripts/dev/sandbox.sh down
EOF
}

cmd_up() {
  command -v docker >/dev/null || die "docker is required for the sandbox database"
  docker info >/dev/null 2>&1 || die "the docker daemon is not running"
  docker image inspect "$db_image" >/dev/null 2>&1 || die "$db_image is not available locally; pull it once with: docker pull $db_image"
  load_secrets
  ensure_ports_free
  # The database lives in RAM: a container that is gone takes its schema and owner with it.
  docker ps --format '{{.Names}}' | grep -qx "$db_container" || rm -f "$dir/db-prepared"
  start_database
  [[ -f $dir/db-prepared ]] || prepare_database
  start_stack
  show
}

cmd_status() {
  load_secrets
  local name
  for name in computer server worker web; do
    printf '%-9s %s\n' "$name" "$(running "$name" && echo "running (pid $(cat "$dir/pids/$name"))" || echo stopped)"
  done
  printf '%-9s %s\n' postgres "$(docker ps --format '{{.Names}}' | grep -qx "$db_container" && echo "running ($db_container, port $db_port)" || echo stopped)"
  server_ready && echo "server health: ready" || echo "server health: not ready"
}

cmd_reset() {
  load_secrets
  stop_one worker 0; stop_one server "$server_port"; stop_one computer "$computer_port"
  docker rm -f "$db_container" >/dev/null 2>&1 || true
  rm -f "$dir/db-prepared"
  rm -rf "$dir"/{workspace,agent-data,sand-data,assets,box-store,pi-agent}
  mkdir -p "$dir"/{workspace,agent-data,sand-data,assets,box-store,pi-agent}
  start_database
  prepare_database
  start_stack
  show
}

cmd_down() {
  load_secrets
  stop_one web "$web_port"; stop_one worker 0; stop_one server "$server_port"
  stop_one computer "$computer_port"
  docker rm -f "$db_container" >/dev/null 2>&1 || true
  [[ -f $dir/secrets.env ]] || die "$dir is not a sandbox directory; not deleting it"
  rm -rf "$dir"
  echo "sandbox stopped and deleted"
}

cmd_logs() {
  local name=${1:-server}
  case $name in server|worker|computer|web|db|prepare) ;; *) die "unknown log: $name" ;; esac
  exec tail -n 80 -f "$dir/logs/$name.log"
}

case "${1:-}" in
  up) cmd_up ;;
  status) cmd_status ;;
  reset) cmd_reset ;;
  down) cmd_down ;;
  logs) shift; cmd_logs "${1:-}" ;;
  *) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
