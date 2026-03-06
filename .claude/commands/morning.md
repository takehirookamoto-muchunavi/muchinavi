朝のブリーフィングを実行してください。

手順:
1. 管理者パスワードを確認（まだ知らなければユーザーに聞く）
2. `curl -s -H "X-Admin-Pass: {password}" https://muchinavi.com/api/admin/briefing` を実行
3. レスポンスのJSONを以下のフォーマットに整理して表示:

---

おはようございます、岡本さん！
{date}（{dayOfWeek}）| アクティブ顧客: {stats.totalActive}名

━━━ 今日の予定 ━━━
{todayEvents を時系列で表示。各イベントは「HH:MM {type絵文字} {title} — {customerName}」形式}
（なければ「本日の予定はありません」）

━━━ 要対応アクション ━━━
🔴 期限切れ ({urgent.overdue.length}件)
{各項目を「- {customerName}: {text} ({deadline}期限)」で表示}

🟡 今日期限 ({urgent.today.length}件)
{同上}

📋 今週中 ({urgent.week.length}件)
{同上}

━━━ フォローアップ推奨 ━━━
{urgent.followUp を「- {customerName}: {daysSinceContact}日間連絡なし（{stageLabel}）」で表示}
{noContact: true なら「- {customerName}: 連絡履歴なし（{stageLabel}）」}

━━━ 取引進捗 ━━━
{processSummary の各ステップで customers があるものだけ表示}
{「{label}: {customerName} (期限: {deadline})」形式}
{activeProcessCount が 0 なら「現在進行中の取引はありません」}

━━━━━━━━━━━━━━━━━

何から取り掛かりますか？

---

イベント種別の絵文字マッピング:
- viewing → 🏠
- meeting → 🤝
- online_meeting → 💻
- contract → ✍️
- settlement → 🏦
- jusetsu → 📋
- jusetsu_prep → 📝
- terass_application → 📝
- loan_review → 🏧
- follow_up → 📞
- general → 📌
