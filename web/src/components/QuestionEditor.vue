<template>
  <el-form label-width="96px" class="question-editor">
    <div class="question-editor__grid">
      <el-form-item label="培训类别" required>
        <el-select v-model="local.category_id" filterable style="width:100%" :disabled="disabled" @change="onCategoryChange">
          <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="难度" required>
        <el-select v-model="local.difficulty" style="width:100%" :disabled="disabled">
          <el-option label="初级" value="easy" /><el-option label="中级" value="medium" /><el-option label="高级" value="hard" />
        </el-select>
      </el-form-item>
      <el-form-item label="题型" required>
        <el-select v-model="local.type" style="width:100%" :disabled="disabled" @change="onTypeChange">
          <el-option label="单选题" value="single" /><el-option label="多选题" value="multiple" />
          <el-option label="判断题" value="judgment" />
        </el-select>
      </el-form-item>
      <el-form-item label="建议分值" required>
        <el-input-number v-model="local.score" :min="0.01" :max="100" :precision="2" :disabled="disabled" />
      </el-form-item>
      <el-form-item label="考点组">
        <el-select
          v-model="local.concept_id"
          clearable
          filterable
          remote
          reserve-keyword
          style="width:100%"
          :loading="conceptLoading"
          :remote-method="searchConcepts"
          :disabled="disabled"
        >
          <el-option v-for="item in concepts" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
      </el-form-item>
    </div>

    <el-form-item label="题干" required>
      <el-input v-model="local.stem" type="textarea" :rows="4" :disabled="disabled" placeholder="支持受控 HTML；图片请用下方上传后插入" />
    </el-form-item>
    <el-form-item v-if="!disabled && canUploadMedia" label="题干图片">
      <div class="question-editor__media">
        <MediaUpload v-model="pendingMediaId" purpose="question" />
        <el-button :disabled="!pendingMediaId" @click="insertMedia">插入题干</el-button>
      </div>
    </el-form-item>
    <el-form-item v-else-if="!disabled" label="题干图片">
      <el-text type="info">需要“上传媒体”权限；无权限时仍可录入纯文本题目。</el-text>
    </el-form-item>

    <template v-if="local.type === 'single' || local.type === 'multiple'">
      <el-form-item v-for="(option, index) in local.options" :key="index" :label="`选项 ${String.fromCharCode(65 + index)}`">
        <div class="question-editor__option">
          <el-input v-model="option.text" :disabled="disabled" />
          <el-checkbox :model-value="local.answer.includes(index)" :disabled="disabled" @update:model-value="(value: boolean | string | number) => toggleAnswer(index, value)">正确</el-checkbox>
          <el-button v-if="!disabled && local.options.length > 2" text type="danger" @click="removeOption(index)">删除</el-button>
        </div>
      </el-form-item>
      <el-form-item v-if="!disabled" label=""><el-button @click="addOption">添加选项</el-button></el-form-item>
    </template>

    <template v-else-if="local.type === 'judgment'">
      <el-form-item label="正确答案" required>
        <el-radio-group :model-value="local.answer[0]" :disabled="disabled" @update:model-value="(value: string | number | boolean | undefined) => local.answer = [Number(value)]">
          <el-radio :value="0">正确</el-radio><el-radio :value="1">错误</el-radio>
        </el-radio-group>
      </el-form-item>
    </template>

    <el-form-item label="答案解析">
      <el-input v-model="local.analysis" type="textarea" :rows="3" :disabled="disabled" />
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import MediaUpload from './MediaUpload.vue';
import type { Id, QuestionDraftPayload, QuestionOption, QuestionType } from '../api/training-types';

type CategoryOption = { id: Id; name: string };
type ConceptOption = { id: Id; name: string };
const props = withDefaults(defineProps<{
  modelValue: QuestionDraftPayload;
  categories?: CategoryOption[];
  concepts?: ConceptOption[];
  disabled?: boolean;
  canUploadMedia?: boolean;
  conceptLoading?: boolean;
}>(), { categories: () => [], concepts: () => [], disabled: false, canUploadMedia: false, conceptLoading: false });
const emit = defineEmits<{
  (event: 'update:modelValue', value: QuestionDraftPayload): void;
  (event: 'scope-change', value: { category_id: Id; type: QuestionType }): void;
  (event: 'concept-search', value: string): void;
}>();

const local = reactive<QuestionDraftPayload>(clone(props.modelValue));
const pendingMediaId = ref<string | null>(null);
let syncing = false;

function clone(value: QuestionDraftPayload): QuestionDraftPayload {
  return JSON.parse(JSON.stringify(value));
}

function fixedJudgmentOptions(): QuestionOption[] {
  return [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }];
}

function normalizeType(type: QuestionType) {
  if (type === 'judgment') {
    local.options = fixedJudgmentOptions();
    local.answer = local.answer[0] === 1 ? [1] : [0];
  } else {
    if (local.options.length < 2) local.options = [{ key: 'A', text: '' }, { key: 'B', text: '' }];
    local.options = local.options.map((option, index) => ({ key: String.fromCharCode(65 + index), text: option.text }));
    local.answer = type === 'single' ? [local.answer[0] ?? 0] : [...new Set(local.answer)].filter((index) => index < local.options.length);
  }
}

function onTypeChange(value: QuestionType) {
  local.type = value;
  local.concept_id = undefined;
  normalizeType(value);
  onScopeChange();
}

function onCategoryChange() {
  local.concept_id = undefined;
  onScopeChange();
}

function onScopeChange() {
  if (local.category_id) emit('scope-change', { category_id: local.category_id, type: local.type });
}

function searchConcepts(keyword: string) {
  emit('concept-search', keyword);
}

function toggleAnswer(index: number, checked: unknown) {
  const values = new Set(local.answer || []);
  if (checked) values.add(index); else values.delete(index);
  const normalized = [...values].sort((a, b) => a - b);
  local.answer = local.type === 'single' && checked ? [index] : normalized;
}

function addOption() {
  if (local.options.length >= 26) return;
  local.options.push({ key: String.fromCharCode(65 + local.options.length), text: '' });
}

function removeOption(index: number) {
  local.options.splice(index, 1);
  local.options = local.options.map((option, optionIndex) => ({ ...option, key: String.fromCharCode(65 + optionIndex) }));
  local.answer = local.answer.filter((answer) => answer !== index).map((answer) => answer > index ? answer - 1 : answer);
}

function insertMedia() {
  if (!pendingMediaId.value) return;
  local.stem = `${local.stem || ''}<p><img data-media-id="${pendingMediaId.value}" alt="题目图片"></p>`;
  pendingMediaId.value = null;
}

watch(() => props.modelValue, (value) => {
  if (JSON.stringify(value) === JSON.stringify(local)) return;
  syncing = true;
  Object.keys(local).forEach((key) => delete (local as any)[key]);
  Object.assign(local, clone(value));
  normalizeType(local.type);
  syncing = false;
}, { deep: true, flush: 'sync' });

watch(local, (value) => {
  if (!syncing) emit('update:modelValue', clone(value));
}, { deep: true, flush: 'sync' });
</script>

<style scoped>
.question-editor__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 18px; }
.question-editor__option { display: flex; gap: 8px; width: 100%; align-items: center; }
.question-editor__media { display: grid; gap: 8px; width: 100%; }
@media (max-width: 760px) { .question-editor__grid { grid-template-columns: 1fr; } }
</style>
