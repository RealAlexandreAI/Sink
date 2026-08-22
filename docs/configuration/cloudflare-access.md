---
title: Cloudflare Access
description: Zero Trust authentication for the Sink dashboard, API and MCP — email OTP for humans, service tokens for machines. Short links stay public.
---

# Cloudflare Access

Sink authenticates `/dashboard`, `/api/**` and `/mcp` through **Cloudflare Access at the edge**. The legacy site-token scheme (`NUXT_SITE_TOKEN` bearer) is **retired** — the worker trusts the Access headers Cloudflare injects after verifying the request.

Short links (`/abc`) stay public. Access only governs who can open the dashboard, call the API, and reach the MCP endpoint.

## What is protected

| Path                    | Auth                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| Short links (`/abc`)    | Public                                                                |
| Dashboard (`/dashboard`)| Access — human (email OTP / SSO)                                       |
| API (`/api/**`)         | Access — human **or** service token                                   |
| MCP (`/mcp`)            | Access — service token                                                 |

The worker never re-verifies a JWT: Cloudflare Access validates the request at the edge and injects `Cf-Access-Jwt-Assertion` (+ `Cf-Access-Authenticated-User-Email` for humans). Presence of those headers is the credential.

## Recommended setup

Three self-hosted Access applications on your Sink hostname:

| Application | Path | Policies |
| ----------- | ---- | -------- |
| `sink-dashboard` | `/dashboard` | allow: your email(s) |
| `sink-api` | `/api` | allow: your email(s) **+** Service Auth: your service token |
| `sink-mcp` | `/mcp` | Service Auth: your service token |

> Service Auth policies must use the **Service Auth** action (API: `decision: "non_identity"`), not *Allow* — an *Allow* policy sends token requests to the IdP login page (302) instead of accepting the token.

### Create a service token

Zero Trust → Access → **Service Auth** → Create Service Token. Note the **Client ID** and **Client Secret** (shown once). Put them in your password manager.

## How people and tools sign in

```txt
Browser            → Access login page → dashboard / API via session cookie
Agent / script     → CF-Access-Client-Id + CF-Access-Client-Secret headers → /api, /mcp
```

- **People (browser):** pass Access (email OTP), then use the dashboard. Logout goes through Cloudflare (`/cdn-cgi/access/logout`).
- **Machines (API + MCP):** send `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers. Cloudflare verifies them at the edge and lets the request through. The worker maps them to the `root` admin identity (`authMethod: access-service`).

### MCP client example

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

## Important limits

::: warning Protect every hostname
If `app.example.com` is behind Access but `old.example.com` points at the same deployment without Access, the old host is unprotected. Protect every hostname that reaches the app.
:::

::: tip Session length still matters
Access session duration controls how long a human stays signed in. Service tokens are long-lived machine credentials — rotate them periodically in Zero Trust.
:::

## Cloudflare references

- [Access applications & paths](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/app-paths/)
- [Access service tokens](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/)
- [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
