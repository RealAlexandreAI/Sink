export type AuthMethod = 'access-user' | 'access-service'

export interface VerifyResponse {
  name: string
  url: string
  authMethod: AuthMethod
  userID: string
  userEmail: string
  accessEnabled: boolean
}
