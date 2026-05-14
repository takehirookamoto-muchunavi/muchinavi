# デプロイ手順書（岡本さん向け）

このドキュメント通りに上から順に実行すれば、MuchiNavi LINE Bot を本番稼働できます。
所要時間：**30〜60分**（アカウント作成済みなら30分以内）。

---

## 0. 前提：必要なアカウント

事前に以下のアカウントを作成してください（全て無料枠OK）：

- [ ] **LINE Developers** … https://developers.line.biz/console/
- [ ] **Cloudflare** … https://dash.cloudflare.com/sign-up
- [ ] **Supabase** … https://supabase.com/dashboard/sign-up
- [ ] **Anthropic** … https://console.anthropic.com/
- [ ] **Slack**（介入通知用・既存ワークスペースで可）

ターミナル / コマンドラインを開いて、以下を実行できる環境であることを確認：

```bash
node --version    # v18 以上が望ましい
npm --version
git --version
```

---

## 1. ローカル準備（5分）

```bash
cd /Users/okamototakehiro/MuchiNavi/muchinavi-deploy/line-bot
npm install
```

---

## 2. LINE Developers でキー取得（10分）

1. https://developers.line.biz/console/ にログイン
2. 既存の岡本さんの公式アカウントが紐づいている **プロバイダー** を選択
3. 既存の **Messaging API チャネル** を開く（なければ「Create a new channel」→「Messaging API」）
4. 「**Basic settings**」タブ：
   - **Channel secret** をコピー → 後で `.env.local` に貼り付け
5. 「**Messaging API**」タブ：
   - **Channel access token (long-lived)** で「Issue」ボタンを押す → 表示された token をコピー
   - **Webhook URL** はあとで設定します（Cloudflare デプロイ後）
   - **Use webhook** を ON にする
   - **Auto-reply messages** を OFF（AIで応答するため）
   - **Greeting messages** を OFF（Bot側で挨拶送るため）

---

## 3. Supabase プロジェクト作成（10分）

1. https://supabase.com/dashboard でログイン → 「New project」
2. プロジェクト名「muchinavi-line-bot」、リージョン「Northeast Asia (Tokyo)」、DB password 任意（必ず保存）
3. プロジェクト作成完了後、左サイドバー「**Project Settings**」→「**API**」：
   - **URL** をコピー（`SUPABASE_URL` 用）
   - **service_role** key をコピー（`SUPABASE_SERVICE_KEY` 用・★絶対に公開しない）
4. 左サイドバー「**SQL Editor**」→「New query」：
   - `line-bot/src/db/schema.sql` の全内容をコピペ → 「Run」
   - 「Success」と出れば OK（4テーブル作成済）

---

## 4. Anthropic API キー取得（3分）

1. https://console.anthropic.com/ でログイン
2. 左サイドバー「API keys」→「Create Key」
3. 名前「muchinavi-line-bot」→ Create → 表示された `sk-ant-...` をコピー

---

## 5. Slack Webhook 作成（5分）

1. https://api.slack.com/apps → 「Create New App」→「From scratch」
2. App Name「MuchiNavi 介入通知」、ワークスペース選択 → Create
3. 左サイドバー「**Incoming Webhooks**」→ ON にする
4. 「Add New Webhook to Workspace」→ 通知を受け取るチャネル選択 → 「Allow」
5. 生成された **Webhook URL** をコピー（`https://hooks.slack.com/services/...`）

---

## 6. `.env.local` に値を記入（5分）

```bash
cd /Users/okamototakehiro/MuchiNavi/muchinavi-deploy/line-bot
cp .env.example .env.local
```

エディタ（VSCode 等）で `.env.local` を開き、各値を貼り付け：

```bash
LINE_CHANNEL_SECRET=（手順2-4の値）
LINE_CHANNEL_ACCESS_TOKEN=（手順2-5の値）
ANTHROPIC_API_KEY=（手順4の値）
SUPABASE_URL=（手順3-3のURL）
SUPABASE_SERVICE_KEY=（手順3-3のservice_role key）
SLACK_WEBHOOK_URL=（手順5の値）
LINE_PERSONAL_USER_ID=  ← 一旦空欄でOK。あとで埋める
```

> `.env.local` は `.gitignore` 済みなので git にコミットされません。
> このファイルの中身は絶対に他人に見せない・スクリーンショット撮らない・チャットに貼らない。

