# dsh-notion-oauth

通过官方 Notion MCP 服务器，用 OAuth 2.0（授权码 + PKCE）把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 连接到 [Notion](https://www.notion.com)。

## 特性

- **GUI 一键登录** —— 设置页中的「Notion」页面提供一键 Login，无需终端、无需 Integration Token。
- **CLI 备选** —— `dsh notion login` 适用于 headless / CLI 配置。
- **OAuth + PKCE** —— 动态客户端注册（RFC 7591），无需复制 `client_id` 或密钥。
- **静默刷新** —— access token 自动刷新，refresh token 原子轮换。
- **工具以 `mcp__notion__*` 挂载** —— 通过官方 MCP 服务器搜索、读取/创建页面、数据库与评论。

## 安装

通过 DSH GUI：设置 → 插件 → 添加插件 → `dsh-notion-oauth`。

或通过 CLI：

```sh
dsh plugin --profile <name> add dsh-notion-oauth
```

## 使用

1. 打开 设置 → Notion → Login。
2. 在浏览器中批准访问。
3. Token 存入 DSH 凭据层，`mcp__notion__*` 工具随即可用。

## 配置

| 键 | 默认值 | 说明 |
|---|---|---|
| `mcpUrl` | `https://mcp.notion.com/mcp` | Notion MCP 服务器 URL |
| `port` | `53007` | 本地 OAuth 回调端口（`127.0.0.1`） |

## 许可证

MIT。复用了 `dsh-notion-mcp` 与 `dsh-notion-connector`（均为 MIT）的代码与设计模式。
