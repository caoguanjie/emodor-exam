<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string; size?: string | number; color?: string }>(), { size: 22, color: 'currentColor' })
const paths: Record<string, string> = {
  house: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  'book-open': '<path d="M12 7v14m0-14C9 4 5 4 2 5v15c3-1 7-1 10 1m0-14c3-3 7-3 10-2v15c-3-1-7-1-10 1"/>',
  'clipboard-pen-line': '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v5M4 20V6a2 2 0 0 1 2-2h2m-4 16a2 2 0 0 0 2 2h5m6-9 3 3-5 5-4 1 1-4Z"/>',
  'user-round': '<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  'user-pen': '<circle cx="10" cy="7" r="4"/><path d="M3 21v-2a7 7 0 0 1 9-6m5 0 3 3-5 5-4 1 1-4Z"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'shield-alert': '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm0-14v4m0 4h.01"/>',
  'heart-pulse': '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/><path d="M3 12h4l2-3 3 7 2-4h7"/>',
  video: '<rect x="3" y="5" width="12" height="14" rx="2"/><path d="m15 10 6-4v12l-6-4"/>',
  flame: '<path d="M8.5 14.5A6 6 0 0 1 12 3c0 6 6 6 6 12a6 6 0 0 1-12 0c0-1 .5-3 1-4 .5 2 1 3 1.5 3.5Z"/>',
  'hard-hat': '<path d="M2 18v3h20v-3M4 18v-4a8 8 0 0 1 5-7m6 0a8 8 0 0 1 5 7v4M9 13V4h6v9M2 18h20"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
  'circle-x': '<circle cx="12" cy="12" r="10"/><path d="m9 9 6 6m0-6-6 6"/>',
  'badge-check': '<path d="m12 3 3 2 4 .5.5 4 2 3-2 3-.5 4-4 .5-3 2-3-2-4-.5-.5-4-2-3 2-3 .5-4L9 5Z"/><path d="m8 12 3 3 5-6"/>',
  'key-round': '<circle cx="8" cy="8" r="5"/><path d="m11.5 11.5 9 9M16 16l3-3m-6 3 3-3"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  volume: '<path d="m11 5-6 4H2v6h3l6 4Zm4 3a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14"/>',
  maximize: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  clipboard: '<rect x="5" y="4" width="14" height="18" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 10h6m-6 4h6m-6 4h4"/>',
  'book-check': '<path d="M4 19V5a2 2 0 0 1 2-2h14v19H6a2 2 0 0 1 0-4h14M9 10l2 2 4-4"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z"/><circle cx="12" cy="13" r="3"/>',
  'contact-round': '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M5.5 16a3.5 3.5 0 0 1 7 0M15 9h3m-3 4h3"/>',
  'id-card': '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M5 16a3 3 0 0 1 6 0m4-6h4m-4 4h3"/>',
  'scan-face': '<path d="M3 7V5a2 2 0 0 1 2-2h2m10 0h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="9" cy="10" r=".5" fill="currentColor"/><circle cx="15" cy="10" r=".5" fill="currentColor"/><path d="M8 15s1.5 2 4 2 4-2 4-2"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3Z"/><path d="m8 12 2.5 2.5L16 9"/>',
  'cloud-off': '<path d="M17.5 17H7a5 5 0 0 1-1.4-9.8A7 7 0 0 1 18.8 9M2 2l20 20"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  'user-lock': '<circle cx="10" cy="7" r="4"/><path d="M3 21v-2a7 7 0 0 1 10-6.3"/><rect x="15" y="15" width="7" height="6" rx="1"/><path d="M17 15v-1a1.5 1.5 0 0 1 3 0v1"/>',
  'loader-circle': '<path d="M21 12a9 9 0 1 1-6.2-8.6"/><path d="M21 3v6h-6"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
}
const source = computed(() => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${props.color === 'currentColor' ? '#646566' : props.color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[props.name] || paths.info}</svg>`)}`)
const iconStyle = computed(() => ({ width: typeof props.size === 'number' ? `${props.size}px` : props.size, height: typeof props.size === 'number' ? `${props.size}px` : props.size }))
</script>

<template><image class="app-icon" :src="source" :style="iconStyle" mode="aspectFit" aria-hidden="true" /></template>
<style scoped>.app-icon { display: inline-block; flex: none; vertical-align: middle; }</style>
