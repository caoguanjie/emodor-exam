import { computed, ref, shallowRef } from 'vue'
import { getSiteConfig, type SiteConfig } from '@/api/site-config'
import { validateRichDocV3, type ReadonlyRichNodeV3 } from '@/types/content-v3'

function hasText(node: ReadonlyRichNodeV3): boolean {
  if (node.type === 'text') return Boolean(node.text.trim())
  return 'content' in node && Array.isArray(node.content) && node.content.some(hasText)
}

/** Each page reloads on show; only its newest visible request may update it. */
export function useSiteConfig() {
  const config = shallowRef<SiteConfig | null>(null)
  const loading = ref(true)
  const error = ref('')
  let revision = 0
  const serviceTerms = computed(() => {
    const value = config.value?.about?.service_terms
    if (!value) return null
    try {
      const doc = validateRichDocV3(value)
      return hasText(doc) ? doc : null
    } catch { return null }
  })

  async function load() {
    const current = ++revision
    config.value = null; loading.value = true; error.value = ''
    try {
      const result = await getSiteConfig()
      if (current === revision) config.value = result
    } catch (cause) {
      if (current === revision) error.value = cause instanceof Error ? cause.message : '配置加载失败，请稍后重试'
    } finally {
      if (current === revision) loading.value = false
    }
  }

  function invalidate() { revision++; loading.value = false }
  return { config, loading, error, serviceTerms, load, invalidate }
}
