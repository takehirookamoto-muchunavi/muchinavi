# MuchiNavi プロジェクト引き継ぎ情報

## プロジェクト概要
**MuchiNavi（ムチナビ）** — AI不動産相談アプリ
住宅購入を検討するお客様向けのAIチャットボット。Gemini 2.0 Flash を使用。

### 技術スタック
- **フロントエンド**: シングルページHTML（index.html 約5900行、CSS/JS全てインライン）
- **管理画面**: admin.html（HTML/CSS/JS全部入り）
- **バックエンド**: Node.js + Express（server/server.js）、Gemini 2.0 Flash API
- **サーバー**: AWS Lightsail (54.168.221.28)、Apache リバースプロキシ、PM2
- **ドメイン**: muchinavi.com
- **GitHub**: https://github.com/takehirookamoto-muchunavi/muchinavi

### デプロイ方法
```bash
cd ~/muchinavi && git pull && pm2 restart all
```

## 重要ファイル構成
```
muchinavi/
├── index.html                    ← ルートのコピー（server/public/index.htmlと常に同期）
├── admin.html                    ← 管理画面コピー（server/public/admin.htmlと常に同期）
├── CLAUDE.md                     ← このファイル
├── server/
│   ├── server.js                 ← バックエンド（全API + Geminiシステムプロンプト）
│   ├── data/
│   │   ├── customers.json        ← 顧客DB（メイン）
│   │   ├── tags.json             ← タグマスター
│   │   ├── broadcasts.json       ← 配信履歴
│   │   ├── events.json           ← カレンダーイベント
│   │   ├── processes.json        ← 取引進捗
│   │   └── settings.json         ← 管理者パスワード
│   └── public/
│       ├── index.html            ← メインアプリ（HTML/CSS/JS全部入り）
│       ├── admin.html            ← 管理画面
│       ├── manifest.json         ← PWA設定
│       └── sw.js                 ← Service Worker
```

### 関連リポジトリ
- **AIエージェントチーム**: `/Users/okamototakehiro/MuchiNavi/muchinavi-agents`
  - ブログ戦略・記事作成・議事録解析等のAIワークフローはそちらで管理

---

## 「おはよう」ブリーフィング機能

### トリガー
ユーザーが「おはよう」「おはようございます」等の朝の挨拶をした場合、または `/morning` コマンドを実行した場合、**自動的に朝ブリーフィングを実行する**。

### 実行手順
1. `GET https://muchinavi.com/api/admin/briefing` を呼び出す（ヘッダー: `X-Admin-Pass`）
2. レスポンスを以下のフォーマットで整理して表示:

```
おはようございます、岡本さん！
{date}（{dayOfWeek}）| アクティブ顧客: {stats.totalActive}名

━━━ 今日の予定 ━━━
{todayEvents を時系列で表示。なければ「予定なし」}

━━━ 要対応 ━━━
🔴 期限切れ: {urgent.overdue の件数と内容}
🟡 今日期限: {urgent.today の件数と内容}
📋 今週中: {urgent.week の件数}

━━━ フォローアップ推奨 ━━━
{urgent.followUp を連絡空き日数順で表示}

━━━ 取引進捗 ━━━
{processSummary をパイプライン形式で表示}

何から取り掛かりますか？
```

3. ユーザーの指示に応じて各APIを呼び出し、業務を実行

### 管理者パスワード
初回呼び出し時にパスワードを聞き、以降のセッションではメモリに保持する。

---

## 管理画面 API リファレンス

**Base URL**: `https://muchinavi.com`
**認証**: 全APIに `X-Admin-Pass: {password}` ヘッダー必須

### 顧客管理
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/admin/customers` | 全顧客一覧（lastContactDate, daysSinceContact, overdueTodoCount 含む） |
| GET | `/api/admin/customer/:token` | 顧客詳細 → `{ customer: {...} }` |
| PUT | `/api/admin/customer/:token` | 顧客情報更新（name, stage, memo, email 等） |
| DELETE | `/api/admin/customer/:token` | 顧客削除 |

### ToDo管理
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/admin/todos/:token` | 顧客のToDo一覧 |
| POST | `/api/admin/todos/:token` | ToDo追加 `{ text, priority, deadline }` |
| PUT | `/api/admin/todo/:token/:id` | ToDo更新 `{ done, text, priority, deadline }` |
| DELETE | `/api/admin/todo/:token/:id` | ToDo削除 |

