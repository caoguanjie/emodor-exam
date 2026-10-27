<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import VideoPanel from '@/components/course/VideoPanel.vue'
import ChapterList from '@/components/course/ChapterList.vue'
import ProtectedImage from '@/components/common/ProtectedImage.vue'
import { hazardChapters, videoChapters, useShellScenario } from '@/fixtures/ui-scenarios/shell'
import { isStaticSessionPreview } from '@/platform/session'
import { useCourseStore } from '@/stores/course'
const { scenario, loadScenario } = useShellScenario('course-video')
const preview = ref(false)
const courseId = ref('')
const fromExam = ref('')
const store = useCourseStore()
onLoad(query => { preview.value = isStaticSessionPreview(query); loadScenario(query); courseId.value = typeof query?.id === 'string' ? query.id : ''; fromExam.value = typeof query?.from_exam === 'string' && /^[1-9]\d*$/.test(query.from_exam) ? query.from_exam : ''; if (!preview.value) reload() })
const title = computed(() => preview.value ? scenario.value.hasVideo ? '课程文件视频示范课' : '现场隐患排查与整改实训' : store.detail?.title || '课程详情')
const chapters = computed(() => preview.value ? scenario.value.hasVideo ? videoChapters : hazardChapters : store.chapters)
function reload() { if (courseId.value) void store.loadDetail(courseId.value).catch(() => {}) }
const backTarget = computed(() => preview.value ? '/pages/course/index?scenario=course-list' : fromExam.value ? `/pages/exam/instructions?paper_id=${encodeURIComponent(fromExam.value)}` : '/pages/course/index')
function openLesson(lessonId: string) { uni.navigateTo({ url: preview.value ? `/pages/course/player?scenario=${scenario.value.id}` : `/pages/course/player?course_id=${encodeURIComponent(courseId.value)}&lesson_id=${encodeURIComponent(lessonId)}${fromExam.value ? `&from_exam=${encodeURIComponent(fromExam.value)}` : ''}` }) }
</script>
<template><AppPage :title="title" :back-target="backTarget" :history-first="false" :padded="false"><VideoPanel v-if="preview" :has-video="scenario.hasVideo" /><template v-else><view v-if="store.detailLoading && !store.detail" class="course-detail-state">课程加载中…</view><view v-else-if="store.detailError || !courseId" class="course-detail-state"><text>{{ store.detailError || '未找到课程' }}</text><wd-button v-if="courseId" size="small" @click="reload">重新加载</wd-button></view><view v-else-if="store.detail" class="course-detail-summary"><ProtectedImage v-if="store.detail.cover_asset_id" :asset-id="store.detail.cover_asset_id" owner-type="training_course_cover" :owner-id="store.detail.id" width="100%" :height="180" /><text class="course-detail-summary__title">{{ store.detail.title }}</text><text v-if="store.detail.description">{{ store.detail.description }}</text><text>共{{ store.detail.required_lesson_count }}节必修课</text></view></template><ChapterList v-if="preview || store.detail" :chapters="chapters" :collapsed-chapters="preview ? scenario.collapsedChapters : []" @select="openLesson" /><view v-if="!preview && store.detail && !chapters.length" class="course-detail-state">暂无课程目录</view></AppPage></template>
<style scoped>
.course-detail-state { display: flex; flex-direction: column; gap: 12px; align-items: center; padding: 32px 16px; color: var(--app-color-text-muted); font-size: 13px; }
.course-detail-summary { display: flex; flex-direction: column; gap: 12px; padding: 20px 16px; font-size: 13px; color: var(--app-color-text-secondary); background: var(--app-color-surface); }
.course-detail-summary__title { font-size: 18px; color: var(--app-color-text); font-weight: 600; }
</style>
