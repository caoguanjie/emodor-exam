<template>
  <el-form label-position="left" label-width="76px" class="paper-properties" @submit.prevent>
    <h3 class="designer-property-group-title">基础设置</h3>
    <div class="designer-property-content">
      <el-form-item label="培训类别">
        <el-select aria-label="试卷培训类别" :model-value="modelValue.category_id || ''" :disabled="readonly || hasQuestions" placeholder="请选择培训类别" @update:model-value="patch({ category_id: String($event) })">
          <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-text v-if="hasQuestions" class="paper-properties__hint" type="info" size="small">已有题目时类别锁定；清空题单或整卷替换后可更改。</el-text>
      <el-form-item label="关联资料">
        <el-select aria-label="试卷关联资料" :model-value="modelValue.regulation_ids || []" multiple :disabled="readonly" placeholder="选择关联资料" @update:model-value="patch({ regulation_ids: $event })">
          <el-option v-for="item in regulations" :key="String(item.id)" :label="item.title" :value="String(item.id)" />
          <el-option v-for="id in missing(modelValue.regulation_ids, regulations)" :key="id" label="已选资料（当前类别不可用）" :value="id" />
        </el-select>
      </el-form-item>
      <el-text class="paper-properties__hint" type="info" size="small">未选资料时，题目来源可选择当前类别全部资料；调整范围不会清空题目来源。</el-text>
      <el-form-item label="关联课程">
        <el-select aria-label="试卷关联课程" :model-value="modelValue.course_ids || []" multiple :disabled="readonly" placeholder="选择关联课程" @update:model-value="patch({ course_ids: $event })">
          <el-option v-for="item in courses" :key="String(item.id)" :label="item.title" :value="String(item.id)" />
          <el-option v-for="id in missing(modelValue.course_ids, courses)" :key="id" label="已选课程（当前类别不可用）" :value="id" />
        </el-select>
      </el-form-item>
    </div>
    <h3 class="designer-property-group-title">考试规则</h3>
    <div class="designer-property-content">
      <el-form-item label="及格分数">
        <el-input-number aria-label="及格分数" :min="1" :max="100" :model-value="modelValue.pass_score ?? 60" :disabled="readonly" @change="patch({ pass_score: Number($event ?? 0) })" />
      </el-form-item>
      <el-form-item label="限时（分）">
        <el-input-number aria-label="考试限时" :min="1" :max="1440" :model-value="modelValue.duration_minutes ?? 30" :disabled="readonly" @change="patch({ duration_minutes: Number($event ?? 0) })" />
      </el-form-item>
      <el-form-item label="考试次数">
        <el-input-number aria-label="最多考试次数" :min="1" :max="100" :model-value="modelValue.max_attempts ?? 3" :disabled="readonly" @change="patch({ max_attempts: Number($event ?? 0) })" />
      </el-form-item>
      <el-form-item label="部分分比例">
        <el-input-number aria-label="多选部分得分比例" :min="0" :max="1" :step="0.1" :model-value="modelValue.partial_credit_ratio ?? 0.5" :disabled="readonly" @change="patch({ partial_credit_ratio: Number($event ?? 0) })" />
      </el-form-item>
      <el-checkbox aria-label="需要完成关联学习" :model-value="!!modelValue.requires_learning" :disabled="readonly" @update:model-value="patch({ requires_learning: Boolean($event) })">需要完成关联学习</el-checkbox>
      <el-text class="paper-properties__hint" type="info" size="small">已关联资料 {{ modelValue.regulation_ids?.length || 0 }} 项，课程 {{ modelValue.course_ids?.length || 0 }} 项。</el-text>
    </div>
  </el-form>
</template>

<script setup lang="ts">
import type { QuestionRegulationOption } from '../Tiptap/components/QuestionSetting.vue';
import type { DesignerPaper, PaperCourseOption } from './contracts';
const props = withDefaults(defineProps<{ modelValue: DesignerPaper; categories?: Array<{ id: string; name: string }>;
  regulations?: QuestionRegulationOption[]; courses?: PaperCourseOption[]; readonly?: boolean; hasQuestions?: boolean }>(), {
  categories: () => [], regulations: () => [], courses: () => [], readonly: false, hasQuestions: false,
});
const emit = defineEmits<{ change: [patch: Partial<DesignerPaper>] }>();
function input(event: Event) { return (event.target as HTMLInputElement).value; }
function number(event: Event) { return Number(input(event)); }
function selected(event: Event) { return Array.from((event.target as HTMLSelectElement).selectedOptions, (option) => option.value); }
function missing(ids: string[] | undefined, options: Array<{ id: string | number }>) { return (ids || []).filter((id) => !options.some((item) => String(item.id) === id)); }
function patch(value: Partial<DesignerPaper>) {
  if (props.readonly || props.hasQuestions && 'category_id' in value) return;
  emit('change', value);
}
</script>

<style scoped>
.paper-properties .el-select,.paper-properties .el-input-number { width:100%; }
.paper-properties__hint { display:block; margin:0 0 12px; color:#b5b8be; font-size:12px; line-height:18px; }
</style>
