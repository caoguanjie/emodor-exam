<template>
  <el-dialog
    :model-value="visible"
    title="考点管理"
    width="760px"
    :teleported="false"
    :close-on-click-modal="false"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-alert
      v-if="!access.read"
      type="warning"
      :closable="false"
      title="无考点查看权限"
      description="请联系管理员开通题库查看权限后重试。"
    />
    <template v-else>
      <div class="concept-manager__toolbar">
        <el-select v-model="categoryId" aria-label="培训类别" style="width: 190px">
          <el-option v-for="category in categories" :key="category.id" :label="category.name" :value="category.id" />
        </el-select>
        <el-input
          v-model="query"
          aria-label="搜索考点"
          clearable
          placeholder="按名称搜索"
          @keyup.enter="search"
        />
        <el-button :loading="loading" @click="search">搜索</el-button>
        <el-button
          data-test="concept-create"
          type="primary"
          :disabled="!access.create || !categoryId"
          @click="openCreate"
        >
          新增考点
        </el-button>
      </div>

      <el-alert v-if="listError" type="error" :closable="false" :title="listError">
        <template #default>
          <el-button text type="primary" @click="loadPage(page)">重试</el-button>
        </template>
      </el-alert>

      <div v-loading="loading" class="concept-manager__list">
        <div v-for="item in items" :key="item.id" class="concept-manager__row">
          <div class="concept-manager__summary">
            <strong>{{ item.name }}</strong>
            <span v-if="item.type" class="concept-manager__legacy">历史题型：{{ typeLabel(item.type) }}</span>
            <span>简单 {{ item.easy_count }} / 困难 {{ item.hard_count }}</span>
            <p>{{ item.description || '暂无说明' }}</p>
          </div>
          <div class="concept-manager__actions">
            <el-button v-if="selectable" text type="primary" @click="choose(item)">选择</el-button>
            <el-button
              :data-test="`concept-edit-${item.id}`"
              text
              :disabled="!access.edit"
              @click="openEdit(item)"
            >编辑</el-button>
            <template v-if="pendingDeleteId === item.id">
              <el-button
                :data-test="`concept-delete-confirm-${item.id}`"
                text
                type="danger"
                :loading="deletingId === item.id"
                @click="remove(item)"
              >确认删除</el-button>
              <el-button text @click="pendingDeleteId = null">取消</el-button>
            </template>
            <el-button
              v-else
              :data-test="`concept-delete-${item.id}`"
              text
              type="danger"
              :disabled="!access.delete"
              @click="pendingDeleteId = item.id"
            >删除</el-button>
          </div>
        </div>
        <el-empty v-if="!loading && !listError && items.length === 0" description="暂无考点" />
      </div>
      <el-pagination
        v-if="total > pageSize"
        layout="prev, pager, next"
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        @current-change="loadPage"
      />
    </template>

    <el-dialog
      :model-value="editorOpen"
      :title="editingId ? '编辑考点' : '新增考点'"
      width="620px"
      :teleported="false"
      :close-on-click-modal="false"
      @update:model-value="editorOpen = $event"
    >
      <el-form label-width="88px">
        <el-form-item label="培训类别" required>
          <el-select v-model="draft.category_id" style="width: 100%" :disabled="saving || !canEditDraft">
            <el-option v-for="category in categories" :key="category.id" :label="category.name" :value="category.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="考点名称" required>
          <el-input
            data-test="concept-name"
            v-model="draft.name"
            aria-label="考点名称"
            maxlength="120"
            :disabled="saving || !canEditDraft"
          />
        </el-form-item>
        <el-form-item label="说明">
          <PlainTextField
            v-model="draft.description"
            aria-label="考点说明"
            :disabled="saving || !canEditDraft"
          />
        </el-form-item>
        <el-alert v-if="saveError" type="error" :closable="false" :title="saveError" />
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="editorOpen = false">取消</el-button>
        <el-button data-test="concept-save" type="primary" :loading="saving" :disabled="saving || !canEditDraft" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { ConceptSummary } from '../api/question-document-types';
import type {
  QuestionConceptAccess,
  QuestionConceptApi,
  QuestionConceptInput,
} from '../api/question-authoring';
import type { Id, QuestionType } from '../api/training-types';
import PlainTextField from './Tiptap/PlainTextField.vue';

export interface ConceptCategoryOption {
  id: Id;
  name: string;
}

const props = withDefaults(defineProps<{
  visible: boolean;
  initialCategoryId?: Id;
  questionType?: QuestionType;
  categories?: ConceptCategoryOption[];
  conceptApi: QuestionConceptApi;
  access: QuestionConceptAccess;
  selectable?: boolean;
}>(), {
  initialCategoryId: '',
  categories: () => [],
  selectable: false,
});

const emit = defineEmits<{
  'update:visible': [visible: boolean];
  selected: [concept: ConceptSummary];
  changed: [];
}>();

const pageSize = 20;
const categoryId = ref<Id>(props.initialCategoryId || props.categories[0]?.id || '');
const query = ref('');
const items = ref<ConceptSummary[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const listError = ref('');
const pendingDeleteId = ref<Id | null>(null);
const deletingId = ref<Id | null>(null);
const editorOpen = ref(false);
const editingId = ref<Id | null>(null);
const saving = ref(false);
const saveError = ref('');
const canEditDraft = computed(() => props.visible && props.access.read
  && (editingId.value ? props.access.edit : props.access.create));
let listGeneration = 0;
let sessionGeneration = 0;
let editorGeneration = 0;

const draft = reactive<{
  category_id: Id;
  name: string;
  description: string;
  type: QuestionType | null;
}>({
  category_id: '',
  name: '',
  description: '',
  type: null,
});

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '请求失败，请重试';
}

