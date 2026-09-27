// Notion OAuth settings page: Login / Logout + connection status.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

const API = '/api/dsh-notion-oauth-ui';
const POLL_MS = 4000;

interface Status {
  connected: boolean;
  mounted: boolean;
  expiresAt: number | null;
  loginPending: boolean;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    let detail = '';
    try {
      const j = (await response.json()) as { error?: unknown };
      if (typeof j?.error === 'string') detail = j.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail ? `${detail} (HTTP ${response.status})` : `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

const styles: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, lineHeight: 1.5, padding: '4px 2px' },
  title: { margin: 0, fontSize: 15 },
  status: { display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: 8, border: '1px solid transparent', fontWeight: 500 },
  statusPending: { background: 'rgba(127,127,127,.10)', borderColor: 'rgba(127,127,127,.20)', opacity: 0.72 },
  statusOn: { background: 'rgba(34,197,94,.10)', borderColor: 'rgba(34,197,94,.34)', color: '#16a34a' },
  statusOff: { background: 'rgba(229,72,77,.09)', borderColor: 'rgba(229,72,77,.26)', color: '#e5484d' },
  glyph: { width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, lineHeight: 1, fontWeight: 700, flex: '0 0 auto' },
  glyphPending: { background: 'rgba(127,127,127,.18)' },
  glyphOn: { background: 'rgba(34,197,94,.18)', color: '#16a34a' },
  glyphOff: { background: 'rgba(229,72,77,.14)', color: '#e5484d' },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  button: { padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(127,127,127,.35)', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' },
  buttonPrimary: { padding: '5px 12px', borderRadius: 6, border: '1px solid #2563eb', background: '#2563eb', color: '#fff', font: 'inherit', cursor: 'pointer' },
  buttonDisabled: { opacity: 0.5, cursor: 'default' },
  ok: { color: '#22c55e' },
  err: { color: '#ef4444' },
  info: { opacity: 0.72 },
  hint: { opacity: 0.75, fontSize: 12 },
  hintP: { margin: '4px 0' },
};

export function NotionSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  // A transient note that adds information. The status box itself is the single
  // source of truth, so no success text is duplicated here.
  const [note, setNote] = useState<{ kind: 'info' | 'err'; text: string } | null>(null);
  const pendingSeenRef = useRef(false);

  const connected = status?.connected ?? false;

  const refresh = useCallback(async () => {
    try {
      setStatus(await api<Status>('/status'));
    } catch {
      /* endpoint unavailable — leave unchanged */
    }
  }, []);

  // Poll so the page follows the host: a completed login, a logout from
  // elsewhere, or a background token refresh.
  useEffect(() => {
    refresh();
    const poll = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(poll);
  }, [refresh]);

  // Follow the host's login state: latch that we saw a pending login, then
  // settle `busy` once it either connects or ends without connecting (denied,
  // failed, or expired) so the UI never gets stuck.
  useEffect(() => {
    if (status?.loginPending) pendingSeenRef.current = true;
  }, [status?.loginPending]);

  const waiting = busy && note?.kind === 'info';
  useEffect(() => {
    if (!waiting || status === null) return;
    if (status.connected) {
      setBusy(false);
      setNote(null);
    } else if (pendingSeenRef.current && !status.loginPending) {
      setBusy(false);
      setNote({ kind: 'err', text: 'Authorization was not completed — please try again.' });
    }
  }, [waiting, status]);

  const login = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ ok: boolean; url?: string; error?: string }>('/login', {});
      if (!r.ok || !r.url) throw new Error(r.error ?? 'login failed');
      window.open(r.url, '_blank', 'noopener');
      setNote({ kind: 'info', text: 'Waiting for confirmation in the browser…' });
    } catch (e) {
      setBusy(false);
      setNote({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const logout = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      await api<{ ok: boolean }>('/logout', {});
      await refresh();
    } catch (e) {
      setNote({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const view = status === null
    ? { label: 'Checking…', mark: '⋯', box: styles.statusPending, markStyle: styles.glyphPending }
    : connected
      ? { label: 'Connected', mark: '✓', box: styles.statusOn, markStyle: styles.glyphOn }
      : { label: 'Not connected', mark: '✕', box: styles.statusOff, markStyle: styles.glyphOff };

  return (
    <div style={styles.page}>
      <h2 style={styles.title}>Notion (OAuth)</h2>
      <div style={{ ...styles.status, ...view.box }}>
        <span style={{ ...styles.glyph, ...view.markStyle }}>{view.mark}</span>
        <span>{view.label}</span>
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
      {note !== null && (
        <div style={note.kind === 'info' ? styles.info : styles.err}>{note.text}</div>
      )}
      <div style={styles.hint}>
        <p style={styles.hintP}>Authorizes through the official Notion MCP (OAuth) — no integration tokens. Permissions come from your Notion account.</p>
        <p style={styles.hintP}>After signing in, the mcp__notion__* tools become available (search, read and create pages, databases).</p>
        <p style={styles.hintP}>The token renews in the background, so you only sign in once.</p>
      </div>
    </div>
  );
}
