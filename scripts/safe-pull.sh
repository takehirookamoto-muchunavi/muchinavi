#!/usr/bin/env bash
# ============================================================
# MuchiNavi 安全デプロイスクリプト（日常用）
# ============================================================
# 使い方（ローカルからSSH）:
#   ssh muchinavi "bash ~/muchinavi/scripts/safe-pull.sh"
#
# 動作:
#   1. 本番のローカル変更（直編集など）を自動 stash で保護
#   2. git pull で最新 main を取得
#   3. stash 内容が新 HEAD に既含まれていれば自動破棄、違えば保持＋警告
#   4. PM2 を restart
# ============================================================

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

# ===== 1. ローカル変更の検知と stash =====
STASHED=0
if [ -n "$(git status --porcelain)" ]; then
  STASH_MSG="safe-pull-auto-$TIMESTAMP"
  warn "本番ローカル変更を検出。stash 保護します: $STASH_MSG"
  git status --short | sed 's/^/    /'
  git stash push -u -m "$STASH_MSG" > /dev/null
  STASHED=1
  log "stash 完了"
fi

# ===== 2. git pull =====
log "git pull..."
git pull --ff-only || err "git pull 失敗（fast-forward できない状態）"

# ===== 3. stash 復元判定 =====
if [ "$STASHED" = "1" ]; then
  echo ""
  log "stash の整合性チェック..."
  # stash 内容が新 HEAD にすべて含まれているか（reverse apply が成功すれば既含）
  if git stash show -p stash@{0} -- 2>/dev/null | git apply --check --reverse - >/dev/null 2>&1; then
    warn "stash 内容は既に新 HEAD に含まれています。stash を破棄します。"
    git stash drop stash@{0}
  else
    warn "stash 内容が新 HEAD と異なります。失わないよう stash を保持。"
    warn "内容確認: git stash show -p stash@{0}"
    warn "適用: git stash pop   破棄: git stash drop stash@{0}"
    echo "⚠️  このデプロイは未反映のローカル変更があります。"
  fi
fi

# ===== 4. PM2 restart =====
export PATH=/opt/bitnami/node/bin:$PATH
log "PM2 restart..."
pm2 restart all --update-env

echo ""
log "デプロイ完了: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo ""
git log --oneline -3
echo ""
