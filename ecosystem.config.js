// PM2 設定ファイル - MuchiNavi
// 使い方: pm2 start ecosystem.config.js
module.exports = {
  apps: [{
    name: 'muchinavi',
    script: './server/server.js',
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    // ログ設定
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/var/log/muchinavi/error.log',
    out_file: '/var/log/muchinavi/out.log',
    merge_logs: true,
    // 自動再起動（クラッシュ時）
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 5000,
  }]
};
