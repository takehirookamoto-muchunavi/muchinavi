#!/usr/bin/env bash
set -euo pipefail
REPO_DIR="${REPO_DIR:-$HOME/muchinavi}"
cd "$REPO_DIR"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

TIMESTAMP="$(date '+%Y%m%d_%H%M%S')"
echo ""
echo "===== MuchiNavi 安全デプロイ $(date '+%Y-%m-%d %H:%M:%S %Z') ====="
echo ""

# tracked ファイルの変更のみ stash（untracked は保護しない）
STASHED=0
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  STASH_MSG="safe-pull-auto-$TIMESTAMP"
  warn "本番ローカル変更を検出（tracked）。stash 保護します: $STASH_MSG"
  git status --short | grep -v '^??' | sed 's/^/    /'
  git stash push -m "$STASH_MSG" > /dev/null
  STASHED=1
  log "stash 完了"
fi

log "git pull..."
git pull --ff-only || err "git pull 失敗（fast-forward できない状態）"

if [ "$STASHED" = "1" ]; then
  echo ""
  log "stash の整合性チェック..."
  if git stash show -p stash@{0} -- 2>/dev/null | git apply --check --reverse - >/dev/null 2>&1; then
    warn "stash 内容は既に新 HEAD に含まれています。stash を破棄します。"
    git stash drop stash@{0}
  else
    warn "stash 内容が新 HEAD と異なります。失わないよう保持。"
    warn "内容確認: git stash show -p stash@{0}"
    warn "適用: git stash pop   破棄: git stash drop stash@{0}"
  fi
fi

export PATH=/opt/bitnami/node/bin:$PATH
log "PM2 restart..."
pm2 restart all --update-env

echo ""
log "デプロイ完了: $(date '+%Y-%m-%d %H:%M:%S %Z')"
git log --oneline -3
echo ""
