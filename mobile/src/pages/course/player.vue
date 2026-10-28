<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import VideoPanel from '@/components/course/VideoPanel.vue'
import ChapterList from '@/components/course/ChapterList.vue'
import { hazardChapters, videoChapters, useShellScenario } from '@/fixtures/ui-scenarios/shell'
import { isStaticSessionPreview } from '@/platform/session'
import { observeMediaVisibility, type NativeVideoEvent, type NativeVideoFailure } from '@/platform/media-player'
import { resolveMediaUrl } from '@/platform/media-url'
import { useCourseStore } from '@/stores/course'
import { useSessionStore } from '@/stores/session'
import { createVideoSessionClient } from '@/stores/video'
const { scenario, loadScenario } = useShellScenario('course-video')
const preview = ref(false), courseId = ref(''), lessonId = ref('')
const fromExam = ref('')
const course = useCourseStore(), session = useSessionStore()
const panel = ref<{ play(): void; pause(): void; seek(positionMs: number): void } | null>(null)
const video = createVideoSessionClient({
  controls: { play: () => panel.value?.play(), pause: () => panel.value?.pause(), seek: position => panel.value?.seek(position) },
  getEpoch: () => session.sessionEpoch,
  refreshProgress: id => course.loadProgress([id]),
  acceptProgress: course.acceptLessonProgress,
  resolveUrl: resolveMediaUrl,
})
const title = computed(() => preview.value ? scenario.value.hasVideo ? '课程文件视频示范课' : '现场隐患排查与整改实训' : course.detail?.title || '课程学习')
const selectedLesson = computed(() => course.detail?.chapters.flatMap(chapter => chapter.lessons).find(lesson => lesson.id === lessonId.value))
const chapters = computed(() => preview.value ? scenario.value.hasVideo ? videoChapters : hazardChapters : course.chapters)
const selectedLessonId = computed(() => preview.value ? scenario.value.hasVideo ? videoChapters[0]?.lessons[0]?.id || '' : '' : lessonId.value)
const playingLessonId = computed(() => !preview.value && video.state.status === 'playing' ? video.state.lessonId : '')
onLoad(query => {
  preview.value = isStaticSessionPreview(query); loadScenario(query)
  if (preview.value) return
  courseId.value = typeof query?.course_id === 'string' ? query.course_id : ''
  lessonId.value = typeof query?.lesson_id === 'string' ? query.lesson_id : ''
  fromExam.value = typeof query?.from_exam === 'string' && /^[1-9]\d*$/.test(query.from_exam) ? query.from_exam : ''
  void reload()
})
async function reload() {
  if (!courseId.value) return
  try { await course.loadDetail(courseId.value); video.select({ courseId: courseId.value, lessonId: lessonId.value }) } catch { /* Store supplies a retryable error. */ }
}
function selectLesson(id: string) {
  if (preview.value) return
  lessonId.value = id; video.select({ courseId: courseId.value, lessonId: id })
}
function onNative(event: NativeVideoEvent, source: string, failure?: NativeVideoFailure) { if (source === video.state.src) void video.event(event, failure) }
function onTimeupdate(position: number, source: string) { if (source === video.state.src) video.timeUpdate(position) }
function ready(source: string) { if (source === video.state.src) video.ready() }
function hide() { if (!preview.value) void video.hide() }
function show() { if (!preview.value) video.show() }
const unobserve = observeMediaVisibility(visible => visible ? show() : hide())
onHide(hide); onShow(show)
onUnload(() => { unobserve(); void video.dispose() })
onBeforeUnmount(() => { unobserve(); void video.dispose() })
watch(() => session.sessionEpoch, () => { void video.dispose() }, { flush: 'sync' })
function identity() { uni.navigateTo({ url: '/pages/identity/index' }) }
const backTarget = computed(() => preview.value ? `/pages/course/detail?scenario=${scenario.value.id}` : `/pages/course/detail?id=${encodeURIComponent(courseId.value)}${fromExam.value ? `&from_exam=${encodeURIComponent(fromExam.value)}` : ''}`)
</script>
<template>
  <AppPage :title="title" :padded="false" :back-target="backTarget">
    <template v-if="preview"><VideoPanel :has-video="scenario.hasVideo" /><ChapterList :chapters="chapters" :collapsed-chapters="scenario.collapsedChapters" :selected-lesson-id="selectedLessonId" /></template>
    <template v-else>
      <view v-if="course.detailLoading" class="player-state">课程加载中…</view>
      <view v-else-if="course.detailError || !selectedLesson" class="player-state"><text>{{ course.detailError || '未找到课程课时' }}</text><wd-button v-if="courseId" size="small" @click="reload">重新加载</wd-button></view>
      <template v-else>
        <VideoPanel :key="`${lessonId}:${video.state.src}`" ref="panel" live :has-video="!!selectedLesson.current_version" :src="video.state.src" :status="video.state.status" :position-ms="video.state.positionMs" :error="video.state.identityReason ? '' : video.state.error" :blocked="!!video.state.identityReason" @request-play="video.play" @native="onNative" @timeupdate="onTimeupdate" @ready="ready" />
        <view class="player-summary"><text class="player-summary__title">{{ selectedLesson.title }}</text><text v-if="video.state.progress">{{ video.state.progress.completed ? '本课时已完成，可按需再次观看' : '学习进度会自动保存，请保持页面打开并正常播放' }}</text><template v-if="video.state.identityReason"><text>{{ video.state.error }}</text><wd-button role="button" :aria-label="video.state.identityReason === 'IDENTITY_PENDING' ? '查看实名状态' : '去实名认证'" size="small" @click="identity">{{ video.state.identityReason === 'IDENTITY_PENDING' ? '查看实名状态' : '去实名认证' }}</wd-button></template></view>
      </template>
      <ChapterList v-if="course.detail" :chapters="chapters" :selected-lesson-id="selectedLessonId" :playing-lesson-id="playingLessonId" @select="selectLesson" />
    </template>
  </AppPage>
</template>
<style scoped>
.player-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 32px 16px; color: var(--app-color-text-muted); font-size: 13px; }
.player-summary { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 16px; background: var(--app-color-surface); color: var(--app-color-text-secondary); font-size: 12px; }
.player-summary__title { font-size: 15px; color: var(--app-color-text); font-weight: 600; }
</style>
