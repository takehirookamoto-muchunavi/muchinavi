#!/usr/bin/env bash
set -u
REPO_DIR="${REPO_DIR:-$HOME/muchinavi}"
LOG_FILE="${DRIFT_LOG:-$HOME/muchinavi-drift.log}"
TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S %Z')"
cd "$REPO_DIR" 2>/dev/null || { echo "[$TIMESTAMP] ERROR: cannot cd $REPO_DIR" >> "$LOG_FILE"; exit 1; }

# tracked ファイルの変更のみ検知（untracked は .env/node_modules 等の通常運用ファイルなので除外）
if git diff --quiet 2>/dev/null && git diff --cached --quiet 2>/dev/null; then
  exit 0
fi
STATUS_OUTPUT="$(git status --porcelain 2>/dev/null | grep -v '^??')"
[ -z "$STATUS_OUTPUT" ] && exit 0

{
  echo ""
  echo "================================================================"
  echo "[$TIMESTAMP] ⚠️  本番ドリフト検出"
  echo "================================================================"
  echo "$STATUS_OUTPUT"
  echo ""
  echo "git diff（最初の200行）:"
  git diff 2>/dev/null | head -200
  echo ""
  echo "対応: ローカルに反映 → commit → push → PR → safe-pull.sh で再デプロイ"
  echo "================================================================"
} >> "$LOG_FILE"

if [ -n "${DRIFT_NOTIFY_EMAIL:-}" ] && command -v mailx >/dev/null 2>&1; then
  {
    echo "本番サーバー上で未コミットのローカル変更が検出されました。"
    echo "時刻: $TIMESTAMP / サーバー: $(hostname)"
    echo ""
    echo "変更ファイル:"
    echo "$STATUS_OUTPUT"
    echo ""
    echo "詳細ログ: $LOG_FILE"
  } | mailx -s "⚠️ MuchiNavi 本番ドリフト検出 ($TIMESTAMP)" "$DRIFT_NOTIFY_EMAIL" 2>/dev/null || true
fi
exit 1
