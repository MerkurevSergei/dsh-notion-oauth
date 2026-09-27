// Local HTTP callback server for the OAuth redirect (127.0.0.1 only).
import { createServer, type Server } from 'node:http';

/** Default deadline for the whole authorization round-trip. */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface LoginServerResult {
  redirectUri: string;
  wait: Promise<{ code: string; state: string }>;
  /** Stop listening and reject the pending wait (idempotent). */
  close: () => void;
}

/**
 * The browser-facing callback page. Self-contained (no external assets, no
 * reflected input) — it only ever reports the outcome of the attempt. A
 * successful page tries to close its own tab, since the flow is popup-driven.
 */
function page(options: { ok: boolean; title: string; detail: string }): string {
  const accent = options.ok ? '#16a34a' : '#dc2626';
  const wash = options.ok ? 'rgba(22,163,74,.12)' : 'rgba(220,38,38,.12)';
  const glyph = options.ok ? '&#10003;' : '&#10007;';
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notion · DeepSeek Harness</title>
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
    <div class="brand">DeepSeek Harness · Notion</div>
  </main>
  <script>${options.ok ? 'setTimeout(function(){ window.close(); }, 900);' : ''}</script>
</body>
</html>
`;
}

export function startLoginServer(
  expectedState: string,
  port: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<LoginServerResult> {
  return new Promise((resolveListen, rejectListen) => {
    let settled = false;
    let resolveWait!: (v: { code: string; state: string }) => void;
    let rejectWait!: (e: Error) => void;
    const wait = new Promise<{ code: string; state: string }>((resolve, reject) => {
      resolveWait = resolve;
      rejectWait = reject;
    });
    wait.catch(() => {});

    let timer: ReturnType<typeof setTimeout> | undefined;

    /** Settle once: stop listening, then resolve or reject the wait. */
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      server.close();
      settle();
    };

    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const reply = (body: string, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
      };
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      // A callback the identity provider itself rejected is terminal.
      const error = url.searchParams.get('error');
      if (error) {
        reply(page({
          ok: false,
          title: 'Доступ не предоставлен',
          detail: 'Notion отклонил авторизацию. Вернитесь в настройки и попробуйте снова.',
        }));
        finish(() => rejectWait(new Error(`OAuth error: ${error}`)));
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      // Malformed or forged callbacks must NOT tear a pending login down — any
      // local process could otherwise kill the flow with one stray request.
      // Answer them and keep waiting for the real redirect.
      if (!code || !state) {
        reply(page({
          ok: false,
          title: 'Некорректный ответ',
          detail: 'В ответе нет кода авторизации. Попробуйте войти ещё раз.',
        }), 400);
        return;
      }
      if (state !== expectedState) {
        reply(page({
          ok: false,
          title: 'Проверка не пройдена',
          detail: 'Этот запрос не соответствует начатой авторизации.',
        }), 400);
        return;
      }
      reply(page({
        ok: true,
        title: 'Notion подключён',
        detail: 'Можно закрыть эту вкладку и вернуться в DeepSeek Harness.',
      }));
      finish(() => resolveWait({ code, state }));
    });

    server.on('error', (e) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      rejectListen(e);
    });

    timer = setTimeout(() => {
      finish(() => rejectWait(new Error(`login timed out after ${Math.round(timeoutMs / 1000)}s`)));
    }, timeoutMs);
    (timer as any).unref?.();

    server.listen(port, '127.0.0.1', () => {
      const actual = (server.address() as any).port as number;
      resolveListen({
        redirectUri: `http://127.0.0.1:${actual}/callback`,
        wait,
        close: () => finish(() => rejectWait(new Error('login cancelled'))),
      });
    });
  });
}
