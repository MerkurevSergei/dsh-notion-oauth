// src/client/index.ts
import { createElement } from "react";

// src/client/NotionSettings.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
var API = "/api/dsh-notion-oauth";
async function api(path, body) {
  const response = await fetch(API + path, {
    method: body === void 0 ? "GET" : "POST",
    headers: body === void 0 ? void 0 : { "Content-Type": "application/json" },
    body: body === void 0 ? void 0 : JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}
var styles = {
  page: { display: "flex", flexDirection: "column", gap: 12, fontSize: 13, lineHeight: 1.5, padding: "4px 2px" },
  title: { margin: 0, fontSize: 15 },
  status: { padding: "8px 10px", borderRadius: 6, background: "rgba(127,127,127,.12)" },
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  button: { padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(127,127,127,.35)", background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" },
  buttonPrimary: { padding: "5px 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", font: "inherit", cursor: "pointer" },
  buttonDisabled: { opacity: 0.5, cursor: "default" },
  ok: { color: "#22c55e" },
  err: { color: "#ef4444" },
  hint: { opacity: 0.75, fontSize: 12 },
  hintP: { margin: "4px 0" }
};
function NotionSettings() {
  const [connected, setConnected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const pollRef = useRef(void 0);
  const refresh = useCallback(async () => {
    try {
      const s = await api("/status");
      setConnected(s.connected);
    } catch {
    }
  }, []);
  useEffect(() => {
    refresh();
    return () => {
      if (pollRef.current !== void 0) window.clearInterval(pollRef.current);
    };
  }, [refresh]);
  const login = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api("/login", {});
      if (!r.ok || !r.url) throw new Error(r.error ?? "login failed");
      window.open(r.url, "_blank");
      setMessage({ kind: "ok", text: "\u0411\u0440\u0430\u0443\u0437\u0435\u0440 \u043E\u0442\u043A\u0440\u044B\u0442 \u2014 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0434\u043E\u0441\u0442\u0443\u043F \u043A Notion \u0438 \u0434\u043E\u0436\u0434\u0438\u0442\u0435\u0441\u044C \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F\u2026" });
      const deadline = Date.now() + 18e4;
      if (pollRef.current !== void 0) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(async () => {
        let s = null;
        try {
          s = await api("/status");
        } catch {
        }
        if (s?.connected) {
          if (pollRef.current !== void 0) window.clearInterval(pollRef.current);
          setConnected(true);
          setMessage({ kind: "ok", text: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E \u2713" });
          setBusy(false);
        } else if (Date.now() > deadline) {
          if (pollRef.current !== void 0) window.clearInterval(pollRef.current);
          setBusy(false);
          setMessage({ kind: "err", text: "\u041D\u0435 \u0434\u043E\u0436\u0434\u0430\u043B\u0438\u0441\u044C \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u0438 \u2014 \u043F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437." });
        }
      }, 1500);
    } catch (e) {
      setBusy(false);
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  const logout = useCallback(async () => {
    setBusy(true);
    try {
      await api("/logout", {});
      setConnected(false);
      setMessage({ kind: "ok", text: "\u041E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u043E" });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, []);
  return /* @__PURE__ */ jsxs("div", { style: styles.page, children: [
    /* @__PURE__ */ jsx("h2", { style: styles.title, children: "Notion (OAuth)" }),
    /* @__PURE__ */ jsx("div", { style: styles.status, children: connected === null ? /* @__PURE__ */ jsx("span", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430\u2026" }) : connected ? /* @__PURE__ */ jsx("span", { style: styles.ok, children: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E" }) : /* @__PURE__ */ jsx("span", { style: styles.err, children: "\u041D\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E" }) }),
    /* @__PURE__ */ jsxs("div", { style: styles.row, children: [
      !connected && /* @__PURE__ */ jsx(
        "button",
        {
          style: busy ? { ...styles.buttonPrimary, ...styles.buttonDisabled } : styles.buttonPrimary,
          disabled: busy,
          onClick: login,
          children: "Login"
        }
      ),
      connected && /* @__PURE__ */ jsx(
        "button",
        {
          style: busy ? { ...styles.button, ...styles.buttonDisabled } : styles.button,
          disabled: busy,
          onClick: logout,
          children: "Logout"
        }
      )
    ] }),
    message !== null && /* @__PURE__ */ jsx("div", { style: message.kind === "ok" ? styles.ok : styles.err, children: message.text }),
    /* @__PURE__ */ jsxs("div", { style: styles.hint, children: [
      /* @__PURE__ */ jsx("p", { style: styles.hintP, children: "\u0410\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F \u0447\u0435\u0440\u0435\u0437 \u043E\u0444\u0438\u0446\u0438\u0430\u043B\u044C\u043D\u044B\u0439 Notion MCP (OAuth) \u2014 \u0431\u0435\u0437 \u0442\u043E\u043A\u0435\u043D\u043E\u0432 \u0438\u043D\u0442\u0435\u0433\u0440\u0430\u0446\u0438\u0439. \u041F\u0440\u0430\u0432\u0430 \u0431\u0435\u0440\u0443\u0442\u0441\u044F \u0438\u0437 \u0432\u0430\u0448\u0435\u0433\u043E \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430 Notion." }),
      /* @__PURE__ */ jsx("p", { style: styles.hintP, children: "\u041F\u043E\u0441\u043B\u0435 \u0432\u0445\u043E\u0434\u0430 \u0441\u0442\u0430\u043D\u043E\u0432\u044F\u0442\u0441\u044F \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u044B mcp__notion__* (\u043F\u043E\u0438\u0441\u043A, \u0447\u0442\u0435\u043D\u0438\u0435 \u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446, \u0431\u0430\u0437\u044B \u0434\u0430\u043D\u043D\u044B\u0445)." })
    ] })
  ] });
}

// src/client/index.ts
var inject = ["slots"];
function apply(ctx) {
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      { name: "settings.section", id: "notion", order: 30, label: "Notion" },
      () => createElement(NotionSettings)
    )
  );
}
export {
  apply,
  inject
};
