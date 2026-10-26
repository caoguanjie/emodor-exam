<template>
  <el-form label-position="left" label-width="96px" require-asterisk-position="right" class="paper-properties" @submit.prevent>
    <h3 class="designer-property-group-title">基础设置</h3>
    <div class="designer-property-content">
      <el-form-item label="培训类别" required class="paper-properties__category">
        <template #label>
          <span class="paper-properties__category-label">培训类别<span class="paper-properties__required" aria-hidden="true">*</span>
            <el-tooltip content="已有题目时类别锁定；清空题单或整卷替换后可更改。" placement="top" :show-after="200">
              <el-icon class="paper-properties__help" tabindex="0" aria-label="培训类别说明"><QuestionFilled /></el-icon>
            </el-tooltip>
          </span>
        </template>
        <el-select aria-label="试卷培训类别" :model-value="modelValue.category_id || ''" :disabled="readonly || hasQuestions" placeholder="请选择" @update:model-value="patch({ category_id: String($event) })">
          <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="排序">
        <el-input aria-label="试卷排序" type="number" inputmode="numeric" :min="0" :max="2147483647" :step="1" :model-value="numericDrafts.sort_order" :disabled="readonly" @update:model-value="changeNumeric('sort_order', $event)" />
      </el-form-item>
      <el-form-item label="备注"><el-input aria-label="试卷备注" :model-value="modelValue.remark ?? ''" type="textarea" :rows="3" :maxlength="1000" show-word-limit placeholder="选填" :disabled="readonly" @update:model-value="patch({ remark: $event })" /></el-form-item>
    </div>
    <h3 class="designer-property-group-title">考试规则</h3>
    <div class="designer-property-content">
      <el-form-item label="考试时间" required>
        <el-input aria-label="考试限时" type="number" inputmode="numeric" :min="1" :max="1440" :step="1" :model-value="numericDrafts.duration_minutes" :disabled="readonly" @update:model-value="changeNumeric('duration_minutes', $event)"><template #append>分钟</template></el-input>
      </el-form-item>
      <el-form-item label="试卷总分" required>
        <el-input ref="totalScoreInput" aria-label="试卷总分" type="number" inputmode="decimal" :min="0.01" :max="999.99" :step="0.01" :model-value="numericDrafts.total_score" :disabled="readonly" @update:model-value="changeNumeric('total_score', $event)"><template #append>分</template></el-input>
      </el-form-item>
      <el-form-item label="及格分数" required>
        <el-input aria-label="及格分数" type="number" inputmode="decimal" :min="0.01" :max="modelValue.total_score ?? 100" :step="0.01" :model-value="numericDrafts.pass_score" :disabled="readonly" @update:model-value="changeNumeric('pass_score', $event)"><template #append>分</template></el-input>
      </el-form-item>
      <el-form-item label="考前学习要求"><el-switch aria-label="考前学习要求" :model-value="!!modelValue.requires_learning" :disabled="readonly" @update:model-value="patch({ requires_learning: Boolean($event) })" /></el-form-item>
      <el-form-item label="关联课程" :required="!!modelValue.requires_learning">
        <el-select aria-label="试卷关联课程" :model-value="modelValue.requires_learning ? modelValue.course_ids || [] : []" multiple filterable clearable :disabled="readonly || !modelValue.requires_learning" placeholder="请选择" @update:model-value="patch({ course_ids: $event })">
          <el-option v-for="item in courses" :key="String(item.id)" :label="item.title" :value="String(item.id)" />
          <el-option v-for="id in missing(modelValue.requires_learning ? modelValue.course_ids : [], courses)" :key="id" label="已选课程（当前不可用）" :value="id" />
        </el-select>
      </el-form-item>
      <el-form-item label="累计学习时长" :required="!!modelValue.requires_learning">
        <el-input aria-label="累计学习时长（分钟）" type="number" inputmode="numeric" :min="1" :max="2147483647" :step="1" :model-value="modelValue.requires_learning ? numericDrafts.required_learning_minutes : ''" :disabled="readonly || !modelValue.requires_learning" @update:model-value="changeNumeric('required_learning_minutes', $event)"><template #append>分钟</template></el-input>
      </el-form-item>
      <el-text class="paper-properties__hint" type="info" size="small">开启后，所选课程累计有效学习时长达到要求，学员才可开考。</el-text>
    </div>
  </el-form>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { QuestionFilled } from '@element-plus/icons-vue';
