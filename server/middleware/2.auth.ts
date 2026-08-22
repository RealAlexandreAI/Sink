export default eventHandler(async (event) => {
  // /api/* and /mcp are protected by Cloudflare Access at the edge:
  //  - humans (dashboard, browser API calls) → email OTP
  //  - machines (/mcp, agent API calls) → service token (CF-Access-Client-Id/Secret)
  // Requests reaching this worker already passed edge verification, so the
  // injected Access headers are authoritative. The legacy site-token scheme
  // (self-verified Bearer) is retired.
  if (!event.path.startsWith('/api/') && event.path !== '/mcp')
    return

  // Local `nuxt dev` has no Access edge — skip auth entirely. Tests run with
  // NODE_ENV=test and exercise the strict (production) path.
  if (process.env.NODE_ENV === 'development') {
    event.context.authMethod = 'access-service'
    event.context.userID = 'root'
    event.context.userEmail = `root@${getRequestURL(event).hostname}`
    return
  }

  const assertion = getHeader(event, 'Cf-Access-Jwt-Assertion')
  const accessEmail = getHeader(event, 'Cf-Access-Authenticated-User-Email')

  if (!assertion && !accessEmail) {
    throw createError({
      status: 401,
      statusText: 'Unauthorized',
    })
  }

  if (accessEmail) {
    event.context.authMethod = 'access-user'
    event.context.userID = accessEmail
    event.context.userEmail = accessEmail
    return
  }

  // Service token: Access validates credentials and injects only the JWT
  // assertion (no email). Map to the root machine identity.
  event.context.authMethod = 'access-service'
  event.context.userID = 'root'
  event.context.userEmail = `root@${getRequestURL(event).hostname}`
})
