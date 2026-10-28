<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import CourseCard from '@/components/course/CourseCard.vue'
import { institution, platformSubtitle, shellCourses, useShellScenario } from '@/fixtures/ui-scenarios/shell'
import { isStaticSessionPreview } from '@/platform/session'
import { useCourseStore } from '@/stores/course'
import { resolvePublicBrandingUrl } from '@/platform/media-url'
const { loadScenario } = useShellScenario('home-default')
const preview = ref(false)
const store = useCourseStore()
const courses = computed(() => preview.value ? shellCourses.slice(0, 4) : store.home.items.map(course => ({ id: course.id, title: course.title, icon: 'book-open', coverAssetId: course.cover_asset_id, lessonCount: course.required_lesson_count, progress: store.progressPercent[course.id] ?? null, completed: store.progressComplete[course.id] === true })))
const logo = computed(() => preview.value ? '/static/brand-logo.png' : resolvePublicBrandingUrl(store.siteConfig.logo_asset_id))
const banners = computed(() => preview.value ? [] : store.siteConfig.banners.map(item => resolvePublicBrandingUrl(item.asset_id)))
onLoad(query => { preview.value = isStaticSessionPreview(query); loadScenario(query); if (!preview.value) reload() })
function reload() { void store.loadHome().catch(() => {}) }
function openCourse(course: { id: string }) { uni.navigateTo({ url: preview.value ? `/pages/course/detail?scenario=${course.id === 'video' ? 'course-video' : 'course-no-video'}` : `/pages/course/detail?id=${encodeURIComponent(course.id)}` }) }
function moreCourses() { uni.reLaunch({ url: `/pages/course/index${preview.value ? '?scenario=course-list' : ''}` }) }
</script>
<template>
  <AppPage tab="home"><template #header><view class="home-brand"><view v-if="logo" class="home-brand__logo"><image :src="logo" mode="aspectFit" /></view><view class="home-brand__copy"><text class="home-brand__name">{{ institution }}</text><text class="home-brand__subtitle">{{ platformSubtitle }}</text></view></view></template>
    <wd-swiper v-if="banners.length" :list="banners" :height="140" :radius="12" image-mode="aspectFill" /><view v-else class="home-banner"><view><text class="home-banner__title">安全学习，从这里开始</text><text class="home-banner__subtitle">系统学习 · 掌握安全技能</text></view><view class="home-banner__icon"><AppIcon name="hard-hat" :size="36" color="#ffffff" /></view><view class="home-banner__dots"><view class="home-banner__dot--active" /><view /><view /></view></view>
    <view class="home-heading"><text>推荐课程</text><text v-if="courses.length" class="home-heading__more" role="button" @click="moreCourses">更多课程 ›</text></view>
    <view v-if="!preview && store.homeLoading && !courses.length" class="home-state">课程加载中…</view>
    <view v-else-if="!preview && store.homeError" class="home-state"><text>{{ store.homeError }}</text><wd-button size="small" @click="reload">重新加载</wd-button></view>
    <EmptyState v-else-if="!courses.length" image="/static/states/empty-data.png" title="暂无课程" />
    <view class="home-courses"><CourseCard v-for="course in courses" :key="course.id" :course="course" @select="openCourse" /></view>
  </AppPage>
</template>
<style scoped>
.home-brand { height: 74px; padding: 12px calc(16px + var(--app-native-menu-inset, 0px)) 14px 16px; display: flex; align-items: center; gap: 12px; background: #3c82f8; color: var(--app-color-surface); }
.home-brand__logo { width: 48px; height: 48px; padding: 4px; flex: none; border-radius: var(--app-radius-md); background: var(--app-color-surface); }
.home-brand__logo image { width: 40px; height: 40px; }
.home-brand__name, .home-brand__subtitle { display: block; }
.home-brand__name { font-size: 18px; font-weight: 600; }
.home-brand__subtitle { font-size: 11px; margin-top: 4px; }
.home-banner { min-height: 140px; position: relative; display: flex; gap: 12px; padding: 18px; border-radius: var(--app-radius-lg); background: linear-gradient(90deg, var(--app-color-primary-deep), var(--app-color-primary)); color: var(--app-color-surface); }
.home-banner__title { display: block; font-size: 20px; line-height: 1.5; font-weight: 600; }
.home-banner__subtitle { display: block; margin-top: 8px; font-size: 12px; }
.home-banner__icon { width: 64px; height: 64px; flex: none; margin-left: auto; display: flex; align-items: center; justify-content: center; border-radius: var(--app-radius-full); background: #ffffff26; }
.home-banner__dots { position: absolute; left: 0; right: 0; bottom: 16px; display: flex; justify-content: center; gap: 4px; }
.home-banner__dots view { width: 4px; height: 4px; border-radius: var(--app-radius-full); background: #ffffff66; }
.home-banner__dots .home-banner__dot--active { width: 12px; background: var(--app-color-surface); }
.home-heading { display: flex; align-items: center; justify-content: space-between; margin: 16px 0; font-size: 18px; font-weight: 600; }
.home-heading__more { color: var(--app-color-primary); font-size: 12px; font-weight: 400; }
.home-courses { display: flex; flex-direction: column; gap: 12px; }
.home-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 32px 16px; color: var(--app-color-text-muted); font-size: 13px; }
/* #ifdef MP-WEIXIN */
.home-brand__copy { flex: 1; min-width: 0; }
.home-brand__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* #endif */
</style>