import type { QuestionRegulationOption } from '../Tiptap/components/QuestionSetting.vue';
import type { DesignerPaper, PaperCourseOption } from './contracts';
const props = withDefaults(defineProps<{ modelValue: DesignerPaper; categories?: Array<{ id: string; name: string }>;
  regulations?: QuestionRegulationOption[]; courses?: PaperCourseOption[]; readonly?: boolean; hasQuestions?: boolean; }>(), {
  categories: () => [], regulations: () => [], courses: () => [], readonly: false, hasQuestions: false,
});
const emit = defineEmits<{ change: [patch: Partial<DesignerPaper>] }>();
type NumericField = 'sort_order' | 'duration_minutes' | 'total_score' | 'pass_score' | 'required_learning_minutes';
const defaults: Record<NumericField, number | null> = { sort_order: 0, duration_minutes: 30, total_score: 100, pass_score: 60, required_learning_minutes: null };
const numericDrafts = reactive<Record<NumericField, string>>({ sort_order: '', duration_minutes: '', total_score: '', pass_score: '', required_learning_minutes: '' });
watch(() => [props.modelValue.sort_order, props.modelValue.duration_minutes, props.modelValue.total_score, props.modelValue.pass_score, props.modelValue.required_learning_minutes], () => {
  for (const key of Object.keys(defaults) as NumericField[]) {
    const value = props.modelValue[key] === undefined ? defaults[key] : props.modelValue[key];
    const draft = numericDrafts[key];
    // Keep unfinished numeric input, including a trailing decimal point or an empty required field.
    if (draft === '' && (value == null || Number.isNaN(value)) || draft !== '' && Number(draft) === value) continue;
    numericDrafts[key] = value == null ? '' : String(value);
  }
}, { immediate: true });
const totalScoreInput = ref<{ focus: () => void; input?: HTMLInputElement } | null>(null);
function focusTotalScore() {
  totalScoreInput.value?.input?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  totalScoreInput.value?.focus();
}
defineExpose({ focusTotalScore });
function changeNumeric(key: NumericField, value: string) {
  if (props.readonly || key === 'required_learning_minutes' && !props.modelValue.requires_learning) return;
  numericDrafts[key] = value;
  patch({ [key]: value === '' ? (key === 'required_learning_minutes' ? null : Number.NaN) : Number(value) });
}
function missing(ids: string[] | undefined, options: Array<{ id: string | number }>) { return (ids || []).filter((id) => !options.some((item) => String(item.id) === id)); }
function patch(value: Partial<DesignerPaper>) {
  if (props.readonly || props.hasQuestions && 'category_id' in value) return;
  if (!props.modelValue.requires_learning && ('course_ids' in value || 'required_learning_minutes' in value)) return;
  const next = { ...value };
  if (value.category_id !== undefined && value.category_id !== props.modelValue.category_id) next.course_ids = [];
  if (value.requires_learning === false) { next.course_ids = []; next.required_learning_minutes = null; }
  emit('change', next);
}
</script>

<style scoped>
.paper-properties .el-select,.paper-properties .el-input { width:100%; }
.paper-properties :deep(.el-form-item__content) { min-width:0; }
.paper-properties__category :deep(.el-form-item__label::after) { display:none; }
.paper-properties__category-label { display:inline-flex; align-items:center; gap:4px; }
.paper-properties__required { color:var(--el-color-danger); }
.paper-properties__help { color:var(--el-text-color-placeholder); cursor:help; font-size:13px; }
.paper-properties__help:focus-visible { outline:2px solid var(--el-color-primary); outline-offset:2px; border-radius:50%; }
.paper-properties :deep(.el-input-group__append) { width:40px; padding:0; box-sizing:border-box; }
.paper-properties :deep(input[type="number"]) { appearance:textfield; -moz-appearance:textfield; }
.paper-properties :deep(input::-webkit-inner-spin-button),
.paper-properties :deep(input::-webkit-outer-spin-button) { -webkit-appearance:none; margin:0; }
.paper-properties__hint { display:block; margin:0 0 12px; color:#b5b8be; font-size:12px; line-height:18px; }
</style>
