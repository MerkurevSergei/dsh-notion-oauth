// dsh-notion-oauth — host half. OAuth login (GUI route + CLI command), token
// storage via DSH credentials, and mounting the Notion MCP client.

import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { Command } from 'commander';
import { parseCmdline } from '@deepseek-ai/dsh-cmdline';
import * as mcpClient from '@deepseek-ai/dsh-mcp-client';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  discoverOAuth,
  registerClient,
  buildAuthorizeUrl,
  exchangeCode,
  refreshAccessToken,
  InvalidGrantError,
  generateVerifier,
  generateState,
  computeChallenge,
  type OAuthEndpoints,
} from './notion-oauth';
import { NotionTokenStore, type StoredTokens } from './token-store';
import { startLoginServer } from './login-server';

export const name = 'notion';
export const inject = ['credentials', 'cmdlineArgs'];

export const Config = z.object({
  mcpUrl: z.string().default('https://mcp.notion.com/mcp'),
  port: z.number().default(53007),
});

const API_PREFIX = '/api/dsh-notion-oauth';

interface PendingLogin {
  endpoints: OAuthEndpoints;
  clientId: string;
  verifier: string;
  redirectUri: string;
}

export function apply(ctx: Context, config: any) {
  const store = new NotionTokenStore(ctx.credentials);

  // Fail closed on a non-TLS MCP endpoint: OAuth discovery trusts whatever the
  // resource advertises, so a plaintext or unexpected origin is never accepted.
  if (!/^https:\/\//i.test(config.mcpUrl)) {
    throw new Error(`dsh-notion-oauth: mcpUrl must be an https:// URL (got "${config.mcpUrl}")`);
  }

  const slot: { child?: { dispose(): void } } = {};
  let pending: PendingLogin | undefined;
  let activeLoginClose: (() => void) | undefined;

  function unmount() {
    if (slot.child) {
      slot.child.dispose();
      slot.child = undefined;
    }
  }

  function mount(accessToken: string) {
    unmount();
    slot.child = ctx.plugin(mcpClient, {
      transport: 'streamable-http',
      serverName: 'notion',
      url: config.mcpUrl,
      headers: { Authorization: `Bearer ${accessToken}` },
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    }) as any;
  }

  async function refreshAndMount(): Promise<void> {
    const tokens = await store.load();
    if (!tokens) return;
    const disc = await discoverOAuth(config.mcpUrl);
    let next;
    try {
      next = await refreshAccessToken(disc.tokenEndpoint, {
        clientId: tokens.clientId,
        refreshToken: tokens.refreshToken,
      });
    } catch (e) {
      if (e instanceof InvalidGrantError) {
        await store.clear();
        unmount();
        return;
      }
      throw e;
    }
    const refreshed: StoredTokens = {
      accessToken: next.accessToken,
      refreshToken: next.refreshToken ?? tokens.refreshToken,
      expiresAt: Date.now() + next.expiresIn * 1000,
      clientId: tokens.clientId,
    };
    await store.save(refreshed);
    mount(refreshed.accessToken);
  }

  async function completePending(code: string): Promise<void> {
    if (!pending) throw new Error('no pending login');
    const { endpoints, clientId, verifier, redirectUri } = pending;
    const tokens = await exchangeCode(endpoints.tokenEndpoint, {
      clientId,
      code,
      redirectUri,
      codeVerifier: verifier,
    });
    if (!tokens.refreshToken) throw new Error('authorization response missing refresh_token');
    const stored: StoredTokens = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
      clientId,
    };
    await store.save(stored);
    mount(stored.accessToken);
  }

  async function beginLogin(): Promise<{ url: string; done: Promise<void> }> {
    // One pending login at a time: cancel a flow that is still waiting for its
    // redirect so it cannot hold the callback port or be completed by mistake.
    if (activeLoginClose) {
      activeLoginClose();
      activeLoginClose = undefined;
      pending = undefined;
    }
    const endpoints = await discoverOAuth(config.mcpUrl);
    const verifier = generateVerifier();
    const state = generateState();
    const { redirectUri, wait, close } = await startLoginServer(state, config.port);
    activeLoginClose = close;
    const clientId = await registerClient(endpoints.registrationEndpoint, [redirectUri]);
    pending = { endpoints, clientId, verifier, redirectUri };
    const url = buildAuthorizeUrl(endpoints.authorizationEndpoint, {
      clientId,
      redirectUri,
      state,
      codeChallenge: computeChallenge(verifier),
    });
    const done = wait
      .then(({ code }) => completePending(code))
      .finally(() => {
        activeLoginClose = undefined;
        pending = undefined;
      });
    done.catch((e) => console.error('[dsh-notion-oauth] login failed:', e));
    return { url, done };
  }

  // --- loopback-fenced routes (status / login / logout) ---
  //
  // Every route is pinned to one method, and the two state-changing ones demand
  // an explicit same-origin `Origin` instead of tolerating its absence: a
  // cross-site GET without `Origin` (an <img>, a navigation) must never reach
  // login or logout, and `Sec-Fetch-Site` alone is not sent by every client.
  function isTrustedRequest(req: IncomingMessage, method: 'GET' | 'POST'): boolean {
    if (req.method !== method) return false;

    const addr = req.socket.remoteAddress;
    if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') return false;

    const host = req.headers.host;
    if (typeof host !== 'string') return false;
    let hostUrl: URL;
    try {
      hostUrl = new URL(`http://${host}`);
    } catch {
      return false;
    }
    const hn = hostUrl.hostname;
    if (hn !== '127.0.0.1' && hn !== 'localhost' && hn !== '[::1]') return false;

    if (req.headers['sec-fetch-site'] === 'cross-site') return false;

    const origin = req.headers.origin;
    if (origin === undefined) {
      // Safe reads may omit it; anything that changes state may not.
      return method === 'GET';
    }
    try {
      return new URL(origin).host === hostUrl.host;
    } catch {
      return false;
    }
  }

  function writeJson(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
  }

  const routes = [
    {
      kind: 'exact',
      path: `${API_PREFIX}/status`,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!isTrustedRequest(req, 'GET')) {
          writeJson(res, 403, { error: 'forbidden' });
          return;
        }
        const tokens = await store.load();
        writeJson(res, 200, { connected: !!tokens });
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/login`,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!isTrustedRequest(req, 'POST')) {
          writeJson(res, 403, { error: 'forbidden' });
          return;
        }
        try {
          const { url } = await beginLogin();
          writeJson(res, 200, { ok: true, url });
        } catch (e) {
          writeJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/logout`,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!isTrustedRequest(req, 'POST')) {
          writeJson(res, 403, { error: 'forbidden' });
          return;
        }
        await store.clear();
        unmount();
        writeJson(res, 200, { ok: true });
      },
    },
  ];

  // Register the settings routes once a web server is available (web/desktop
  // profiles). Headless profiles never provide one, so the CLI `notion login`
  // command keeps working there without the routes.
  ctx.inject(['webServer'], (ctx: any) => {
    const disposers = routes.map((r: any) => ctx.webServer.register(r));
    return () => {
      for (const d of disposers) d?.();
    };
  });

  // --- CLI command (fallback) ---
  const isNotionCommand = (ctx.cmdlineArgs?.get?.() ?? [])[0] === 'notion';
  if (isNotionCommand) {
    const program = new Command();
    program
      .command('notion')
      .command('login')
      .description('Authorize Notion via the official MCP OAuth flow')
      .action(async () => {
        try {
          const { url, done } = await beginLogin();
          console.log(`[dsh-notion-oauth] open this URL to authorize Notion:\n${url}`);
          await done;
          ctx.appExit?.(0);
        } catch (e) {
          console.error(e);
          ctx.appExit?.(1);
        }
      });
    parseCmdline(ctx, program);
  }

  // --- startup: mount if a token is present, else refresh ---
  if (!isNotionCommand) {
    (async () => {
      try {
        const tokens = await store.load();
        if (!tokens) return;
        if (tokens.expiresAt > Date.now() + 60_000) {
          mount(tokens.accessToken);
        } else {
          await refreshAndMount();
        }
      } catch (e) {
        console.error('[dsh-notion-oauth] startup error:', e);
      }
    })();
  }

  ctx.effect(() => () => unmount());
}
