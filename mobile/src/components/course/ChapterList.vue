<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '../common/AppIcon.vue'
import type { StaticChapter } from '@/fixtures/ui-scenarios/shell'
type ChapterView = Omit<StaticChapter, 'lessons'> & { lessons: (StaticChapter['lessons'][number] & { progressText?: string })[] }
const props = withDefaults(defineProps<{ chapters: ChapterView[]; collapsedChapters?: string[]; showLessonProgress?: boolean; selectedLessonId?: string; playingLessonId?: string }>(), { collapsedChapters: () => [], showLessonProgress: true, selectedLessonId: '', playingLessonId: '' })
const emit = defineEmits<{ select: [lessonId: string] }>()
const open = ref<string[]>([])
watch(() => JSON.stringify([props.chapters.map(chapter => chapter.id), props.collapsedChapters]), () => { open.value = props.chapters.filter((chapter) => !props.collapsedChapters.includes(chapter.id)).map((chapter) => chapter.id) }, { immediate: true })
const lessonCount = computed(() => props.chapters.reduce((count, chapter) => count + chapter.lessons.length, 0))
const selectedCompleted = computed(() => props.selectedLessonId ? props.chapters.some(chapter => chapter.lessons.some(lesson => lesson.id === props.selectedLessonId && lesson.completed)) : false)
  function lessonNumber(chapterIndex: number, lessonIndex: number) {
    return props.chapters.slice(0, chapterIndex).reduce((count, chapter) => count + chapter.lessons.length, 0) + lessonIndex + 1
  }
  function lessonName(chapterIndex: number, lessonIndex: number, title: string) {
    const code = `${chapterIndex + 1}.${lessonIndex + 1}`
    return title.startsWith(`${code} `) ? title : `${code} ${title}`
  }
</script>
<template>
  <view class="chapter-list"><view class="chapter-list__heading"><text>课程目录</text><text class="chapter-list__count">共{{ lessonCount }}课时</text></view>
    <wd-collapse v-model="open" custom-style="padding:12px 16px;--wot-collapse-item-header-padding:0 14px;--wot-collapse-item-title-font-size:14px;--wot-collapse-item-body-padding:0;--wot-collapse-bg:var(--app-color-background)">
        <wd-collapse-item v-for="(chapter, chapterIndex) in chapters" :key="chapter.id" :name="chapter.id" :title="chapter.title" :border="false" custom-class="chapter-list__chapter" :custom-style="`margin-bottom:${chapterIndex < chapters.length - 1 ? '12px' : '0'};border-radius:var(--app-radius-md);overflow:hidden;background:var(--app-color-surface)`">
        <template #title="{ expanded }">
          <view class="chapter-list__title" role="button" :aria-label="chapter.title" :aria-expanded="expanded">
            <AppIcon :name="expanded ? 'chevron-down' : 'chevron-right'" :size="16" color="#646566" />
              <text class="chapter-list__section-name">{{ chapter.title }}</text>
              <text class="chapter-list__section-count">{{ chapter.lessons.length }}节</text>
          </view>
        </template>
            <view v-for="(lesson, index) in chapter.lessons" :key="lesson.id" class="chapter-list__lesson" :class="{ 'chapter-list__lesson--selected': lesson.id === selectedLessonId }" role="button" :aria-label="lesson.title" @click="emit('select', lesson.id)"><AppIcon v-if="lesson.id === selectedLessonId" name="play" :size="16" color="#1989fa" /><text v-else class="chapter-list__number">{{ lessonNumber(chapterIndex, index) }}</text><view class="chapter-list__copy"><text class="chapter-list__name">{{ lessonName(chapterIndex, index, lesson.title) }}</text><view v-if="lesson.id === playingLessonId" class="chapter-list__playing"><wd-loading type="wave" :size="14" inherit-color /><text>正在学习</text></view></view><text class="chapter-list__badge" :class="{ 'chapter-list__badge--complete': showLessonProgress && lesson.completed }">{{ showLessonProgress ? lesson.progressText || (lesson.completed ? '已完成' : '0%') : '视频' }}</text></view>
      </wd-collapse-item>
    </wd-collapse>
    <view v-if="selectedCompleted && showLessonProgress" class="chapter-list__hint"><AppIcon name="circle-check" :size="14" color="#07c160" /><text>本课时已完成，可按需再次观看。</text></view>
  </view>
</template>
<style scoped>
.chapter-list__heading { min-height: 60px; display: flex; justify-content: space-between; align-items: center; padding: 16px; background: var(--app-color-surface); font-size: 16px; font-weight: 600; }
.chapter-list__count { font-size: 12px; font-weight: 400; color: var(--app-color-text-muted); }
.chapter-list__title { width: 100%; min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .chapter-list__section-name { flex: 1; min-width: 0; font-weight: 600; }
  .chapter-list__section-count { flex: none; color: var(--app-color-text-muted); font-size: 12px; font-weight: 400; }
.chapter-list__lesson { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 10px 14px; color: var(--app-color-text-secondary); border-top: 1px solid var(--app-color-border); font-size: 13px; }
.chapter-list__lesson--selected { min-height: 64px; background: var(--app-color-primary-soft); color: var(--app-color-primary); }
  .chapter-list__number { width: 18px; flex: none; color: var(--app-color-text-muted); font-size: 12px; }
.chapter-list__copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.chapter-list__name { overflow-wrap: anywhere; }
.chapter-list__playing { display: flex; align-items: center; gap: 4px; min-height: 16px; color: var(--app-color-primary); font-size: 11px; }
.chapter-list__badge { flex: none; font-size: 10px; padding: 3px 7px; border-radius: var(--app-radius-full); background: var(--app-color-background); color: var(--app-color-text-muted); }
.chapter-list__badge--complete { background: var(--app-color-success-soft); color: var(--app-color-success); }
.chapter-list__hint { display: flex; align-items: center; gap: 6px; padding: 12px 16px; color: var(--app-color-text-muted); font-size: 12px; }
</style>
