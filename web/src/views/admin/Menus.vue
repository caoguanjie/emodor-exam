<template>
  <section class="page-card">
    <FitsTable>
      <template #search>
        <FitsListSearch @submit.prevent>
          <el-form-item label="模糊搜索"><el-input v-model="keyword" maxlength="255" placeholder="菜单名称 / URL / 权限标识" clearable @keyup.enter="searchMenus" @clear="searchMenus" /></el-form-item>
          <template #actions><el-button type="primary" @click="searchMenus">查询</el-button><el-button @click="resetSearch">重置</el-button></template>
        </FitsListSearch>
      </template>
      <template #actions>
        <el-button v-if="canRead && canCreate" type="primary" :disabled="writeBusy" @click="openCreate">新增菜单</el-button>
        <el-button v-if="canRead && rows.length" @click="toggleExpanded">{{ expanded ? '收起全部' : '展开全部' }}</el-button>
      </template>
      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false"><el-button link @click="load">重试</el-button></el-alert>
      <el-table ref="tableRef" v-loading="loading" :data="visibleRows" row-key="id" :tree-props="{ children: 'children' }" :default-expand-all="expanded" :empty-text="appliedKeyword ? '未找到匹配的菜单' : '暂无菜单配置'">
        <el-table-column prop="name" label="名称" min-width="180" show-overflow-tooltip />
        <el-table-column label="图标" width="70" align="center"><template #default="{ row }"><el-icon v-if="row.icon" :title="row.icon"><component :is="iconFor(row.icon)" /></el-icon><span v-else>—</span></template></el-table-column>
        <el-table-column label="类型" width="80" align="center"><template #default="{ row }"><el-tag :type="row.type === 'directory' ? 'info' : row.type === 'button' ? 'warning' : 'primary'">{{ typeLabel[row.type as MenuType] }}</el-tag></template></el-table-column>
        <el-table-column label="上级菜单" min-width="120" show-overflow-tooltip><template #default="{ row }">{{ parentName(row.parent_id) }}</template></el-table-column>
        <el-table-column prop="sort" label="排序" width="70" align="center" />
        <el-table-column label="菜单URL" min-width="180" show-overflow-tooltip><template #default="{ row }">{{ row.route_path || '—' }}</template></el-table-column>
        <el-table-column label="权限标识" min-width="180" show-overflow-tooltip><template #default="{ row }">{{ row.permission_code || '—' }}</template></el-table-column>
        <el-table-column label="状态" width="80" align="center"><template #default="{ row }"><el-tag :type="row.status === 1 ? 'success' : 'info'">{{ row.status === 1 ? '正常' : '禁用' }}</el-tag></template></el-table-column>
        <el-table-column v-if="canRead && (canUpdate || canDelete)" label="操作" width="130" align="center" fixed="right">
          <template #default="{ row }"><FitsTableActions class="menu-row-actions"><FitsTableAction v-if="canUpdate" type="primary" :disabled="writeBusy" @click="openEdit(row)">修改</FitsTableAction><FitsTableAction v-if="canDelete" type="danger" :disabled="writeBusy" @click="remove(row)">删除</FitsTableAction></FitsTableActions></template>
        </el-table-column>
      </el-table>
    </FitsTable>

    <el-dialog v-model="dialogVisible" :title="form.id ? '修改菜单' : '新增菜单'" width="min(640px, calc(100% - 32px))" align-center :append-to="contentDialogTarget || 'body'" class="re-form-dialog menu-dialog" :before-close="beforeDialogClose">
      <el-alert v-if="dialogError" :title="dialogError" type="error" show-icon :closable="false" class="menu-dialog-error" />
      <el-form v-loading="formLoading" label-width="96px" :disabled="saving || formLoading">
        <el-form-item label="菜单名称" required><el-input v-model="form.name" maxlength="128" placeholder="请输入菜单名称" /></el-form-item>
        <el-form-item label="类型" required><el-radio-group v-model="form.type"><el-radio-button value="directory">目录</el-radio-button><el-radio-button value="menu">菜单</el-radio-button><el-radio-button value="button">按钮</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="所属菜单"><el-tree-select v-model="form.parent_id" :data="parentOptions" clearable check-strictly node-key="value" :props="{ label: 'label', children: 'children' }" placeholder="请选择所属菜单，留空为根菜单" style="width:100%" /></el-form-item>
        <el-form-item v-if="form.type === 'menu'" label="菜单URL" required><el-select v-model="form.route_path" filterable placeholder="请选择已注册的菜单URL" style="width:100%"><el-option v-for="path in routeOptions" :key="path" :label="path" :value="path" /></el-select></el-form-item>
        <el-form-item v-if="form.type !== 'directory'" label="权限标识" :required="form.type === 'button'"><el-select v-model="form.permission_code" clearable filterable placeholder="请选择已注册权限" style="width:100%"><el-option v-for="item in permissionOptions" :key="item.code" :label="item.name + '（' + item.code + '）'" :value="item.code" /></el-select></el-form-item>
        <el-form-item label="图标"><el-input v-model="form.icon" placeholder="如 Setting、User，可留空" maxlength="64"><template #prefix><el-icon v-if="form.icon"><component :is="iconFor(form.icon)" /></el-icon></template></el-input></el-form-item>
        <el-form-item label="排序" required><el-input-number v-model="form.sort" :min="0" :max="100000" :precision="0" controls-position="right" placeholder="请输入排序值" /></el-form-item>
        <el-form-item label="状态" required><el-radio-group v-model="form.status"><el-radio :value="1">正常</el-radio><el-radio :value="0">禁用</el-radio></el-radio-group></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="saving" @click="closeDialog">取消</el-button><el-button v-if="canRead && (form.id ? canUpdate : canCreate)" type="primary" :loading="saving" :disabled="saving || formLoading || loading || !!dialogError" @click="save">保存</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch, type Component, type Ref } from 'vue';
