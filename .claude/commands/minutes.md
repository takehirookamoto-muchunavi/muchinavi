議事録解析を実行してください。

手順:
1. ユーザーに面談の議事録テキスト（Googleミートの文字起こし等）を貼り付けてもらう
2. agents/analyst.md の議事録解析フォーマットに従って解析
3. 以下を抽出・整理:
   - 顧客プロフィール（家族構成、職業、年収、自己資金等）
   - 希望条件（エリア、物件タイプ、予算、間取り等）
   - 購入動機・背景（きっかけ、検討段階、緊急度）
   - 面談中の重要発言（原文引用と解釈）
   - ネクストアクション（担当と期限）
4. MuchiNavi更新提案を作成:
   - ステージ変更案
   - ToDo追加案
   - タグ追加案
   - メモ更新案
5. 解析結果を `minutes/YYYY-MM-DD_顧客イニシャル.md` として保存
6. ユーザーの承認を得てからMuchiNavi APIを呼び出して更新:
   - `PUT /api/admin/customer/:token` （ステージ・メモ更新）
   - `POST /api/admin/todos/:token` （ToDo追加）
   - `POST /api/admin/interactions/:token` （連絡履歴追加）
   - `POST /api/admin/events` （次回イベント登録）
