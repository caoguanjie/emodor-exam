<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '../common/AppIcon.vue'
import ProtectedImage from '../common/ProtectedImage.vue'
interface CourseCardModel { id: string; title: string; icon: string; lessonCount: number; progress: number | null; completed?: boolean; coverAssetId?: string | null }
const props = withDefaults(defineProps<{ course: CourseCardModel; showProgress?: boolean }>(), { showProgress: false })
const completed = computed(() => props.course.completed ?? props.course.progress === 100)
const emit = defineEmits<{ select: [course: CourseCardModel] }>()
</script>
<template>
  <view class="course-card" role="button" :aria-label="course.title" @click="emit('select', course)">
    <view class="course-card__cover"><ProtectedImage v-if="course.coverAssetId" :asset-id="course.coverAssetId" owner-type="training_course_cover" :owner-id="course.id" :width="64" :height="64"><AppIcon :name="course.icon" :size="30" color="#1989fa" /></ProtectedImage><AppIcon v-else :name="course.icon" :size="30" color="#1989fa" /></view>
    <view class="course-card__copy"><text class="course-card__title">{{ course.title }}</text><template v-if="showProgress"><view class="course-card__track"><view class="course-card__progress" :style="{ width: `${course.progress || 0}%` }" /></view><text class="course-card__state" :class="{ 'course-card__state--complete': completed }">{{ course.progress === null ? '进度暂不可用' : completed ? '已完成' : course.progress ? `已学习 ${course.progress}%` : '未学习' }}</text></template><text v-else class="course-card__count">共{{ course.lessonCount }}节</text></view>
  </view>
</template>
<style scoped>
.course-card { min-height: 88px; display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--app-color-border); border-radius: var(--app-radius-lg); background: var(--app-color-surface); }
.course-card__cover { width: 64px; height: 64px; flex: none; display: flex; align-items: center; justify-content: center; overflow:hidden; border-radius: var(--app-radius-md); background: var(--app-color-primary-soft); }
.course-card__copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 6px; }
.course-card__title { font-size: 14px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
.course-card__count { font-size: 12px; color: var(--app-color-text-muted); }
.course-card__track { height: 4px; overflow: hidden; border-radius: var(--app-radius-full); background: var(--app-color-background); }
.course-card__progress { height: 100%; background: var(--app-color-success); }
.course-card__state { font-size: 11px; color: var(--app-color-text-muted); }
.course-card__state--complete { color: var(--app-color-success); }
</style>
