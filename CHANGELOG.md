# Changelog

## 1.0.1

- Releases are now published from GitHub Actions through npm Trusted Publishing:
  OIDC instead of a stored token, with a provenance attestation on the published
  version. No functional changes.

## 1.0.0

First stable release.

- OAuth 2.0 authorization code flow with PKCE (S256) and a verified `state`,
  against the official Notion MCP server — no integration token to copy.
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
