<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import CourseCard from '@/components/course/CourseCard.vue'
import { shellCourses, useShellScenario } from '@/fixtures/ui-scenarios/shell'
import { isStaticSessionPreview } from '@/platform/session'
import { useCourseStore } from '@/stores/course'
const { loadScenario } = useShellScenario('course-list')
const preview = ref(false)
const retryPage = ref(1)
const store = useCourseStore()
const courses = computed(() => preview.value ? shellCourses : store.list.items.map(course => ({ id: course.id, title: course.title, icon: 'book-open', coverAssetId: course.cover_asset_id, lessonCount: course.required_lesson_count, progress: store.progressPercent[course.id] ?? null, completed: store.progressComplete[course.id] === true })))
onLoad(query => { preview.value = isStaticSessionPreview(query); loadScenario(query); if (!preview.value) loadPage(1) })
function loadPage(page: number) { retryPage.value = page; void store.loadList(page).catch(() => {}) }
function reload() { loadPage(retryPage.value) }
function more() { loadPage(store.list.page + 1) }
function openCourse(course: { id: string }) { uni.navigateTo({ url: preview.value ? `/pages/course/detail?scenario=${course.id === 'video' ? 'course-video' : 'course-no-video'}` : `/pages/course/detail?id=${encodeURIComponent(course.id)}` }) }
</script>
<template><AppPage title="课程" :back="false" tab="course"><text class="course-count">全部课程 · {{ preview ? shellCourses.length : store.list.total }}门</text><view class="course-list"><CourseCard v-for="course in courses" :key="course.id" :course="course" show-progress @select="openCourse" /></view><view v-if="!preview && store.listLoading" class="course-state">课程加载中…</view><view v-else-if="!preview && store.listError" class="course-state"><text>{{ store.listError }}</text><wd-button size="small" @click="reload">重新加载</wd-button></view><view v-else-if="!courses.length" class="course-state">暂无课程</view><view v-else-if="!preview && store.hasMore" class="course-state"><wd-button size="small" variant="plain" @click="more">加载更多</wd-button></view><text v-else class="course-end">— 没有更多课程了 —</text></AppPage></template>
<style scoped>
.course-count { display: block; margin-bottom: 12px; font-size: 13px; color: var(--app-color-text-secondary); }
.course-list { display: flex; flex-direction: column; gap: 12px; }
.course-end { display: block; text-align: center; margin-top: 12px; color: var(--app-color-text-muted); font-size: 12px; }
.course-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 28px 16px; color: var(--app-color-text-muted); font-size: 13px; }
</style>
