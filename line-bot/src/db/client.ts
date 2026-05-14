import { createClient, SupabaseClient as SbClient } from '@supabase/supabase-js';

export type Customer = {
  id: string;
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
  family_structure: Record<string, unknown> | null;
  life_stage: string | null;
  values_priority: Record<string, unknown> | null;
  area_preference: Record<string, unknown> | null;
  budget_range: Record<string, unknown> | null;
  reason_for_move: string | null;
  stage: string;
  temperature: string;
  escalated_at: string | null;
  escalation_reason: string | null;
};

type ConversationMessage = {
  role: string;
  message: string;
  created_at: string;
};

type ConversationMetadata = {
  tokens_in?: number;
  tokens_out?: number;
  model?: string;
  response_ms?: number;
};

export class SupabaseDb {
  private client: SbClient;

  constructor(url: string, serviceKey: string) {
    this.client = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });
  }

  async getCustomerByLineId(lineUserId: string): Promise<Customer | null> {
    const { data, error } = await this.client
      .from('customers')
      .select('*')
      .eq('line_user_id', lineUserId)
      .maybeSingle();
    if (error) throw error;
    return data as Customer | null;
  }

  async upsertCustomer(input: {
    line_user_id: string;
    display_name?: string;
    picture_url?: string;
    stage?: string;
  }): Promise<Customer> {
    const { data, error } = await this.client
      .from('customers')
      .upsert(input, { onConflict: 'line_user_id' })
      .select()
      .single();
    if (error) throw error;
    return data as Customer;
  }

  async saveConversation(
    customerId: string,
    role: 'user' | 'assistant' | 'system',
    message: string,
    metadata?: ConversationMetadata
  ) {
    const { error } = await this.client.from('conversations').insert({
      customer_id: customerId,
      role,
      message,
      metadata,
    });
    if (error) throw error;
  }

  async getRecentConversation(
    customerId: string,
    limit = 20
  ): Promise<ConversationMessage[]> {
    const { data, error } = await this.client
      .from('conversations')
      .select('role, message, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).reverse() as ConversationMessage[];
  }

  async saveTrigger(customerId: string, triggerType: string, matchedText: string) {
    const { error } = await this.client.from('triggers').insert({
      customer_id: customerId,
      trigger_type: triggerType,
      matched_text: matchedText,
      notified_slack: true,
      notified_line: true,
    });
    if (error) throw error;
  }

  async updateCustomerStage(customerId: string, stage: string, reason?: string) {
    const updates: Record<string, unknown> = { stage };
    if (stage === 'escalated') {
      updates.escalated_at = new Date().toISOString();
      updates.escalation_reason = reason;
    }
    const { error } = await this.client.from('customers').update(updates).eq('id', customerId);
    if (error) throw error;
  }
}
