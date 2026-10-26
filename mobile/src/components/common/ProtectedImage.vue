<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import type { MediaTicketView } from '@/api/media'
import { createProtectedImageController } from '@/platform/protected-image'
import { useSessionStore } from '@/stores/session'
const props = withDefaults(defineProps<{ assetId: string; ownerType: string; ownerId: string; width?: number | string; height?: number | string; initialTicket?: MediaTicketView }>(), { width: '100%', height: '100%' })
const session = useSessionStore()
const src = ref('')
const controller = createProtectedImageController({
  read: () => ({ assetId: props.assetId, ownerType: props.ownerType, ownerId: props.ownerId,
    initialTicket: props.initialTicket, epoch: session.sessionEpoch, userId: String(session.user?.id || ''),
    authenticated: Boolean(session.accessToken), loggingIn: session.isLoggingIn }),
  show: value => { src.value = value },
})
function retry() { controller.retry() }
watch(() => [props.assetId, props.ownerType, props.ownerId, props.initialTicket, session.sessionEpoch,
  session.user?.id, Boolean(session.accessToken), session.isLoggingIn], controller.update, { immediate: true, flush: 'sync' })
onBeforeUnmount(controller.dispose)
</script>
<template><wd-img v-if="src" :src="src" :width="width" :height="height" mode="aspectFill" @error="retry" /><slot v-else /></template>
