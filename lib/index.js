// src/index.ts
import z from "@deepseek-ai/schemastery";
import { Command } from "commander";
import { parseCmdline } from "@deepseek-ai/dsh-cmdline";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";

// src/notion-oauth.ts
import { createHash, randomBytes } from "node:crypto";
var UA = "dsh-notion-oauth/0.1.0";
function withUA(init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", UA);
  return { ...init, headers };
}
function base64url(buf) {
  return buf.toString("base64url");
}
function generateVerifier() {
  return base64url(randomBytes(32));
}
function computeChallenge(verifier) {
  return base64url(createHash("sha256").update(verifier).digest());
}
function generateState() {
  return base64url(randomBytes(16));
}
async function fetchJson(url, init) {
  const res = await fetch(url, withUA(init));
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}
async function discoverOAuth(resourceBaseUrl) {
  const origin = new URL(resourceBaseUrl).origin;
  const doc = await fetchJson(`${origin}/.well-known/oauth-protected-resource`);
  const authServer = doc.authorization_servers?.[0];
  if (!authServer) throw new Error("OAuth discovery: no authorization_servers advertised");
  const meta = await fetchJson(`${authServer}/.well-known/oauth-authorization-server`);
  return {
    authorizationEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    registrationEndpoint: meta.registration_endpoint
  };
}
async function registerClient(registrationEndpoint, redirectUris) {
  const res = await fetch(registrationEndpoint, withUA({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "dsh-notion-oauth",
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"]
    })
  }));
  if (!res.ok) throw new Error(`DCR failed: HTTP ${res.status}`);
  const json = await res.json();
  return json.client_id;
}
function buildAuthorizeUrl(authorizationEndpoint, opts) {
  const url = new URL(authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
function parseTokenBody(body) {
  const accessToken = body.access_token;
  const expiresIn = body.expires_in;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("token response missing access_token");
  }
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("token response missing or invalid expires_in");
  }
  return { accessToken, refreshToken: body.refresh_token, expiresIn };
}
async function exchangeCode(tokenEndpoint, opts) {
  const res = await fetch(tokenEndpoint, withUA({
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: opts.clientId,
      code: opts.code,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.codeVerifier
    })
  }));
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}`);
  return parseTokenBody(await res.json());
}
var InvalidGrantError = class extends Error {
  constructor() {
    super("invalid_grant: refresh token expired or rotated away \u2014 re-authorize required");
  }
};
async function refreshAccessToken(tokenEndpoint, opts) {
  const res = await fetch(tokenEndpoint, withUA({
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: opts.clientId,
      refresh_token: opts.refreshToken
    })
  }));
  const body = await res.json().catch(() => ({}));
  if (body.error === "invalid_grant") throw new InvalidGrantError();
  if (!res.ok) throw new Error(`refresh failed: HTTP ${res.status}`);
  return parseTokenBody(body);
}

// src/token-store.ts
import { credentialRef } from "@deepseek-ai/dsh-credentials";
var REF = credentialRef("NOTION_OAUTH");
var NotionTokenStore = class {
  credentials;
  constructor(credentials) {
    this.credentials = credentials;
  }
  async load() {
    const resolved = await this.credentials.resolve(REF);
    if (!resolved) return void 0;
    try {
      return JSON.parse(resolved.value);
    } catch {
      return void 0;
    }
  }
  async save(tokens) {
    await this.credentials.set(REF, JSON.stringify(tokens));
  }
  async clear() {
    await this.credentials.unset(REF);
  }
};

// src/login-server.ts
import { createServer } from "node:http";
var DEFAULT_TIMEOUT_MS = 10 * 60 * 1e3;
function startLoginServer(expectedState, port, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolveListen, rejectListen) => {
    let settled = false;
    let resolveWait;
    let rejectWait;
    const wait = new Promise((resolve, reject) => {
      resolveWait = resolve;
      rejectWait = reject;
    });
    wait.catch(() => {
    });
    let timer;
    const finish = (settle) => {
      if (settled) return;
      settled = true;
      if (timer !== void 0) clearTimeout(timer);
      server.close();
      settle();
    };
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const reply = (body, status = 200) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
        res.end(body);
      };
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        reply("<h1>Authorization failed</h1>");
        finish(() => rejectWait(new Error(`OAuth error: ${error}`)));
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) {
        reply("<h1>Missing code or state</h1>", 400);
        return;
      }
      if (state !== expectedState) {
        reply("<h1>State mismatch</h1>", 400);
        return;
      }
      reply("<h1>Authorized \u2014 you can close this page</h1>");
      finish(() => resolveWait({ code, state }));
    });
    server.on("error", (e) => {
      if (settled) return;
      settled = true;
      if (timer !== void 0) clearTimeout(timer);
      rejectListen(e);
    });
    timer = setTimeout(() => {
      finish(() => rejectWait(new Error(`login timed out after ${Math.round(timeoutMs / 1e3)}s`)));
    }, timeoutMs);
    timer.unref?.();
    server.listen(port, "127.0.0.1", () => {
      const actual = server.address().port;
      resolveListen({
        redirectUri: `http://127.0.0.1:${actual}/callback`,
        wait,
        close: () => finish(() => rejectWait(new Error("login cancelled")))
      });
    });
  });
}