function typeLabel(type: QuestionType): string {
  return {
    single: '单选题',
    multiple: '多选题',
    judgment: '判断题',
  }[type];
}

async function loadPage(targetPage = 1) {
  const generation = ++listGeneration;
  if (!props.visible || !props.access.read || !categoryId.value) {
    items.value = [];
    total.value = 0;
    loading.value = false;
    return;
  }
  loading.value = true;
  listError.value = '';
  try {
    const result = await props.conceptApi.list({
      category_id: categoryId.value,
      type: props.questionType,
      query: query.value.trim() || undefined,
      page: targetPage,
      page_size: pageSize,
    });
    if (generation !== listGeneration || !props.visible || !props.access.read) return;
    items.value = result.items;
    total.value = result.total;
    page.value = result.page;
  } catch (error) {
    if (generation !== listGeneration || !props.visible || !props.access.read) return;
    items.value = [];
    total.value = 0;
    listError.value = errorMessage(error);
  } finally {
    if (generation === listGeneration) loading.value = false;
  }
}

function search() {
  void loadPage(1);
}

function resetDraft(item?: ConceptSummary) {
  editorGeneration += 1;
  saving.value = false;
  editingId.value = item?.id ?? null;
  draft.category_id = item?.category_id ?? categoryId.value;
  draft.name = item?.name ?? '';
  draft.description = item?.description ?? '';
  draft.type = item?.type ?? props.questionType ?? null;
  saveError.value = '';
}

function openCreate() {
  if (!props.visible || !props.access.read || !props.access.create || !categoryId.value || saving.value) return;
  resetDraft();
  editorOpen.value = true;
}

function openEdit(item: ConceptSummary) {
  if (!props.visible || !props.access.read || !props.access.edit || saving.value) return;
  resetDraft(item);
  editorOpen.value = true;
}

async function save() {
  if (!editorOpen.value || saving.value || !canEditDraft.value) return;
  const name = draft.name.trim();
  if (!name || !draft.category_id) {
    saveError.value = '培训类别和考点名称不能为空';
    return;
  }
  const input: QuestionConceptInput = {
    category_id: draft.category_id,
    name,
    description: draft.description,
    type: draft.type || 'single',
  };
  const session = sessionGeneration;
  const editorSession = editorGeneration;
  const targetId = editingId.value;
  const isCurrentEditor = () => session === sessionGeneration
    && editorSession === editorGeneration
    && targetId === editingId.value
    && props.visible
    && editorOpen.value;
  saving.value = true;
  saveError.value = '';
  try {
    if (targetId) await props.conceptApi.update(targetId, input);
    else await props.conceptApi.create(input);
    if (!isCurrentEditor()) return;
    editorOpen.value = false;
    emit('changed');
    await loadPage(1);
  } catch (error) {
    if (isCurrentEditor()) saveError.value = errorMessage(error);
  } finally {
    if (isCurrentEditor()) saving.value = false;
  }
}

async function remove(item: ConceptSummary) {
  if (!props.visible || !props.access.read || !props.access.delete
    || deletingId.value || pendingDeleteId.value !== item.id) return;
  const session = sessionGeneration;
  deletingId.value = item.id;
  listError.value = '';
  try {
    await props.conceptApi.remove(item.id);
    if (session !== sessionGeneration || !props.visible) return;
    if (pendingDeleteId.value === item.id) pendingDeleteId.value = null;
    emit('changed');
    await loadPage(page.value);
  } catch (error) {
    if (session === sessionGeneration) listError.value = errorMessage(error);
  } finally {
    if (session === sessionGeneration) deletingId.value = null;
  }
}

function choose(item: ConceptSummary) {
  if (!props.visible || !props.access.read || !props.selectable) return;
  emit('selected', item);
}

watch(() => props.visible, (visible) => {
  sessionGeneration += 1;
  listGeneration += 1;
  saving.value = false;
  deletingId.value = null;
  saveError.value = '';
  if (!visible) {
    loading.value = false;
    editorOpen.value = false;
    pendingDeleteId.value = null;
    return;
  }
  const nextCategoryId = props.initialCategoryId
    || categoryId.value
    || props.categories[0]?.id
    || '';
  if (categoryId.value === nextCategoryId) void loadPage(1);
  else categoryId.value = nextCategoryId;
}, { immediate: true });

watch(editorOpen, (open) => {
  if (open) return;
  editorGeneration += 1;
  saving.value = false;
  saveError.value = '';
}, { flush: 'sync' });

watch(canEditDraft, (allowed) => {
  if (!allowed) editorOpen.value = false;
}, { flush: 'sync' });

watch(() => props.access.read, () => {
  sessionGeneration += 1;
  saving.value = false;
  deletingId.value = null;
  pendingDeleteId.value = null;
  void loadPage(1);
}, { flush: 'sync' });

watch(() => props.initialCategoryId, (value) => {
  if (!props.visible || !value || value === categoryId.value) return;
  categoryId.value = value;
});

watch(categoryId, () => {
  pendingDeleteId.value = null;
  if (props.visible) void loadPage(1);
});
</script>

<style scoped>
.concept-manager__toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.concept-manager__list {
  min-height: 180px;
}

.concept-manager__row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.concept-manager__summary {
  min-width: 0;
}

.concept-manager__summary > span {
  margin-left: 12px;
  color: var(--el-text-color-secondary);
}

.concept-manager__summary p {
  margin: 6px 0 0;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
}

.concept-manager__legacy {
  font-size: 12px;
}

.concept-manager__actions {
  flex: 0 0 auto;
}
</style>
