// Local HTTP callback server for the OAuth redirect (127.0.0.1 only).
import { createServer, type Server } from 'node:http';

export interface LoginServerResult {
  redirectUri: string;
  wait: Promise<{ code: string; state: string }>;
}

export function startLoginServer(expectedState: string, port: number): Promise<LoginServerResult> {
  return new Promise((resolveListen, rejectListen) => {
    let resolveWait!: (v: { code: string; state: string }) => void;
    let rejectWait!: (e: Error) => void;
    const wait = new Promise<{ code: string; state: string }>((resolve, reject) => {
      resolveWait = resolve;
      rejectWait = reject;
    });
    wait.catch(() => {});

    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const respond = (body: string, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
        server.close();
      };
      const error = url.searchParams.get('error');
      if (error) {
        respond('<h1>Authorization failed</h1>');
        rejectWait(new Error(`OAuth error: ${error}`));
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) {
        respond('<h1>Missing code or state</h1>');
        rejectWait(new Error('missing code or state'));
        return;
      }
      if (state !== expectedState) {
        respond('<h1>State mismatch</h1>');
        rejectWait(new Error('state mismatch'));
        return;
      }
      respond('<h1>Authorized — you can close this page</h1>');
      resolveWait({ code, state });
    });

    server.on('error', rejectListen);
    server.listen(port, '127.0.0.1', () => {
      const actual = (server.address() as any).port as number;
      resolveListen({ redirectUri: `http://127.0.0.1:${actual}/callback`, wait });
    });
  });
}
