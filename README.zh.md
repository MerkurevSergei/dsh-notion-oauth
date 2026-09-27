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

## 安全

- **仅限回环的控制路由。** 设置页通过 `/api/dsh-notion-oauth/{status,login,logout}` 通信。每个路由固定一种 HTTP 方法（`GET /status`、`POST /login`、`POST /logout`），并且只接受远端地址与 `Host` 均为回环、非 `Sec-Fetch-Site: cross-site`、且对改变状态的路由携带显式同源 `Origin` 的请求。跨站页面无法发起或取消登录。
- **OAuth 加固。** 授权码 + PKCE（S256）、每次流程独立的 `state`（由回调服务器校验），以及 10 分钟的回调截止时间。格式错误或伪造的回调返回 400，**不会**中断正在等待的登录。
- **传输。** `mcpUrl` 必须是 `https://`，否则插件拒绝加载。发现端点（授权、令牌、注册）取自 `mcpUrl` 资源所声明的地址，因此请保持其来源可信。
- **静态令牌。** access/refresh token 以单条记录存放在 DSH 凭据层（`NOTION_OAUTH`）。该存储的私密性仅等同于你的操作系统用户账户：工具进程以同一用户运行，因此任何拥有凭据访问权的插件都能读取**所有**已存密钥（`NOTION_OAUTH`、`DEEPSEEK_API_KEY` 等），而不只是自己的。令牌不会暴露给浏览器端、不会由任何 HTTP 路由返回，也不会写入日志。

## 许可证

MIT。复用了 `dsh-notion-mcp` 与 `dsh-notion-connector`（均为 MIT）的代码与设计模式。
