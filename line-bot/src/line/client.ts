type Profile = {
  displayName: string;
  userId: string;
  pictureUrl?: string;
  statusMessage?: string;
  language?: string;
};

export class LineClient {
  constructor(private accessToken: string) {}

  private async request(path: string, options: RequestInit = {}) {
    const res = await fetch(`https://api.line.me${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`LINE API error ${res.status} on ${path}: ${errBody}`);
    }
    return res;
  }

  async replyText(replyToken: string, text: string) {
    return this.request('/v2/bot/message/reply', {
      method: 'POST',
      body: JSON.stringify({
        replyToken,
        messages: [{ type: 'text', text }],
      }),
    });
  }

  async pushText(userId: string, text: string) {
    return this.request('/v2/bot/message/push', {
      method: 'POST',
      body: JSON.stringify({
        to: userId,
        messages: [{ type: 'text', text }],
      }),
    });
  }

  async getProfile(userId: string): Promise<Profile> {
    const res = await this.request(`/v2/bot/profile/${userId}`);
    return res.json();
  }
}
