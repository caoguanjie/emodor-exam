<template>
  <section class="question-setting" :data-client-id="clientId">
    <el-alert
      v-if="!meta"
      type="warning"
      :closable="false"
      title="题目属性尚未初始化"
      description="请等待宿主补齐该题的业务属性。"
    />
    <el-form v-else label-position="top" class="question-setting__form">
      <el-form-item label="题型">
        <el-input :model-value="typeLabel(meta.type)" disabled />
      </el-form-item>
      <el-form-item label="培训类别" required>
        <div data-test="question-category" class="question-setting__field">
          <el-select
            :model-value="draftCategoryId"
            filterable
            :disabled="readonly"
            style="width: 100%"
            @update:model-value="draftCategoryId = String($event)"
            @change="changeCategory"
          >
            <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </div>
      </el-form-item>
      <el-form-item label="难度" required>
        <el-radio-group
          :model-value="meta.difficulty"
          :disabled="readonly"
          @update:model-value="changeDifficulty"
        >
          <el-radio-button value="easy">简单</el-radio-button>
          <el-radio-button value="hard">困难</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="考点">
        <div class="question-setting__concept">
          <el-select
            data-test="question-concept"
            :model-value="draftConceptId"
            clearable
            filterable
            remote
            reserve-keyword
            :remote-method="searchConcepts"
            :loading="conceptLoading"
            :disabled="readonly || !canReadOptions || !draftCategoryId"
            placeholder="搜索或选择考点"
            @update:model-value="changeConcept"
          >
            <el-option v-for="item in concepts" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
          <el-button
            :disabled="readonly || !conceptAccess.read || !draftCategoryId"
            @click="openConceptManager"
          >管理</el-button>
        </div>
        <el-pagination v-if="conceptTotal > 20" size="small" layout="prev, pager, next" :current-page="conceptPage" :page-size="20" :total="conceptTotal" :disabled="readonly || conceptLoading" @current-change="pageConcepts" />
      </el-form-item>
      <el-alert
        v-if="conceptConflict"
        type="warning"
        :closable="false"
        title="原考点与新类别不兼容"
        description="请重新选择或清除考点；题目解析和其他输入已保留。"
      >
        <template #default>
          <el-button
            data-test="clear-incompatible-concept"
            text
            type="warning"
            :disabled="readonly"
            @click="clearConcept"
          >清除原考点</el-button>
        </template>
      </el-alert>
      <el-alert v-if="conceptError" type="error" :closable="false" :title="conceptError">
        <template #default>
          <el-button text type="primary" @click="loadConcepts(conceptQuery)">重试</el-button>
        </template>
      </el-alert>
      <el-form-item label="制度来源">
        <el-select
          :model-value="meta.regulation_id"
          clearable
          filterable
          :disabled="readonly"
          style="width: 100%"
          @update:model-value="changeRegulation"
        >
          <el-option
            v-for="item in regulations"
            :key="item.id"
            :label="item.title"
            :value="String(item.id)"
            :disabled="Boolean(item.category_id && item.category_id !== draftCategoryId)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="建议分值" required>
        <el-input-number
          :model-value="meta.score_cents / 100"
          :min="0.01"
          :max="100"
          :precision="2"
          :step="0.5"
          :disabled="readonly"
          @update:model-value="changeScore"
        />
        <span class="question-setting__unit">分</span>
      </el-form-item>
      <el-form-item label="正确答案">
        <el-input :model-value="answerSummary || '未设置'" disabled />
      </el-form-item>
      <el-form-item label="答案解析">
        <TiptapEditor
          :key="`analysis-${clientId}`"
          :model-value="meta.analysis"
          profile="rich"
          :mode="readonly ? 'preview' : 'edit'"
          presentation="inline"
          :show-toolbar="!readonly"
          :show-panels="false"
          @update:model-value="changeRichField('analysis', $event)"
          :media-resolver="mediaResolver"
        />
        <div v-if="!readonly && canUploadMedia">
          <MediaUpload :key="`analysis-media-${clientId}`" v-model="analysisMedia" purpose="question" />
          <el-button :disabled="!analysisMedia" @click="insertMedia('analysis')">插入解析末尾</el-button>
        </div>
      </el-form-item>
    </el-form>

    <QuestionConceptManager
      v-model:visible="managerVisible"
      :initial-category-id="draftCategoryId"
      :categories="categories"
      :question-type="meta?.type"
      :concept-api="conceptApi"
      :access="conceptAccess"
      selectable
      @selected="selectManagedConcept"
      @changed="loadConcepts(conceptQuery)"
    />
  </section>
