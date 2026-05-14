import Anthropic from '@anthropic-ai/sdk';

type RespondInput = {
  model: string;
  systemPrompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
};

type RespondOutput = {
  text: string;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
};

export class ClaudeClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async respond(input: RespondInput): Promise<RespondOutput> {
    const response = await this.client.messages.create({
      model: input.model,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: input.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return {
      text,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    };
  }
}
