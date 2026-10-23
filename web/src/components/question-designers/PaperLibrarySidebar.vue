<template>
  <aside class="paper-library" aria-label="试题和试卷库">
    <section v-if="!readonly" class="paper-library__new">
      <h2>题目控件</h2>
      <div>
        <el-button v-for="item in types" :key="item.type" :disabled="disabled || !categoryId" @click="emit('add-question', item.type)">
          <SvgIcon :icon-class="item.type === 'single' ? 'radio' : item.type === 'multiple' ? 'checkbox' : 'select'" />{{ item.label }}
        </el-button>
      </div>
    </section>
    <el-tabs :model-value="tab" class="paper-library__tabs" aria-label="库类型" @tab-change="switchTab($event as Tab)">
      <el-tab-pane v-for="kind in (['question', 'paper'] as const)" :key="kind" :label="kind === 'question' ? '试题库' : '试卷库'" :name="kind">
        <div v-if="tab === kind" class="paper-library__pane">
          <form class="paper-library__search" @submit.prevent="search">
            <el-input v-model="active.keyword" :aria-label="`${label}关键词`" :placeholder="`搜索${label}`" :disabled="tab === 'question' && !categoryId">
              <template #suffix><el-button native-type="submit" :icon="Search" link class="paper-library__search-action" aria-label="搜索" :disabled="tab === 'question' && !categoryId" /></template>
            </el-input>
          </form>
          <div class="paper-library__content">
            <el-empty v-if="tab === 'question' && !categoryId" :image-size="64" description="请先选择培训类别" />
            <el-skeleton v-else-if="active.loading" :rows="3" animated />
            <el-alert v-else-if="active.error" :title="active.error" type="error" :closable="false"><el-button link type="primary" @click="load(tab, active.page)">重试</el-button></el-alert>
            <el-empty v-else-if="!active.items.length" :image-size="64" :description="tab === 'question' ? '暂无试题' : '暂无完整试卷'" />
            <ul v-else class="paper-library__results">
              <li v-for="item in active.items" :key="item.id" :class="{ 'is-selected': selected === item.id }">
                <div class="paper-library__meta">
                  <el-tag size="small" type="primary" effect="light" class="paper-library__type-tag">{{ 'stem' in item ? typeLabel(item.type).replace(/题$/, '') : '试卷' }}</el-tag>
                  <el-text v-if="'stem' in item" class="paper-library__detail" size="small" type="info">{{ item.difficulty === 'easy' ? '简单' : '困难' }}</el-text>
                  <template v-else>
                    <el-text class="paper-library__detail" size="small" type="info">{{ item.question_count }} 题</el-text>
                    <el-text class="paper-library__category" size="small" type="info" truncated :title="categoryName(item.category_id)">{{ categoryName(item.category_id) }}</el-text>
                  </template>
                </div>
                <el-button text class="paper-library__summary" @click="selected = item.id"><span class="paper-library__excerpt">{{ itemTitle(item) }}</span></el-button>
                <div v-if="!readonly" class="paper-library__actions">
                  <el-button :icon="Plus" size="small" type="primary" link class="paper-library__insert"
                    :aria-label="tab === 'question' ? '加入试卷' : '使用整卷'"
                    :disabled="disabled || detailLoading || ('question_count' in item && item.question_count < 1)"
                    @click="getDetail(item.id)">{{ tab === 'question' ? '加入试卷' : '使用整卷' }}</el-button>
                </div>
              </li>
            </ul>
            <el-text v-if="detailLoading" role="status" type="info">正在读取完整内容…</el-text>
            <el-alert v-if="detailError" :title="detailError" type="error" :closable="false"><el-button link type="primary" :disabled="disabled" @click="getDetail(lastDetailId)">重试</el-button></el-alert>
            <el-pagination v-if="active.total > 0" class="paper-library__pagination" :aria-label="`${label}分页`" size="small"
              layout="total, prev, pager, next" :pager-count="5" :total="active.total" :page-size="20" :current-page="active.page"
              :disabled="active.loading" @current-change="load(tab, $event)" />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { Plus, Search } from '@element-plus/icons-vue';
import SvgIcon from '../Tiptap/components/SvgIcon.vue';
import type {
  PaperDesignerValue, PaperLibrarySource, PaperLibrarySummary, QuestionLibrarySource, QuestionLibrarySummary,
} from './contracts';

