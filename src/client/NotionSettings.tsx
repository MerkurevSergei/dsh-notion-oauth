// Notion OAuth settings page: Login / Logout + live connection status.

import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

const API = '/api/dsh-notion-oauth';
const POLL_MS = 4000;

interface Status {
  connected: boolean;
  mounted: boolean;
  expiresAt: number | null;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

function formatExpiry(expiresAt: number | null, now: number): string {
  if (expiresAt === null) return '';
  const ms = expiresAt - now;
  if (ms <= 0) return '· токен истёк — ждём автообновление';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `· истекает через ${m} мин ${s} с`;
}

const styles: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, lineHeight: 1.5, padding: '4px 2px' },
  title: { margin: 0, fontSize: 15 },
  status: { padding: '8px 10px', borderRadius: 6, background: 'rgba(127,127,127,.12)' },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  button: { padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(127,127,127,.35)', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' },
  buttonPrimary: { padding: '5px 12px', borderRadius: 6, border: '1px solid #2563eb', background: '#2563eb', color: '#fff', font: 'inherit', cursor: 'pointer' },
  buttonDisabled: { opacity: 0.5, cursor: 'default' },
  ok: { color: '#22c55e' },
  err: { color: '#ef4444' },
  hint: { opacity: 0.75, fontSize: 12 },
  hintP: { margin: '4px 0' },
};

export function NotionSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const connected = status?.connected ?? false;

  const refresh = useCallback(async () => {
    try {
      setStatus(await api<Status>('/status'));
    } catch {
      /* endpoint unavailable — leave unchanged */
    }
  }, []);

  // Live status: poll on a cadence, plus a 1s ticker so the expiry countdown
  // feels real. The page also auto-reflects a background token refresh.
  useEffect(() => {
    refresh();
    const poll = window.setInterval(refresh, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [refresh]);

  // When the poll observes a successful login, settle the busy state.
  useEffect(() => {
    if (connected && busy) {
      setBusy(false);
      setMessage({ kind: 'ok', text: 'Подключено ✓' });
    }
  }, [connected, busy]);

  const login = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ ok: boolean; url?: string; error?: string }>('/login', {});
      if (!r.ok || !r.url) throw new Error(r.error ?? 'login failed');
      window.open(r.url, '_blank');
      setMessage({ kind: 'ok', text: 'Браузер открыт — подтвердите доступ к Notion…' });
    } catch (e) {
      setBusy(false);
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const logout = useCallback(async () => {
    setBusy(true);
    try {
      await api<{ ok: boolean }>('/logout', {});
      await refresh();
      setMessage({ kind: 'ok', text: 'Отключено' });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const expiryText = formatExpiry(status?.expiresAt ?? null, now);

  return (
    <div style={styles.page}>
      <h2 style={styles.title}>Notion (OAuth)</h2>
      <div style={styles.status}>
        {status === null
          ? <span>Проверка…</span>
          : connected
            ? <span style={styles.ok}>Подключено{expiryText}</span>
            : <span style={styles.err}>Не подключено</span>}
      </div>
      <div style={styles.row}>
        {!connected && (
          <button
            style={busy ? { ...styles.buttonPrimary, ...styles.buttonDisabled } : styles.buttonPrimary}
            disabled={busy}
            onClick={login}
          >
            Login
          </button>
        )}
        {connected && (
          <button
            style={busy ? { ...styles.button, ...styles.buttonDisabled } : styles.button}
            disabled={busy}
            onClick={logout}
          >
            Logout
          </button>
        )}
      </div>
      {message !== null && (
        <div style={message.kind === 'ok' ? styles.ok : styles.err}>{message.text}</div>
      )}
      <div style={styles.hint}>
        <p style={styles.hintP}>Авторизация через официальный Notion MCP (OAuth) — без токенов интеграций. Права берутся из вашего аккаунта Notion.</p>
        <p style={styles.hintP}>После входа становятся доступны инструменты mcp__notion__* (поиск, чтение и создание страниц, базы данных).</p>
        <p style={styles.hintP}>Токен обновляется автоматически; статус и срок действия обновляются на этой странице.</p>
      </div>
    </div>
  );
}
