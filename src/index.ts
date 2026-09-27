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
  const slot: { child?: { dispose(): void } } = {};
  let pending: PendingLogin | undefined;

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
    const endpoints = await discoverOAuth(config.mcpUrl);
    const verifier = generateVerifier();
    const state = generateState();
    const { redirectUri, wait } = await startLoginServer(state, config.port);
    const clientId = await registerClient(endpoints.registrationEndpoint, [redirectUri]);
    pending = { endpoints, clientId, verifier, redirectUri };
    const url = buildAuthorizeUrl(endpoints.authorizationEndpoint, {
      clientId,
      redirectUri,
      state,
      codeChallenge: computeChallenge(verifier),
    });
    const done = wait.then(({ code }) => completePending(code));
    done.catch((e) => console.error('[dsh-notion-oauth] login failed:', e));
    return { url, done };
  }

  // --- loopback-fenced routes (status / login / logout) ---
  function isLoopback(req: IncomingMessage): boolean {
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
    if (origin === undefined) return true;
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
        if (!isLoopback(req)) {
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
        if (!isLoopback(req)) {
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
        if (!isLoopback(req)) {
          writeJson(res, 403, { error: 'forbidden' });
          return;
        }
        await store.clear();
        unmount();
        writeJson(res, 200, { ok: true });
      },
    },
  ];

  // Register the settings routes only when a web server is present (web/desktop
  // profiles). Headless profiles still get the CLI `notion login` command.
  let webServer: any = null;
  try {
    webServer = (ctx as any).get?.('webServer') ?? (ctx as any).webServer;
  } catch {
    webServer = null;
  }
  if (webServer?.register) {
    ctx.effect(() => {
      const disposers = routes.map((r: any) => webServer.register(r));
      return () => {
        for (const d of disposers) (d as any)?.();
      };
    });
  }

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
