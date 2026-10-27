<script setup lang="ts">
import { getCurrentInstance, ref } from 'vue'
import AppIcon from '../common/AppIcon.vue'
import EmptyState from '../common/EmptyState.vue'
import { nativeVideoFailure, type NativeVideoEvent, type NativeVideoFailure } from '@/platform/media-player'
const props = withDefaults(defineProps<{ hasVideo?: boolean; live?: boolean; src?: string; status?: string; error?: string; blocked?: boolean; positionMs?: number }>(), { hasVideo: true, live: false, src: '', status: 'idle', error: '', blocked: false, positionMs: 0 })
const emit = defineEmits<{ requestPlay: []; native: [event: NativeVideoEvent, source: string, failure?: NativeVideoFailure]; timeupdate: [positionMs: number, source: string]; ready: [source: string] }>()
const playing = ref(false)
const initialTime = props.positionMs / 1000
const instance = getCurrentInstance()
function context() { return uni.createVideoContext('course-native-video', instance?.proxy) }
function play() { context().play() }
function pause() { if (props.live && props.src) context().pause() }
function seek(positionMs: number) { context().seek(positionMs / 1000) }
function native(event: NativeVideoEvent, error?: unknown) { emit('native', event, props.src, event === 'error' ? nativeVideoFailure(error) : undefined) }
function update(event: unknown) {
  const seconds = (event as { detail?: { currentTime?: number } })?.detail?.currentTime
  if (typeof seconds === 'number' && Number.isFinite(seconds)) emit('timeupdate', Math.round(seconds * 1000), props.src)
}
function requestPlay() { if (!props.blocked && props.status !== 'starting') emit('requestPlay') }
defineExpose({ play, pause, seek })
</script>
<template>
  <view class="video-panel" :class="{ 'video-panel--empty': !hasVideo }">
    <view v-if="live && hasVideo" class="video-panel__native-stage">
      <video v-if="src" id="course-native-video" class="video-panel__native" :src="src" :initial-time="initialTime" :autoplay="false" :controls="true" :show-center-play-btn="true" :show-play-btn="true" :enable-progress-gesture="false" object-fit="contain" @play="native('play')" @pause="native('pause')" @waiting="native('waiting')" @ended="native('ended')" @error="native('error', $event)" @timeupdate="update" @loadedmetadata="emit('ready', src)" />
      <view v-if="!src || error" class="video-panel__stage video-panel__overlay" :role="blocked ? undefined : 'button'" :aria-label="error ? '重试播放' : status === 'ended' ? '重新播放' : '播放课程视频'" :aria-disabled="blocked || status === 'starting'" @click="requestPlay"><view class="video-panel__play"><AppIcon name="play" :size="28" color="#ffffff" /></view><text>{{ error || (status === 'starting' ? '视频加载中…' : blocked ? '请先完成实名认证' : status === 'ended' ? '重新播放课程视频' : '点击播放课程视频') }}</text><text v-if="error" class="video-panel__retry">点击重试</text></view>
    </view>
    <view v-else-if="hasVideo" class="video-panel__stage" role="button" aria-label="播放课程视频" @click="playing = !playing"><view class="video-panel__play"><AppIcon name="play" :size="28" color="#ffffff" /></view><text>{{ playing ? '视频加载中…' : '点击播放课程视频' }}</text></view>
    <EmptyState v-else image="/static/states/empty-data.png" title="暂无视频" description="课程视频尚未提供" />
    <view v-if="hasVideo && !live" class="video-panel__controls"><AppIcon name="play" :size="16" color="#ffffff" /><text>00:00 / --:--</text><view class="video-panel__spacer" /><AppIcon name="volume" :size="18" color="#ffffff" /><AppIcon name="maximize" :size="18" color="#ffffff" /></view>
  </view>
</template>
<style scoped>
.video-panel { background: #191c28; color: var(--app-color-surface); }
.video-panel__stage { height: 196px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--app-color-text-muted); font-size: 12px; }
.video-panel__play { width: 64px; height: 64px; border-radius: var(--app-radius-full); background: #ffffff26; display: flex; align-items: center; justify-content: center; margin-bottom: 4px; }
.video-panel--empty { background: var(--app-color-background); color: var(--app-color-text); }
.video-panel__controls { display: flex; align-items: center; gap: 12px; height: 38px; padding: 0 16px; background: #10131b; font-size: 11px; }
.video-panel__spacer { flex: 1; }
.video-panel__native-stage { position: relative; min-height: 220px; }
.video-panel__native { display: block; width: 100%; height: 220px; }
.video-panel__overlay { position: absolute; inset: 0; height: 220px; padding: 16px; background: #191c28; text-align: center; }
.video-panel__retry { color: #ffffff; }
</style>
