import type { Customer } from '../db/client';
import type { Trigger } from '../triggers/detector';

const TRIGGER_LABELS: Record<string, string> = {
  meeting_request: '🟠 面談希望',
  contract_intent: '🔴 契約意向',
  price_inquiry: '🟡 金額相談',
  urgency: '⚡ 急ぎ案件',
  complaint: '⚠️ 不満・クレーム',
  law_question: '📚 法務相談',
  low_confidence: '🤔 AI応答信頼度低下',
  turn_limit: '⏱ 進展なし(5往復超)',
};

export async function notifySlack(
  webhookUrl: string,
  customer: Customer,
  trigger: Trigger,
  message: string
) {
  if (!webhookUrl) return;

  const label = TRIGGER_LABELS[trigger.type] || trigger.type;
  const payload = {
    text: `${label} — ${customer.display_name || '未取得'}さん`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${label} 介入トリガー発火` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*顧客:* ${customer.display_name || '未取得'}さん` },
          { type: 'mrkdwn', text: `*LINE User ID:* \`${customer.line_user_id}\`` },
          { type: 'mrkdwn', text: `*マッチ:* ${trigger.matched}` },
          { type: 'mrkdwn', text: `*ステージ:* ${customer.stage}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*発言全文:*\n> ${message}` },
      },
    ],
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook error ${res.status}`);
  }
}
