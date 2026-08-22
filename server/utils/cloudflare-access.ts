/**
 * Cloudflare Access edge-trust helpers.
 *
 * /api/* and /mcp are guarded by Access at the edge (email OTP for humans,
 * service token for machines). The worker trusts the injected headers
 * (`Cf-Access-Jwt-Assertion`, `Cf-Access-Authenticated-User-Email`) — see
 * middleware/2.auth.ts. The former in-worker JWT verification (jose + JWKS)
 * and the site-token scheme are retired.
 */

export type CloudflareAccessAuth
  = | {
    authMethod: 'access-user'
    userID: string
    userEmail: string
  }
  | {
    authMethod: 'access-service'
    userID: 'root'
    userEmail: string
  }

export function isCloudflareAccessConfigured(teamDomain: string, audience: string): boolean {
  return !!teamDomain.trim() && !!audience.trim()
}
