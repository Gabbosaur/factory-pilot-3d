#!/usr/bin/env bash
# Tests → record both demo scenarios on the real AMD API → verify offline replay. Logs in .tmp/.
set -u
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null
mkdir -p .tmp; rm -f .tmp/all.done .tmp/tests.final.log
pkill -f e2e-smoke 2>/dev/null
npx vitest --run 2>&1 | grep -E "×|FAIL|Tests |AssertionError" > .tmp/tests.final.log
bash scripts/record-demo.sh && bash scripts/verify-replay.sh
echo ALL_DONE > .tmp/all.done
