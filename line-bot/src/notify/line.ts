import { LineClient } from '../line/client';
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

export async function notifyOkamoto(
  line: LineClient,
  okamotoUserId: string,
  customer: Customer,
  trigger: Trigger,
  message: string
) {
  const label = TRIGGER_LABELS[trigger.type] || trigger.type;
  const text = `${label} 介入トリガー
━━━━━━━━━━
👤 ${customer.display_name || '未取得'}さん
🏷 ${customer.stage}
🔑 ${trigger.matched}

💬 発言:
${message}`;

  await line.pushText(okamotoUserId, text);
}
