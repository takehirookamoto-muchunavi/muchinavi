# MuchiNavi LINE Bot (Phase 0 prototype)

岡本岳大さん（むちのち）のAI接客LINE Bot。
顧客の深層理解→物件提案→ライフプラン試算→面談予約までをAIが対応し、
契約意向・金額相談・急ぎ案件等は岡本さんへ即エスカレーションする。

## アーキテクチャ

```
LINE 公式アカウント
  │
  ▼ Webhook
Cloudflare Workers (Hono) ── Claude API (Haiku 4.5 / Opus 4.7)
  │                              │
  ▼                              ▼
Supabase (PostgreSQL)        会話履歴・顧客状態
  │
  ▼ 介入トリガー検出
LINE個人 + Slack Webhook → 岡本さん即通知
```

## セットアップ手順

```bash
# 1. 依存関係インストール
cd line-bot && npm install

# 2. ローカル開発用 .env.local 作成
cp .env.example .env.local
# .env.local の各値を埋める（チャットに貼り付け絶対NG）

# 3. ローカル起動
npm run dev

# 4. Cloudflare デプロイ
wrangler login
wrangler secret put LINE_CHANNEL_SECRET    # 以下、全シークレットを順次登録
npm run deploy

# 5. LINE Developers Console で Webhook URL を Workers の URL に設定
#    例: https://muchinavi-line-bot.YOUR-SUBDOMAIN.workers.dev/line/webhook
```

## ディレクトリ構成

```
line-bot/
├── src/
│   ├── index.ts            # Hono エントリ
│   ├── line/
│   │   ├── webhook.ts      # LINE Webhook受信・署名検証
│   │   └── client.ts       # LINE Reply/Push API クライアント
│   ├── llm/
│   │   ├── claude.ts       # Claude API 呼び出し
│   │   └── prompts/
│   │       └── system.ts   # システムプロンプト（MuchiNavi移植版）
│   ├── db/
│   │   ├── schema.sql      # Supabase スキーマ定義
│   │   └── client.ts       # Supabase クライアント
│   ├── triggers/
│   │   └── detector.ts     # 介入トリガー検出ロジック
│   └── notify/
│       ├── slack.ts        # Slack Webhook 通知
│       └── line.ts         # LINE Push (岡本さん個人) 通知
├── package.json
├── wrangler.toml           # Cloudflare Workers 設定
├── tsconfig.json
└── .env.example
```

## Phase 0 完了条件

- [ ] 友だち追加 → AI挨拶 → ヒアリング3ターン → 物件希望抽出
- [ ] 介入トリガー（面談・契約・金額・急ぎ）発火時に岡本さん通知
- [ ] 全会話ログが Supabase に保存される
- [ ] 岡本さん主観で応答品質 4/5 以上

## 関連ドキュメント

- 戦略: `muchinavi-agents/memory/project_line_bot_2026_05_14.md`
- コスト試算: 同上
- MuchiNavi 旧Geminiシステムプロンプト: `muchinavi-deploy/server/server.js:2657-3478`
