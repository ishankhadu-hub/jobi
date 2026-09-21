#!/usr/bin/env bash
# Spin up a throwaway Postgres in Docker, apply the Supabase shim + migrations +
# grants, and run the RLS isolation test against it. No Supabase account needed.
#
#   ./tests/rls-isolation/docker-run.sh
#
set -euo pipefail

NAME="jobi-rls-test-pg"
PORT="${RLS_TEST_PORT:-55432}"
export DATABASE_URL="postgresql://postgres:postgres@localhost:${PORT}/postgres"
export RLS_LOCAL_BOOTSTRAP=1

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "Starting postgres:16 on :${PORT} (container ${NAME})…"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p "${PORT}:5432" postgres:16 >/dev/null

echo -n "Waiting for Postgres to accept connections"
for i in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; then echo " — ready"; break; fi
  echo -n "."; sleep 1
  if [ "$i" = "60" ]; then echo; echo "Postgres did not become ready in time." >&2; exit 1; fi
done

node "$(dirname "$0")/run.mjs"
