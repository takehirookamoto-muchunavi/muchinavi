import { Hono } from 'hono';
import { handleLineWebhook } from './line/webhook';

export type Bindings = {
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  SLACK_WEBHOOK_URL: string;
  LINE_PERSONAL_USER_ID: string;
  ANTHROPIC_MODEL_DEFAULT: string;
  ANTHROPIC_MODEL_ESCALATION: string;
  ENVIRONMENT: string;
  INTERVENTION_TURN_LIMIT: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', (c) => c.text('MuchiNavi LINE Bot - Phase 0 prototype'));

app.get('/health', (c) =>
  c.json({
    ok: true,
    env: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
  })
);

app.post('/line/webhook', handleLineWebhook);

export default app;
