// src/index.ts
import z from "@deepseek-ai/schemastery";
import { Command } from "commander";
import { parseCmdline } from "@deepseek-ai/dsh-cmdline";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";

// src/notion-oauth.ts
import { createHash, randomBytes } from "node:crypto";
var UA = `dsh-notion-oauth/${"0.2.12"}`;
function withUA(init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", UA);
  return { ...init, headers };
}
function withTimeout(ms, init = {}) {
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
  return { ...init, signal };
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
async function fetchJson(url, init = {}, timeoutMs = 3e4) {
  const res = await fetch(url, withUA(withTimeout(timeoutMs, init)));
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}
async function discoverOAuth(resourceBaseUrl) {
  const origin = new URL(resourceBaseUrl).origin;
  const doc = await fetchJson(`${origin}/.well-known/oauth-protected-resource`);
  const authServer = doc.authorization_servers?.[0];
  if (!authServer) throw new Error("OAuth discovery: no authorization_servers advertised");
  if (!/^https:\/\//i.test(authServer)) {
    throw new Error("OAuth discovery: authorization server must be https");
  }
  const meta = await fetchJson(`${authServer}/.well-known/oauth-authorization-server`);
  const endpoints = {
    authorizationEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    registrationEndpoint: meta.registration_endpoint
  };
  for (const [key, value] of Object.entries(endpoints)) {
    if (typeof value !== "string" || !/^https:\/\//i.test(value)) {
      throw new Error(`OAuth discovery: ${key} must be https`);
    }
  }
  return endpoints;
}
async function registerClient(registrationEndpoint, redirectUris) {
  const res = await fetch(registrationEndpoint, withUA(withTimeout(3e4, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "dsh-notion-oauth",
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"]
    })
  })));
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
  const res = await fetch(tokenEndpoint, withUA(withTimeout(6e4, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: opts.clientId,
      code: opts.code,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.codeVerifier
    })
  })));
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}`);
  return parseTokenBody(await res.json());
}
var InvalidGrantError = class extends Error {
  constructor() {
    super("invalid_grant: refresh token expired or rotated away \u2014 re-authorize required");
  }
};
async function refreshAccessToken(tokenEndpoint, opts) {
  const res = await fetch(tokenEndpoint, withUA(withTimeout(6e4, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: opts.clientId,
      refresh_token: opts.refreshToken
    })
  })));
  const body = await res.json().catch(() => ({}));
  if (body.error === "invalid_grant") throw new InvalidGrantError();
  if (!res.ok) throw new Error(`refresh failed: HTTP ${res.status}`);
  return parseTokenBody(body);
}

// src/token-store.ts
import { credentialRef } from "@deepseek-ai/dsh-credentials";
var REF = credentialRef("NOTION_OAUTH");
function isStoredTokens(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return typeof v.accessToken === "string" && v.accessToken.length > 0 && typeof v.refreshToken === "string" && v.refreshToken.length > 0 && typeof v.clientId === "string" && v.clientId.length > 0 && typeof v.expiresAt === "number" && Number.isFinite(v.expiresAt);
}
var NotionTokenStore = class {
  credentials;
  constructor(credentials) {
    this.credentials = credentials;
  }
  async load() {
    const resolved = await this.credentials.resolve(REF);
    if (!resolved) return void 0;
    try {
      const parsed = JSON.parse(resolved.value);
      return isStoredTokens(parsed) ? parsed : void 0;
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
function page(options) {
  const accent = options.ok ? "#16a34a" : "#dc2626";
  const wash = options.ok ? "rgba(22,163,74,.12)" : "rgba(220,38,38,.12)";
  const glyph = options.ok ? "&#10003;" : "&#10007;";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notion \xB7 DeepSeek Harness</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #f5f6f8; color: #1f2328;
  }
  @media (prefers-color-scheme: dark) { body { background: #15171c; color: #e7e9ec; } }
  .card {
    width: min(430px, 100%); padding: 30px 28px 24px; text-align: center;
    background: #fff; border: 1px solid rgba(127,127,127,.2); border-radius: 16px;
    box-shadow: 0 10px 30px rgba(0,0,0,.07);
  }
  @media (prefers-color-scheme: dark) { .card { background: #1d2026; border-color: rgba(255,255,255,.08); } }
  .badge {
    width: 54px; height: 54px; margin: 0 auto 18px; border-radius: 50%;
    display: grid; place-items: center; font-size: 27px; font-weight: 700;
    color: ${accent}; background: ${wash};
  }
  h1 { margin: 0 0 8px; font-size: 19px; font-weight: 650; letter-spacing: -.01em; }
  p.detail { margin: 0; font-size: 14px; opacity: .72; }
  .brand {
    margin-top: 22px; padding-top: 14px; border-top: 1px solid rgba(127,127,127,.18);
    font-size: 11.5px; letter-spacing: .04em; text-transform: uppercase; opacity: .45;
  }
</style>
</head>
<body>
  <main class="card">
    <div class="badge">${glyph}</div>
    <h1>${options.title}</h1>
    <p class="detail">${options.detail}</p>
    <div class="brand">DeepSeek Harness \xB7 Notion</div>
  </main>
  <script>${options.ok ? "setTimeout(function(){ window.close(); }, 900);" : ""}</script>
</body>
</html>
`;
}
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
        reply(page({
          ok: false,
          title: "Access denied",
          detail: "Notion declined the authorization. Return to settings and try again."
        }));
        finish(() => rejectWait(new Error(`OAuth error: ${error}`)));
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) {
        reply(page({
          ok: false,
          title: "Invalid response",
          detail: "The callback is missing the authorization code. Please try again."
        }), 400);
        return;
      }
      if (state !== expectedState) {
        reply(page({
          ok: false,
          title: "Verification failed",
          detail: "This request does not match the authorization that was started."
        }), 400);
        return;
      }
      reply(page({
        ok: true,
        title: "Authorization received",
        detail: "Close this tab \u2014 the connection is finishing in DeepSeek Harness."
      }));
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
  let loginStarting = false;
  let tokenLock = Promise.resolve();
  function unmount() {
    if (refreshTimer !== void 0) {
      clearTimeout(refreshTimer);
      refreshTimer = void 0;
    }
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
    } catch (e) {
      console.error("[dsh-notion-oauth] refresh failed:", e);
      if (await store.load()) armRefresh(config.refreshRetryMs);
    }
  }
  function mountAndSchedule(accessToken, expiresAt) {
    mount(accessToken);
    armRefresh(Math.max(3e4, expiresAt - Date.now() - config.refreshLeadMs));
  }
  function withTokenLock(fn) {
    const run = tokenLock.then(fn, fn);
    tokenLock = run.then(() => void 0, () => void 0);
    return run;
  }
  function refreshAndMount() {
    return withTokenLock(async () => {
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
    });
  }
  function completePending(code) {
    return withTokenLock(async () => {
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
    });
  }
  async function beginLogin() {
    if (loginStarting) throw new Error("login already in progress");
    loginStarting = true;
    try {
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
      try {
        const clientId = await registerClient(endpoints.registrationEndpoint, [redirectUri]);
        const myPending = { endpoints, clientId, verifier, redirectUri };
        pending = myPending;
        const url = buildAuthorizeUrl(endpoints.authorizationEndpoint, {
          clientId,
          redirectUri,
          state,
          codeChallenge: computeChallenge(verifier)
        });
        const done = wait.then(({ code }) => completePending(code)).finally(() => {
          if (activeLoginClose === close) activeLoginClose = void 0;
          if (pending === myPending) pending = void 0;
        });
        done.catch((e) => console.error("[dsh-notion-oauth] login failed:", e));
        return { url, done };
      } catch (e) {
        close();
        if (activeLoginClose === close) activeLoginClose = void 0;
        throw e;
      }
    } finally {
      loginStarting = false;
    }
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
          expiresAt,
          loginPending: activeLoginClose !== void 0
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
        if (activeLoginClose) {
          activeLoginClose();
          activeLoginClose = void 0;
          pending = void 0;
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
    const notion = program.command("notion").description("Notion OAuth connection");
    notion.command("login").description("Authorize Notion via the official MCP OAuth flow").action(async () => {
      try {
        const { url, done } = await beginLogin();
        console.log(`[dsh-notion-oauth] open this URL to authorize Notion:
${url}`);
        await done;
        console.log("[dsh-notion-oauth] connected");
        ctx.appExit?.(0);
      } catch (e) {
        console.error(e);
        ctx.appExit?.(1);
      }
    });
    notion.command("logout").description("Disconnect Notion and forget the stored token").action(async () => {
      try {
        if (activeLoginClose) {
          activeLoginClose();
          activeLoginClose = void 0;
          pending = void 0;
        }
        await store.clear();
        unmount();
        console.log("[dsh-notion-oauth] disconnected");
        ctx.appExit?.(0);
      } catch (e) {
        console.error(e);
        ctx.appExit?.(1);
      }
    });
    notion.command("status").description("Show the stored Notion token state").action(async () => {
      try {
        const tokens = await store.load();
        const valid = tokens !== void 0 && tokens.expiresAt > Date.now();
        console.log(JSON.stringify({
          token: tokens === void 0 ? "none" : valid ? "valid" : "expired",
          expiresAt: tokens?.expiresAt ?? null
        }, null, 2));
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
        if (await store.load()) armRefresh(config.refreshRetryMs);
      }
    })();
  }
  ctx.effect(() => () => {
    if (activeLoginClose) {
      activeLoginClose();
      activeLoginClose = void 0;
      pending = void 0;
    }
    unmount();
  });
}
export {
  Config,
  apply,
  inject,
  name
};
