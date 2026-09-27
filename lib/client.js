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
      body: body === void 0 ? void 0 : JSON.stringify(body),
      signal: AbortSignal.timeout(15e3)
    });
    if (!response.ok) {
      let detail = "";
      try {
        const j = await response.json();
        if (typeof j?.error === "string") detail = j.error;
      } catch {
      }
      throw new Error(detail ? `${detail} (HTTP ${response.status})` : `HTTP ${response.status}`);
    }
    return await response.json();
  }
  var styles = {
    page: { display: "flex", flexDirection: "column", gap: 12, fontSize: 13, lineHeight: 1.5, padding: "4px 2px" },
    title: { margin: 0, fontSize: 15 },
    status: { display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderRadius: 8, border: "1px solid transparent", fontWeight: 500 },
    statusPending: { background: "rgba(127,127,127,.10)", borderColor: "rgba(127,127,127,.20)", opacity: 0.72 },
    statusOn: { background: "rgba(34,197,94,.10)", borderColor: "rgba(34,197,94,.34)", color: "#16a34a" },
    statusOff: { background: "rgba(229,72,77,.09)", borderColor: "rgba(229,72,77,.26)", color: "#e5484d" },
    glyph: { width: 20, height: 20, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 12, lineHeight: 1, fontWeight: 700, flex: "0 0 auto" },
    glyphPending: { background: "rgba(127,127,127,.18)" },
    glyphOn: { background: "rgba(34,197,94,.18)", color: "#16a34a" },
    glyphOff: { background: "rgba(229,72,77,.14)", color: "#e5484d" },
    row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
    button: { padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(127,127,127,.35)", background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" },
    buttonPrimary: { padding: "5px 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", font: "inherit", cursor: "pointer" },
    buttonDisabled: { opacity: 0.5, cursor: "default" },
    ok: { color: "#22c55e" },
    err: { color: "#ef4444" },
    info: { opacity: 0.72 },
    hint: { opacity: 0.75, fontSize: 12 },
    hintP: { margin: "4px 0" }
  };
  function NotionSettings() {
    const [status, setStatus] = (0, import_react.useState)(null);
    const [busy, setBusy] = (0, import_react.useState)(false);
    const [note, setNote] = (0, import_react.useState)(null);
    const pendingSeenRef = (0, import_react.useRef)(false);
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
      return () => window.clearInterval(poll);
    }, [refresh]);
    (0, import_react.useEffect)(() => {
      if (status?.loginPending) pendingSeenRef.current = true;
    }, [status?.loginPending]);
    const waiting = busy && note?.kind === "info";
    (0, import_react.useEffect)(() => {
      if (!waiting || status === null) return;
      if (status.connected) {
        setBusy(false);
        setNote(null);
      } else if (pendingSeenRef.current && !status.loginPending) {
        setBusy(false);
        setNote({ kind: "err", text: "Authorization was not completed \u2014 please try again." });
      }
    }, [waiting, status]);
    const login = (0, import_react.useCallback)(async () => {
      setBusy(true);
      setNote(null);
      try {
        const r = await api("/login", {});
        if (!r.ok || !r.url) throw new Error(r.error ?? "login failed");
        window.open(r.url, "_blank", "noopener");
        setNote({ kind: "info", text: "Waiting for confirmation in the browser\u2026" });
      } catch (e) {
        setBusy(false);
        setNote({ kind: "err", text: e instanceof Error ? e.message : String(e) });
      }
    }, []);
    const logout = (0, import_react.useCallback)(async () => {
      setBusy(true);
      setNote(null);
      try {
        await api("/logout", {});
        await refresh();
      } catch (e) {
        setNote({ kind: "err", text: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy(false);
      }
    }, [refresh]);
    const view = status === null ? { label: "Checking\u2026", mark: "\u22EF", box: styles.statusPending, markStyle: styles.glyphPending } : connected ? { label: "Connected", mark: "\u2713", box: styles.statusOn, markStyle: styles.glyphOn } : { label: "Not connected", mark: "\u2715", box: styles.statusOff, markStyle: styles.glyphOff };
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.page, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { style: styles.title, children: "Notion (OAuth)" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.status, ...view.box }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...styles.glyph, ...view.markStyle }, children: view.mark }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: view.label })
      ] }),
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
      note !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: note.kind === "info" ? styles.info : styles.err, children: note.text }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.hint, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hintP, children: "Authorizes through the official Notion MCP (OAuth) \u2014 no integration tokens. Permissions come from your Notion account." }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hintP, children: "After signing in, the mcp__notion__* tools become available (search, read and create pages, databases)." }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hintP, children: "The token renews in the background, so you only sign in once." })
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
