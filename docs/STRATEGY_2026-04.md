# MuchiNavi 戦略ドキュメント 2026年4月版

**作成日**: 2026-04-18
**対象ブランチ**: `claude/fervent-austin-2b5005`
**セッション種別**: 徹底分析 → 実装反映 → Devil+Auditor監査 → コア施策実装
**記録者**: Claude Opus 4.7

---

## 目次

1. [エグゼクティブサマリ](#1-エグゼクティブサマリ)
2. [Phase 1-6：徹底分析ダイジェスト](#2-phase-1-6徹底分析ダイジェスト)
3. [Devil + Auditor 監査結果](#3-devil--auditor-監査結果)
4. [修正版ロードマップ](#4-修正版ロードマップ)
5. [今セッションで実装済みの一覧](#5-今セッションで実装済みの一覧)
6. [未解決TODO・確認事項](#6-未解決todo確認事項)
7. [付録：基盤資料・検証データ](#7-付録基盤資料検証データ)

---

## 1. エグゼクティブサマリ

### ⚡ 核心3行

1. **実顧客はわずか3名**（本番データ実測）。CVR最適化より**母数（流入）を増やす方が先**。基盤資料「ブログ集客戦略」を最優先で実行すべき。
2. **差別化の核は「岡本岳大という実在の人」**。LIFULL（送客型）、SUUMO（匿名アドバイザー）、TERASS Offer（複数エージェント競合）には真似できない一点突破。
3. **14ステップフォームを「専用カルテ作成」にリフレーミング**が基盤資料核心の未実施施策。これが母数3名でも検証可能な唯一のCVR施策。今セッションで実装済み。

### 🎯 戦略の三位一体（独自優位）

```
[A] 実在する岡本岳大  ←→  [B] あなた専用の住宅購入ジャーニー
              ↘                ↙
          [C] 実面談・実契約への一直線
```

- **A**：顔写真・TERASS所属・ブログ216本・2児のパパ（真実の属性）
- **B**：AIチャット × 進捗バー × マイカルテ（Notion型蓄積）
- **C**：3項目即時予約（SUUMO方式、CVR 2-3倍想定）

### 🚨 やらないこと（Devil+Auditor 合意で削除）

- ❌ 実績数字の吹かし（宅建業法32条・景品表示法違反リスク）
- ❌ 岡本AIラジオ／マインドマップ／Wrapped（ブランド毀損・運用破綻）
- ❌ 離脱語→自動フォロー（特商法再勧誘禁止に抵触可能性）
- ❌ FB Pixel 先置き（電気通信事業法2023改正違反）
- ❌ Rightmove型ローン審査シミュレーター（宅建業法32条・貸金業法リスク）

---

## 2. Phase 1-6：徹底分析ダイジェスト

### Phase 1：自社実データ解析（customers.json / events.json / etc.）

本番データ実測の衝撃的な発見：

| 発見 | 数値 |
|---|---|
| 登録アカウント総数 | 10 |
| うち関係者 | 7（70%） |
| 実顧客（非関係者） | **3** |
| `events.json` 存在 | ❌ 未生成 |
| `processes.json` 存在 | ❌ 未生成 |
| `{{PROGRESS}}` タグ発火回数 | 0 / 196メッセージ |
| 全チャットの最終発話者がAIの率 | **100%** |
| `checklist` 完了率 | 0 / 11（全顧客） |
| タグ死蔵率 | 11/15（73%） |
| 明示的離脱意思発話（「見送り」「自分で探す」等） | 12回検知・エスカレーションなし |
| stage 3〜7（面談以降）に到達した顧客 | **0人** |

詳細は Phase 1 サブエージェント出力を参照。

### Phase 2：競合4社フロントエンド・コード解析

**SUUMOカウンター**
- Adobe Analytics (`s.prop4="P21C0TOPA000"`)、VWO（AB テスト）
- `data-suit` 属性で流入経路別CV計測
- FAQPage JSON-LD 埋め込み
- **予約3項目のみ → 予約後29項目ヒアリング分離**（公開実績：初訪問9.1日→4.4日短縮）

**イエプラ**
- GTM + SiTest（ヒートマップ&ABテスト）
- 「3部門No.1」バッジ画像3枚並べ（社会的証明）
- チャット内に物件カード埋め込み（賃貸想定）

**LIFULL HOME'S AIチャット**
- Flutter Web + Tealium iQ + DoubleClick Floodlight + FB Pixel（487127493573795）
- CTA: オレンジ→ゴールドグラデ（`linear-gradient(20deg, #ED6103, #FFAB00)`）
- AI → 有人切替動線が弱い（送客モデル）

**TERASS**
- Next.js App Router + Firebase Auth UID
- `terass.house` は form.run 外注フォーム
- 49ページ eBook をリードマグネット

### Phase 3：AI対話ツールUX（Claude/ChatGPT/Gemini/Perplexity/Character.AI/NotebookLM）

**移植すべき要素**：
- **Character.AI のGreeting**（岡本さん顔写真+一人称+直近の思考）→ 実装済み（プロフィールカード）
- **ChatGPT の Memory**（`customer.memory`永続化）→ 未実装（次フェーズ）
- **Perplexity の インライン出典**（`{{SOURCE|url|label}}` タグ）→ 未実装
- **Claude の Projects** 概念（マイ不動産カルテ）→ 部分実装（カルテカード）

**移植しないもの**（Devil 判断）：
- Character.AI の長時間没入（住宅購入は面談誘導が目的のため、長時間AI滞在はゼロサム）
- NotebookLM Audio Overview（コスト・運用負担・聴取母数ゼロ）

### Phase 4：習慣化ツールUX（Duolingo/Notion/TikTok/LINE/Spotify 等14サービス）

**採用**：
- **Notion型サンクコスト**（マイ不動産カルテに蓄積＝離脱不可）
- **LINE 既読マークの安心感**（岡本さん既読表示、顧客側既読は任意）
- **マネーフォワード型の気付き通知**（金利変動・相場変化、低頻度サービスの再訪フック）

**却下**：
- Duolingo 型ストリーク強圧（住宅購入は毎日タスクではない、逆効果）
- Strava Local Legend（他顧客との比較は心理操作リスク）
- Spotify Wrapped（年次イベント、3名では無意味）

### Phase 5：海外不動産 best-in-class（Zillow/Compass/Opendoor/Redfin/Rightmove）

**移植候補**：
- **Rightmove Mortgage in Principle**（「通る確率」即表示）→ **Devil/Auditorで削除判定**（宅建業法リスク）
- **Compass Collections**（物件共有UI）→ **却下**（TERASS Picks と二重実装）
- **Zillow Virtual Staging**（AI家具配置）→ **却下**（幻想増強は顧客ファーストに反する）
- **Redfin Compete Score**（地域競争度スコア）→ **将来検討**（物件固有データが揃えば）

### Phase 6：行動設計フレームワーク理論（Hooked/Fogg/Peak-End/JTBD/Cialdini 等16理論）

**ムチナビの最上位原理**（優先順）：
1. **Self-Determination Theory**（自律性・有能感・関係性）＝ 岡本哲学と完全整合
2. **Fogg Behavior Model (B=MAP)** ＝ 面談予約という高ハードル行動の分解
3. **Progress Principle** ＝ `{{PROGRESS}}` タグ（今セッションで修正済み）
4. **Peak-End Rule** ＝ 診断結果の祝福演出（今セッションで実装済み）
5. **IKEA Effect** ＝ マイカルテ蓄積（実装済み）
6. **Commitment & Consistency** ＝ 3項目→詳細段階 の階段（次フェーズ）

**使わない理論**：
- Hooked Model そのまま → 住宅購入は低頻度、毎日開かせる意味なし
- Loss Aversion（恐怖訴求）→ 岡本哲学「ずっと幸せ」と衝突

---

## 3. Devil + Auditor 監査結果

### Devil（Agent I）判定：🔴 **FAIL / NO-GO**

**致命的欠陥 TOP3**：
1. **母数ゼロで「戦略」を名乗る愚**（n=3 の過剰適合）
2. **三位一体の内部矛盾**（[A]AI深化と[C]面談誘導のゼロサム／Replika現象）
3. **岡本さん1人のキャパシティ破綻**（週20-30h追加は不可能）

**削除推奨**：岡本AIラジオ、ムチナビWrapped、マインドマップ、AI Virtual Staging、Compass Collections、Rightmove型ローン審査、Strava Local

### Auditor（Agent T）判定：🔴 **NO-GO（一部条件付きGO）**

**6レンズ検証結果**：
| レンズ | 判定 |
|---|---|
| ビジョン整合性 | ⚠️ Tier 3 の一部が逸脱 |
| 部署間整合性 | ❌ 流入施策欠落が致命的 |
| Devil品質検証 | ❌ 14ステップ価値転換が施策化されていない |
| リスク統合 | ❌ 法的リスク3件は放置不可 |
| 実行可能性 | ❌ Tier 1以降は工数不能 |
| ブランド一貫性 | ⚠️ エンタメ系で一部逸脱 |

**追加指摘**：
- 基盤資料「CVR最大化コピーライティング」第6章10 Commandments の「14ステップ=専用カルテ」リフレーミングが施策化されていなかった（**最大の欠落**）
- `muchinochi55.com → muchinavi.com` 動線設計が施策にない
- Market Intelligence（2026年税制、40平米要件緩和）反映ゼロ

### 統合された最終判定

**🟡 条件付きGO**（Phase 0 + Phase A + 14ステップ「専用カルテ」リフレーミングのみ）

- Phase 0（計測・JSON-LD等）→ 即GO
- 14ステップ専用カルテリフレーミング → 即GO（基盤資料核心）
- Tier 1 以降 → 流入100名到達までは**凍結**
- Tier 3 エンタメ系 → **永久凍結**

---

## 4. 修正版ロードマップ

### 🟢 Phase 0：今週中（計測・法的・SEO 基盤）

| # | 施策 | 状態 |
|---|---|---|
| P0-1 | Microsoft Clarity 導入 | 🟡 枠組み済・Project ID 待ち |
| P0-2 | GA4 Consent Mode V2 | ✅ 実装済 |
| P0-3 | `{{PROGRESS}}` タグ発火修正 | ✅ 実装済 |
| P0-4 | FAQPage / schema.org/Person JSON-LD | ✅ 実装済 |
| P0-5 | Cookie同意バナー | ✅ 実装済 |
| P0-6 | 特商法表記・プライバシーポリシー | ✅ 実装済 |
| P0-7 | muchinochi55.com → muchinavi.com 動線CTA | 🔴 未実装（ブログ側改修必要） |

### 🟡 Phase A：3ヶ月（母数を増やす・最優先）

**基盤資料「ブログ集客戦略」に従って流入を増やす**

| # | 施策 | 根拠資料 |
|---|---|---|
| PA-1 | ブログSEO月8本公開（HM特集・エリア特化型スプシの既存案を消化） | ブログ集客戦略 / スプシID `16O1WUQ...` / `1HV1TletIC...` |
| PA-2 | LP登録誘導戦略の実装 | `1GZJQ3G...` |
| PA-3 | **14ステップフォームの「専用カルテ」リフレーミング** | CVR最大化コピーライティング 10 Commandments |

**PA-3 は既に実装済み**（今セッション）。PA-1/PA-2 は岡本さんの執筆活動と連動。

### 🟠 Phase B：流入100名到達後（2-4週間）

| # | 施策 | 実装状況 |
|---|---|---|
| PB-1 | 3項目即時予約フォーム | 🔴 未着手 |
| PB-2 | Greeting刷新（Character.AI式、ただし過剰にしない） | ✅ 実装済（プロフィールカード） |
| PB-3 | 面談3択（Zoom / 10分電話 / 対面） | 🔴 未着手 |

### 🔵 Phase C：信頼と長期伴走

| # | 施策 | 実装状況 |
|---|---|---|
| PC-1 | 引渡し後「1年／3年点検」事前約束UI | 🔴 未着手 |
| PC-2 | 信頼バッジ固定配置（TERASS所属・無料・営業しない） | ✅ 実装済 |

### 🔴 永久凍結（絶対にやらない）

- 岡本AIラジオ（TTSコスト・運用破綻）
- ムチナビ・ラップ（3名では意味なし）
- 家選びマインドマップ（利用頻度ゼロ予測）
- AI Virtual Staging（幻想増強リスク）
- Strava Local型「似た家族の進捗」（心理操作）
- Compass Collections型物件スレッド（TERASS Picks と二重）
- Rightmove型ローン審査シミュレーター（宅建業法32条・貸金業法リスク）
- FB Pixel 先置き（電気通信事業法 同意必須）
- 離脱語→自動フォロー（特商法再勧誘禁止）
- **実績数字の吹かし**（宅建業法32条・景品表示法・Wayback Machine で永久残存）

---

## 5. 今セッションで実装済みの一覧

### 5.1 index.html（顧客UI）

| 改修 | 行（変更後） | 要点 |
|---|---|---|
| Welcome コピー改訂 | L3571-3574 | 「あなた専用の住まい探しカルテを作る」 |
| Welcome トレンドフック | L3936-3942 | 「2026年・住宅市場の今」 |
| 信頼バッジ（ピル型3色） | L3944-3956 | 約2分で完成／営業電話なし／いつでも削除OK |
| **岡本さんプロフィールカード** | L3958-3990 | 顔写真・TERASS登録・**記事216本**・2児のパパ・引用・所属 |
| Contact/Password リフレーミング | L3871-3887 | 「カルテを保存します」「カルテのパスワードを設定」 |
| 診断結果「マイカルテ完成」化 | L4171-4215 | ✨ MY KARTE COMPLETED バナー + 5項目サマリ |
| **祝福演出**（紙吹雪・キラキラ・チェックマーク・カスケード） | L266-398, L4555-4594 | Peak-End Rule、`prefers-reduced-motion`対応 |
| 全ステップ下部マイクロコピー | L4266-4277 | 「岡本だけが見ます」等 |
| プログレスバー文言 | L4391-4402 | 「マイカルテ XX%」「あとX問で完成」 |
| ステップアイコン刷新 | L215-252 | 円形ゴールドバッジ、浮遊＋回転リング |
| ステップタイトルグラデ | L253-263 | ネイビーのテキストグラデ |
| Primary CTAグラデ化 | L368-406 | テラコッタ→ゴールドグラデ、ホバー光沢 |
| 選択肢カード温色化 | L188-193, L524-549 | 選択時ゴールドアイコン |
| 予算スライダー大文字化 | L583-592 | 36px グラデ文字 |
| カラーパレット拡張 | L47-87 | ネイビー・テラコッタ・ゴールド・セージ・クリーム |
| 背景レイヤー | L97-122 | 多層グラデ＋水玉パターン |
| Cookie同意バナーUI | L3421-3436 | 下部固定、最小限のみ／すべて同意 |
| 法的モーダルUI | L3438-3493 | 特商法・プライバシーポリシー |
| 構造化データ | L29-197 | Person + FAQPage + WebSite JSON-LD |
| GA4 Consent Mode V2 | L29-76 | 同意前 denied、同意後 granted |
| Clarity 遅延ロード関数 | L78-97 | Project ID 後追い可 |
| 同意・モーダル制御JS | L7617-7691 | `setConsent()`, `openTokuteiModal()`, ESC/背景クリック対応 |
| モバイル最適化 | L742-810 | アイコン60px、CTA画面幅100%、sticky progress、scroll-nudge |

### 5.2 server.js（バックエンド）

| 改修 | 行 | 要点 |
|---|---|---|
| `{{PROGRESS}}` 発火条件をシステムプロンプトに追加 | L1777-1790 | ステージ名マッピング・発火条件明記 |
| `{{PROGRESS}}` サーバー側処理（DB更新） | L1871-1897 | stage 自動昇格＋履歴記録 |

### 5.3 新規ファイル

- `.claude/launch.json`（Claude Preview 用 Python HTTP サーバー設定）
- `docs/STRATEGY_2026-04.md`（本ドキュメント）

---

## 6. 未解決TODO・確認事項

### 🚨 すぐ必要

| # | タスク | 岡本さん対応必要 |
|---|---|---|
| T1 | **Microsoft Clarity Project ID 取得**→[clarity.microsoft.com](https://clarity.microsoft.com/)（無料） | ✅ 必要 |
| T2 | 取得後、index.html `L97` の `'PLACEHOLDER'` を Project ID に置換 | ✅ 必要（Claudeが実装可） |
| T3 | 特商法表記の **連絡先メールアドレス** | ✅ 必要（任意：問い合わせフォームのみでも可） |
| T4 | muchinochi55.com ブログ側の CTA（ムチナビ誘導）改修 | ✅ 必要（別リポジトリ） |
| T5 | 本worktreeを main にマージ or PR作成 | ✅ 必要 |

### ⚠️ 判断が必要

| # | 論点 | 推奨 |
|---|---|---|
| J1 | プロフィールカードに**真実の数字**をさらに追加するか（例：TERASS所属○年） | 必要なら控えめに追加。吹かし不可 |
| J2 | `muchinavi-agents/` リポジトリとの連携深化 | 別セッションで検討 |
| J3 | admin.html の同系統リブランド | 流入増の後に検討 |

### 📋 次のセッションで着手予定

1. Phase 0 の最終項目（muchinochi55.com CTA 改修）
2. Phase A の PA-1（ブログSEO月8本）に向けたエージェントチェーン起動
3. 3項目即時予約フォームの実装（Phase B / PB-1）

---

## 7. 付録：基盤資料・検証データ

### 7.1 基盤資料（Google Drive）

絶対参照条件：全エージェント実行時に必読。

- **フォルダ**: https://drive.google.com/drive/folders/1VcY6GCiz4OamZ-Iy6A13uw0v1XtD1tru
- **取得コマンド**: `curl -sL "https://docs.google.com/document/d/{ID}/export?format=txt"`

| ドキュメント | ID |
|---|---|
| ブログ集客戦略 | `1ViPWcvssigN18qE-0Qk6oy830mGws9OPVbo5Pgo1Exw` |
| 記事作成・リライト戦略 | `1DFTrFJ5ov5J4qKbD2cW3eZP03fkg3W52EEXMUkctuqk` |
| **CVR最大化コピーライティング（核心資料）** | `1jvkw7GlTHHb_GSZLvBFfOGOa-5obA4nteHNudHr4NHE` |
| LP登録誘導戦略 | `1GZJQ3GixtztqTlq7JJNF-aMbIwn7m94jpSzSZ0Q0GMY` |
| Claudeへの指示文 | `1Qey9Ox-QwaamiUrmzWveq1Vc-FlmrEde1JIbW7uPRxo` |
| アイキャッチ画像生成 | `1F6eSHiE4xFUjvadZyYLdOq53PJKNdpweDNGvPizDaxw` |

| スプレッドシート | ID |
|---|---|
| HM特集記事 | `16O1WUQ0aSgMv2kmlIi6xhXfbsE3UDfJYst_9Zt4U7LE` |
| エリア特化型記事案 | `1HV1TletICVvbFPehbxX2o1iD1TW-622ZZnj8jRF4K3U` |

### 7.2 検証データポイント（実装検証済み）

- HTTP 200 / プレビューサーバー `http://localhost:8765/index.html`
- HTML syntax OK（`{`=643, `}`=643）
- JS syntax OK（4 scripts validated）
- JSON-LD 3本 all valid JSON
- console errors: **0件**
- モバイル 375×812：CTA が FV 内収納
- デスクトップ：非退行

### 7.3 岡本さん関連 検証済み公開情報

- **所属**: 株式会社TERASS
- **TERASS本社宅建業免許**: 国土交通大臣(1)第010125号
- **肩書き**: 住宅購入専門エージェント / TERASS登録エージェント / 2児のパパ
- **活動エリア**: 大阪府全域、東京23区+多摩、兵庫阪神間
- **経歴**: 20代で東京にて中高友人3人と不動産会社起業→TERASSに参画
- **姿勢**: ノルマなし／押し売りしない／お客様ファースト
- **宅建士資格**: **未取得**（エージェント職で運営、宅建士の記載は不可）
- **ブログ**: https://muchinochi55.com/ （**実測216記事、2025/5〜運用、月20本ペース**）
- **Twitter**: @muchinochi55
- **顔写真URL**: https://muchinochi55.com/wp-content/uploads/2025/08/IMG_4473.jpeg

### 7.4 関連リポジトリ・ファイルパス

- **本リポジトリ（メインサービス）**: `/Users/okamototakehiro/MuchiNavi/muchinavi-deploy/`
- **worktree（今回作業）**: `/Users/okamototakehiro/MuchiNavi/muchinavi-deploy/.claude/worktrees/fervent-austin-2b5005/`
- **エージェント定義**: `/Users/okamototakehiro/MuchiNavi/muchinavi-agents/agents/`
- **ブログリポジトリ**: 別リポジトリ（WordPress）
- **Google Drive 基盤資料**: 上記 7.1 参照

### 7.5 デザイントークン（今セッション導入）

```css
--brand-navy: #1F3A70        /* 信頼 */
--brand-navy-deep: #0F2452   /* ヘッダー */
--brand-terracotta: #D96941  /* 家の温もり */
--brand-coral: #E87B4E       /* 夕陽 */
--brand-gold: #C9A35C        /* プレミアム */
--brand-cream: #FAF7F0       /* 背景 */
--brand-sage: #6B8E65        /* 成長・安心 */
```

### 7.6 永久凍結リスト（再掲）

以下は**絶対に実装しない**。Agent T 監査の常設チェック項目。

- 実績数字の吹かし（合格率など外部機関情報以外の自社数字）
- 恐怖訴求（「今逃すと一生後悔」型）
- 退会導線の隠蔽
- 営業Push通知連打
- 虚偽希少性（「残り1名」等）
- AIであることの隠蔽
- 面談拒否後の執拗な再提案
- Duolingo的ストリーク強圧
- 顧客同士の競争UI
- Rightmove型ローン審査（法的リスク）
- 岡本AIラジオ・Wrapped・マインドマップ・Virtual Staging（ブランド毀損）

---

## 改訂履歴

| 日付 | 改訂 |
|---|---|
| 2026-04-18 | 初版作成（徹底分析セッション成果物） |

---

**次回更新予定**: Phase 0 完了時 / 流入100名到達時 / 四半期レビュー時
