<template>
  <section class="page-card dictionaries-page">
    <aside class="dictionary-categories" aria-label="字典分类">
      <div class="dictionary-categories__heading">
        <h2>字典分类</h2>
        <span v-if="typesReady" class="category-total">{{ categories.length }} 类</span>
      </div>
      <div class="dictionary-categories__search">
        <el-input v-model="categoryKeyword" aria-label="搜索字典分类" placeholder="搜索字典分类" :prefix-icon="Search" clearable />
        <el-button v-if="canWrite" circle text class="dictionary-category-add" aria-label="新增字典分类" title="新增字典分类" :disabled="writePending" @click="openCreateCategory"><el-icon><CirclePlus /></el-icon></el-button>
      </div>
      <div v-if="typesError || categoryActionError" class="dictionary-error dictionary-error--categories" role="alert">
        <span>{{ typesError || categoryActionError }}</span>
        <el-button v-if="typesError" link type="primary" aria-label="重试加载字典分类" @click="retryTypes">重试</el-button>
      </div>
      <nav v-loading="typesLoading" class="dictionary-categories__list" aria-label="选择字典分类" :aria-busy="typesLoading">
        <button type="button" class="dictionary-category dictionary-category--all" data-dictionary-type="" :class="{ 'is-selected': typesReady && !selectedType }" :aria-pressed="typesReady && !selectedType" @click="selectType('')">
          <span>全部字典</span><span v-if="typesReady" class="dictionary-category__count">{{ itemCount }}</span>
        </button>
        <el-tree ref="categoryTree" class="dictionary-category-tree" :data="visibleCategories" node-key="type" :props="{ label: 'label' }" :indent="0" highlight-current :current-node-key="selectedType || undefined" :expand-on-click-node="false" :empty-text="typesError || typesLoading ? ' ' : categoryKeyword.trim() ? '没有匹配的分类' : '暂无字典分类'" @node-click="onCategoryClick" @keydown.enter.prevent="onCategoryKeySelect" @keydown.space.prevent="onCategoryKeySelect">
          <template #default="{ data }">
            <span class="dictionary-tree-node" :data-dictionary-type="data.type">
              <span class="dictionary-tree-node__label" :title="data.label">{{ data.label }}</span>
              <span class="dictionary-category__count">{{ data.count }}</span>
              <span v-if="canWrite" class="dictionary-tree-node__actions" @click.stop @keydown.stop>
                <el-dropdown trigger="click" placement="bottom-end" @command="(command: string) => onCategoryCommand(command, data)">
                  <el-button text circle size="small" :aria-label="'管理分类' + data.label" :title="'管理分类' + data.label" :disabled="writePending"><el-icon><MoreFilled /></el-icon></el-button>
                  <template #dropdown>
                    <el-dropdown-menu :data-category-menu="data.type">
                      <el-dropdown-item command="edit" data-category-action="edit">编辑</el-dropdown-item>
                      <el-dropdown-item command="delete" data-category-action="delete" :disabled="!!categoryDeleteReason(data)"><span class="dictionary-category-menu__item"><span>删除</span><small v-if="categoryDeleteReason(data)">{{ categoryDeleteReason(data) }}</small></span></el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </span>
            </span>
          </template>
        </el-tree>
      </nav>
    </aside>

    <section class="dictionary-detail" aria-labelledby="dictionary-detail-title">
      <header class="dictionary-detail__heading">
        <div class="dictionary-detail__title"><h2 id="dictionary-detail-title">{{ selectedCategory?.label || '全部字典' }}</h2></div>
        <p v-if="selectedCategory?.description" class="dictionary-detail__category-description">{{ selectedCategory.description }}</p>
        <p class="dictionary-detail__description">{{ selectedCategory?.is_system ? '内置分类的字典项只读；分类名称和描述可按权限编辑。' : '内置字典项只读，自定义分类和字典项可按权限维护。' }}</p>
      </header>
      <FitsTable>
        <template #search>
          <FitsListSearch class="dictionary-search" label-width="56px" @submit.prevent>
            <el-form-item label="关键词"><el-input v-model="filters.keyword" aria-label="字典项关键词" placeholder="输入名称或编码" maxlength="128" clearable @keyup.enter="search" /></el-form-item>
            <el-form-item label="状态"><el-select v-model="filters.status" aria-label="字典状态"><el-option label="全部" value="all" /><el-option label="启用" :value="1" /><el-option label="停用" :value="0" /></el-select></el-form-item>
            <template #actions><el-button type="primary" :disabled="!typesReady" @click="search">查询</el-button><el-button :disabled="!typesReady" @click="resetQuery">重置</el-button></template>
          </FitsListSearch>
        </template>
        <template v-if="canWrite" #actions><el-button type="primary" @click="openCreate"><el-icon><Plus /></el-icon><span>新增字典项</span></el-button></template>
        <div v-if="error || actionError" class="dictionary-error" role="alert">
          <span>{{ error || actionError }}</span><el-button v-if="error" link type="primary" aria-label="重试加载字典项" @click="load">重试</el-button>
        </div>
        <el-table v-loading="loading" :data="items" :aria-busy="loading" row-key="id">
          <template #empty><el-empty v-if="typesReady && !loading && !error" description="暂无符合条件的字典项" /></template>
          <el-table-column prop="label" label="显示名称" min-width="150" show-overflow-tooltip />
          <el-table-column v-if="!selectedType" label="类型" min-width="165" show-overflow-tooltip><template #default="{ row }">{{ categories.find(category => category.type === row.type)?.label || '未命名分类' }}</template></el-table-column>
          <el-table-column prop="code" label="编码" min-width="140" show-overflow-tooltip />
          <el-table-column prop="sort" label="排序" width="72" />
          <el-table-column label="属性" width="90"><template #default="{ row }"><el-tag :type="row.is_system ? 'info' : 'primary'" effect="plain">{{ row.is_system ? '固定' : '自定义' }}</el-tag></template></el-table-column>
          <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status ? 'success' : 'info'">{{ row.status ? '启用' : '停用' }}</el-tag></template></el-table-column>
          <el-table-column label="备注" min-width="160" show-overflow-tooltip><template #default="{ row }">{{ row.remark || '—' }}</template></el-table-column>
          <el-table-column label="操作" width="126" fixed="right"><template #default="{ row }"><span v-if="row.is_system" class="dictionary-readonly">只读</span><FitsTableActions v-else-if="canWrite"><FitsTableAction type="primary" :disabled="saving || !!deletingId" @click="openEdit(row)">编辑</FitsTableAction><FitsTableAction type="danger" :disabled="saving || !!deletingId" :loading="deletingId === row.id" @click="remove(row)">删除</FitsTableAction></FitsTableActions><span v-else class="dictionary-readonly">—</span></template></el-table-column>
        </el-table>
        <template #pagination><el-pagination :current-page="page" :page-size="pageSize" :total="total" :page-sizes="[10,20,50,100]" layout="total, sizes, prev, pager, next" :disabled="!typesReady" @current-change="changePage" @size-change="changePageSize" /></template>
      </FitsTable>
    </section>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑字典项' : '新增自定义字典项'" width="520px" class="re-form-dialog dictionary-form-dialog" :before-close="beforeDialogClose" :close-on-click-modal="false" destroy-on-close>
      <p class="dictionary-form-hint">请选择已有的自定义分类；如需新分类，请先在左侧新增。内置分类的字典项只读。</p>
      <div v-if="formError" class="dictionary-error" role="alert">{{ formError }}</div>
      <el-form label-width="110px" :disabled="saving" @submit.prevent>
        <el-form-item label="分类" required><el-select v-model="form.type" aria-label="字典类型" filterable placeholder="请选择字典分类"><el-option v-for="category in customCategories" :key="category.type" :label="category.label" :value="category.type" /></el-select></el-form-item>
        <el-form-item label="分类编码"><el-input :model-value="form.type" class="dictionary-category-code" aria-label="分类编码" readonly placeholder="选择分类后自动显示" /></el-form-item>
        <el-form-item label="字典项名称" required><el-input v-model="form.label" aria-label="字典项名称" maxlength="128" placeholder="请输入字典项名称" /></el-form-item>
        <el-form-item label="字典项编码" required><el-input v-model="form.code" aria-label="字典项编码" maxlength="64" placeholder="如 notice_email" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" :max="100000" :precision="0" /></el-form-item>
        <el-form-item label="状态"><el-radio-group v-model="form.status"><el-radio :value="1">启用</el-radio><el-radio :value="0">停用</el-radio></el-radio-group></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" aria-label="字典备注" type="textarea" :rows="2" maxlength="255" show-word-limit /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="saving" @click="closeDialog">取消</el-button><el-button type="primary" :loading="saving" :disabled="!canWrite" @click="save">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="categoryDialogVisible" :title="categoryForm.type ? '编辑字典分类' : '新增字典分类'" width="520px" class="re-form-dialog dictionary-category-dialog" :before-close="beforeCategoryDialogClose" :close-on-click-modal="false" destroy-on-close>
      <p v-if="categoryCreationHint" class="dictionary-form-hint">{{ categoryCreationHint }}</p>
      <div v-if="categoryFormError" class="dictionary-error" role="alert">{{ categoryFormError }}</div>
      <el-form label-width="90px" :disabled="categorySaving" @submit.prevent>
        <el-form-item label="分类名称" required><el-input v-model="categoryForm.label" aria-label="字典分类名称" placeholder="请输入分类名称" maxlength="128" show-word-limit /></el-form-item>
        <el-form-item label="分类描述"><el-input v-model="categoryForm.description" aria-label="字典分类描述" type="textarea" placeholder="请输入分类描述" :rows="4" maxlength="255" show-word-limit /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="categorySaving" @click="closeCategoryDialog">取消</el-button><el-button type="primary" :loading="categorySaving" :disabled="!canWrite" @click="saveCategory">保存</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { CirclePlus, MoreFilled, Plus, Search } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox, type TreeInstance } from 'element-plus';
