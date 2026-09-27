// OAuth 2.0 (authorization code + PKCE) for Notion Remote MCP.
// Every fetch adds a User-Agent header: Cloudflare in front of mcp.notion.com
// rejects requests without one with HTTP 403 (see openai/codex#12859).

import { createHash, randomBytes } from 'node:crypto';

declare const __PKG_VERSION__: string;

const UA = `dsh-notion-oauth/${__PKG_VERSION__}`;

function withUA(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  if (!headers.has('User-Agent')) headers.set('User-Agent', UA);
  return { ...init, headers };
}

function withTimeout(ms: number, init: RequestInit = {}): RequestInit {
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(ms)])
    : AbortSignal.timeout(ms);
  return { ...init, signal };
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function generateVerifier(): string {
  return base64url(randomBytes(32));
}

export function computeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export function generateState(): string {
  return base64url(randomBytes(16));
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<any> {
  const res = await fetch(url, withUA(withTimeout(timeoutMs, init)));
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export interface OAuthEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
}

export async function discoverOAuth(resourceBaseUrl: string): Promise<OAuthEndpoints> {
  const origin = new URL(resourceBaseUrl).origin;
  const doc = await fetchJson(`${origin}/.well-known/oauth-protected-resource`);
  const authServer: string | undefined = doc.authorization_servers?.[0];
  if (!authServer) throw new Error('OAuth discovery: no authorization_servers advertised');
  if (!/^https:\/\//i.test(authServer)) {
    throw new Error('OAuth discovery: authorization server must be https');
  }
  const meta = await fetchJson(`${authServer}/.well-known/oauth-authorization-server`);
  const endpoints = {
    authorizationEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    registrationEndpoint: meta.registration_endpoint,
  };
  for (const [key, value] of Object.entries(endpoints)) {
    if (typeof value !== 'string' || !/^https:\/\//i.test(value)) {
      throw new Error(`OAuth discovery: ${key} must be https`);
    }
  }
  return endpoints;
}

export async function registerClient(registrationEndpoint: string, redirectUris: string[]): Promise<string> {
  const res = await fetch(registrationEndpoint, withUA(withTimeout(30_000, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'dsh-notion-oauth',
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    }),
  })));
  if (!res.ok) throw new Error(`DCR failed: HTTP ${res.status}`);
  const json: any = await res.json();
  return json.client_id as string;
}

export function buildAuthorizeUrl(authorizationEndpoint: string, opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('state', opts.state);
  url.searchParams.set('code_challenge', opts.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

function parseTokenBody(body: any): Tokens {
  const accessToken = body.access_token;
  const expiresIn = body.expires_in;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('token response missing access_token');
  }
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('token response missing or invalid expires_in');
  }
  return { accessToken, refreshToken: body.refresh_token, expiresIn };
}

export async function exchangeCode(tokenEndpoint: string, opts: {
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<Tokens> {
  const res = await fetch(tokenEndpoint, withUA(withTimeout(60_000, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: opts.clientId,
      code: opts.code,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.codeVerifier,
    }),
  })));
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}`);
  return parseTokenBody(await res.json());
}

export class InvalidGrantError extends Error {
  constructor() {
    super('invalid_grant: refresh token expired or rotated away — re-authorize required');
  }
}

export async function refreshAccessToken(tokenEndpoint: string, opts: {
  clientId: string;
  refreshToken: string;
}): Promise<Tokens> {
  const res = await fetch(tokenEndpoint, withUA(withTimeout(60_000, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: opts.clientId,
      refresh_token: opts.refreshToken,
    }),
  })));
  const body: any = await res.json().catch(() => ({}));
  if (body.error === 'invalid_grant') throw new InvalidGrantError();
  if (!res.ok) throw new Error(`refresh failed: HTTP ${res.status}`);
  return parseTokenBody(body);
}
