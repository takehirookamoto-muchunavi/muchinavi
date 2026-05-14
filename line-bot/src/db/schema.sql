-- MuchiNavi LINE Bot - Supabase スキーマ
-- Phase 0 prototype
-- 実行: Supabase Dashboard → SQL Editor で全文ペースト → Run

-- =========================
-- customers: LINE友だち追加した顧客
-- =========================
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  line_user_id text unique not null,
  display_name text,
  picture_url text,

  -- 深層理解フェーズで収集する情報
  family_structure jsonb,         -- {adults: 2, children: 1, ages: [3]}
  life_stage text,                -- 'newlywed' | 'child_birth' | 'school_age' | 'second_house'
  values_priority jsonb,          -- {school: 5, commute: 3, budget: 4}
  area_preference jsonb,          -- {primary: '吹田市', secondary: ['茨木市'], school_district: '○○小'}
  budget_range jsonb,             -- {min: 4000, max: 6000, unit: '万円'}
  reason_for_move text,           -- 'rent_burden' | 'family_growth' | 'investment' | other

  -- ステージ管理
  stage text default 'new',       -- 'new' | 'hearing' | 'proposing' | 'booking' | 'escalated' | 'closed'
  temperature text default 'cold', -- 'hot' | 'warm' | 'cold' | 'vip'
  escalated_at timestamptz,
  escalation_reason text,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_message_at timestamptz default now()
);

create index if not exists idx_customers_line_user_id on customers(line_user_id);
create index if not exists idx_customers_stage on customers(stage);
create index if not exists idx_customers_last_message_at on customers(last_message_at desc);

-- =========================
-- conversations: 全会話ログ（Bot ↔ 顧客）
-- =========================
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  role text not null,             -- 'user' | 'assistant' | 'system'
  message text not null,
  message_type text default 'text', -- 'text' | 'image' | 'sticker' | 'location'
  metadata jsonb,                 -- {tokens_in, tokens_out, model, response_ms}
  created_at timestamptz default now()
);

create index if not exists idx_conversations_customer_id on conversations(customer_id, created_at desc);

-- =========================
-- triggers: 介入トリガー発火ログ
-- =========================
create table if not exists triggers (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  trigger_type text not null,     -- 'meeting_request' | 'contract_intent' | 'price_inquiry' | 'urgency' | 'complaint' | 'law_question' | 'low_confidence' | 'turn_limit'
  matched_text text,
  triggered_at timestamptz default now(),
  notified_slack boolean default false,
  notified_line boolean default false,
  resolved_at timestamptz,
  resolution_note text
);

create index if not exists idx_triggers_customer_id on triggers(customer_id, triggered_at desc);
create index if not exists idx_triggers_unresolved on triggers(triggered_at desc) where resolved_at is null;

-- =========================
-- properties: 物件提案候補（MuchiNavi本体APIから同期 or 手動投入）
-- Phase 0は最小定義のみ、Phase 1で本格設計
-- =========================
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,        -- TERASS Picks ID / 物件ID
  title text not null,
  area text,
  price_yen bigint,
  layout text,
  built_year int,
  url text,
  raw_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_properties_external_id on properties(external_id);

-- =========================
-- updated_at 自動更新トリガー
-- =========================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_customers_updated_at on customers;
create trigger trg_customers_updated_at before update on customers
  for each row execute function update_updated_at();

drop trigger if exists trg_properties_updated_at on properties;
create trigger trg_properties_updated_at before update on properties
  for each row execute function update_updated_at();
