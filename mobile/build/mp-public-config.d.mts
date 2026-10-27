export interface MpPublicConfigReport {
  ready: boolean
  errors: string[]
  requestDomains: string[]
  uploadDomains: string[]
  downloadDomains: string[]
}
export function inspectMpPublicConfig(env: Record<string, string | undefined>): MpPublicConfigReport
