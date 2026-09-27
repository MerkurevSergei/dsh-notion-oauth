# dsh-notion-oauth

Notion integration for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) via the official Notion MCP server with OAuth 2.0 (authorization code + PKCE).

## Features

- **GUI login** — a "Notion" page under Settings with a one-click Login (no terminal, no Integration Token).
- **CLI fallback** — `dsh notion login` for headless / CLI profiles.
- **OAuth + PKCE** — dynamic client registration (RFC 7591), no `client_id`/secret to copy.
- **Silent refresh** — access token refreshed automatically; refresh token rotated atomically.
- **Tools as `mcp__notion__*`** — search, read/create pages, databases, comments via the official MCP server.

## Install

Via the DSH GUI: Settings → Plugins → Add plugin → `dsh-notion-oauth`.

Or via CLI:

```sh
dsh plugin --profile <name> add dsh-notion-oauth
```

## Usage

1. Open Settings → Notion → Login.
2. Approve access in the browser.
3. The token is stored in DSH credentials; the `mcp__notion__*` tools become available.

## Config

| Key | Default | Meaning |
|---|---|---|
| `mcpUrl` | `https://mcp.notion.com/mcp` | Notion MCP server URL |
| `port` | `53007` | Local OAuth callback port (`127.0.0.1`) |

## License

MIT. Reuses code/patterns from `dsh-notion-mcp` and `dsh-notion-connector` (both MIT).
