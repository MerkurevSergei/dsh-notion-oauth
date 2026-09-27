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
        reply('<h1>Authorization failed</h1>');
        finish(() => rejectWait(new Error(`OAuth error: ${error}`)));
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      // Malformed or forged callbacks must NOT tear a pending login down — any
      // local process could otherwise kill the flow with one stray request.
      // Answer them and keep waiting for the real redirect.
      if (!code || !state) {
        reply('<h1>Missing code or state</h1>', 400);
        return;
      }
      if (state !== expectedState) {
        reply('<h1>State mismatch</h1>', 400);
        return;
      }
      reply('<h1>Authorized — you can close this page</h1>');
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
