// Token storage in the DSH credentials service (single atomic record).
import { credentialRef } from '@deepseek-ai/dsh-credentials';

const REF = credentialRef('NOTION_OAUTH');

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  clientId: string;
}

function isStoredTokens(value: unknown): value is StoredTokens {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.accessToken === 'string' && v.accessToken.length > 0
    && typeof v.refreshToken === 'string' && v.refreshToken.length > 0
    && typeof v.clientId === 'string' && v.clientId.length > 0
    && typeof v.expiresAt === 'number' && Number.isFinite(v.expiresAt);
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
      const parsed: unknown = JSON.parse(resolved.value);
      return isStoredTokens(parsed) ? parsed : undefined;
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
