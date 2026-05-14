# Tally → LINE 切替プレイブック

LINE Bot がデプロイ済みで動作確認できている状態を前提とした、
「Tally CTA を LINE 友だち追加 CTA に差し替える」ためのプレイブック。

判定基準（プロジェクトメモリより）：
- LINE登録率 ≥ Tally登録率 × 1.5倍
- かつ反響30件以上のサンプル
- AI応答品質 4/5 以上

判定がGOになったら**5-10分で完了する**ように準備された手順。

---

## Phase 1：並列運用（CTA追加・Tally残置）

### 1. LINE 友だち追加URL を取得

LINE Developers Console → Messaging API チャネル → 「Messaging API」タブ：
- **Bot basic ID** を確認（`@xxx` 形式）
- 友だち追加URL: `https://line.me/R/ti/p/@xxx`
- QRコードもダウンロードしておく

→ この URL を `muchinochi55.com` の CTA に追加していく。

### 2. 対象記事：B_REWRITE TOP10（CTAをLINE併設）

`reports/blog_rewrite_plan_2026_05_09.md` の B_REWRITE TOP10 リストから5本を選び、
各記事末尾に「LINEで気軽に相談」CTAを追加（Tally CTAの直前に配置）。

CTAテンプレ（再利用ブロック ID:288/599/852 に並走させる新ブロック）：

```html
<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group">
  <p class="has-text-align-center"><strong>LINEでお気軽にご相談ください</strong></p>
  <p class="has-text-align-center">
    <a href="https://line.me/R/ti/p/@xxx" class="wp-block-button__link wp-element-button">
      公式LINEで相談する（24時間返信）
    </a>
  </p>
  <p class="has-text-align-center" style="font-size:0.9em;color:#666">
    岡本のAIアシスタントが、ご家族構成やご希望エリアをお伺いし、ぴったりの選択肢をご提案します。
  </p>
</div>
<!-- /wp:group -->
```

→ Phase 1は **新規 / 大規模リライト記事5本のみ** に追加。既存232記事のCTAは触らない。

---

## Phase 2：判定（2週間後）

並列運用開始から2週間経過時点で判定：

```
LINE登録数 / Tally登録数 ≥ 1.5 AND サンプル数 ≥ 30 → Phase 3へGO
それ以外 → 並列継続 or 撤退判断
```

判定データ取得：
- LINE登録数: Supabase `customers` テーブルの `created_at` を期間フィルタ
- Tally登録数: Tally Dashboard の Submissions 数

---

## Phase 3：全切替（GO判定後・5-10分作業）

### 1. WP 再利用ブロックの差替え（CTA一斉切替）

CTAは再利用ブロック化されているため、4つのブロックを更新するだけで全232記事に反映。

| 用途 | ブロックID | 現状 | 切替後 |
|------|-----------|------|--------|
| 購入CTA 冒頭 | 288 | Tally URL | LINE 友だち追加URL |
| 購入CTA 中盤 | 599 | Tally URL | LINE 友だち追加URL |
| 購入CTA 末尾 | 852 | Tally URL | LINE 友だち追加URL |
| 5記事個別CTA | 3119 | Tally URL | LINE 友だち追加URL |

切替コマンド例（WP REST API）：
```bash
# 各ブロックの内容を取得
curl -s "https://muchinochi55.com/wp-json/wp/v2/blocks/288?context=edit" \
  -H "Authorization: Basic <BASE64>"

# 内容を編集して POST
curl -X POST "https://muchinochi55.com/wp-json/wp/v2/blocks/288" \
  -H "Authorization: Basic <BASE64>" \
  -H "Content-Type: application/json" \
  -d '{"content": "..." }'
```

または管理画面から手動で4ブロック更新（5-10分）。

### 2. ハードコードCTA監査

`memory/feedback_pattern_update_audit_required.md` に従い、再利用ブロック外のハードコードCTAを全件スキャン：

```bash
# 全記事から Tally URL を検索
curl -s "https://muchinochi55.com/wp-json/wp/v2/posts?per_page=100&search=tally.so" \
  -H "Authorization: Basic <BASE64>" | jq '.[] | .id'
```

該当する記事は個別に LINE URL へ差替え。

### 3. Tally ページの停止（最終）

Tally Dashboard → 該当フォームを Archive（即削除はせず1ヶ月猶予）。
理由：万が一の URL バックリンク・ブックマークからのアクセスを404でなく案内ページにリダイレクトしたい場合に備える。

---

## 撤退時（LINE劣勢の場合）

LINE Bot は維持しつつ、CTA を Tally に戻す。
- Phase 1 で追加した LINE CTA を削除
- 再利用ブロックは Tally のまま
- Cloudflare Workers / Supabase は稼働継続（コストは無料枠なので維持コスト極小）

→ 「LINEは別チャネルとして残しつつ、メイン窓口は Tally のまま」という体制に戻る。

---

## 関連ファイル

- 戦略全体: `muchinavi-agents/memory/project_line_bot_2026_05_14.md`
- 旧Tally戦略: `muchinavi-agents/memory/project_tally_single_funnel_2026_05_07.md`
- CTA監査要件: `muchinavi-agents/memory/feedback_pattern_update_audit_required.md`
- B_REWRITE計画: `muchinavi-agents/reports/blog_rewrite_plan_2026_05_09.md`