</template>

<script setup lang="ts">
import type { JSONContent } from '@tiptap/core';
import { computed, ref, watch } from 'vue';
import type { ConceptSummary, QuestionMeta } from '../../../api/question-document-types';
import type {
  QuestionConceptAccess,
  QuestionConceptApi,
  QuestionConceptOptionsApi,
} from '../../../api/question-authoring';
import type { ActiveDifficulty, Id, QuestionType } from '../../../api/training-types';
import QuestionConceptManager, { type ConceptCategoryOption } from '../../QuestionConceptManager.vue';
import TiptapEditor from '../index.vue';
import MediaUpload from '../../MediaUpload.vue';
import { isControlledMediaAssetId, type MediaResolver } from '../extensions/MediaImage';

export interface QuestionRegulationOption {
  id: Id | number;
  title: string;
  current_version_id?: Id | number | null;
  category_id?: Id | null;
}

const emptyRichDocument: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

const props = withDefaults(defineProps<{
  clientId: string;
  meta?: QuestionMeta;
  answerSummary?: string;
  categories?: ConceptCategoryOption[];
  regulations?: QuestionRegulationOption[];
  conceptApi: QuestionConceptApi;
  conceptAccess: QuestionConceptAccess;
  conceptOptionsApi?: QuestionConceptOptionsApi;
  change: (patch: Partial<QuestionMeta>) => boolean | void;
  readonly?: boolean;
  canUploadMedia?: boolean;
  mediaResolver?: MediaResolver;
}>(), {
  meta: undefined,
  answerSummary: '',
  categories: () => [],
  regulations: () => [],
  readonly: false,
  canUploadMedia: false,
});

const draftCategoryId = ref<Id>(props.meta?.category_id ?? '');
const draftConceptId = ref<Id | null>(props.meta?.concept_id ?? null);
const concepts = ref<Array<Pick<ConceptSummary, 'id' | 'name'>>>([]);
const conceptPage = ref(1);
const conceptTotal = ref(0);
const canReadOptions = computed(() => props.conceptAccess.read || !!props.conceptOptionsApi);
const conceptLoading = ref(false);
const conceptError = ref('');
const conceptQuery = ref('');
const conceptConflict = ref(false);
const managerVisible = ref(false);
const analysisMedia = ref<string | null>(null);
let conceptGeneration = 0;
let managerClientId: string | null = null;

function typeLabel(type: QuestionType): string {
  return {
    single: '单选题',
    multiple: '多选题',
    judgment: '判断题',
  }[type];
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '考点加载失败，请重试';
}

function apply(patch: Partial<QuestionMeta>): boolean {
  if (props.readonly || !props.meta) return false;
  return props.change(patch) !== false;
}

async function loadConcepts(query = '', page = 1) {
  const generation = ++conceptGeneration;
  conceptQuery.value = query;
  if (!canReadOptions.value || !draftCategoryId.value) {
    concepts.value = [];
    conceptLoading.value = false;
    conceptError.value = canReadOptions.value ? '' : '无考点查看权限';
    conceptTotal.value = 0;
    return;
  }
  conceptLoading.value = true;
  conceptError.value = '';
  try {
    const input = {
      category_id: draftCategoryId.value,
      type: props.meta?.type,
      query: query.trim() || undefined,
      page,
      page_size: 20,
    };
    const result = props.conceptAccess.read ? await props.conceptApi.list(input)
      : await props.conceptOptionsApi!({ ...input, type: props.meta!.type });
    if (generation !== conceptGeneration) return;
    concepts.value = result.items;
    conceptPage.value = result.page;
    conceptTotal.value = result.total;
  } catch (error) {
    if (generation !== conceptGeneration) return;
    concepts.value = [];
    conceptError.value = errorMessage(error);
  } finally {
    if (generation === conceptGeneration) conceptLoading.value = false;
  }
}

function pageConcepts(page: number) { if (!props.readonly) void loadConcepts(conceptQuery.value, page); }

function searchConcepts(query: string) {
  void loadConcepts(query);
}

function changeCategory(value: unknown) {
  const categoryId = String(value ?? '');
  const previousCategory = props.meta?.category_id ?? '';
  draftCategoryId.value = categoryId;
  conceptConflict.value = Boolean(draftConceptId.value && categoryId !== previousCategory);
  if (!apply({ category_id: categoryId })) {
    draftCategoryId.value = previousCategory;
    conceptConflict.value = false;
    return;
  }
  void loadConcepts(conceptQuery.value);
}

function changeDifficulty(value: string | number | boolean | undefined) {
  if (value === 'easy' || value === 'hard') apply({ difficulty: value as ActiveDifficulty });
}

