#!/bin/bash
# ============================================================
# MuchiNavi 初回デプロイスクリプト
# 対象: Ubuntu 22.04 LTS (AWS Lightsail)
# 使い方: sudo bash deploy.sh
# ============================================================

set -e  # エラー時に停止

# 色付きログ
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ========== 前提チェック ==========
if [ "$EUID" -ne 0 ]; then
  err "rootユーザーで実行してください: sudo bash deploy.sh"
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   🏠 MuchiNavi デプロイスクリプト        ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ========== 1. システム更新 ==========
log "システムパッケージを更新中..."
apt update && apt upgrade -y

# ========== 2. Node.js 20 LTS インストール ==========
if ! command -v node &> /dev/null; then
  log "Node.js 20 LTS をインストール中..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
else
  NODE_VER=$(node -v)
  log "Node.js は既にインストール済み: $NODE_VER"
fi

# ========== 3. PM2 インストール ==========
if ! command -v pm2 &> /dev/null; then
  log "PM2をインストール中..."
  npm install -g pm2
else
  log "PM2は既にインストール済み"
fi

# ========== 4. Nginx インストール ==========
if ! command -v nginx &> /dev/null; then
  log "Nginxをインストール中..."
  apt install -y nginx
else
  log "Nginxは既にインストール済み"
fi

# ========== 5. アプリケーションディレクトリ作成 ==========
APP_DIR="/var/www/muchinavi"
if [ ! -d "$APP_DIR" ]; then
  log "アプリケーションディレクトリを作成中..."
  mkdir -p $APP_DIR
fi

# アプリファイルがまだ無い場合の案内
if [ ! -f "$APP_DIR/package.json" ]; then
  warn "アプリケーションファイルを $APP_DIR にコピーしてください"
  warn "例: scp -r ./server ./package.json ./ecosystem.config.js ubuntu@<IP>:$APP_DIR/"
fi

# ========== 6. ログディレクトリ作成 ==========
mkdir -p /var/log/muchinavi
chown -R ubuntu:ubuntu /var/log/muchinavi

# ========== 7. データディレクトリ権限 ==========
mkdir -p $APP_DIR/server/data
chown -R ubuntu:ubuntu $APP_DIR

# ========== 8. バックアップディレクトリ ==========
mkdir -p /var/backups/muchinavi
chown -R ubuntu:ubuntu /var/backups/muchinavi

# ========== 9. Nginx設定 ==========
if [ -f "$APP_DIR/nginx.conf" ]; then
  log "Nginx設定をコピー中..."
  cp $APP_DIR/nginx.conf /etc/nginx/sites-available/muchinavi
  if [ ! -L /etc/nginx/sites-enabled/muchinavi ]; then
    ln -s /etc/nginx/sites-available/muchinavi /etc/nginx/sites-enabled/muchinavi
  fi
  # デフォルトサイトを無効化
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  log "Nginx設定完了"
else
  warn "nginx.confが見つかりません。後で手動設定してください"
fi

# ========== 10. SSL証明書ディレクトリ ==========
mkdir -p /etc/ssl/muchinavi
log "SSL証明書ディレクトリ: /etc/ssl/muchinavi/"
warn "SSL証明書を配置してください（CloudFlare Origin CertificateまたはLet's Encrypt）"

# ========== 11. npm install ==========
if [ -f "$APP_DIR/package.json" ]; then
  log "依存パッケージをインストール中..."
  cd $APP_DIR
  npm install --production
fi

# ========== 12. PM2起動 ==========
if [ -f "$APP_DIR/ecosystem.config.js" ] && [ -f "$APP_DIR/server/server.js" ]; then
  log "PM2でアプリケーションを起動中..."
  su - ubuntu -c "cd $APP_DIR && pm2 start ecosystem.config.js"
  su - ubuntu -c "pm2 save"
  # PM2の自動起動設定
  env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
  log "PM2自動起動設定完了"
else
  warn "アプリファイルが不完全です。ファイル配置後に以下を実行:"
  warn "  cd $APP_DIR && pm2 start ecosystem.config.js"
fi

# ========== 13. バックアップcron設定 ==========
if [ -f "$APP_DIR/scripts/backup.sh" ]; then
  chmod +x $APP_DIR/scripts/backup.sh
  # 毎日AM3:00にバックアップ
  CRON_LINE="0 3 * * * /bin/bash $APP_DIR/scripts/backup.sh >> /var/log/muchinavi/backup.log 2>&1"
  (crontab -u ubuntu -l 2>/dev/null | grep -v "backup.sh"; echo "$CRON_LINE") | crontab -u ubuntu -
  log "バックアップcron設定完了（毎日AM3:00）"
fi

# ========== 14. ファイアウォール ==========
log "ファイアウォール設定..."
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw --force enable
log "ファイアウォール有効化完了"

# ========== 完了 ==========
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   ✅ デプロイ準備完了！                   ║"
echo "╠══════════════════════════════════════════╣"
echo "║                                          ║"
echo "║   次のステップ:                            ║"
echo "║   1. .env ファイルを設定                   ║"
echo "║      vi $APP_DIR/server/.env              ║"
echo "║   2. SSL証明書を配置                       ║"
echo "║   3. ドメインDNSをこのサーバーIPに向ける      ║"
echo "║   4. pm2 restart muchinavi               ║"
echo "║                                          ║"
echo "╚══════════════════════════════════════════╝"
echo ""
