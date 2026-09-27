// dsh-notion-oauth-ui — host half. OAuth login (GUI route + CLI command), token
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
  refreshLeadMs: z.number().default(5 * 60 * 1000),
  refreshRetryMs: z.number().default(60 * 1000),
});

const API_PREFIX = '/api/dsh-notion-oauth-ui';

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
    throw new Error(`dsh-notion-oauth-ui: mcpUrl must be an https:// URL (got "${config.mcpUrl}")`);
  }

  const slot: { child?: { dispose(): void } } = {};
  let pending: PendingLogin | undefined;
  let activeLoginClose: (() => void) | undefined;
  let mounted = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let loginStarting = false;
  let tokenLock: Promise<unknown> = Promise.resolve();

  function unmount() {
    if (refreshTimer !== undefined) {
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
    }
    if (slot.child) {
      slot.child.dispose();
      slot.child = undefined;
    }
    mounted = false;
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
    mounted = true;
  }

  function armRefresh(delayMs: number): void {
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void runRefresh();
    }, delayMs);
    (refreshTimer as any).unref?.();
  }

  async function runRefresh(): Promise<void> {
    try {
      // refreshAndMount re-arms the next refresh via mountAndSchedule.
      await refreshAndMount();
    } catch (e) {
      console.error('[dsh-notion-oauth-ui] refresh failed:', e);
      // invalid_grant already cleared the store and unmounted; otherwise retry.
      if (await store.load()) armRefresh(config.refreshRetryMs);
    }
  }

  function mountAndSchedule(accessToken: string, expiresAt: number): void {
    mount(accessToken);
    armRefresh(Math.max(30_000, expiresAt - Date.now() - config.refreshLeadMs));
  }

  /** Serialize read-modify-write token mutations (login vs refresh). */
  function withTokenLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = tokenLock.then(fn, fn);
    tokenLock = run.then(() => undefined, () => undefined);
    return run;
  }

  function refreshAndMount(): Promise<void> {
    return withTokenLock(async () => {
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
      mountAndSchedule(refreshed.accessToken, refreshed.expiresAt);
    });
  }

  function completePending(code: string): Promise<void> {
    return withTokenLock(async () => {
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
      mountAndSchedule(stored.accessToken, stored.expiresAt);
    });
  }

  async function beginLogin(): Promise<{ url: string; done: Promise<void> }> {
    // Serialize the synchronous start-up window: until the callback server is
    // listening there is no `activeLoginClose` to cancel, so a second caller
    // would race us for the port.
    if (loginStarting) throw new Error('login already in progress');
    loginStarting = true;
    try {
      // One pending login at a time: cancel a flow that is still waiting for
      // its redirect so it cannot hold the callback port or be completed by
      // mistake.
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
      try {
        const clientId = await registerClient(endpoints.registrationEndpoint, [redirectUri]);
        const myPending: PendingLogin = { endpoints, clientId, verifier, redirectUri };
        pending = myPending;
        const url = buildAuthorizeUrl(endpoints.authorizationEndpoint, {
          clientId,
          redirectUri,
          state,
          codeChallenge: computeChallenge(verifier),
        });
        const done = wait
          .then(({ code }) => completePending(code))
          .finally(() => {
            // Only clear state this flow still owns: a newer login may have
            // replaced it while the token exchange was in flight.
            if (activeLoginClose === close) activeLoginClose = undefined;
            if (pending === myPending) pending = undefined;
          });
        done.catch((e) => console.error('[dsh-notion-oauth-ui] login failed:', e));
        return { url, done };
      } catch (e) {
        // Registration failed after the callback server started: release it.
        close();
        if (activeLoginClose === close) activeLoginClose = undefined;
        throw e;
      }
    } finally {
      loginStarting = false;
    }
  }

  // --- loopback-fenced routes (status / login / logout) ---
  //
  // The Desktop shell proxies renderer requests and strips `Origin` and
  // `Sec-Fetch-Site` before forwarding to the host, so a legitimate GUI call
  // arrives loopback-only, same-Host, and *without* those headers. An absent
  // `Origin` therefore cannot be treated as hostile. The cases that matter:
  //   * `Origin` present -> must be the app itself or the same host;
  //   * `Sec-Fetch-Site: cross-site` -> refused (plain web UI);
  //   * POST -> must be `application/json`, which is not a CORS-simple value,
  //     so a cross-site caller needs a preflight that these routes reject.
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
    if (origin !== undefined && origin !== 'dsh-app://app') {
      try {
        if (new URL(origin).host !== hostUrl.host) return false;
      } catch {
        return false;
      }
    }

    if (method === 'POST') {
      const contentType = req.headers['content-type'];
      if (typeof contentType !== 'string' || !/^application\/json\b/i.test(contentType)) return false;
    }

    return true;
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
        const expiresAt = tokens?.expiresAt ?? null;
        writeJson(res, 200, {
          connected: mounted && expiresAt !== null && expiresAt > Date.now(),
          mounted,
          expiresAt,
          loginPending: activeLoginClose !== undefined,
        });
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
        // Cancel an in-flight authorization so its callback cannot reconnect.
        if (activeLoginClose) {
          activeLoginClose();
          activeLoginClose = undefined;
          pending = undefined;
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
    const notion = program.command('notion').description('Notion OAuth connection');
    notion
      .command('login')
      .description('Authorize Notion via the official MCP OAuth flow')
      .action(async () => {
        try {
          const { url, done } = await beginLogin();
          console.log(`[dsh-notion-oauth-ui] open this URL to authorize Notion:\n${url}`);
          await done;
          console.log('[dsh-notion-oauth-ui] connected');
          ctx.appExit?.(0);
        } catch (e) {
          console.error(e);
          ctx.appExit?.(1);
        }
      });
    notion
      .command('logout')
      .description('Disconnect Notion and forget the stored token')
      .action(async () => {
        try {
          if (activeLoginClose) {
            activeLoginClose();
            activeLoginClose = undefined;
            pending = undefined;
          }
          await store.clear();
          unmount();
          console.log('[dsh-notion-oauth-ui] disconnected');
          ctx.appExit?.(0);
        } catch (e) {
          console.error(e);
          ctx.appExit?.(1);
        }
      });
    notion
      .command('status')
      .description('Show the stored Notion token state')
      .action(async () => {
        try {
          const tokens = await store.load();
          const valid = tokens !== undefined && tokens.expiresAt > Date.now();
          console.log(JSON.stringify({
            token: tokens === undefined ? 'none' : valid ? 'valid' : 'expired',
            expiresAt: tokens?.expiresAt ?? null,
          }, null, 2));
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
          mountAndSchedule(tokens.accessToken, tokens.expiresAt);
        } else {
          await refreshAndMount();
        }
      } catch (e) {
        console.error('[dsh-notion-oauth-ui] startup error:', e);
        // A transient discovery/refresh failure still leaves valid tokens: retry.
        if (await store.load()) armRefresh(config.refreshRetryMs);
      }
    })();
  }

  ctx.effect(() => () => {
    if (activeLoginClose) {
      activeLoginClose();
      activeLoginClose = undefined;
      pending = undefined;
    }
    unmount();
  });
}
