export type TriggerType =
  | 'meeting_request'
  | 'contract_intent'
  | 'price_inquiry'
  | 'urgency'
  | 'complaint'
  | 'law_question'
  | 'low_confidence'
  | 'turn_limit';

export type Trigger = {
  type: TriggerType;
  matched: string;
};

const TRIGGER_PATTERNS: { type: TriggerType; patterns: RegExp[] }[] = [
  {
    type: 'meeting_request',
    patterns: [/面談したい/, /会いたい/, /会って話/, /直接.*相談/, /アポ取り?たい/, /打ち合わせ/],
  },
  {
    type: 'contract_intent',
    patterns: [
      /契約したい/,
      /決めたい/,
      /買い付け/,
      /進めたい/,
      /申し?込み?たい/,
      /購入希望/,
      /買います/,
    ],
  },
  {
    type: 'price_inquiry',
    patterns: [
      /値段は/,
      /いくら/,
      /価格.*教/,
      /査定/,
      /ローン.*組め/,
      /借入.*いくら/,
      /月々.*返済/,
      /税金.*いくら/,
      /譲渡所得/,
      /手取り/,
    ],
  },
  {
    type: 'urgency',
    patterns: [/今週中/, /明日まで/, /今すぐ/, /急ぎ/, /急いで/, /至急/, /\d{1,2}日まで/],
  },
  {
    type: 'complaint',
    patterns: [
      /不満/,
      /怒/,
      /ひどい/,
      /最悪/,
      /他社で/,
      /他の会社/,
      /もう結構/,
      /キャンセル/,
      /やめます/,
    ],
  },
  {
    type: 'law_question',
    patterns: [/重要事項/, /手付/, /違約金/, /瑕疵/, /契約解除/, /訴訟/, /法律/, /宅建/],
  },
  {
    type: 'low_confidence',
    patterns: [
      /意味.*わからない/,
      /何の話/,
      /話.*噛み合わない/,
      /わかりにくい/,
      /もう少しわかりやすく/,
      /ちゃんと答え/,
      /答えになってない/,
    ],
  },
];

export function detectTriggers(text: string): Trigger[] {
  const triggered: Trigger[] = [];
  const seen = new Set<TriggerType>();
  for (const { type, patterns } of TRIGGER_PATTERNS) {
    if (seen.has(type)) continue;
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        triggered.push({ type, matched: match[0] });
        seen.add(type);
        break;
      }
    }
  }
  return triggered;
}

/**
 * 会話履歴ベースのトリガー検出。
 * - turn_limit: ユーザー発言が turnLimit を超えても深掘り情報が揃わない場合
 * - 履歴ベースの判定はキーワード検出と並走させる
 */
export function detectHistoryTriggers(
  history: { role: string; message: string }[],
  turnLimit: number
): Trigger[] {
  const triggers: Trigger[] = [];

  const userTurns = history.filter((h) => h.role === 'user').length;
  if (userTurns >= turnLimit) {
    const last = history.filter((h) => h.role === 'user').slice(-1)[0];
    triggers.push({
      type: 'turn_limit',
      matched: `${userTurns}往復経過`,
    });
    if (last) {
      triggers[triggers.length - 1].matched += `（直近発言: ${last.message.slice(0, 30)}...）`;
    }
  }

  return triggers;
}