function changeConcept(value: unknown) {
  if (props.readonly || !props.meta || !canReadOptions.value) return;
  const conceptId = value === undefined || value === null || value === '' ? null : String(value);
  if (apply({ concept_id: conceptId })) {
    draftConceptId.value = conceptId;
    conceptConflict.value = false;
  }
}

function clearConcept() {
  changeConcept(null);
}

function openConceptManager() {
  if (props.readonly || !props.meta || !props.conceptAccess.read || !draftCategoryId.value) return;
  managerClientId = props.clientId;
  managerVisible.value = true;
}

function selectManagedConcept(value: ConceptSummary) {
  if (!managerVisible.value || managerClientId !== props.clientId
    || props.readonly || !props.conceptAccess.read) return;
  if (value.category_id !== draftCategoryId.value) {
    conceptError.value = '所选考点不属于当前培训类别';
    return;
  }
  if (!concepts.value.some((item) => item.id === value.id)) concepts.value.unshift(value);
  changeConcept(value.id);
  managerVisible.value = false;
}

function changeRegulation(value: unknown) {
  const regulationId = value === undefined || value === null || value === '' ? null : String(value);
  const regulation = props.regulations.find((item) => String(item.id) === regulationId);
  apply({
    regulation_id: regulationId,
    regulation_version_id: regulation?.current_version_id === undefined || regulation?.current_version_id === null
      ? null
      : String(regulation.current_version_id),
  });
}

function changeScore(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  apply({ score_cents: Math.round(value * 100) });
}

function changeRichField(field: 'analysis', document: JSONContent) {
  apply({ [field]: document });
}

function insertMedia(field: 'analysis') {
  const media = analysisMedia;
  if (props.readonly || !props.canUploadMedia || !props.meta || !isControlledMediaAssetId(media.value)) return;
  const document = JSON.parse(JSON.stringify(props.meta[field] ?? emptyRichDocument)) as JSONContent;
  document.content ||= [];
  let paragraph = document.content.at(-1);
  if (paragraph?.type !== 'paragraph') { paragraph = { type: 'paragraph' }; document.content.push(paragraph); }
  paragraph.content ||= [];
  paragraph.content.push({ type: 'mediaImage', attrs: { asset_id: media.value, alt: '解析图片' } });
  if (apply({ [field]: document })) media.value = null;
}

watch(() => [props.clientId, props.readonly, props.conceptAccess.read] as const, () => {
  managerVisible.value = false;
  managerClientId = null;
  analysisMedia.value = null;
}, { flush: 'sync' });

watch(() => [props.conceptAccess.read, props.conceptOptionsApi] as const, () => {
  void loadConcepts(conceptQuery.value);
}, { flush: 'sync' });

watch(managerVisible, (visible) => {
  if (!visible) managerClientId = null;
}, { flush: 'sync' });

watch(() => [props.clientId, props.meta?.category_id, props.meta?.concept_id] as const, (current, previous) => {
  const [clientId, categoryId, conceptId] = current;
  const sameQuestion = Boolean(previous && previous[0] === clientId);
  const categoryChanged = Boolean(sameQuestion && previous?.[1] !== categoryId);
  const conceptChanged = Boolean(sameQuestion && previous?.[2] !== conceptId);
  conceptGeneration += 1;
  draftCategoryId.value = categoryId ?? '';
  draftConceptId.value = conceptId ?? null;
  if (!sameQuestion || conceptChanged) conceptConflict.value = false;
  else if (categoryChanged && conceptId) conceptConflict.value = true;
  conceptQuery.value = '';
  void loadConcepts();
}, { immediate: true });
</script>

<style scoped>
.question-setting {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 12px;
}

.question-setting__form,
.question-setting :deep(.el-form-item__content),
.question-setting :deep(.ruleexam-tiptap-inline-host) {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.question-setting :deep(.ruleexam-tiptap-inline-host) {
  flex: 1 1 100%;
}

.question-setting__form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.question-setting__field,
.question-setting__concept {
  display: flex;
  width: 100%;
  min-width: 0;
  gap: 8px;
}

.question-setting__concept :deep(.el-select) {
  flex: 1 1 auto;
}

.question-setting__unit {
  margin-left: 6px;
  color: var(--el-text-color-secondary);
}

.question-setting :deep(.ruleexam-tiptap-inline) {
  box-sizing: border-box;
  max-width: 100%;
  min-width: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
}

.question-setting :deep(.header-menu) {
  justify-content: flex-start;
  padding-inline: 0;
}
</style>
