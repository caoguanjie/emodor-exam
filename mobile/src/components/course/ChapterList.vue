<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '../common/AppIcon.vue'
import type { StaticChapter } from '@/fixtures/ui-scenarios/shell'
type ChapterView = Omit<StaticChapter, 'lessons'> & { lessons: (StaticChapter['lessons'][number] & { progressText?: string })[] }
const props = withDefaults(defineProps<{ chapters: ChapterView[]; collapsedChapters?: string[]; showLessonProgress?: boolean }>(), { collapsedChapters: () => [], showLessonProgress: true })
const emit = defineEmits<{ select: [lessonId: string] }>()
const open = ref<string[]>([])
watch(() => [props.chapters, props.collapsedChapters], () => { open.value = props.chapters.filter((chapter) => !props.collapsedChapters.includes(chapter.id)).map((chapter) => chapter.id) }, { immediate: true })
const lessonCount = computed(() => props.chapters.reduce((count, chapter) => count + chapter.lessons.length, 0))
</script>
<template>
  <view class="chapter-list"><view class="chapter-list__heading"><text>课程目录</text><text class="chapter-list__count">共{{ lessonCount }}课时</text></view>
    <wd-collapse v-model="open" custom-style="--wot-collapse-padding:0;--wot-collapse-item-header-padding:14px 16px;--wot-collapse-item-title-font-size:14px;--wot-collapse-item-body-padding:0;--wot-collapse-bg:var(--app-color-surface)">
      <wd-collapse-item v-for="chapter in chapters" :key="chapter.id" :name="chapter.id" :title="chapter.title" :border="false">
        <template #title="{ expanded }">
          <view class="chapter-list__title" role="button" :aria-label="chapter.title" :aria-expanded="expanded">
            <text>{{ chapter.title }}</text>
            <AppIcon :name="expanded ? 'chevron-down' : 'chevron-right'" :size="16" color="#646566" />
          </view>
        </template>
        <view v-for="(lesson, index) in chapter.lessons" :key="lesson.id" class="chapter-list__lesson" :class="{ 'chapter-list__lesson--complete': lesson.completed }" role="button" :aria-label="lesson.title" @click="emit('select', lesson.id)"><AppIcon v-if="lesson.completed" name="play" :size="16" color="#1989fa" /><text v-else class="chapter-list__number">{{ index + 1 }}</text><text class="chapter-list__name">{{ lesson.title }}</text><text class="chapter-list__badge">{{ showLessonProgress ? lesson.progressText || (lesson.completed ? '已完成' : '0%') : '视频' }}</text></view>
      </wd-collapse-item>
    </wd-collapse>
    <view v-if="chapters.some(chapter => chapter.lessons.some(lesson => lesson.completed))" class="chapter-list__hint"><AppIcon name="circle-check" :size="14" color="#07c160" /><text>本课时已完成，可按需再次观看。</text></view>
  </view>
</template>
<style scoped>
.chapter-list__heading { min-height: 60px; display: flex; justify-content: space-between; align-items: center; padding: 16px; background: var(--app-color-surface); font-size: 16px; font-weight: 600; }
.chapter-list__count { font-size: 12px; font-weight: 400; color: var(--app-color-text-muted); }
.chapter-list__title { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.chapter-list__lesson { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 12px 16px; color: var(--app-color-text-secondary); border-top: 1px solid var(--app-color-border); font-size: 13px; }
.chapter-list__lesson--complete { background: var(--app-color-primary-soft); color: var(--app-color-primary); }
.chapter-list__number { width: 14px; flex: none; color: var(--app-color-text-muted); font-size: 12px; }
.chapter-list__name { flex: 1; min-width: 0; }
.chapter-list__badge { flex: none; font-size: 10px; padding: 3px 7px; border-radius: var(--app-radius-sm); background: var(--app-color-background); color: var(--app-color-text-muted); }
.chapter-list__lesson--complete .chapter-list__badge { background: var(--app-color-success-soft); color: var(--app-color-success); }
.chapter-list__hint { display: flex; align-items: center; gap: 6px; padding: 12px 16px; color: var(--app-color-text-muted); font-size: 12px; }
</style>