import { ElMessage, ElMessageBox, type TableInstance } from 'element-plus';
import {
  AlarmClock, CollectionTag, Cpu, DataAnalysis, Document, DocumentChecked, EditPen,
  Grid, Menu as MenuIcon, Medal, Monitor, Notebook, OfficeBuilding,
  Picture, Reading, Setting, SetUp, Tickets, User, UserFilled,
} from '@element-plus/icons-vue';
import http from '../../api/http';
import { FitsTable, FitsListSearch, FitsTableActions, FitsTableAction } from '../../components/FitsTable';
import { useAuthStore } from '../../stores/auth';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';

type MenuType = 'directory' | 'menu' | 'button';
interface MenuForm {
  id: string; parent_id: string | null; name: string; type: MenuType;
  route_path: string | null; permission_code: string | null; icon: string | null; sort: number; status: number;
}
interface MenuRow extends MenuForm { children?: MenuRow[] }
interface TreeOption { value: string; label: string; children?: TreeOption[] }
interface PermissionOption { code: string; name: string }
const routeOptions = [
  '/admin/dashboard', '/admin/students', '/admin/training-categories', '/admin/courses',
  '/admin/questions', '/admin/papers', '/admin/questions/import', '/admin/exam-records',
  '/admin/training-statistics', '/admin/ai-config', '/admin/administrators', '/admin/roles',
  '/admin/sessions', '/admin/system/menus', '/admin/system/dictionaries',
  '/admin/system/site-settings', '/admin/system/audit-logs',
];
const typeLabel: Record<MenuType, string> = { directory: '目录', menu: '菜单', button: '按钮' };
const iconMap: Record<string, Component> = {
  AlarmClock, CollectionTag, Cpu, DataAnalysis, Document, DocumentChecked, EditPen, Grid,
  Menu: MenuIcon, Medal, Monitor, Notebook, OfficeBuilding, Picture, Reading, Setting, SetUp, Tickets, User, UserFilled,
};
function iconFor(name: string) { return Object.hasOwn(iconMap, name) ? iconMap[name] : Setting; }
const auth = useAuthStore();
const contentDialogTarget = inject<Ref<HTMLElement | undefined>>('contentDialogTarget', ref());
const canRead = computed(() => auth.can('menus:read'));
const canCreate = computed(() => auth.can('menus:create'));
const canUpdate = computed(() => auth.can('menus:update'));
const canDelete = computed(() => auth.can('menus:delete'));
function hasWriteAccess(permission: 'menus:create' | 'menus:update' | 'menus:delete') { return auth.can('menus:read') && auth.can(permission); }
const rows = ref<MenuRow[]>([]);
const keyword = ref('');
const appliedKeyword = ref('');
const visibleRows = computed<MenuRow[]>(() => {
  const query = appliedKeyword.value.toLowerCase();
  if (!query) return rows.value;
  const filter = (items: MenuRow[]): MenuRow[] => items.flatMap((item) => {
    if ([item.name, item.route_path, item.permission_code].some((value) => value?.toLowerCase().includes(query))) return [item];
    const children = filter(item.children || []);
    return children.length ? [{ ...item, children }] : [];
  });
  return filter(rows.value);
});
const tableRef = ref<TableInstance>();
const expanded = ref(true);
const loading = ref(false);
const saving = ref(false);
const removingId = ref<string | null>(null);
const deleteConfirmPending = ref(false);
const writeBusy = computed(() => saving.value || removingId.value !== null || deleteConfirmPending.value);
const error = ref('');
const dialogVisible = ref(false);
const formLoading = ref(false);
const dialogError = ref('');
const dirty = ref(false);
const permissionOptions = ref<PermissionOption[]>([]);
function emptyForm(): MenuForm {
  return { id: '', parent_id: null, name: '', type: 'menu', route_path: null, permission_code: null, icon: null, sort: 0, status: 1 };
}
const form = reactive<MenuForm>(emptyForm());
const formBaseline = ref<MenuForm>(emptyForm());
let pageActive = true;
let listRequest = 0;
let draftVersion = 0;
let deleteRequest = 0;

