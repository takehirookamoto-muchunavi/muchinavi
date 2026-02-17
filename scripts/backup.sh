#!/bin/bash
# ============================================================
# MuchiNavi データバックアップスクリプト
# cron: 0 3 * * * /bin/bash /var/www/muchinavi/scripts/backup.sh
# ============================================================

APP_DIR="/var/www/muchinavi"
DATA_DIR="$APP_DIR/server/data"
BACKUP_DIR="/var/backups/muchinavi"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/muchinavi_data_$TIMESTAMP.tar.gz"
KEEP_DAYS=7

# バックアップ作成
if [ -d "$DATA_DIR" ]; then
  tar -czf "$BACKUP_FILE" -C "$APP_DIR/server" data/
  echo "[$(date)] バックアップ作成: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
else
  echo "[$(date)] エラー: データディレクトリが見つかりません: $DATA_DIR"
  exit 1
fi

# 古いバックアップを削除（7日以上前）
DELETED=$(find "$BACKUP_DIR" -name "muchinavi_data_*.tar.gz" -mtime +$KEEP_DAYS -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date)] 古いバックアップ ${DELETED}件 を削除しました"
fi

# 現在のバックアップ数を表示
COUNT=$(ls -1 "$BACKUP_DIR"/muchinavi_data_*.tar.gz 2>/dev/null | wc -l)
echo "[$(date)] 現在のバックアップ数: ${COUNT}件"
