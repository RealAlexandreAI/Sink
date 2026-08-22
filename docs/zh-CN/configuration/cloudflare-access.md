---
title: Cloudflare Access 身份认证
description: Sink 仪表盘、API 与 MCP 的 Zero Trust 认证——人用邮箱 OTP，机器用 Service Token。短链接保持公开。
---

# Cloudflare Access 身份认证

Sink 的 `/dashboard`、`/api/**` 和 `/mcp` 通过 **Cloudflare Access 边缘**认证。旧版站点令牌（`NUXT_SITE_TOKEN` Bearer）**已退役**——worker 信任 Access 验证通过后注入的请求头。

短链接（`/abc`）始终公开。Access 只决定谁能打开仪表盘、调用 API、访问 MCP 端点。

## 保护范围

| 路径                  | 认证方式                                        |
| --------------------- | ----------------------------------------------- |
| 短链接（`/abc`）      | 公开                                            |
| 仪表盘（`/dashboard`）| Access — 人（邮箱 OTP / SSO）                    |
| API（`/api/**`）      | Access — 人 **或** Service Token                |
| MCP（`/mcp`）         | Access — Service Token                           |

Worker 不再自行校验 JWT：Cloudflare Access 在边缘验证后注入 `Cf-Access-Jwt-Assertion`（人类请求还带 `Cf-Access-Authenticated-User-Email`）。这些头的存在即是凭据。

## 推荐配置

在 Sink 域名上建三个 Self-hosted Access 应用：

| 应用 | 路径 | 策略 |
| ---- | ---- | ---- |
| `sink-dashboard` | `/dashboard` | allow：你的邮箱 |
| `sink-api` | `/api` | allow：你的邮箱 **+** Service Auth：你的服务令牌 |
| `sink-mcp` | `/mcp` | Service Auth：你的服务令牌 |

> Service Auth 策略必须用 **Service Auth** action（API 对应 `decision: "non_identity"`），不能用 *Allow*——*Allow* 会把带令牌的请求 302 到 IdP 登录页，令牌直接失效。

### 创建 Service Token

Zero Trust → Access → **Service Auth** → Create Service Token。记下 **Client ID** 和 **Client Secret**（只显示一次），存入密码管理器。

## 人和工具分别怎么登录

```txt
浏览器        → Access 登录页 → 仪表盘 / API（会话 Cookie）
Agent / 脚本  → CF-Access-Client-Id + CF-Access-Client-Secret 头 → /api、/mcp
```

- **人（浏览器）：** 先过 Access（邮箱 OTP），再使用仪表盘。退出登录走 Cloudflare（`/cdn-cgi/access/logout`）。
- **机器（API + MCP）：** 发送 `CF-Access-Client-Id` 和 `CF-Access-Client-Secret` 头。Cloudflare 在边缘验证后放行，worker 将其映射为 `root` 管理员身份（`authMethod: access-service`）。

### MCP 客户端示例

```json
{
  "mcpServers": {
    "sink": {
      "type": "http",
      "url": "https://links.example.com/mcp",
      "headers": {
        "CF-Access-Client-Id": "…",
        "CF-Access-Client-Secret": "…"
      }
    }
  }
}
```

## 重要限制

::: warning 保护每一个域名
如果 `app.example.com` 开了 Access，但 `old.example.com` 也指向同一套部署且没开 Access，旧域名将毫无保护。所有能访问应用的域名都要保护。
:::

::: tip 会话时长仍然重要
Access 会话时长决定人保持登录多久。Service Token 是长期机器凭据——请在 Zero Trust 中定期轮换。
:::

## Cloudflare 参考资料

- [Access 应用与路径](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/app-paths/)
- [Access Service Token](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/)
- [Access 策略](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