const parentOptions = computed<TreeOption[]>(() => {
  const convert = (items: MenuRow[]): TreeOption[] => items
    .filter((item) => item.type !== 'button' && String(item.id) !== form.id)
    .map((item) => ({ value: String(item.id), label: item.name, children: convert(item.children || []) }));
  return convert(rows.value);
});
const menuNames = computed(() => {
  const result = new Map<string, string>();
  function collect(items: MenuRow[]) {
    for (const item of items) { result.set(String(item.id), item.name); collect(item.children || []); }
  }
  collect(rows.value);
  return result;
});
function parentName(id: string | null) { return id ? menuNames.value.get(String(id)) || '—' : '—'; }
function setRowsExpanded(items: MenuRow[], value: boolean) {
  for (const item of items) {
    if (item.children?.length) { tableRef.value?.toggleRowExpansion(item, value); setRowsExpanded(item.children, value); }
  }
}
async function searchMenus() {
  if (!pageActive || !auth.can('menus:read')) return;
  appliedKeyword.value = keyword.value.trim();
  expanded.value = true;
  await nextTick();
  setRowsExpanded(visibleRows.value, true);
}
function resetSearch() { keyword.value = ''; return searchMenus(); }
function toggleExpanded() {
  expanded.value = !expanded.value;
  setRowsExpanded(visibleRows.value, expanded.value);
}
function reset(row?: MenuRow) {
  const value: MenuForm = row ? {
    id: String(row.id), parent_id: row.parent_id ? String(row.parent_id) : null, name: row.name,
    type: row.type, route_path: row.route_path || null, permission_code: row.permission_code || null,
    icon: row.icon || null, sort: row.sort, status: row.status,
  } : emptyForm();
  formBaseline.value = { ...value };
  Object.assign(form, value);
  dirty.value = false;
}
function discardForm() {
  dialogVisible.value = false;
  formLoading.value = false;
  dialogError.value = '';
  Object.assign(form, formBaseline.value);
  dirty.value = false;
}
function pendingWriteNotice() { ElMessage.warning('正在保存，请稍候'); }
const unsaved = useUnsavedChanges(dirty, { onDiscard: discardForm, canDiscard: () => !saving.value, onBlocked: pendingWriteNotice });
watch([form, dialogVisible, saving], () => {
  dirty.value = dialogVisible.value && (saving.value || JSON.stringify(form) !== JSON.stringify(formBaseline.value));
}, { deep: true, flush: 'sync' });
function currentDraft(version: number) { return pageActive && version === draftVersion && dialogVisible.value; }
async function prepareOpen(permission: 'menus:create' | 'menus:update') {
  if (!pageActive || !hasWriteAccess(permission) || writeBusy.value) return null;
  const version = ++draftVersion;
  if (dialogVisible.value && !await unsaved.confirmDiscard(() => pageActive && version === draftVersion && !writeBusy.value)) return null;
  if (!pageActive || version !== draftVersion || !hasWriteAccess(permission)) return null;
  discardForm();
  return version;
}
async function closeDialog() {
  if (saving.value) { pendingWriteNotice(); return false; }
  const version = draftVersion;
  if (!await unsaved.confirmDiscard(() => pageActive && version === draftVersion)) return false;
  draftVersion += 1;
  discardForm();
  return true;
}
async function beforeDialogClose(done: () => void) { if (await closeDialog()) done(); }

