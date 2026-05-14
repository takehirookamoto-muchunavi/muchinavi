import { Context } from 'hono';
import type { Bindings } from '../index';
import { LineClient } from './client';
import { ClaudeClient } from '../llm/claude';
import { SupabaseDb } from '../db/client';
import { detectTriggers } from '../triggers/detector';
import { notifySlack } from '../notify/slack';
import { notifyOkamoto } from '../notify/line';
import { buildSystemPrompt } from '../llm/prompts/system';

type LineEvent = {
  type: string;
  replyToken?: string;
  source: { userId: string; type: string };
  message?: { type: string; text?: string };
  timestamp: number;
};

async function verifyLineSignature(
  body: string,
  signature: string | undefined,
  channelSecret: string
): Promise<boolean> {
  if (!signature) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return expected === signature;
}

export async function handleLineWebhook(c: Context<{ Bindings: Bindings }>) {
  const signature = c.req.header('X-Line-Signature');
  const body = await c.req.text();

  const valid = await verifyLineSignature(body, signature, c.env.LINE_CHANNEL_SECRET);
  if (!valid) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  const payload = JSON.parse(body);
  const events: LineEvent[] = payload.events || [];

  c.executionCtx.waitUntil(processEvents(events, c.env));

  return c.json({ ok: true });
}

async function processEvents(events: LineEvent[], env: Bindings) {
  const line = new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN);
  const claude = new ClaudeClient(env.ANTHROPIC_API_KEY);
  const db = new SupabaseDb(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  for (const event of events) {
    try {
      await processSingleEvent(event, { line, claude, db, env });
    } catch (err) {
      console.error('processSingleEvent failed', err);
    }
  }
}

type Deps = { line: LineClient; claude: ClaudeClient; db: SupabaseDb; env: Bindings };

async function processSingleEvent(event: LineEvent, deps: Deps) {
  const { line, claude, db, env } = deps;

  if (event.type === 'follow') {
    const profile = await line.getProfile(event.source.userId).catch(() => null);
    const displayName = profile?.displayName || 'お客様';
    const customer = await db.upsertCustomer({
      line_user_id: event.source.userId,
      display_name: displayName,
      picture_url: profile?.pictureUrl,
      stage: 'new',
    });
    const greeting = `${displayName}さん、はじめまして。
むちのち（岡本岳大）と申します。大阪・阪神間を拠点に「本当のお客様ファースト」を大切にしている不動産エージェントです。

ここでは住まい探しのご相談を24時間お受けしています。ご家族のことやご希望のエリア、お住み替えを考えられているきっかけなど、少しずつ教えていただけると、ぴったりの選択肢を一緒に考えていけます。

まず、今のお住まい状況やお住み替えを検討されているきっかけからお聞かせいただけますか？`;
    if (event.replyToken) {
      await line.replyText(event.replyToken, greeting);
    }
    await db.saveConversation(customer.id, 'assistant', greeting);
    return;
  }

  if (event.type !== 'message' || event.message?.type !== 'text') return;

  const userMessage = event.message.text || '';

  let customer = await db.getCustomerByLineId(event.source.userId);
  if (!customer) {
    const profile = await line.getProfile(event.source.userId).catch(() => null);
    customer = await db.upsertCustomer({
      line_user_id: event.source.userId,
      display_name: profile?.displayName || 'お客様',
      picture_url: profile?.pictureUrl,
      stage: 'hearing',
    });
  }

  await db.saveConversation(customer.id, 'user', userMessage);

  const triggers = detectTriggers(userMessage);
  if (triggers.length > 0) {
    for (const trigger of triggers) {
      await db.saveTrigger(customer.id, trigger.type, trigger.matched);
      await notifySlack(env.SLACK_WEBHOOK_URL, customer, trigger, userMessage).catch((err) =>
        console.error('Slack notify failed', err)
      );
      if (env.LINE_PERSONAL_USER_ID) {
        await notifyOkamoto(line, env.LINE_PERSONAL_USER_ID, customer, trigger, userMessage).catch(
          (err) => console.error('LINE personal notify failed', err)
        );
      }
    }
    if (event.replyToken) {
      await line.replyText(
        event.replyToken,
        `承知いたしました。重要なご相談ですので、岡本から直接ご連絡させていただきますね。少しだけお時間をいただけますでしょうか。`
      );
    }
    await db.updateCustomerStage(customer.id, 'escalated', triggers[0].type);
    return;
  }

  const history = await db.getRecentConversation(customer.id, 20);

  const systemPrompt = buildSystemPrompt(customer);
  const reply = await claude.respond({
    model: env.ANTHROPIC_MODEL_DEFAULT,
    systemPrompt,
    messages: history.map((h) => ({
      role: h.role === 'user' ? 'user' : 'assistant',
      content: h.message,
    })),
  });

  await db.saveConversation(customer.id, 'assistant', reply.text, {
    tokens_in: reply.tokensIn,
    tokens_out: reply.tokensOut,
    model: env.ANTHROPIC_MODEL_DEFAULT,
  });

  if (event.replyToken) {
    await line.replyText(event.replyToken, reply.text);
  }
}