---

## 7. ローカル動作確認（5分）

```bash
npm run dev
```

別ターミナルで：

```bash
curl http://localhost:8787/health
# => {"ok":true,"env":"development",...}
```

`Ctrl+C` で停止。

---

## 8. Cloudflare Workers にデプロイ（10分）

```bash
npx wrangler login
# ブラウザが開き Cloudflare 認証 → 戻る

# シークレットを順次登録（プロンプトで値を貼り付け）
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put SLACK_WEBHOOK_URL

# デプロイ
npm run deploy
```

成功すると `https://muchinavi-line-bot.YOUR-SUBDOMAIN.workers.dev` のURLが表示される。
これをコピー → **Webhook URL に `/line/webhook` を追加**：

例: `https://muchinavi-line-bot.okamoto.workers.dev/line/webhook`

---

## 9. LINE 側に Webhook URL を設定（3分）

1. LINE Developers Console → Messaging API チャネル → **Messaging API** タブ
2. **Webhook URL** に手順8のURL（`/line/webhook` 込み）を入力 → 「Update」
3. **Verify** ボタンを押す → 「Success」が出ればOK
4. **Use webhook** を ON

---

## 10. 動作テスト（5分）

1. スマホのLINEで岡本さんの公式アカウントに友だち追加（既に友だちなら一度ブロック→解除）
2. 友だち追加直後、AIから挨拶メッセージが届くはず
3. 「家族3人で大阪に住みたい」などテストメッセージ送信 → AI応答確認
4. Supabase Dashboard → Table editor → `customers` / `conversations` で会話ログが保存されているか確認

---

## 11. 岡本さん個人通知の設定（3分）

1. **岡本さん自身がBotに友だち追加 → 何か発言**（例：「テスト」）
2. Supabase Dashboard → `customers` テーブル → 自分の行の `line_user_id`（`U...` で始まる文字列）をコピー
3. Cloudflareに登録：

```bash
npx wrangler secret put LINE_PERSONAL_USER_ID
# => 上記の値を貼り付け
```

4. 介入トリガーを発火させるテスト発言（例：「面談したいです」）を別端末から送信
5. 岡本さん個人LINE + Slack 両方に通知が来れば完成

---

## 12. TimeRex URL の設定（任意・後でも可）

`wrangler.toml` の `TIMEREX_URL = ""` に予約ページURLを入れて、再デプロイ：

```bash
# wrangler.toml を編集
# TIMEREX_URL = "https://timerex.net/s/okamoto/..."

npm run deploy
```

これで AI が面談予約の場面で TimeRex URL を自然に案内するようになります。

---

## 13. 既存 Tally CTA を LINE 友だち追加に置き換え（Phase 1）

公式LINE「友だち追加URL」を取得：
- LINE Developers → Messaging API チャネル → **Messaging API** タブ → **Bot basic ID** （`@xxx` 形式）
- 友だち追加URL: `https://line.me/R/ti/p/@xxx`
- もしくは QR コード

公開済 232記事の中で B_REWRITE TOP10 から、CTA を Tally → LINE 友だち追加URL に差し替え（Phase 1並列運用）。

---

## トラブルシューティング

- **Webhook Verify で Failed**：Channel access token が間違っているか、Cloudflare のデプロイが終わってないか、URL に `/line/webhook` が含まれていない
- **AI応答が来ない**：`npx wrangler tail` でリアルタイムログ確認（ANTHROPIC_API_KEY間違いが多い）
- **Slack通知が来ない**：Webhook URLが間違っているか、トリガーキーワードが発言に含まれていない
- **DB保存されない**：Supabase の `service_role` key を使っているか確認（`anon` key だとRLSで弾かれる）

---

## デプロイ後の確認チェックリスト

- [ ] `/health` エンドポイントが 200 を返す
- [ ] LINE Webhook Verify が Success
- [ ] 友だち追加で挨拶メッセージが来る
- [ ] 通常のメッセージで AI 応答が来る
- [ ] 介入キーワード（「面談したい」等）で Slack + LINE個人 両方に通知
- [ ] Supabase に customers / conversations / triggers が記録される
- [ ] Phase 0 完了条件（README参照）達成

---

完了したら岡本さん主観で会話品質を 4/5 以上か判定し、不足あれば `src/llm/prompts/system.ts` を調整して再デプロイ（`npm run deploy`）。
