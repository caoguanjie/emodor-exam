<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { getMediaTicket, type MediaTicketView } from '@/api/media'
import { resolveMediaUrl } from '@/platform/media-url'
import { useSessionStore } from '@/stores/session'
const props = withDefaults(defineProps<{ assetId: string; ownerType: string; ownerId: string; width?: number | string; height?: number | string; initialTicket?: MediaTicketView }>(), { width: '100%', height: '100%' })
const session = useSessionStore()
const src = ref('')
let revision = 0, timer: ReturnType<typeof setTimeout> | undefined, retried = false
const initialEpoch = session.sessionEpoch
function stop() { revision++; if (timer) clearTimeout(timer); src.value = '' }
function display(ticket: MediaTicketView, current: number) {
  src.value = resolveMediaUrl(ticket.content_url)
  const remaining = Date.parse(ticket.expires_at) - Date.now()
  if (Number.isFinite(remaining) && remaining > 0) timer = setTimeout(() => { if (current === revision) void load() }, Math.max(1000, remaining - 10000))
}
async function load() {
  const current = ++revision
  if (timer) clearTimeout(timer)
  if (!props.assetId || !props.ownerId || !session.accessToken) { src.value = ''; return }
  try { const result = await getMediaTicket(props.assetId, props.ownerType, props.ownerId); if (current === revision) display(result, current) }
  catch { if (current === revision) src.value = '' }
}
function retry() { if (!retried) { retried = true; void load() } }
watch(() => [props.assetId, props.ownerType, props.ownerId, session.sessionEpoch], () => {
  stop(); retried = false
  if (session.sessionEpoch === initialEpoch && session.accessToken && props.initialTicket && Date.parse(props.initialTicket.expires_at) > Date.now()) display(props.initialTicket, revision)
  else void load()
}, { immediate: true })
onBeforeUnmount(stop)
</script>
<template><wd-img v-if="src" :src="src" :width="width" :height="height" mode="aspectFill" @error="retry" /><slot v-else /></template>
