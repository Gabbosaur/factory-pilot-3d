#!/usr/bin/env bash
# Starts the already-built app with REPLAY_MODE=1 and runs both scenarios: no AMD calls should be made.
set -u
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null
mkdir -p .tmp; rm -f .tmp/replay.*
for pid in $(ss -ltnp 2>/dev/null | grep ':3100 ' | grep -oE 'pid=[0-9]+' | cut -d= -f2); do kill "$pid" 2>/dev/null; done
sleep 1
npx tsx scripts/build-data.ts > .tmp/replay.smoke.log 2>&1
NEXT_TELEMETRY_DISABLED=1 npm run build > .tmp/replay.build.log 2>&1 || { echo "build failed" > .tmp/replay.done; exit 1; }
REPLAY_MODE=1 NEXT_TELEMETRY_DISABLED=1 npx next start -p 3100 > .tmp/replay.server.log 2>&1 &
SERVER=$!
for i in $(seq 1 60); do curl -s -m 2 http://localhost:3100/api/health > /dev/null && break; sleep 2; done
for s in p1-bearing k1-overheat; do
  npx tsx scripts/e2e-smoke.ts http://localhost:3100 $s >> .tmp/replay.smoke.log 2>&1
  echo "$s exit=$?" >> .tmp/replay.smoke.log
done
kill $SERVER 2>/dev/null
echo ok > .tmp/replay.done
