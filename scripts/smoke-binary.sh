#!/usr/bin/env bash
# Release check for one built executable: start it on an empty temp DATA_DIR, check version and embedded UI,
# run the eval/e2e.py regression, then stop it and delete the temp data.
# usage: scripts/smoke-binary.sh <binary> <testset-dir> [port]   (testset from eval/make-testset.sh)
# Claude settings come from the caller's environment, e.g. ANTHROPIC_BASE_URL/ANTHROPIC_API_KEY for magpie.
set -euo pipefail
bin="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
testset="$2"
port="${3:-3960}"
cd "$(dirname "$0")/.."
version=$(node -p 'require("./package.json").version')
data=$(mktemp -d)
DATA_DIR="$data" PORT="$port" "$bin" >"$data/server.log" 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; rm -rf "$data"' EXIT
for _ in $(seq 40); do curl -sf "http://localhost:$port/api/auth/me" >/dev/null && break; sleep 0.5; done

fail() { echo "FAIL $*"; cat "$data/server.log"; exit 1; }
grep -q "notion-meetings v$version " "$data/server.log" || fail "startup line is not v$version"
curl -sf "http://localhost:$port/api/auth/me" | grep -q "\"version\":\"$version\"" || fail "/api/auth/me does not report v$version"
cmp -s <(curl -sf "http://localhost:$port/") public/index.html || fail "embedded UI differs from public/index.html (rebuild)"
echo "PASS v$version starts, reports its version and serves the current UI"
python3 -I eval/e2e.py "http://localhost:$port" "$testset"
