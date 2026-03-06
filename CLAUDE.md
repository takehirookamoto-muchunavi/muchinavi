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

---

## 自動ルーティング（最重要）

ユーザーの発言を解析し、適切なエージェントに自動接続する。
**エージェントファイルのベースパス**: `/Users/okamototakehiro/MuchiNavi/muchinavi-agents`

### ルーティングテーブル

| ユーザーの発言パターン | 起動エージェント | 参照ファイル（muchinavi-agents/） | 動作 |
|----------------------|----------------|--------------------------------|------|
| 「おはよう」等の朝の挨拶 | 全体会議 | `.claude/commands/morning.md` | API + 全部署レポート + TOP3 |
| 「ブログ書きたい」「記事作って」 | J→K→L→M→N チェーン | `.claude/commands/blog.md` | 9ステップフロー |
| 「noteを書きたい」「note記事」 | note作成 | `.claude/commands/note.md` | note記事フロー |
| 「議事録」「面談メモ」 | Agent B (Analyst) | `agents/analyst.md` | 議事録解析 → API更新 |
| 「戦略」「PV分析」「ブログの数字」 | F→G→H→I チェーン | `agents/blog_strategy.md` | 戦略レビュー |
| 「収支予測」「売上シミュレーション」 | Agent H (収支予測) | `agents/blog_strategy.md` | 収支計算 → 検証 |
| 「レビューして」「チェックして」 | Agent C/I/N (Devil) | `agents/devil.md` | 否定レビュー |
| 「今週の振り返り」 | 週次レビュー | `.claude/commands/weekly.md` | 週次集計 |
| 顧客名 + 操作 | 直接API実行 | このファイルのAPIリファレンス | MuchiNavi API |
| 「MuchiNaviの応答改善」 | Agent D (Content) | `agents/content_agent.md` | 応答品質改善 |
| 「フォローすべき顧客」「追客」 | Agent O (Follow-up) | `agents/followup.md` | 優先度判定 → メッセージ |
| 「市場動向」「金利」「競合」 | Agent P (Market Intel) | `agents/market_intelligence.md` | 市場レポート |
| 「レビュー依頼」「紹介」「引渡し後」 | Agent Q (CS) | `agents/customer_success.md` | CSフォロー |
| 「マーケティング」「集客戦略」「何をすべき」 | Agent R→S チェーン | `agents/marketing.md` | 全データ分析 → 提案 → 否定レビュー |
| 「最終チェック」「全体を見て」「GOサイン」 | Agent T (Auditor) | `agents/auditor.md` | 6レンズ検証 → GO/NO-GO判定 |
| 「バグ」「機能追加」「コード修正」 | Agent A (Builder) | `agents/builder_orchestrator.md` | このリポジトリで直接対応 |
| 複数タスク同時 | Agent E (Orchestrator) | `agents/builder_orchestrator.md` | 振り分け |

### ルーティングルール
1. ユーザーの発言からキーワード・意図を読み取り、上表に照合
2. 該当ファイルを **絶対パス** `/Users/okamototakehiro/MuchiNavi/muchinavi-agents/{参照ファイル}` で読み込む
3. チェーン実行時は前工程の出力を次工程に自動で渡す
4. 否定エージェント自動起動: コード完成→Agent C、戦略完成→Agent I、記事完成→Agent N、マーケティング提案→Agent S
5. **監査役（Agent T）常時自動起動**: 全チェーンにおいてDevil通過後に必ず Agent T を自動起動し、GO/NO-GO判定を経てから岡本さんに提示する（省略厳禁）
6. 開発系（バグ・機能追加）はこのリポジトリで直接対応（muchinavi-agents への案内は不要）
7. 曖昧な場合はユーザーに確認

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
