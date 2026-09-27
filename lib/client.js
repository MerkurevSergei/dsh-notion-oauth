window.__ModuleLoader__.load({
	id: "dsh-notion-oauth",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  "use strict";
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/client/index.ts
  var index_exports = {};
  __export(index_exports, {
    apply: () => apply,
    inject: () => inject
  });
  module.exports = __toCommonJS(index_exports);
  var import_react2 = require("react");

  // src/client/NotionSettings.tsx
  var import_react = require("react");
  var import_jsx_runtime = require("react/jsx-runtime");
  var API = "/api/dsh-notion-oauth";
  var POLL_MS = 4e3;
  async function api(path, body) {
    const response = await fetch(API + path, {
      method: body === void 0 ? "GET" : "POST",
      headers: body === void 0 ? void 0 : { "Content-Type": "application/json" },
      body: body === void 0 ? void 0 : JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }
  function formatExpiry(expiresAt, now) {
    if (expiresAt === null) return "";
    const ms = expiresAt - now;
    if (ms <= 0) return "\xB7 \u0442\u043E\u043A\u0435\u043D \u0438\u0441\u0442\u0451\u043A \u2014 \u0436\u0434\u0451\u043C \u0430\u0432\u0442\u043E\u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435";
    const m = Math.floor(ms / 6e4);
    const s = Math.floor(ms % 6e4 / 1e3);
    return `\xB7 \u0438\u0441\u0442\u0435\u043A\u0430\u0435\u0442 \u0447\u0435\u0440\u0435\u0437 ${m} \u043C\u0438\u043D ${s} \u0441`;
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
    const [status, setStatus] = (0, import_react.useState)(null);
    const [busy, setBusy] = (0, import_react.useState)(false);
    const [message, setMessage] = (0, import_react.useState)(null);
    const [now, setNow] = (0, import_react.useState)(() => Date.now());
    const connected = status?.connected ?? false;
    const refresh = (0, import_react.useCallback)(async () => {
      try {
        setStatus(await api("/status"));
      } catch {
      }
    }, []);
    (0, import_react.useEffect)(() => {
      refresh();
      const poll = window.setInterval(refresh, POLL_MS);
      const tick = window.setInterval(() => setNow(Date.now()), 1e3);
      return () => {
        window.clearInterval(poll);
        window.clearInterval(tick);
      };
    }, [refresh]);
    (0, import_react.useEffect)(() => {
      if (connected && busy) {
        setBusy(false);
        setMessage({ kind: "ok", text: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E \u2713" });
      }
    }, [connected, busy]);
    const login = (0, import_react.useCallback)(async () => {
      setBusy(true);
      setMessage(null);
      try {
        const r = await api("/login", {});
        if (!r.ok || !r.url) throw new Error(r.error ?? "login failed");
        window.open(r.url, "_blank");
        setMessage({ kind: "ok", text: "\u0411\u0440\u0430\u0443\u0437\u0435\u0440 \u043E\u0442\u043A\u0440\u044B\u0442 \u2014 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0434\u043E\u0441\u0442\u0443\u043F \u043A Notion\u2026" });
      } catch (e) {
        setBusy(false);
        setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
      }
    }, []);
    const logout = (0, import_react.useCallback)(async () => {
      setBusy(true);
      try {
        await api("/logout", {});
        await refresh();
        setMessage({ kind: "ok", text: "\u041E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u043E" });
      } catch (e) {
        setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy(false);
      }
    }, [refresh]);
    const expiryText = formatExpiry(status?.expiresAt ?? null, now);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.page, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { style: styles.title, children: "Notion (OAuth)" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.status, children: status === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430\u2026" }) : connected ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.ok, children: [
        "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E",
        expiryText
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.err, children: "\u041D\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
        !connected && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            style: busy ? { ...styles.buttonPrimary, ...styles.buttonDisabled } : styles.buttonPrimary,
            disabled: busy,
            onClick: login,
            children: "Login"
          }
        ),
        connected && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            style: busy ? { ...styles.button, ...styles.buttonDisabled } : styles.button,
            disabled: busy,
            onClick: logout,
            children: "Logout"
          }
        )
      ] }),
      message !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: message.kind === "ok" ? styles.ok : styles.err, children: message.text }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.hint, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hintP, children: "\u0410\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F \u0447\u0435\u0440\u0435\u0437 \u043E\u0444\u0438\u0446\u0438\u0430\u043B\u044C\u043D\u044B\u0439 Notion MCP (OAuth) \u2014 \u0431\u0435\u0437 \u0442\u043E\u043A\u0435\u043D\u043E\u0432 \u0438\u043D\u0442\u0435\u0433\u0440\u0430\u0446\u0438\u0439. \u041F\u0440\u0430\u0432\u0430 \u0431\u0435\u0440\u0443\u0442\u0441\u044F \u0438\u0437 \u0432\u0430\u0448\u0435\u0433\u043E \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430 Notion." }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hintP, children: "\u041F\u043E\u0441\u043B\u0435 \u0432\u0445\u043E\u0434\u0430 \u0441\u0442\u0430\u043D\u043E\u0432\u044F\u0442\u0441\u044F \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u044B mcp__notion__* (\u043F\u043E\u0438\u0441\u043A, \u0447\u0442\u0435\u043D\u0438\u0435 \u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446, \u0431\u0430\u0437\u044B \u0434\u0430\u043D\u043D\u044B\u0445)." }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hintP, children: "\u0422\u043E\u043A\u0435\u043D \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438; \u0441\u0442\u0430\u0442\u0443\u0441 \u0438 \u0441\u0440\u043E\u043A \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u044E\u0442\u0441\u044F \u043D\u0430 \u044D\u0442\u043E\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435." })
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
        () => (0, import_react2.createElement)(NotionSettings)
      )
    );
  }

		return module.exports;
	}
});