// src/index.ts
var name = "notion";
var inject = ["credentials", "cmdlineArgs"];
var Config = z.object({
  mcpUrl: z.string().default("https://mcp.notion.com/mcp"),
  port: z.number().default(53007),
  refreshLeadMs: z.number().default(5 * 60 * 1e3),
  refreshRetryMs: z.number().default(60 * 1e3)
});
var API_PREFIX = "/api/dsh-notion-oauth";
function apply(ctx, config) {
  const store = new NotionTokenStore(ctx.credentials);
  if (!/^https:\/\//i.test(config.mcpUrl)) {
    throw new Error(`dsh-notion-oauth: mcpUrl must be an https:// URL (got "${config.mcpUrl}")`);
  }
  const slot = {};
  let pending;
  let activeLoginClose;
  let mounted = false;
  let refreshTimer;
  function unmount() {
    if (slot.child) {
      slot.child.dispose();
      slot.child = void 0;
    }
    mounted = false;
  }
  function mount(accessToken) {
    unmount();
    slot.child = ctx.plugin(mcpClient, {
      transport: "streamable-http",
      serverName: "notion",
      url: config.mcpUrl,
      headers: { Authorization: `Bearer ${accessToken}` },
      toolCallTimeoutMs: 6e4,
      failOnStartupError: false
    });
    mounted = true;
  }
  function armRefresh(delayMs) {
    if (refreshTimer !== void 0) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void runRefresh();
    }, delayMs);
    refreshTimer.unref?.();
  }
  async function runRefresh() {
    try {
      await refreshAndMount();
      const t = await store.load();
      if (t) {
        armRefresh(Math.max(3e4, t.expiresAt - Date.now() - config.refreshLeadMs));
      }
    } catch (e) {
      console.error("[dsh-notion-oauth] refresh failed:", e);
      if (await store.load()) armRefresh(config.refreshRetryMs);
    }
  }
  function mountAndSchedule(accessToken, expiresAt) {
    mount(accessToken);
    armRefresh(Math.max(3e4, expiresAt - Date.now() - config.refreshLeadMs));
  }
  async function refreshAndMount() {
    const tokens = await store.load();
    if (!tokens) return;
    const disc = await discoverOAuth(config.mcpUrl);
    let next;
    try {
      next = await refreshAccessToken(disc.tokenEndpoint, {
        clientId: tokens.clientId,
        refreshToken: tokens.refreshToken
      });
    } catch (e) {
      if (e instanceof InvalidGrantError) {
        await store.clear();
        unmount();
        return;
      }
      throw e;
    }
    const refreshed = {
      accessToken: next.accessToken,
      refreshToken: next.refreshToken ?? tokens.refreshToken,
      expiresAt: Date.now() + next.expiresIn * 1e3,
      clientId: tokens.clientId
    };
    await store.save(refreshed);
    mountAndSchedule(refreshed.accessToken, refreshed.expiresAt);
  }
  async function completePending(code) {
    if (!pending) throw new Error("no pending login");
    const { endpoints, clientId, verifier, redirectUri } = pending;
    const tokens = await exchangeCode(endpoints.tokenEndpoint, {
      clientId,
      code,
      redirectUri,
      codeVerifier: verifier
    });
    if (!tokens.refreshToken) throw new Error("authorization response missing refresh_token");
    const stored = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + tokens.expiresIn * 1e3,
      clientId
    };
    await store.save(stored);
    mountAndSchedule(stored.accessToken, stored.expiresAt);
  }
  async function beginLogin() {
    if (activeLoginClose) {
      activeLoginClose();
      activeLoginClose = void 0;
      pending = void 0;
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
      codeChallenge: computeChallenge(verifier)
    });
    const done = wait.then(({ code }) => completePending(code)).finally(() => {
      activeLoginClose = void 0;
      pending = void 0;
    });
    done.catch((e) => console.error("[dsh-notion-oauth] login failed:", e));
    return { url, done };
  }
  function isTrustedRequest(req, method) {
    if (req.method !== method) return false;
    const addr = req.socket.remoteAddress;
    if (addr !== "127.0.0.1" && addr !== "::1" && addr !== "::ffff:127.0.0.1") return false;
    const host = req.headers.host;
    if (typeof host !== "string") return false;
    let hostUrl;
    try {
      hostUrl = new URL(`http://${host}`);
    } catch {
      return false;
    }
    const hn = hostUrl.hostname;
    if (hn !== "127.0.0.1" && hn !== "localhost" && hn !== "[::1]") return false;
    if (req.headers["sec-fetch-site"] === "cross-site") return false;
    const origin = req.headers.origin;
    if (origin !== void 0 && origin !== "dsh-app://app") {
      try {
        if (new URL(origin).host !== hostUrl.host) return false;
      } catch {
        return false;
      }
    }
    if (method === "POST") {
      const contentType = req.headers["content-type"];
      if (typeof contentType !== "string" || !/^application\/json\b/i.test(contentType)) return false;
    }
    return true;
  }
  function writeJson(res, status, value) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  }
  const routes = [
    {
      kind: "exact",
      path: `${API_PREFIX}/status`,
      handler: async (req, res) => {
        if (!isTrustedRequest(req, "GET")) {
          writeJson(res, 403, { error: "forbidden" });
          return;
        }
        const tokens = await store.load();
        const expiresAt = tokens?.expiresAt ?? null;
        writeJson(res, 200, {
          connected: mounted && expiresAt !== null && expiresAt > Date.now(),
          mounted,
          expiresAt
        });
      }
    },
    {
      kind: "exact",
      path: `${API_PREFIX}/login`,
      handler: async (req, res) => {
        if (!isTrustedRequest(req, "POST")) {
          writeJson(res, 403, { error: "forbidden" });
          return;
        }
        try {
          const { url } = await beginLogin();
          writeJson(res, 200, { ok: true, url });
        } catch (e) {
          writeJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
    },
    {
      kind: "exact",
      path: `${API_PREFIX}/logout`,
      handler: async (req, res) => {
        if (!isTrustedRequest(req, "POST")) {
          writeJson(res, 403, { error: "forbidden" });
          return;
        }
        await store.clear();
        unmount();
        writeJson(res, 200, { ok: true });
      }
    }
  ];
  ctx.inject(["webServer"], (ctx2) => {
    const disposers = routes.map((r) => ctx2.webServer.register(r));
    return () => {
      for (const d of disposers) d?.();
    };
  });
  const isNotionCommand = (ctx.cmdlineArgs?.get?.() ?? [])[0] === "notion";
  if (isNotionCommand) {
    const program = new Command();
    program.command("notion").command("login").description("Authorize Notion via the official MCP OAuth flow").action(async () => {
      try {
        const { url, done } = await beginLogin();
        console.log(`[dsh-notion-oauth] open this URL to authorize Notion:
${url}`);
        await done;
        ctx.appExit?.(0);
      } catch (e) {
        console.error(e);
        ctx.appExit?.(1);
      }
    });
    parseCmdline(ctx, program);
  }
  if (!isNotionCommand) {
    (async () => {
      try {
        const tokens = await store.load();
        if (!tokens) return;
        if (tokens.expiresAt > Date.now() + 6e4) {
          mountAndSchedule(tokens.accessToken, tokens.expiresAt);
        } else {
          await refreshAndMount();
        }
      } catch (e) {
        console.error("[dsh-notion-oauth] startup error:", e);
      }
    })();
  }
  ctx.effect(() => () => unmount());
}
export {
  Config,
  apply,
  inject,
  name
};