### 連絡履歴
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/admin/interactions/:token` | やり取り履歴 |
| POST | `/api/admin/interactions/:token` | 記録追加 `{ method, date, content }` |
| DELETE | `/api/admin/interaction/:token/:id` | 記録削除 |

### ダイレクトチャット（顧客へのメッセージ）
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/admin/direct-chat/:token` | チャット履歴取得 |
| POST | `/api/admin/direct-chat/:token` | メッセージ送信 `{ message }` → 顧客にメール通知も送信 |

### 一斉配信
| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/admin/broadcasts/preview` | 対象人数プレビュー `{ filterType, filterTags }` |
| POST | `/api/admin/broadcasts/send` | 配信実行 `{ message, filterType, filterTags }` |

### カレンダー / イベント
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/admin/events` | イベント一覧（`?from=&to=&customerToken=` で絞込可） |
| POST | `/api/admin/events` | イベント作成 `{ type, title, customerToken, date, startTime, endTime, location, notes }` |
| PUT | `/api/admin/event/:id` | イベント更新 |
| DELETE | `/api/admin/event/:id` | イベント削除 |

**イベント種別（type）**: `viewing`(内見), `meeting`(面談), `online_meeting`(オンライン面談), `contract`(契約), `settlement`(決済), `jusetsu_prep`(重説準備), `jusetsu`(重説実施), `terass_application`(TERASS申請), `loan_review`(ローン), `follow_up`(フォロー), `general`(その他)

### 取引進捗（プロセス）
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/admin/processes` | プロセス一覧（`?status=active&customerToken=` で絞込可） |
| POST | `/api/admin/processes` | プロセス作成 `{ customerToken, propertyName, propertyPrice }` |
| PUT | `/api/admin/process/:id/step/:key` | ステップ更新 `{ status, deadline, notes }` |
| DELETE | `/api/admin/process/:id` | プロセス削除 |
| GET | `/api/admin/process-template` | ステップテンプレート取得 |

**ステップキー**: `application`(申込) → `jusetsu_prep`(重説準備) → `terass_application`(TERASS申請) → `jusetsu`(重説実施) → `contract`(契約) → `loan_review`(ローン本審査) → `settlement`(決済・引渡し)

**ステップstatus**: `pending`, `in_progress`, `completed`, `blocked`

### 朝ブリーフィング
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/admin/briefing` | 集約ブリーフィングデータ |

### AI機能
| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/admin/suggest-todos/:token` | AI ToDo提案 |
| POST | `/api/admin/chat-agent/:token` | AIエージェント相談 `{ message }` |
| POST | `/api/admin/extract-from-chat/:token` | チャットから顧客情報抽出 |

### タグ / チェックリスト
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/admin/tags` | タグ一覧 |
| POST | `/api/admin/tags` | タグ作成 `{ name, color, category }` |
| GET | `/api/admin/checklist/:token` | チェックリスト取得 |
| PUT | `/api/admin/checklist/:token` | チェックリスト更新 |

---

## Claudeが対応できる業務コマンド例

| ユーザーの指示例 | 実行するAPI |
|---|---|
| 「田中さんにフォローメール送って」 | `POST /api/admin/direct-chat/:token` |
| 「田中さんのステージを相談中に変更」 | `PUT /api/admin/customer/:token` |
| 「明日10時に鈴木さんの内見を登録」 | `POST /api/admin/events` |
| 「佐藤さんの取引を開始して」 | `POST /api/admin/processes` |
| 「鈴木さんの重説準備を完了にして」 | `PUT /api/admin/process/:id/step/jusetsu_prep` |
| 「今週の予定を見せて」 | `GET /api/admin/events?from=&to=` |
| 「連絡が2週間以上空いてる顧客は？」 | `GET /api/admin/briefing` → followUp |
| 「全員にお知らせ配信して」 | `POST /api/admin/broadcasts/send` |
| 「山田さんのToDoに面談準備を追加」 | `POST /api/admin/todos/:token` |

---

## ユーザー情報
- 岡本岳大さん（TERASS所属の不動産エージェント）
- 「本当の意味でのお客様ファースト」を大切にしている
- お客様が住宅購入でずっと幸せでいられることを重視

## 顧客ステージ
1. 登録 → 2. 情報入力 → 3. 面談予約 → 4. 相談中 → 5. ライフプラン → 6. 物件探し・内見 → 7. 契約 → 8. 引渡し

## Geminiシステムプロンプト内の重要タグ
- `{{CHOICES|選択肢1|選択肢2|選択肢3}}` — 選択肢ボタンの出力形式
- `{{PROGRESS|ステップ名}}` — 進捗バーの更新
- 顧客名は `〇〇さん` で呼びかけ