import { FitsTable, FitsListSearch, FitsTableActions, FitsTableAction } from '../../components/FitsTable';
import http from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { createLatestRequestScope } from '../../utils/latest-request-scope';

interface DictionaryRow { id: string; type: string; code: string; label: string; sort: number; status: number; is_system: boolean; remark: string | null }
interface DictionaryCategory { type: string; label: string; description: string | null; sort: number; count: number; is_system: boolean }
interface CategoryForm { type: string; label: string; description: string }
interface DictionaryForm { id: string; type: string; code: string; label: string; sort: number; status: number; remark: string }
interface DictionaryPage { items: DictionaryRow[]; total: number }
interface CategoryPage { items: DictionaryCategory[]; total: number }
type StatusFilter = 'all' | 0 | 1;

const fixedTypes = new Set(['question_type', 'difficulty', 'learner_source', 'paper_status', 'exam_status', 'question_status', 'regulation_status']);
const auth = useAuthStore();
const canWrite = computed(() => auth.can('system_settings:write'));
const categories = ref<DictionaryCategory[]>([]);
const categoryTree = ref<TreeInstance>();
const categoryKeyword = ref('');
const selectedType = ref('');
const typesReady = ref(false);
const typesLoading = ref(false);
const typesError = ref('');
const selectedCategory = computed(() => categories.value.find(category => category.type === selectedType.value));
const visibleCategories = computed(() => {
  const keyword = categoryKeyword.value.trim().toLowerCase();
  return categories.value.filter(category => !keyword || category.label.toLowerCase().includes(keyword) || category.type.toLowerCase().includes(keyword));
});
const customCategories = computed(() => categories.value.filter(category => !category.is_system && !fixedTypes.has(category.type)));
const itemCount = computed(() => categories.value.reduce((sum, category) => sum + category.count, 0));
const items = ref<DictionaryRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const filters = reactive({ keyword: '', status: 'all' as StatusFilter });
let appliedFilters = { keyword: '', status: 'all' as StatusFilter };
const loading = ref(false);
const error = ref('');
const actionError = ref('');
const saving = ref(false);
const deletingId = ref('');
const dialogVisible = ref(false);
const formError = ref('');
const dirty = ref(false);
const form = reactive<DictionaryForm>({ id: '', type: '', code: '', label: '', sort: 0, status: 1, remark: '' });
let formBaseline: DictionaryForm = { ...form };
const categoryDialogVisible = ref(false);
const categorySaving = ref(false);
const deletingCategoryType = ref('');
const categoryFormError = ref('');
const categoryActionError = ref('');
const categoryCreationHint = ref('');
const categoryDirty = ref(false);
const categoryForm = reactive<CategoryForm>({ type: '', label: '', description: '' });
let categoryBaseline: CategoryForm = { ...categoryForm };
const writePending = computed(() => saving.value || categorySaving.value || !!deletingId.value || !!deletingCategoryType.value);
let active = false;
let selectionInitialized = false;
let listScope = createLatestRequestScope();
let typeScope = createLatestRequestScope();
let activation = 0;

