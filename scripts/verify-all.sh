#!/usr/bin/env bash
# One-shot pre-deploy gate: typecheck → build → unit tests → fresh local server (vault-injected key) → every smoke suite.
# Usage: bash scripts/verify-all.sh   (exit 0 = safe to deploy)
set -u
cd "$(dirname "$0")/.."
PORT=${PORT:-8110}; DIR=./data/verify-$$
fail=0
step() { printf '\n▸ %s\n' "$1"; }
step typecheck; npx tsc -p tsconfig.json --noEmit || fail=1
step build; npm run build >/dev/null 2>&1 && echo "built" || { echo "BUILD FAILED"; fail=1; }
step "unit tests"; npm test 2>&1 | grep -E "^ℹ (pass|fail)" || fail=1
step "local server :$PORT"
lsof -ti tcp:$PORT | xargs kill 2>/dev/null; sleep 0.3
# Key: from a local secrets vault when present, else OPENAI_API_KEY from the environment (never printed).
VAULT="$HOME/.claude/skills/vault/bin/vault"
if [ -x "$VAULT" ]; then RUN=("$VAULT" use openai-api-key --); else RUN=(); fi
"${RUN[@]}" env PORT=$PORT DATA_DIR=$DIR node --no-warnings --import ./server/early.js server/index.ts > "$DIR.log" 2>&1 &
SRV=$!
for i in $(seq 1 30); do curl -sf "http://localhost:$PORT/healthz" >/dev/null && break; sleep 0.5; done
for s in scripts/smoke*.mjs; do
  name=$(basename "$s" .mjs)
  out=$(node "$s" "http://localhost:$PORT" 2>&1); code=$?
  bad=$(printf '%s\n' "$out" | grep -c '✗')
  if [ $code -ne 0 ] || [ "$bad" -gt 0 ]; then echo "✗ $name (exit $code, $bad failed)"; printf '%s\n' "$out" | grep '✗' | head -5; fail=1; else echo "✓ $name"; fi
done
kill $SRV 2>/dev/null; lsof -ti tcp:$PORT | xargs kill 2>/dev/null; wait $SRV 2>/dev/null
if [ $fail -eq 0 ]; then rm -rf "$DIR" "$DIR.log"; else rm -rf "$DIR"; echo "server log kept: $DIR.log"; fi
[ $fail -eq 0 ] && echo -e "\nALL GREEN" || echo -e "\nNOT READY"
exit $fail
