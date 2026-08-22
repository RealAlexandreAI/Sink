import type { VerifyResponse } from '../../shared/types/auth'
import { describe, expect, it } from 'vitest'
import { fetch, fetchWithAuth } from '../utils'

describe('/api/verify', () => {
  it('returns the expected verification data with valid auth', async () => {
    const response = await fetchWithAuth('/api/verify')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')

    const data = await response.json() as VerifyResponse
    expect(data).toMatchObject({
      name: 'Sink',
      url: 'https://sink.cool',
      authMethod: 'access-user',
      userID: 'tester@localhost',
      userEmail: 'tester@localhost',
      accessEnabled: false,
    })
  })

  it('returns 401 when accessing without auth', async () => {
    const response = await fetch('/api/verify')
    expect(response.status).toBe(401)
  })

  it('returns 401 with a bare Bearer token (site-token retired)', async () => {
    const response = await fetch('/api/verify', {
      headers: { Authorization: 'Bearer invalid-token-12345' },
    })
    expect(response.status).toBe(401)
  })

  it('authenticates a service-token request (assertion without email)', async () => {
    // A service-token request carries only Cf-Access-Jwt-Assertion after edge
    // verification. The worker maps it to the root machine identity.
    const response = await fetch('/api/verify', {
      headers: { 'Cf-Access-Jwt-Assertion': 'service-token-assertion' },
    })
    expect(response.status).toBe(200)
    const data = await response.json() as VerifyResponse
    expect(data).toMatchObject({
      authMethod: 'access-service',
      userID: 'root',
      accessEnabled: false,
    })
  })

  it('rejects an Access cookie without the assertion header', async () => {
    const response = await fetch('/api/verify', {
      headers: { Cookie: 'CF_Authorization=unsigned-token' },
    })
    expect(response.status).toBe(401)
  })
})
