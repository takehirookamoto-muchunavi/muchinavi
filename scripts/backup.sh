#!/bin/bash
# ============================================================
# MuchiNavi データバックアップスクリプト（Bitnami Lightsail 用）
# cron: 0 3 * * * /bin/bash $HOME/muchinavi/scripts/backup.sh >> $HOME/muchinavi-backups/backup.log 2>&1
# ============================================================

set -u

APP_DIR="${APP_DIR:-$HOME/muchinavi}"
DATA_DIR="$APP_DIR/server/data"
BACKUP_DIR="${BACKUP_DIR:-$HOME/muchinavi-backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/muchinavi_data_$TIMESTAMP.tar.gz"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

if [ -d "$DATA_DIR" ]; then
  EXTRA_FILES=""
  [ -f "$APP_DIR/server/.env" ] && EXTRA_FILES="$EXTRA_FILES .env"
  [ -f "$APP_DIR/server/.env.save" ] && EXTRA_FILES="$EXTRA_FILES .env.save"
  tar -czf "$BACKUP_FILE" -C "$APP_DIR/server" data/ $EXTRA_FILES 2>/dev/null
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] ✓ バックアップ作成: $BACKUP_FILE ($SIZE)"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] ✗ エラー: $DATA_DIR が見つかりません"
  exit 1
fi

if ! tar -tzf "$BACKUP_FILE" > /dev/null 2>&1; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] ✗ 警告: $BACKUP_FILE の整合性チェック失敗"
  exit 1
fi

DELETED=$(find "$BACKUP_DIR" -name "muchinavi_data_*.tar.gz" -mtime +"$KEEP_DAYS" -delete -print 2>/dev/null | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] 🗑  古いバックアップ ${DELETED}件 を削除（${KEEP_DAYS}日以上前）"
fi

COUNT=$(ls -1 "$BACKUP_DIR"/muchinavi_data_*.tar.gz 2>/dev/null | wc -l)
echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] 📊 現在のバックアップ数: ${COUNT}件"
