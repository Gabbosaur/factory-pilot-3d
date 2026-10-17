#!/usr/bin/env bash
# Secret scan → stage explicit paths → commit → push. Output in .tmp/push.log
set -u
mkdir -p .tmp
{
  echo '--- secret scan (tracked + to-be-added files)'
  if grep -rIlE 'evo_[A-Za-z0-9]{20,}|rc-[0-9a-f]{40,}' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.tmp --exclude='.env' --exclude='.env.*' . ; then
    echo 'SECRET FOUND – aborting'; echo fail > .tmp/push.done; exit 1
  fi
  echo 'clean'
  git add .gitignore .env.example .nvmrc README.md package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs vitest.config.mts \
    .kiro/specs app modules server shared data/factories data/manuals data/memory-seed.json data/replay public scripts tests
  git rm -q --cached vitest.config.ts 2>/dev/null || true
  echo '--- staged'
  git diff --cached --name-only
  echo '--- ignored check'
  git diff --cached --name-only | grep -E '(^|/)\.env$|\.tmp/|node_modules|manuals\.generated' && { echo 'UNEXPECTED FILE STAGED – aborting'; echo fail > .tmp/push.done; exit 1; }
  git commit -q -m "FactoryPilot 3D: working prototype (English UI, AMD Token Factory agents, replay)" \
    -m "3D factory map, simulator and anomaly engine, root-cause analysis, impact in EUR, diagnosis (DeepSeek-V4-Flash) and safety (Gemma-4-31B-IT) on AMD Token Factory, deterministic escalation, L0-L3 autonomy, factory memory (local + Evolus adapter), onboarding, recorded replay for the demo. 29 tests passing." && echo committed
  git push 2>&1 | tail -5
  git status -sb | head -1
  git log --oneline -3
} > .tmp/push.log 2>&1
echo ok > .tmp/push.done