const unsaved = useUnsavedChanges(dirty, { onDiscard: discardForm, canDiscard: () => !saving.value });
const categoryUnsaved = useUnsavedChanges(categoryDirty, { onDiscard: discardCategoryForm, canDiscard: () => !categorySaving.value });
watch(form, () => { if (dialogVisible.value) dirty.value = JSON.stringify(form) !== JSON.stringify(formBaseline); }, { deep: true, flush: 'sync' });
watch(categoryForm, () => { if (categoryDialogVisible.value) categoryDirty.value = JSON.stringify(categoryForm) !== JSON.stringify(categoryBaseline); }, { deep: true, flush: 'sync' });
watch([visibleCategories, selectedType], async () => {
  await nextTick();
  categoryTree.value?.setCurrentKey(selectedType.value || undefined, false);
  // ElTree initializes tab stops before the asynchronous catalog arrives.
  const treeElement = categoryTree.value?.$el as HTMLElement | undefined;
  const nodes = Array.from(treeElement?.querySelectorAll<HTMLElement>('.el-tree-node[role="treeitem"]') || []);
  const tabTarget = nodes.find(node => node.dataset.key === selectedType.value) || nodes[0];
  for (const node of nodes) node.tabIndex = node === tabTarget ? 0 : -1;
});

function clearFilters() {
  filters.keyword = ''; filters.status = 'all';
  appliedFilters = { keyword: '', status: 'all' };
  page.value = 1;
}
function updateSelection(type: string) {
  if (selectedType.value === type) return;
  selectedType.value = type;
  clearFilters();
  items.value = []; total.value = 0; error.value = ''; actionError.value = '';
}
async function loadTypes(preferredType?: string) {
  if (!active || !auth.can('system_settings:read')) return false;
  const ticket = typeScope.begin();
  const selectionAtStart = selectedType.value;
  typesLoading.value = true; typesError.value = '';
  try {
    const data = await http.get<never, CategoryPage>('/admin/dictionaries/types', { signal: ticket.signal });
    if (!ticket.isCurrent()) return false;
    const previousIndex = categories.value.findIndex(category => category.type === selectedType.value);
    categories.value = data.items;
    if (preferredType && selectedType.value === selectionAtStart && data.items.some(category => category.type === preferredType)) updateSelection(preferredType);
    else if (!selectionInitialized) updateSelection(data.items[0]?.type || '');
    else if (selectedType.value && !data.items.some(category => category.type === selectedType.value)) {
      updateSelection(data.items[Math.min(Math.max(previousIndex, 0), data.items.length - 1)]?.type || '');
    }
    selectionInitialized = true; typesReady.value = true;
    return true;
  } catch (cause) {
    if (ticket.isCurrent() && !ticket.signal.aborted) typesError.value = cause instanceof Error ? cause.message : '字典分类加载失败，请重试';
    return false;
  } finally {
    if (ticket.isCurrent()) typesLoading.value = false;
    ticket.finish();
  }
}
async function load() {
  if (!active || !typesReady.value || !auth.can('system_settings:read')) return;
  const ticket = listScope.begin();
  const requestedType = selectedType.value;
  const isCurrent = () => ticket.isCurrent() && selectedType.value === requestedType;
  loading.value = true; error.value = '';
  const params = {
    page: page.value, page_size: pageSize.value,
    ...(selectedType.value ? { type: selectedType.value } : {}),
    ...(appliedFilters.keyword ? { keyword: appliedFilters.keyword } : {}),
    ...(appliedFilters.status !== 'all' ? { status: appliedFilters.status } : {}),
  };
  try {
    const data = await http.get<never, DictionaryPage>('/admin/dictionaries', { params, signal: ticket.signal });
    if (!isCurrent()) return;
    const finalPage = Math.max(1, Math.ceil(data.total / pageSize.value));
    if (page.value > finalPage) { page.value = finalPage; await load(); return; }
    items.value = data.items; total.value = data.total;
  } catch (cause) {
    if (isCurrent() && !ticket.signal.aborted) error.value = cause instanceof Error ? cause.message : '字典项加载失败，请重试';
  } finally {
    if (isCurrent()) loading.value = false;
    ticket.finish();
  }
}
async function retryTypes() {
  const before = selectedType.value;
  const wasReady = typesReady.value;
  if (await loadTypes() && (!wasReady || before !== selectedType.value)) await load();
}
function selectType(type: string) {
  if (!active || !typesReady.value || !auth.can('system_settings:read') || selectedType.value === type) return;
  updateSelection(type);
  return load();
}
function onCategoryClick(category: DictionaryCategory) { return selectType(category.type); }
function onCategoryKeySelect(event: KeyboardEvent) {
  const target = event.target;
  if (target instanceof HTMLElement && target.matches('.el-tree-node[role="treeitem"]') && target.dataset.key) return selectType(target.dataset.key);
}
function categoryDeleteReason(category: DictionaryCategory) {
  if (category.is_system || fixedTypes.has(category.type)) return '内置分类不可删除';
  return category.count > 0 ? '请先删除分类下的字典项' : '';
}
function onCategoryCommand(command: string, category: DictionaryCategory) {
  if (command === 'edit') openEditCategory(category);
  else if (command === 'delete') return removeCategory(category);
}
function resetCategoryForm(category?: DictionaryCategory) {
  categoryBaseline = { type: category?.type || '', label: category?.label || '', description: category?.description || '' };
  Object.assign(categoryForm, categoryBaseline);
  categoryFormError.value = ''; categoryCreationHint.value = ''; categoryDirty.value = false;
}
function discardCategoryForm() {
  categoryDialogVisible.value = false;
  Object.assign(categoryForm, categoryBaseline);
  categoryFormError.value = ''; categoryDirty.value = false;
}
function openCreateCategory() {
  if (!active || !auth.can('system_settings:write') || writePending.value || dialogVisible.value) return;
  resetCategoryForm(); categoryDialogVisible.value = true;
}
function openEditCategory(category: DictionaryCategory) {
  if (!active || !auth.can('system_settings:write') || writePending.value || dialogVisible.value) return;
  resetCategoryForm(category); categoryDialogVisible.value = true;
}
async function beforeCategoryDialogClose(done: () => void) {
  if (categorySaving.value) return;
  if (await categoryUnsaved.confirmDiscard()) { categoryDialogVisible.value = false; done(); }
}
async function closeCategoryDialog() {
  if (!categorySaving.value && await categoryUnsaved.confirmDiscard()) categoryDialogVisible.value = false;
}
function upsertCategory(category: DictionaryCategory) {
  categories.value = [...categories.value.filter(item => item.type !== category.type), category]
    .sort((left, right) => left.sort - right.sort || left.type.localeCompare(right.type));
}
async function saveCategory() {
  if (!active || !auth.can('system_settings:write') || !categoryDialogVisible.value || writePending.value) return;
  const type = categoryForm.type;
  const payload = { label: categoryForm.label.trim(), description: categoryForm.description.trim() || null };
  categoryFormError.value = '';
  if (!payload.label) { categoryFormError.value = '请填写分类名称'; return; }
  if (payload.label.length > 128 || (payload.description?.length || 0) > 255) { categoryFormError.value = '分类名称最多 128 字，描述最多 255 字'; return; }
  categorySaving.value = true;
  try {
    const saved = type
      ? await http.put<never, DictionaryCategory>(`/admin/dictionaries/types/${encodeURIComponent(type)}`, payload)
      : await http.post<never, DictionaryCategory>('/admin/dictionaries/types', payload);
    categoryDirty.value = false; categoryDialogVisible.value = false;
    if (!active) return;
    const previousType = selectedType.value;
    upsertCategory(saved);
    if (!type) { categoryKeyword.value = ''; updateSelection(saved.type); }
    ElMessage.success(type ? '字典分类已保存' : '字典分类已新增');
    await loadTypes(type ? undefined : saved.type);
    if (!type || previousType !== selectedType.value) await load();
  } catch (cause) {
    if (active) categoryFormError.value = cause instanceof Error ? cause.message : '分类保存失败，请重试';
  } finally { categorySaving.value = false; }
}
async function removeCategory(category: DictionaryCategory) {
  const current = categories.value.find(item => item.type === category.type);
  if (!active || !auth.can('system_settings:write') || writePending.value || !current || categoryDeleteReason(current)) return;
  deletingCategoryType.value = current.type; categoryActionError.value = '';
  try {
    try {
      await ElMessageBox.confirm(`确定删除“${current.label}”分类吗？`, '删除字典分类', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
    } catch { return; }
    const latest = categories.value.find(item => item.type === current.type);
    if (!active || !auth.can('system_settings:write') || !latest) return;
    if (categoryDeleteReason(latest)) { categoryActionError.value = categoryDeleteReason(latest); return; }
    await http.delete(`/admin/dictionaries/types/${encodeURIComponent(current.type)}`);
    if (!active) return;
    const previousType = selectedType.value;
    const index = categories.value.findIndex(item => item.type === current.type);
    categories.value = categories.value.filter(item => item.type !== current.type);
    if (previousType === current.type) updateSelection(categories.value[Math.min(index, categories.value.length - 1)]?.type || '');
    ElMessage.success('字典分类已删除');
    await loadTypes();
    if (previousType !== selectedType.value) await load();
  } catch (cause) {
    if (active) categoryActionError.value = cause instanceof Error ? cause.message : '分类删除失败，请重试';
  } finally { deletingCategoryType.value = ''; }
}
function search() {
  if (!auth.can('system_settings:read')) return;
  appliedFilters = { keyword: filters.keyword.trim(), status: filters.status };
  filters.keyword = appliedFilters.keyword;
  page.value = 1; actionError.value = '';
  return load();
}
function resetQuery() { clearFilters(); actionError.value = ''; return load(); }
function changePage(nextPage: number) {
  if (nextPage === page.value) return;
  page.value = nextPage;
  return load();
}
function changePageSize(nextPageSize: number) {
  if (nextPageSize === pageSize.value) return;
  pageSize.value = nextPageSize; page.value = 1;
  return load();
}
function resetForm(row?: DictionaryRow) {
  formBaseline = row
    ? { id: row.id, type: row.type, code: row.code, label: row.label, sort: row.sort, status: row.status, remark: row.remark || '' }
    : { id: '', type: selectedCategory.value && !selectedCategory.value.is_system && !fixedTypes.has(selectedType.value) ? selectedType.value : '', code: '', label: '', sort: 0, status: 1, remark: '' };
  Object.assign(form, formBaseline); formError.value = ''; dirty.value = false;
}
function discardForm() { dialogVisible.value = false; Object.assign(form, formBaseline); formError.value = ''; dirty.value = false; }
function openCreate() {
  if (!active || !auth.can('system_settings:write') || writePending.value || categoryDialogVisible.value) return;
  if (!customCategories.value.length) { openCreateCategory(); categoryCreationHint.value = '请先新增字典分类，再添加字典项。'; return; }
  resetForm(); dialogVisible.value = true;
}
function openEdit(row: DictionaryRow) {
  if (!active || !auth.can('system_settings:write') || row.is_system || fixedTypes.has(row.type) || writePending.value || categoryDialogVisible.value) return;
  resetForm(row); dialogVisible.value = true;
}
async function beforeDialogClose(done: () => void) {
  if (saving.value) return;
  if (await unsaved.confirmDiscard()) { dialogVisible.value = false; done(); }
}
async function closeDialog() {
  if (!saving.value && await unsaved.confirmDiscard()) dialogVisible.value = false;
}
async function save() {
  if (!active || !auth.can('system_settings:write') || !dialogVisible.value || writePending.value) return;
  const payload = { type: form.type.trim(), code: form.code.trim(), label: form.label.trim(), sort: form.sort, status: form.status, remark: form.remark.trim() || null };
  formError.value = '';
  if (!payload.type || !payload.code || !payload.label) { formError.value = '请填写分类、字典项名称和字典项编码'; return; }
  if (fixedTypes.has(payload.type) || categories.value.some(category => category.type === payload.type && category.is_system) || (form.id && fixedTypes.has(formBaseline.type))) { formError.value = '内置分类的字典项只读，请选择自定义分类'; return; }
  if (!customCategories.value.some(category => category.type === payload.type)) { formError.value = '请选择已有的自定义分类；如需新分类，请先在左侧新增'; return; }
  if (!/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(payload.code)) { formError.value = '编码须以小写字母或数字开头，可包含下划线、点或短横线，最长 64 位'; return; }
  if (!Number.isInteger(payload.sort) || payload.sort < 0 || payload.sort > 100000) { formError.value = '排序须为 0 至 100000 的整数'; return; }
  saving.value = true;
  try {
    if (form.id) await http.put(`/admin/dictionaries/${form.id}`, payload);
    else await http.post('/admin/dictionaries', payload);
    dirty.value = false; dialogVisible.value = false;
    if (!active) return;
    ElMessage.success('字典项已保存');
    clearFilters();
    const catalogUpdated = await loadTypes(payload.type);
    if (!catalogUpdated) updateSelection(payload.type);
    await load();
  } catch (cause) {
    if (active) formError.value = cause instanceof Error ? cause.message : '保存失败，请重试';
  } finally { saving.value = false; }
}
async function remove(row: DictionaryRow) {
  if (!active || !auth.can('system_settings:write') || row.is_system || fixedTypes.has(row.type) || writePending.value) return;
  deletingId.value = row.id; actionError.value = '';
  try {
    try {
      await ElMessageBox.confirm(`确定删除“${row.label}”吗？已被业务引用的字典项无法删除。`, '删除字典项', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
    } catch { return; }
    if (!active || !auth.can('system_settings:write')) return;
    await http.delete(`/admin/dictionaries/${row.id}`);
    if (!active) return;
    ElMessage.success('已删除');
    await loadTypes();
    await load();
  } catch (cause) {
    if (active) actionError.value = cause instanceof Error ? cause.message : '删除失败，请重试';
  } finally { deletingId.value = ''; }
}
function activate() {
  if (active) return;
  active = true; listScope = createLatestRequestScope(); typeScope = createLatestRequestScope();
  const currentActivation = ++activation;
  void (async () => {
    const catalogUpdated = await loadTypes();
    if (active && currentActivation === activation && (catalogUpdated || typesReady.value)) await load();
  })();
}
function deactivate() {
  active = false; activation += 1; listScope.stop(); typeScope.stop();
  loading.value = false; typesLoading.value = false;
}
onMounted(activate); onActivated(activate); onDeactivated(deactivate); onUnmounted(deactivate);
</script>

<style scoped>
.dictionary-category-code :deep(.el-input__wrapper){background:var(--el-fill-color-light)}
.dictionary-category-code :deep(.el-input__inner){color:var(--re-text-3);font-family:var(--re-mono);font-size:12px}
.page-card.dictionaries-page{display:grid;grid-template-columns:240px minmax(0,1fr);gap:0;padding:0;min-width:0;max-width:100%;min-height:520px;overflow:hidden}
.dictionary-categories{display:flex;flex-direction:column;min-width:0;padding:20px 16px;border-right:1px solid var(--re-border)}
.dictionary-categories__heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:16px}
.dictionary-categories__heading h2,.dictionary-detail__title h2{margin:0;font-size:16px;font-weight:600;color:var(--re-text);line-height:1.5}
.category-total{font-size:12px;color:var(--re-text-3)}
.dictionary-categories__search{display:flex;align-items:center;gap:6px;min-width:0}
.dictionary-categories__search>.el-input{min-width:0;flex:1}
.dictionary-category-add{flex:none;margin:0;color:var(--re-primary);font-size:20px}
.dictionary-categories__list{display:flex;flex-direction:column;gap:4px;min-height:160px;max-height:calc(100vh - 288px);overflow-y:auto;overscroll-behavior:contain;margin-top:16px;padding:2px}
.dictionary-category{display:flex;align-items:center;justify-content:space-between;flex:none;width:100%;gap:10px;padding:10px 12px;border:0;border-radius:6px;background:transparent;text-align:left;color:var(--re-text-2);font:inherit;font-size:14px;line-height:1.5;cursor:pointer}
.dictionary-category:hover{background:var(--re-bg);color:var(--re-text)}
.dictionary-category.is-selected{background:var(--el-color-primary-light-9);color:var(--re-primary);font-weight:500}
.dictionary-category:focus-visible{outline:2px solid var(--re-primary);outline-offset:-2px}
.dictionary-category--all{margin-bottom:4px}
.dictionary-category-tree{flex:none;min-width:0;background:transparent;--el-tree-node-hover-bg-color:var(--re-bg)}
.dictionary-category-tree :deep(.el-tree-node__content){height:40px;border-radius:6px;padding-right:4px}
.dictionary-category-tree :deep(.el-tree-node__expand-icon.is-leaf){display:none}
.dictionary-category-tree :deep(.el-tree-node.is-current>.el-tree-node__content){background:var(--el-color-primary-light-9);color:var(--re-primary)}
.dictionary-category-tree :deep(.el-tree-node:focus-visible>.el-tree-node__content){outline:2px solid var(--re-primary);outline-offset:-2px}
.dictionary-tree-node{display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding-left:12px;font-size:14px;line-height:1.5}
.dictionary-tree-node__label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dictionary-tree-node__actions{display:inline-flex;align-items:center;flex:none}
.dictionary-tree-node__actions .el-button{margin:0;color:var(--re-text-3);font-size:14px}
.dictionary-category-menu__item{display:flex;flex-direction:column;gap:2px;line-height:1.6}
.dictionary-category-menu__item small{font-size:11px;color:var(--re-text-3)}
.dictionary-category__count{flex:none;min-width:20px;text-align:right;font-size:12px;color:var(--re-text-3);font-variant-numeric:tabular-nums}
.is-selected .dictionary-category__count{color:var(--re-primary)}
.dictionary-detail{min-width:0;padding:20px 24px 16px;overflow:hidden}
.dictionary-detail__heading{margin-bottom:20px}
.dictionary-detail__title{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px 12px;min-width:0}
.dictionary-detail__category-description{margin:6px 0 0;color:var(--re-text-2);font-size:13px;line-height:1.6;overflow-wrap:anywhere}
.dictionary-detail__description{margin:6px 0 0;color:var(--re-text-3);font-size:12px;line-height:1.6}
.dictionary-search{grid-template-columns:minmax(220px,1.5fr) minmax(150px,1fr) auto;gap:12px 16px}
.dictionary-search :deep(.el-form-item:not(.fits-list-search__actions)>.el-form-item__content){max-width:none}
.dictionary-search :deep(.fits-list-search__actions>.el-form-item__content){flex-wrap:nowrap}
.dictionary-readonly{color:var(--re-text-3);font-size:13px}
.dictionary-error{display:flex;align-items:center;flex-wrap:wrap;gap:4px 12px;margin-bottom:12px;color:var(--re-danger);font-size:13px;line-height:1.6}
.dictionary-error--categories{margin:12px 0 0;font-size:12px}
.dictionary-form-hint{margin:0 0 18px;color:var(--re-text-3);font-size:12px;line-height:1.7}
.dictionary-form-dialog :deep(.el-select){width:100%}
@media(max-width:1200px){.dictionary-search{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)}.dictionary-search :deep(.fits-list-search__actions){grid-column:1/-1}}
@media(max-width:900px){.page-card.dictionaries-page{grid-template-columns:minmax(0,1fr)}.dictionary-categories{padding:16px;border-right:0;border-bottom:1px solid var(--re-border)}.dictionary-categories__heading{margin-bottom:12px}.dictionary-categories__search{max-width:400px}.dictionary-categories__list{min-height:0;max-height:220px;margin-top:12px}.dictionary-category--all{margin-bottom:0}.dictionary-detail{padding:20px 16px 16px}}
@media(max-width:560px){.dictionary-search{grid-template-columns:minmax(0,1fr)}.dictionary-detail__heading{margin-bottom:16px}.dictionary-categories__list{max-height:180px}}
</style>
