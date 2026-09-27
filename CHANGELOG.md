# Changelog

## 1.0.1

- A visual setup guide in the README (both languages) with screenshots, plus a
  `screenshots.json` so storefronts show them in the plugin card. No code changes.

## 1.0.0

First release of `dsh-notion-oauth-ui` (renamed from `dsh-notion-oauth` — same plugin, new name).

- OAuth 2.0 authorization code flow with PKCE (S256) and a verified `state`,
  against the official Notion MCP server — no Integration Token to copy.
- GUI sign-in: a **Notion** page under Settings with Login / Logout and a live
  connection status.
- CLI fallback: `dsh notion login`, `dsh notion logout`, `dsh notion status`.
- Silent token refresh five minutes before expiry, retrying every minute while a
  refresh keeps failing.
- Notion tools exposed as `mcp__notion__*` through the official MCP server.
- Localized display metadata (`locale/en.json`, `locale/zh.json`) and a vector icon.
- Hardened local control routes: loopback-only, method-pinned, cross-site
  refused, and JSON-only for state changes. The token never reaches the browser
  half, and it is never logged.
- Published from GitHub Actions through npm Trusted Publishing (OIDC, provenance
  attestation), with the version staged for maintainer approval before it goes live.