type Tab = 'question' | 'paper';
type Summary = QuestionLibrarySummary | PaperLibrarySummary;
interface QueryState { keyword: string; query: string; page: number; total: number; items: Summary[]; loading: boolean; error: string; loaded: boolean; serial: number }
const props = withDefaults(defineProps<{
  questionSource?: QuestionLibrarySource; paperSource?: PaperLibrarySource; categoryId?: string;
  categories?: Array<{ id: string; name: string }>; disabled?: boolean; readonly?: boolean;
}>(), { categoryId: '', categories: () => [], disabled: false, readonly: false });
const emit = defineEmits<{
  'add-question': [type: 'single' | 'multiple' | 'judgment'];
  'insert-question': [value: Awaited<ReturnType<QuestionLibrarySource['get']>>];
  'use-paper': [value: PaperDesignerValue];
}>();
const types = [{ type: 'single' as const, label: '单选题' }, { type: 'multiple' as const, label: '多选题' }, { type: 'judgment' as const, label: '判断题' }];
const tab = ref<Tab>('question'); const selected = ref('');
const empty = (): QueryState => ({ keyword: '', query: '', page: 1, total: 0, items: [], loading: false, error: '', loaded: false, serial: 0 });
const queries = reactive({ question: empty(), paper: empty() });
const active = computed(() => queries[tab.value]);
const label = computed(() => tab.value === 'question' ? '试题库' : '试卷库');
const detailLoading = ref(false); const detailError = ref(''); let detailSerial = 0; let lastDetailId = '';
function categoryName(id: string) { return props.categories.find((category) => category.id === id)?.name || id; }
function typeLabel(type: string) { return ({ single: '单选题', multiple: '多选题', judgment: '判断题' } as Record<string, string>)[type] || type; }
function itemTitle(item: Summary) { return 'stem' in item ? item.stem.replace(/<[^>]*>/g, '').trim() : item.title; }
function invalidateDetail() { detailSerial += 1; detailLoading.value = false; detailError.value = ''; }
async function load(kind: Tab, page: number) {
  const state = queries[kind]; const ticket = ++state.serial;
  state.page = page; state.error = '';
  if (kind === 'question' && !props.categoryId) { state.items = []; state.total = 0; state.loading = false; return; }
  const source = kind === 'question' ? props.questionSource : props.paperSource;
  if (!source) { state.items = []; state.total = 0; state.loading = false; state.loaded = true; return; }
  state.loading = true;
  try {
    const input = { keyword: state.query || undefined, page, page_size: 20 };
    const result = kind === 'question'
      ? await props.questionSource!.list({ ...input, category_id: props.categoryId })
      : await props.paperSource!.list(input);
    if (ticket !== state.serial) return;
    state.items = result.items; state.total = result.total; state.page = result.page; state.loaded = true;
  } catch (failure) { if (ticket === state.serial) state.error = failure instanceof Error ? failure.message : '加载失败，请重试'; }
  finally { if (ticket === state.serial) state.loading = false; }
}
function search() { active.value.query = active.value.keyword.trim(); void load(tab.value, 1); }
function switchTab(kind: Tab) {
  if (kind === tab.value) return;
  invalidateDetail(); selected.value = ''; tab.value = kind;
  if (!queries[kind].loaded && !queries[kind].loading) void load(kind, queries[kind].page);
}
async function getDetail(id: string) {
  if (props.readonly || props.disabled || detailLoading.value) return;
  const kind = tab.value; const ticket = ++detailSerial; lastDetailId = id;
  detailLoading.value = true; detailError.value = '';
  try {
    if (kind === 'question') {
      if (!props.questionSource || !props.categoryId) return;
      const result = await props.questionSource.get(id);
      if (ticket === detailSerial && !props.readonly && !props.disabled) emit('insert-question', result);
    } else {
      if (!props.paperSource) return;
      const result = await props.paperSource.get(id);
      if (ticket === detailSerial && !props.readonly && !props.disabled) emit('use-paper', result);
    }
  } catch (failure) { if (ticket === detailSerial) detailError.value = failure instanceof Error ? failure.message : '完整内容读取失败'; }
  finally { if (ticket === detailSerial) detailLoading.value = false; }
}
watch(() => [props.categoryId, props.questionSource], () => {
  invalidateDetail(); queries.question.serial += 1; queries.question.loaded = false; queries.question.items = []; queries.question.total = 0; queries.question.page = 1;
  if (tab.value === 'question') void load('question', 1);
}, { immediate: true });
watch(() => props.paperSource, () => { queries.paper.serial += 1; queries.paper.loaded = false; if (tab.value === 'paper') void load('paper', 1); });
watch(() => [props.disabled, props.readonly], () => { if (props.disabled || props.readonly) invalidateDetail(); });
onBeforeUnmount(() => { invalidateDetail(); queries.question.serial += 1; queries.paper.serial += 1; });
</script>

