#!/usr/bin/env bash
# ============================================================
# MuchiNavi 本番ドリフト検知スクリプト
# ============================================================
# 目的: 本番サーバー上で直接編集された未コミット変更を検知し、
#       ログに記録・任意でメール通知する。
#
# 使い方（cron で定期実行）:
#   0 9 * * * bash /home/bitnami/muchinavi/scripts/check-drift.sh
#
# 出力:
#   - 変更あり: ログ $HOME/muchinavi-drift.log に記録、exit 1
#   - 変更なし: 何もしない、exit 0
#
# メール通知（任意）:
#   環境変数 DRIFT_NOTIFY_EMAIL を設定すると mailx でメール送信
# ============================================================

set -u

REPO_DIR="${REPO_DIR:-$HOME/muchinavi}"
LOG_FILE="${DRIFT_LOG:-$HOME/muchinavi-drift.log}"
TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S %Z')"

cd "$REPO_DIR" 2>/dev/null || { echo "[$TIMESTAMP] ERROR: cannot cd $REPO_DIR" >> "$LOG_FILE"; exit 1; }

# ドリフト検知（tracked ファイルの変更のみ。untracked は .env/node_modules 等の通常運用ファイルなので除外）
if git diff --quiet 2>/dev/null && git diff --cached --quiet 2>/dev/null; then
  # clean state
  exit 0
fi
# tracked ファイルの modified を取得（?? untracked は含まない）
STATUS_OUTPUT="$(git status --porcelain 2>/dev/null | grep -v '^??')"
if [ -z "$STATUS_OUTPUT" ]; then
  exit 0
fi

# === 変更検出 → ログ ===
{
  echo ""
  echo "================================================================"
  echo "[$TIMESTAMP] ⚠️  本番ドリフト検出"
  echo "================================================================"
  echo "変更ファイル:"
  echo "$STATUS_OUTPUT"
  echo ""
  echo "git diff（最初の200行）:"
  git diff 2>/dev/null | head -200
  echo ""
  echo "対応: ローカルに反映 → commit → push → PR → safe-pull.sh で再デプロイ"
  echo "================================================================"
} >> "$LOG_FILE"

# === 任意: メール通知 ===
if [ -n "${DRIFT_NOTIFY_EMAIL:-}" ] && command -v mailx >/dev/null 2>&1; then
  {
    echo "本番サーバー上で未コミットのローカル変更が検出されました。"
    echo ""
    echo "時刻: $TIMESTAMP"
    echo "サーバー: $(hostname)"
    echo ""
    echo "変更ファイル:"
    echo "$STATUS_OUTPUT"
    echo ""
    echo "対応:"
    echo "  1. 本番の変更をローカルに反映（手動編集を Git に取り込む）"
    echo "  2. commit → push → PR → merge"
    echo "  3. 本番で bash ~/muchinavi/scripts/safe-pull.sh を実行"
    echo ""
    echo "詳細ログ: $LOG_FILE"
  } | mailx -s "⚠️ MuchiNavi 本番ドリフト検出 ($TIMESTAMP)" "$DRIFT_NOTIFY_EMAIL" 2>/dev/null || true
fi

exit 1
