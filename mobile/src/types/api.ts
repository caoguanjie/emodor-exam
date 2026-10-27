export interface ApiEnvelope<T> { code: number; message: string; data: T }
export interface MobileSessionUser {
  id: number
  username: string
  real_name: string
  phone_masked: string
  role: 'employee'
  source: 'institution' | 'external' | null
  category_id: number | string | null
  identity_status: 'unverified' | 'pending' | 'verified' | 'rejected'
}
export interface MobileSessionResult { access_token: string; expires_in: number; user: MobileSessionUser }
export interface SmsChallenge { challenge_id: string; expires_in: number; retry_after: number; masked_phone: string }
export interface SmsLoginInput { phone: string; challenge_id: string; code: string }
export interface ApiRequestConfig {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: unknown
  headers?: Record<string, string>
  auth?: boolean
  refreshOnUnauthorized?: boolean
}
