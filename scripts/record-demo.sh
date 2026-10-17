#!/usr/bin/env bash
# Builds the app, starts it with RECORD_MODE=1, runs both demo scenarios against the real
# AMD Token Factory and rebuilds the replay index. Logs go to .tmp/.
set -u
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null
mkdir -p .tmp
rm -f .tmp/record.*
export NEXT_TELEMETRY_DISABLED=1

npm run build > .tmp/record.build.log 2>&1 || { echo "build failed" > .tmp/record.done; exit 1; }
# free the port from any previous run
for pid in $(ss -ltnp 2>/dev/null | grep ':3100 ' | grep -oE 'pid=[0-9]+' | cut -d= -f2); do kill "$pid" 2>/dev/null; done
sleep 1
RECORD_MODE=1 npx next start -p 3100 > .tmp/record.server.log 2>&1 &
SERVER=$!
for i in $(seq 1 60); do curl -s -m 2 http://localhost:3100/api/health > /dev/null && break; sleep 2; done

for s in p1-bearing k1-overheat; do
  # skip scenarios whose recordings already exist for both agents (delete files to force re-record)
  if ls data/replay/diagnosi.$s.*.json >/dev/null 2>&1 && ls data/replay/sicurezza.$s.*.json >/dev/null 2>&1; then
    echo "skip $s (already recorded)" >> .tmp/record.smoke.log; continue
  fi
  npx tsx scripts/e2e-smoke.ts http://localhost:3100 $s >> .tmp/record.smoke.log 2>&1
  echo "$s exit=$?" >> .tmp/record.smoke.log
done

kill $SERVER 2>/dev/null
npx tsx scripts/build-data.ts >> .tmp/record.smoke.log 2>&1
ls data/replay >> .tmp/record.smoke.log
echo ok > .tmp/record.done