async function load() {
  if (!pageActive || !auth.can('menus:read')) return;
  const request = ++listRequest;
  loading.value = true;
  error.value = '';
  try {
    const value = await http.get<MenuRow[], MenuRow[]>('/admin/menus');
    if (pageActive && request === listRequest && auth.can('menus:read')) rows.value = value;
  } catch (failure: unknown) {
    if (pageActive && request === listRequest) error.value = failure instanceof Error ? failure.message : '菜单加载失败';
  } finally { if (request === listRequest) loading.value = false; }
}
async function openCreate() {
  const version = await prepareOpen('menus:create');
  if (version === null) return;
  reset();
  dialogVisible.value = true;
  formLoading.value = true;
  try {
    const options = await http.get<PermissionOption[], PermissionOption[]>('/admin/menus/permission-options');
    if (currentDraft(version) && hasWriteAccess('menus:create')) permissionOptions.value = options;
  } catch (failure: unknown) {
    if (currentDraft(version)) dialogError.value = failure instanceof Error ? failure.message : '权限选项加载失败';
  } finally { if (currentDraft(version)) formLoading.value = false; }
}
async function openEdit(row: MenuRow) {
  if (!row.id) return;
  const version = await prepareOpen('menus:update');
  if (version === null) return;
  reset({ ...emptyForm(), id: String(row.id) });
  dialogVisible.value = true;
  formLoading.value = true;
  try {
    const [detail, options] = await Promise.all([
      http.get<MenuRow, MenuRow>('/admin/menus/' + encodeURIComponent(String(row.id))),
      http.get<PermissionOption[], PermissionOption[]>('/admin/menus/permission-options'),
    ]);
    if (!currentDraft(version) || !hasWriteAccess('menus:update')) return;
    permissionOptions.value = options;
    reset(detail);
  } catch (failure: unknown) {
    if (currentDraft(version)) dialogError.value = failure instanceof Error ? failure.message : '菜单详情加载失败';
  } finally { if (currentDraft(version)) formLoading.value = false; }
}
function validParent(id: string | null) {
  if (!id) return true;
  function contains(items: TreeOption[]): boolean { return items.some((item) => item.value === id || contains(item.children || [])); }
  return contains(parentOptions.value);
}
function buildPayload() {
  if (!form.name.trim() || form.name.trim().length > 128) { ElMessage.warning('请输入 1—128 字的菜单名称'); return null; }
  if (!['directory', 'menu', 'button'].includes(form.type)) { ElMessage.warning('请选择菜单类型'); return null; }
  if (!validParent(form.parent_id)) { ElMessage.warning('请选择有效的所属菜单，不能选择自身或下级菜单'); return null; }
  if (!Number.isInteger(form.sort) || form.sort < 0 || form.sort > 100000) { ElMessage.warning('排序须为 0—100000 的整数'); return null; }
  if (form.status !== 0 && form.status !== 1) { ElMessage.warning('请选择正常或禁用状态'); return null; }
  const routePath = form.type === 'menu' ? form.route_path : null;
  const permission = form.type === 'directory' ? null : form.permission_code || null;
  if (form.type === 'menu' && (!routePath || !routeOptions.includes(routePath))) { ElMessage.warning('请选择已注册的菜单URL'); return null; }
  if ((form.type === 'button' && !permission) || (permission && !permissionOptions.value.some((item) => item.code === permission))) {
    ElMessage.warning('请选择已注册的权限标识');
    return null;
  }
  const icon = form.icon?.trim() || null;
  if (icon && !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(icon)) { ElMessage.warning('图标须为有效的 Element Plus 图标名称'); return null; }
  return {
    parent_id: form.parent_id || null, name: form.name.trim(), type: form.type,
    route_path: routePath, permission_code: permission, icon, sort: form.sort, status: form.status,
  };
}
function notifyMenuChange() { window.dispatchEvent(new CustomEvent('re:admin-menus-changed')); }
async function save() {
  const id = formBaseline.value.id;
  if (!pageActive || !hasWriteAccess(id ? 'menus:update' : 'menus:create') || !dialogVisible.value || saving.value || formLoading.value || loading.value || dialogError.value || removingId.value !== null) return;
  const payload = buildPayload();
  if (!payload) return;
  const version = draftVersion;
  saving.value = true;
  try {
    if (id) await http.put('/admin/menus/' + encodeURIComponent(id), payload);
    else await http.post('/admin/menus', payload);
    notifyMenuChange();
    if (!currentDraft(version)) return;
    dialogVisible.value = false;
    formBaseline.value = { ...form };
    unsaved.markClean();
    ElMessage.success('菜单已保存');
    await load();
  } finally { saving.value = false; }
}
async function remove(row: MenuRow) {
  if (!pageActive || !hasWriteAccess('menus:delete') || !row.id || writeBusy.value) return;
  const request = ++deleteRequest;
  const id = String(row.id);
  deleteConfirmPending.value = true;
  try {
    try {
      await ElMessageBox.confirm('确定删除“' + row.name + '”吗？存在子项或角色引用时不能删除。', '删除菜单', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
    } catch { return; }
    if (!pageActive || request !== deleteRequest || !hasWriteAccess('menus:delete')) return;
    removingId.value = id;
    await http.delete('/admin/menus/' + encodeURIComponent(id));
    notifyMenuChange();
    if (!pageActive || request !== deleteRequest) return;
    ElMessage.success('菜单已删除');
    await load();
  } catch (failure: unknown) {
    if (pageActive && request === deleteRequest) error.value = failure instanceof Error ? failure.message : '删除菜单失败';
  } finally {
    if (request === deleteRequest) deleteConfirmPending.value = false;
    if (removingId.value === id) removingId.value = null;
  }
}
function invalidatePage() {
  pageActive = false;
  listRequest += 1;
  draftVersion += 1;
  deleteRequest += 1;
  loading.value = false;
  deleteConfirmPending.value = false;
  discardForm();
}
onMounted(load);
onActivated(() => {
  const returning = !pageActive;
  pageActive = true;
  if (returning) void load();
});
onDeactivated(invalidatePage);
onBeforeUnmount(invalidatePage);
</script>

<style scoped>
.menu-row-actions { justify-content: center; flex-wrap: nowrap; gap: 6px; }
.menu-dialog-error { margin-bottom: 16px; }
.menu-dialog :deep(.el-dialog__body) { max-height: 70vh; overflow-y: auto; }
</style>
