週次レビューを実行してください。

手順:
1. 管理者パスワードを確認（まだ知らなければユーザーに聞く）
2. 以下のAPIを呼び出してデータを収集:
   - `curl -s -H "X-Admin-Pass: {password}" https://muchinavi.com/api/admin/briefing`
   - `curl -s -H "X-Admin-Pass: {password}" https://muchinavi.com/api/admin/customers`
   - `curl -s -H "X-Admin-Pass: {password}" https://muchinavi.com/api/admin/events`
   - `curl -s -H "X-Admin-Pass: {password}" https://muchinavi.com/api/admin/processes?status=active`
3. ユーザーに以下を質問:
   - 今週のMuchiNavi新規登録数
   - 今週の面談数
   - 今週公開した記事（あれば）
   - 気になったこと・困ったこと
4. agents/analyst.md の週次データ集約に従って以下を出力:

---

# 週次レビュー（{date}）

## 今週の成果サマリー
- 新規登録: {入力された数}名
- 面談実施: {入力された数}件
- 公開記事: {入力された記事}
- アクティブ顧客: {API取得}名

## 数字の前週比
（可能な範囲で比較）

## 顧客ステータス
- ステージ別分布
- 今週ステージが進んだ顧客
- フォロー漏れ（14日以上連絡なし）

## 取引進捗
- 進行中の取引一覧
- 今週のステップ変更

## 来週やること（優先順位TOP3）
1. ...
2. ...
3. ...

## MuchiNaviへの改善フィードバック
（データから見える改善ポイント）

---

5. レビュー結果を提示し、来週の優先事項について議論
