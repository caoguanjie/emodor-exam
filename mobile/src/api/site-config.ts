import { request } from './client'
import type { PublicSiteConfig } from './courses'
import type { ReadonlyRichDocV3 } from '@/types/content-v3'

export interface SiteAbout {
  institution_name: string
  platform_subtitle: string
  version: string
  contact_email: string
  wechat_account: string
  contact_phone: string
  service_terms: ReadonlyRichDocV3 | null
}

export interface SiteConfig extends PublicSiteConfig { about: SiteAbout }

export function getSiteConfig(): Promise<SiteConfig> {
  return request({ url: '/site-config', auth: false })
}
