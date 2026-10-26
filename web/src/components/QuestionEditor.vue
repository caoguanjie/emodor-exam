<template>
  <el-form label-width="96px" class="question-editor">
    <div class="question-editor__grid">
      <el-form-item label="题型" required>
        <el-select v-model="local.type" style="width:100%" :disabled="disabled" @change="onTypeChange">
          <el-option label="单选题" value="single" /><el-option label="多选题" value="multiple" />
          <el-option label="判断题" value="judgment" />
        </el-select>
      </el-form-item>
      <el-form-item label="培训类别" required>
        <el-select v-model="local.category_id" filterable style="width:100%" :disabled="disabled">
          <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="难度" required>
        <el-select v-model="local.difficulty" style="width:100%" :disabled="disabled">
          <el-option v-if="historicalDifficulty" :label="historicalDifficulty" :value="local.difficulty" disabled />
          <el-option v-for="item in difficultyOptions" :key="item.value" :label="item.label" :value="item.value" />
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
      <el-form-item v-for="(option, index) in local.options" :key="option.key" :label="`选项 ${String.fromCharCode(65 + index)}`">
        <div class="question-editor__option">
          <el-input v-model="option.text" :disabled="disabled" />
          <el-checkbox :model-value="local.answer.includes(index)" :disabled="disabled" @update:model-value="(value: boolean | string | number) => toggleAnswer(index, value)">正确</el-checkbox>
          <el-button v-if="!disabled" text :disabled="index === 0" @click="moveOption(index, -1)">上移</el-button>
          <el-button v-if="!disabled" text :disabled="index === local.options.length - 1" @click="moveOption(index, 1)">下移</el-button>
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

    <details class="question-editor__optional" :open="analysisExpanded" @toggle="analysisExpanded = ($event.target as HTMLDetailsElement).open">
      <summary>答案解析（选填）</summary>
      <el-form-item label="答案解析">
        <el-input v-model="local.analysis" type="textarea" :rows="3" :disabled="disabled" />
      </el-form-item>
    </details>
  </el-form>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import MediaUpload from './MediaUpload.vue';
import { newQuestionOptionId, questionDraftFromView, type Id, type QuestionDraftPayload, type QuestionOption, type QuestionType } from '../api/training-types';

type CategoryOption = { id: Id; name: string };
const props = withDefaults(defineProps<{
  modelValue: QuestionDraftPayload;
  categories?: CategoryOption[];
  disabled?: boolean;
  canUploadMedia?: boolean;
  difficultyOptions?: Array<{ value: string; label: string }>;
}>(), { categories: () => [], disabled: false, canUploadMedia: false, difficultyOptions: () => [] });
const emit = defineEmits<{
  (event: 'update:modelValue', value: QuestionDraftPayload): void;
}>();

const local = reactive<QuestionDraftPayload>(clone(props.modelValue));
const analysisExpanded = ref(!!local.analysis?.trim());
const pendingMediaId = ref<string | null>(null);
let syncing = false;
const historicalDifficulty = computed(() => local.difficulty && !props.difficultyOptions.some((item) => item.value === local.difficulty)
  ? `${({ easy: '简单', medium: '中级', hard: '困难' } as Record<string, string>)[local.difficulty] || local.difficulty}（历史，当前停用）` : '');

function clone(value: QuestionDraftPayload): QuestionDraftPayload {
  if (value.content_schema_version === 3) return JSON.parse(JSON.stringify(value));
  const draft = value.content_schema_version === 2 ? questionDraftFromView(value) : value;
  // HTML fields are the active form state; saving explicitly rebuilds v2 JSON.
  const { content_schema_version: _schema, content_json: _content, ...editable } = draft;
  return JSON.parse(JSON.stringify(editable));
}

function fixedJudgmentOptions(): QuestionOption[] {
  return [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }];
}

function normalizeType(type: QuestionType) {
  if (type === 'judgment') {
    if (local.options.length !== 2) local.options = fixedJudgmentOptions();
    local.answer = local.answer[0] === 1 ? [1] : [0];
  } else {
    if (local.options.length < 2) local.options = [{ key: 'A', text: '' }, { key: 'B', text: '' }];
    local.answer = type === 'single' ? [local.answer[0] ?? 0] : [...new Set(local.answer)].filter((index) => index < local.options.length);
  }
}

function onTypeChange(value: QuestionType) {
  local.type = value;
  if (value === 'judgment') local.options = fixedJudgmentOptions();
  normalizeType(value);
}

function toggleAnswer(index: number, checked: unknown) {
  const values = new Set(local.answer || []);
  if (checked) values.add(index); else values.delete(index);
  const normalized = [...values].sort((a, b) => a - b);
  local.answer = local.type === 'single' && checked ? [index] : normalized;
}

function addOption() {
  if (local.options.length >= 26) return;
  local.options.push({ key: newQuestionOptionId(local.options), text: '' });
}

function removeOption(index: number) {
  local.options.splice(index, 1);
  local.answer = local.answer.filter((answer) => answer !== index).map((answer) => answer > index ? answer - 1 : answer);
}

function moveOption(index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= local.options.length) return;
  const correctIds = new Set(local.answer.map((answer) => local.options[answer]?.key));
  const [option] = local.options.splice(index, 1);
  local.options.splice(target, 0, option);
  local.answer = local.options.flatMap((option, position) => correctIds.has(option.key) ? [position] : []);
}

function insertMedia() {
  if (!pendingMediaId.value) return;
  local.stem = `${local.stem || ''}<p><img data-media-id="${pendingMediaId.value}" alt="题目图片"></p>`;
  pendingMediaId.value = null;
}

watch(() => props.modelValue, (value) => {
  if (JSON.stringify(clone(value)) === JSON.stringify(local)) return;
  syncing = true;
  Object.keys(local).forEach((key) => delete (local as any)[key]);
  Object.assign(local, clone(value));
  analysisExpanded.value = !!local.analysis?.trim();
  normalizeType(local.type);
  syncing = false;
}, { deep: true, flush: 'sync' });

watch(local, (value) => {
  if (!syncing) emit('update:modelValue', clone(value));
}, { deep: true, flush: 'sync' });
</script>

<style scoped>
.question-editor__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 18px; }
.question-editor__optional { margin-top: 8px; border-top: 1px solid var(--el-border-color-lighter); }
.question-editor__optional summary { padding: 14px 0; cursor: pointer; color: var(--el-text-color-regular); font-size: 14px; }
.question-editor__option { display: flex; gap: 8px; width: 100%; align-items: center; }
.question-editor__media { display: grid; gap: 8px; width: 100%; }
@media (max-width: 760px) { .question-editor__grid { grid-template-columns: 1fr; } }
</style>
