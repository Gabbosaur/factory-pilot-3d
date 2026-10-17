#!/usr/bin/env bash
# Secret scan → stage explicit paths → commit → push. Output in .tmp/push.log
set -u
mkdir -p .tmp
MSG_SUBJECT="${1:-FactoryPilot 3D update}"
MSG_BODY="${2:-}"
{
  echo '--- secret scan'
  if grep -rIlE 'evo_[A-Za-z0-9]{20,}|rc-[0-9a-f]{40,}' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.tmp --exclude='.env' --exclude='.env.*' . ; then
    echo 'SECRET FOUND – aborting'; echo fail > .tmp/push.done; exit 1
  fi
  echo 'clean'
  git add .gitignore .env.example .nvmrc README.md package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs vitest.config.mts \
    .kiro/specs app modules server shared data/factories data/manuals data/memory-seed.json data/replay public scripts tests
  echo '--- staged'
  git diff --cached --name-only
  if git diff --cached --name-only | grep -E '(^|/)\.env$|\.tmp/|node_modules|manuals\.generated'; then
    echo 'UNEXPECTED FILE STAGED – aborting'; echo fail > .tmp/push.done; exit 1
  fi
  git commit -q -m "$MSG_SUBJECT" ${MSG_BODY:+-m "$MSG_BODY"} && echo committed
  git push 2>&1 | tail -4
  git log --oneline -3
} > .tmp/push.log 2>&1
echo ok > .tmp/push.done
