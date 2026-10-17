#!/usr/bin/env bash
# Writes a snapshot of relevant processes and logs to .tmp/status.log (debug helper).
mkdir -p .tmp
{
  date +%T
  echo '--- processes'
  ps -eo pid,etime,args | grep -E 'next|vitest|tsx|e2e|record-demo|verify-replay|full-check' | grep -v -E 'grep|status.sh' | cut -c1-160
  echo '--- port 3100'
  ss -ltnp 2>/dev/null | grep ':3100 ' || echo free
  echo '--- build tail'
  tail -3 .tmp/record.build.log 2>/dev/null
  echo '--- smoke'
  cut -c1-300 .tmp/record.smoke.log 2>/dev/null
  echo '--- server'
  cut -c1-200 .tmp/record.server.log 2>/dev/null
} > .tmp/status.log 2>&1
