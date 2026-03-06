ブログ記事の自動作成フローを実行してください。

agents/content_writing_v2.md のフローに従い、以下の9ステップを順番に実行します。

---

## Step 1: 記事選定

1. WordPress REST API で既存記事一覧を取得:
   ```
   curl -s "https://muchinochi55.com/wp-json/wp/v2/posts?per_page=100&_fields=id,title,slug,status" | jq '.[].title.rendered'
   ```
   ページネーションがある場合は全ページ取得する。

2. 次に、ブラウザでスプレッドシートを開いて記事候補を確認:
   - HM特集記事: https://docs.google.com/spreadsheets/d/16O1WUQ0aSgMv2kmlIi6xhXfbsE3UDfJYst_9Zt4U7LE/edit
   - エリア特化型: https://docs.google.com/spreadsheets/d/1HV1TletICVvbFPehbxX2o1iD1TW-622ZZnj8jRF4K3U/edit

3. 既存WP記事とタイトル・テーマが重複しない未作成記事をリストアップ

4. 優先順位判定（購買意向の高さ・紹介ルート相性・競合手薄度）で候補を提示

5. ユーザーに作成する記事を選んでもらう

---

## Step 2: 記事設計（Agent J）

選定した記事について:
- スプレッドシートの情報（タイトル案、ターゲット層、検索意図、LINE誘導フック）を取得
- 既存WP記事との重複・カニバリチェック
- メインKW・サブKW・ロングテールKW設定
- h2/h3構成設計（AEO対応: 質問形式活用）
- 設計書を `blog/drafts/YYYY-MM-DD_テーマ_design.md` に保存

---

## Step 3: 記事本文生成（Prompt①）

agents/content_writing_v2.md の「Step 3: Prompt① AEO×SEO統合版」に、
Step 2の設計書情報（テーマ、メインKW、ターゲット等）を埋め込んで記事を生成。
結果を `blog/drafts/YYYY-MM-DD_テーマ_v0.md` に保存。

---

## Step 4: 第1次修正（Prompt②）

agents/content_writing_v2.md の「Step 4: Prompt② 読みやすさ・LINE誘導強化」を適用。
修正:
- 読了時間の明記
- 表・箇条書き・ボックス装飾の強化
- LINE誘導の自然な挿入
- 共感導入・体験談の追加
結果を `blog/drafts/YYYY-MM-DD_テーマ_v1.md` に保存。

---

## Step 5: 第2次修正（Prompt③）

agents/content_writing_v2.md の「Step 5: Prompt③ DRM×コンプライアンスリライト」を適用。
4つのミッション:
1. SWELL最適化（視覚化・読みやすさ）
2. 共感と寄り添い（心理的導線・寸止めテクニック）
3. DRM×損失回避（マイクロCTA 3箇所・特典具体化）
4. コンプライアンス（断定緩和・注釈・出典URL）
結果を `blog/drafts/YYYY-MM-DD_テーマ_v2.md` に保存。

---

## Step 6: CTA最適化（Agent M）

3パターンのCTAを生成し、最適版を選択して記事に配置:
- パターンA: 問いかけ型
- パターンB: 損失回避型
- パターンC: 具体的メリット型

配置位置: 導入直後 / 中盤 / 記事末尾

---

## Step 7: 否定レビュー（Agent N）

「読み逃げ読者」視点で記事を徹底批判:
- 読者離脱ポイント
- CTA効果
- コンプライアンス
- コンテンツ品質

agents/devil.md のフォーマットで出力。
**「致命的問題なし」が出るまで修正を繰り返す。**
最終版を `blog/ready/YYYY-MM-DD_テーマ_final.md` に保存。

---

## Step 8: SEOメタデータ最終確認

以下を確定してユーザーに提示:
- SEOタイトル（30〜40文字）
- メタディスクリプション（120〜150文字）
- スラッグ（英語ハイフン区切り）
- フォーカスキーワード
- 推奨カテゴリ（WP既存カテゴリから選択）
- 推奨タグ（WP既存タグから選択 + 新規提案）

WordPress カテゴリ・タグの確認:
```
curl -s "https://muchinochi55.com/wp-json/wp/v2/categories?per_page=100&_fields=id,name" | jq '.[] | {id, name}'
curl -s "https://muchinochi55.com/wp-json/wp/v2/tags?per_page=100&_fields=id,name" | jq '.[] | {id, name}'
```

---

## Step 9: WordPress入稿

ユーザーにWordPress認証情報（Application Password）を確認。

### 認証情報がある場合: REST API入稿
```
curl -X POST "https://muchinochi55.com/wp-json/wp/v2/posts" \
  -H "Authorization: Basic {base64エンコード}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "SEOタイトル",
    "content": "記事HTML",
    "status": "draft",
    "categories": [カテゴリID],
    "tags": [タグID],
    "excerpt": "メタディスクリプション",
    "slug": "スラッグ"
  }'
```
→ 下書きとして保存。ユーザーがWP管理画面でSWELL装飾・アイキャッチ追加後に公開。

### 認証情報がない場合: 手動入稿ガイド
最終記事テキストを出力し、以下の手順を案内:
1. WordPress管理画面 (muchinochi55.com/wp-admin) で新規投稿
2. 記事テキストを貼り付け
3. SWELL装飾を適用
4. アイキャッチ画像を設定
5. SEOタイトル・メタ・スラッグを入力
6. カテゴリ・タグを設定
7. プレビュー確認後に公開

---

## 完了後

公開済み記事を `blog/published/YYYY-MM-DD_テーマ.md` にコピーして保存。