<style scoped>
.paper-library { display:flex; flex-direction:column; width:280px; height:100%; min-width:0; min-height:0; background:#fff; overflow:hidden; }
.paper-library h2 { font-size:12px; font-weight:400; line-height:32px; color:#7a8794; margin:0; }
.paper-library__search { display:flex; align-items:center; flex:0 0 32px; height:32px; margin:12px 16px; box-sizing:border-box; }
.paper-library__search .el-input { width:100%; height:32px; --el-input-height:32px; --el-input-border-color:var(--re-border, #e6eaee); }
.paper-library__search :deep(.el-input__wrapper) { min-height:32px; padding:0 10px; background:var(--re-surface, #fff); }
.paper-library__search-action { width:20px; height:24px; padding:0; margin:0; font-size:16px; }
.paper-library__tabs { display:flex; flex-direction:column; flex:1; min-height:0; --el-text-color-primary:#7a8794; }
.paper-library__tabs :deep(.el-tabs__header) { flex:0 0 40px; height:40px; margin:0; padding:0 16px; }
.paper-library__tabs :deep(.el-tabs__nav-wrap::after) { height:1px; background:#e6eaee; }
.paper-library__tabs :deep(.el-tabs__item) { height:40px; padding:0 12px; }
.paper-library__tabs :deep(.el-tabs__item.is-active) { font-weight:700; }
.paper-library__tabs :deep(.el-tabs__content) { flex:1; min-height:0; }
.paper-library__tabs :deep(.el-tab-pane) { height:100%; }
.paper-library__pane { display:flex; flex-direction:column; height:100%; min-height:0; }
.paper-library__content { flex:1; min-width:0; overflow:auto; padding:4px 12px; }
.paper-library__new { flex:0 0 auto; padding:8px 16px 16px; border-bottom:1px solid #e6eaee; }
.paper-library__new > div { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
.paper-library__new .el-button { width:100%; height:32px; min-width:0; margin:0; padding:0 8px; border-radius:2px; font-size:12px; white-space:nowrap; --el-button-border-color:#d9dbe3; }
.paper-library__new .svg-icon { margin-right:4px; font-size:14px; color:#8d959e; }
.paper-library__results { display:flex; flex-direction:column; gap:8px; padding:0; margin:0; list-style:none; }
.paper-library__results li { display:flex; flex-direction:column; gap:8px; min-width:0; padding:12px; border:1px solid var(--re-border, #e6eaee); border-radius:var(--el-border-radius-small, 6px); background:var(--re-surface, #fff); transition:border-color .15s,box-shadow .15s; }
.paper-library__results li:hover,.paper-library__results li.is-selected { border-color:color-mix(in srgb, var(--re-primary, #3056d3) 40%, transparent); box-shadow:0 2px 8px #1a253214; }
.paper-library__summary { width:100%; max-width:100%; min-width:0; height:auto; padding:0; justify-content:flex-start; text-align:left; white-space:normal; font-size:13px; line-height:1.5; }
.paper-library__summary :deep(> span) { width:100%; max-width:100%; min-width:0; }
.paper-library__summary:hover { background:transparent; }
.paper-library__excerpt { display:-webkit-box; width:100%; max-width:100%; min-width:0; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; white-space:normal; overflow-wrap:anywhere; line-height:1.5; }
.paper-library__meta { display:flex; align-items:center; gap:8px; min-width:0; }
.paper-library__type-tag { flex:none; height:auto; padding:1px 6px; border:0; border-radius:3px; background:var(--el-color-primary-light-9, #edf0fc); color:var(--re-primary, #3056d3); font-size:11px; line-height:16px; }
.paper-library__detail,.paper-library__category { color:var(--re-text-3); font-size:11px; line-height:16px; }
.paper-library__detail { flex:none; }
.paper-library__category { flex:1; min-width:0; }
.paper-library__actions { display:flex; align-items:center; }
.paper-library__insert { width:auto; height:auto; margin:0; padding:0; font-size:12px; line-height:18px; box-shadow:none; transform:none; }
.paper-library__insert:hover,.paper-library__insert:focus,.paper-library__insert:active { box-shadow:none; transform:none; }
.paper-library__pagination { flex-wrap:wrap; gap:4px; padding-top:8px; overflow:auto; }
</style>
