// Token storage in the DSH credentials service (single atomic record).
import { credentialRef } from '@deepseek-ai/dsh-credentials';

const REF = credentialRef('NOTION_OAUTH');

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  clientId: string;
}

export class NotionTokenStore {
  private credentials: any;

  constructor(credentials: any) {
    this.credentials = credentials;
  }

  async load(): Promise<StoredTokens | undefined> {
    const resolved = await this.credentials.resolve(REF);
    if (!resolved) return undefined;
    try {
      return JSON.parse(resolved.value) as StoredTokens;
    } catch {
      return undefined;
    }
  }

  async save(tokens: StoredTokens): Promise<void> {
    await this.credentials.set(REF, JSON.stringify(tokens));
  }

  async clear(): Promise<void> {
    await this.credentials.unset(REF);
  }
}
