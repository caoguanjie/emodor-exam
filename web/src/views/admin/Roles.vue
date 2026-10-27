<template>
  <div class="page-card">
    <FitsTable>
      <template #search>
        <FitsListSearch @submit.prevent>
          <el-form-item label="角色名称"><el-input v-model="query.keyword" maxlength="128" placeholder="请输入角色名称" clearable @keyup.enter="searchRoles" /></el-form-item>
          <template #actions><el-button type="primary" @click="searchRoles">查询</el-button></template>
        </FitsListSearch>
      </template>
      <template v-if="auth.can('roles:create')" #actions><el-button type="primary" :disabled="writeBusy" @click="openCreate">新增角色</el-button></template>
      <el-table v-loading="loading" :data="roles">
        <template #empty><el-empty v-if="!loading" description="暂无角色" /></template>
        <el-table-column prop="name" label="角色名称" min-width="180" show-overflow-tooltip />
        <el-table-column label="备注" min-width="240" show-overflow-tooltip><template #default="{ row }">{{ row.remark || '—' }}</template></el-table-column>
        <el-table-column label="创建时间" min-width="170"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column>
        <el-table-column label="状态" width="90" align="center"><template #default="{ row }"><el-tag :type="row.status === 1 ? 'success' : 'info'">{{ row.status === 1 ? '启用' : '停用' }}</el-tag></template></el-table-column>
        <el-table-column v-if="showOperations" label="操作" width="230" align="center" fixed="right">
          <template #default="{ row }">
            <FitsTableActions class="role-actions">
              <FitsTableAction v-if="auth.can('roles:permissions')" type="primary" :disabled="writeBusy" @click="openPermissions(row)">权限设置</FitsTableAction>
              <FitsTableAction v-if="auth.can('roles:update')" type="primary" :disabled="writeBusy || row.is_system" @click="openEdit(row)">修改</FitsTableAction>
              <FitsTableAction v-if="auth.can('roles:delete')" type="danger" :disabled="writeBusy || row.is_system" @click="deleteRole(row)">删除</FitsTableAction>
            </FitsTableActions>
          </template>
        </el-table-column>
      </el-table>
      <template #pagination><el-pagination v-model:current-page="query.page" layout="total, prev, pager, next" :total="total" :page-size="query.page_size" @current-change="load" /></template>
    </FitsTable>

    <el-dialog v-model="dialog" :title="form.id ? '修改角色' : '新增角色'" width="min(600px, calc(100% - 32px))" class="re-form-dialog role-dialog" :before-close="beforeDialogClose">
      <el-form v-loading="detailLoading" label-width="90px" :disabled="saving || detailLoading">
        <el-form-item label="角色名称" required><el-input v-model="form.name" maxlength="128" placeholder="请输入角色名称" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="请输入备注" /></el-form-item>
        <el-form-item v-if="form.id" label="状态"><el-radio-group v-model="form.status"><el-radio :value="1">启用</el-radio><el-radio :value="0">停用</el-radio></el-radio-group></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="saving" @click="closeDialog">取消</el-button><el-button v-if="auth.can(form.id ? 'roles:update' : 'roles:create')" type="primary" :loading="saving" :disabled="saving || detailLoading" @click="save">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="permissionsDialog" title="权限设置" width="min(720px, calc(100% - 32px))" class="re-form-dialog role-dialog" :before-close="beforePermissionsDialogClose">
      <div class="permission-heading">{{ permissionTarget?.name }}<span v-if="permissionTarget?.is_system" class="permission-note">系统角色仅支持查看权限</span></div>
      <div class="permission-tools">
        <el-button :disabled="permissionLoading" @click="setTreeExpanded(true)">展开</el-button>
        <el-button :disabled="permissionLoading" @click="setTreeExpanded(false)">收起</el-button>
        <el-button :disabled="!canSavePermissions" @click="clearPermissions">清空权限</el-button>
      </div>
      <div v-loading="permissionLoading" class="permission-tree">
        <el-tree ref="permissionTreeRef" :data="permissionTree" node-key="id" show-checkbox default-expand-all :expand-on-click-node="false" :props="treeProps" @check="handlePermissionCheck">
          <template #default="{ data }"><span class="permission-label">{{ data.label }}<span v-if="data.status === 0" class="permission-note">（停用）</span></span></template>
        </el-tree>
      </div>
      <template #footer><el-button :disabled="permissionSaving" @click="closePermissionsDialog">取消</el-button><el-button v-if="auth.can('roles:permissions')" type="primary" :loading="permissionSaving" :disabled="!canSavePermissions" @click="savePermissions">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox, type TreeInstance } from 'element-plus';
import http from '../../api/http';
import { FitsTable, FitsListSearch, FitsTableActions, FitsTableAction } from '../../components/FitsTable';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { useAuthStore } from '../../stores/auth';
import { buildRolePermissionTree, getRolePermissionCheckedKeys, updateRolePermissionSelection, type RolePermissionNode, type RolePermissionTreeResponse } from '../../utils/role-permission-tree';

interface RoleRow {
  id: string;
  code: string;
  name: string;
  remark: string | null;
  created_at: string | null;
  updated_at: string | null;
  is_system: boolean;
  status: number;
  permissions: string[];
}
interface RolePage { items: RoleRow[]; total: number; page: number; page_size: number }
interface RoleForm { id: string; name: string; remark: string; status: number }

const auth = useAuthStore();
const roles = ref<RoleRow[]>([]);
const query = reactive({ page: 1, page_size: 10, keyword: '' });
const total = ref(0);
const loading = ref(false);
const dialog = ref(false);
const detailLoading = ref(false);
const saving = ref(false);
const form = reactive<RoleForm>(emptyForm());
const formBaseline = ref<RoleForm>(emptyForm());
const editTarget = ref<RoleRow | null>(null);
const dirty = ref(false);
const permissionsDialog = ref(false);
const permissionTarget = ref<RoleRow | null>(null);
const permissionTree = ref<RolePermissionNode[]>([]);
const permissionTreeRef = ref<TreeInstance>();
const selectedPermissions = ref<string[]>([]);
const permissionBaseline = ref<string[]>([]);
const permissionLoading = ref(false);
const permissionSaving = ref(false);
const permissionDirty = ref(false);
const deletePendingId = ref<string | null>(null);
const deletingId = ref<string | null>(null);
const writeBusy = computed(() => saving.value || permissionSaving.value || deletePendingId.value !== null || deletingId.value !== null);
const showOperations = computed(() => ['roles:update', 'roles:delete', 'roles:permissions'].some((code) => auth.can(code)));
const canSavePermissions = computed(() => auth.can('roles:permissions') && !!permissionTarget.value && !permissionTarget.value.is_system && !permissionLoading.value && !writeBusy.value);
const treeProps = { label: 'label', children: 'children', disabled: (node: RolePermissionNode) => !canSavePermissions.value || !!node.disabled };
let pageActive = true;
let listRequest = 0;
let entryRequest = 0;

function emptyForm(): RoleForm { return { id: '', name: '', remark: '', status: 1 }; }
function canEditRole(row: RoleRow | null) { return !!row && !row.is_system && auth.can('roles:update'); }
function canDeleteRole(row: RoleRow) { return !row.is_system && auth.can('roles:delete'); }
function currentEntry(request: number) { return pageActive && request === entryRequest; }
function formatTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
function fillForm(value: RoleForm) { Object.assign(form, value); formBaseline.value = { ...value }; dirty.value = false; }
function discardDraft() { dialog.value = false; detailLoading.value = false; Object.assign(form, formBaseline.value); dirty.value = false; }
function discardPermissions() { permissionsDialog.value = false; permissionLoading.value = false; selectedPermissions.value = [...permissionBaseline.value]; permissionDirty.value = false; }
function pendingWriteNotice() { ElMessage.warning('正在保存，请稍候'); }
const unsaved = useUnsavedChanges(dirty, { onDiscard: discardDraft, canDiscard: () => !saving.value, onBlocked: pendingWriteNotice });
const permissionUnsaved = useUnsavedChanges(permissionDirty, { onDiscard: discardPermissions, canDiscard: () => !permissionSaving.value, onBlocked: pendingWriteNotice });
watch([form, dialog, saving], () => {
  dirty.value = dialog.value && (saving.value || JSON.stringify(form) !== JSON.stringify(formBaseline.value));
}, { deep: true, flush: 'sync' });
watch([selectedPermissions, permissionsDialog, permissionSaving], () => {
  permissionDirty.value = permissionsDialog.value && (permissionSaving.value || JSON.stringify(selectedPermissions.value) !== JSON.stringify(permissionBaseline.value));
}, { deep: true, flush: 'sync' });

async function prepareEntry(permission: string) {
  if (!pageActive || !auth.can(permission) || writeBusy.value) return null;
  const request = ++entryRequest;
  const isCurrent = () => currentEntry(request) && auth.can(permission) && !writeBusy.value;
  if (dialog.value && !await unsaved.confirmDiscard(isCurrent)) return null;
  if (permissionsDialog.value && !await permissionUnsaved.confirmDiscard(isCurrent)) return null;
  if (!isCurrent()) return null;
  discardDraft();
  discardPermissions();
  return request;
}
async function closeDialog() {
  if (saving.value) { pendingWriteNotice(); return false; }
  const request = entryRequest;
  if (!await unsaved.confirmDiscard(() => currentEntry(request))) return false;
  entryRequest += 1;
  discardDraft();
  return true;
}
async function beforeDialogClose(done: () => void) { if (await closeDialog()) done(); }
async function closePermissionsDialog() {
  if (permissionSaving.value) { pendingWriteNotice(); return false; }
  const request = entryRequest;
  if (!await permissionUnsaved.confirmDiscard(() => currentEntry(request))) return false;
  entryRequest += 1;
  discardPermissions();
  return true;
}
async function beforePermissionsDialogClose(done: () => void) { if (await closePermissionsDialog()) done(); }

async function load() {
  if (!pageActive || !auth.can('roles:read')) return;
  const request = ++listRequest;
  loading.value = true;
  try {
    const data: RolePage = await http.get('/admin/roles', { params: { ...query, keyword: query.keyword.trim() } });
    if (!pageActive || request !== listRequest) return;
    roles.value = data.items;
    total.value = data.total;
  } finally { if (request === listRequest) loading.value = false; }
}
async function searchRoles() { query.page = 1; await load(); }
async function openCreate() {
  if (await prepareEntry('roles:create') === null) return;
  editTarget.value = null;
  fillForm(emptyForm());
  dialog.value = true;
}
async function openEdit(row: RoleRow) {
  if (!row.id || !canEditRole(row)) return;
  const request = await prepareEntry('roles:update');
  if (request === null) return;
  editTarget.value = row;
  fillForm({ id: String(row.id), name: row.name, remark: row.remark || '', status: row.status });
  dialog.value = true;
  detailLoading.value = true;
  try {
    const detail: RoleRow = await http.get('/admin/roles/' + encodeURIComponent(String(row.id)));
    if (!currentEntry(request) || !dialog.value) return;
    if (!canEditRole(detail)) { discardDraft(); return; }
    editTarget.value = detail;
    fillForm({ id: String(detail.id), name: detail.name, remark: detail.remark || '', status: detail.status });
  } catch (error) {
    if (currentEntry(request)) discardDraft();
    throw error;
  } finally { if (currentEntry(request)) detailLoading.value = false; }
}
async function save() {
  if (!pageActive || !dialog.value || detailLoading.value || writeBusy.value || !auth.can(form.id ? 'roles:update' : 'roles:create')) return;
  if (form.id && !canEditRole(editTarget.value)) return;
  if (!form.name.trim()) { ElMessage.warning('请输入角色名称'); return; }
  const draft = { ...form };
  const request = entryRequest;
  const body = { name: draft.name.trim(), remark: draft.remark.trim() };
  saving.value = true;
  try {
    if (draft.id) await http.put('/admin/roles/' + encodeURIComponent(draft.id), { ...body, status: draft.status });
    else await http.post('/admin/roles', body);
    if (!currentEntry(request) || !dialog.value) return;
    ElMessage.success('角色已保存');
    formBaseline.value = { ...draft };
    dialog.value = false;
    unsaved.markClean();
    await load();
  } finally { saving.value = false; }
}

async function syncTreeChecks() {
  await nextTick();
  if (permissionsDialog.value) permissionTreeRef.value?.setCheckedKeys(getRolePermissionCheckedKeys(permissionTree.value, selectedPermissions.value));
}
async function openPermissions(row: RoleRow) {
  if (!row.id) return;
  const request = await prepareEntry('roles:permissions');
  if (request === null) return;
  permissionTarget.value = row;
  permissionTree.value = [];
  selectedPermissions.value = [];
  permissionBaseline.value = [];
  permissionsDialog.value = true;
  permissionLoading.value = true;
  try {
    const [detail, response]: [RoleRow, RolePermissionTreeResponse] = await Promise.all([
      http.get<RoleRow, RoleRow>('/admin/roles/' + encodeURIComponent(String(row.id))),
      http.get<RolePermissionTreeResponse, RolePermissionTreeResponse>('/admin/roles/permission-tree'),
    ]);
    if (!currentEntry(request) || !permissionsDialog.value || !auth.can('roles:permissions')) return;
    permissionTarget.value = detail;
    permissionTree.value = buildRolePermissionTree(response);
    selectedPermissions.value = [...new Set(detail.permissions)].sort();
    permissionBaseline.value = [...selectedPermissions.value];
    permissionDirty.value = false;
    // Element Plus caches disabled leaves as effectively checked during setCheckedKeys.
    permissionLoading.value = false;
    await syncTreeChecks();
  } catch (error) {
    if (currentEntry(request)) discardPermissions();
    throw error;
  } finally { if (currentEntry(request)) permissionLoading.value = false; }
}
function handlePermissionCheck(node: RolePermissionNode, state: { checkedKeys: (string | number)[] }) {
  if (!pageActive || !permissionsDialog.value || !canSavePermissions.value) return;
  selectedPermissions.value = updateRolePermissionSelection(permissionTree.value, selectedPermissions.value, node.id, state.checkedKeys.includes(node.id));
  void syncTreeChecks();
}
function setTreeExpanded(expanded: boolean) {
  const visit = (nodes: RolePermissionNode[]) => nodes.forEach((node) => {
    const treeNode = permissionTreeRef.value?.getNode(node.id);
    if (treeNode) treeNode.expanded = expanded;
    if (node.children) visit(node.children);
  });
  visit(permissionTree.value);
}
function clearPermissions() {
  if (!pageActive || !permissionsDialog.value || !canSavePermissions.value) return;
  selectedPermissions.value = [];
  void syncTreeChecks();
}
async function savePermissions() {
  const target = permissionTarget.value;
  if (!pageActive || !permissionsDialog.value || !target || !canSavePermissions.value) return;
  const request = entryRequest;
  const permissions = [...new Set(selectedPermissions.value)].sort();
  permissionSaving.value = true;
  try {
    await http.put('/admin/roles/' + encodeURIComponent(String(target.id)) + '/permissions', { permissions });
    if (!currentEntry(request) || !permissionsDialog.value) return;
    ElMessage.success('角色权限已保存');
    permissionBaseline.value = permissions;
    permissionsDialog.value = false;
    permissionUnsaved.markClean();
    await load();
  } finally {
    permissionSaving.value = false;
    if (currentEntry(request) && permissionsDialog.value) await syncTreeChecks();
  }
}
async function deleteRole(row: RoleRow) {
  if (!row.id || !canDeleteRole(row)) return;
  const request = await prepareEntry('roles:delete');
  if (request === null) return;
  const id = String(row.id);
  deletePendingId.value = id;
  try {
    try { await ElMessageBox.confirm('确定删除角色“' + row.name + '”吗？已关联账号的角色不能删除。', '删除角色', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }); }
    catch { return; }
    if (!currentEntry(request) || !canDeleteRole(row)) return;
    deletingId.value = id;
    await http.delete('/admin/roles/' + encodeURIComponent(id));
    if (!currentEntry(request)) return;
    ElMessage.success('角色已删除');
    if (roles.value.length === 1 && query.page > 1) query.page -= 1;
    await load();
  } finally {
    if (currentEntry(request)) deletePendingId.value = null;
    if (deletingId.value === id) deletingId.value = null;
  }
}
function invalidatePage() {
  pageActive = false;
  listRequest += 1;
  entryRequest += 1;
  loading.value = false;
  deletePendingId.value = null;
  discardDraft();
  discardPermissions();
}
onMounted(load);
onActivated(() => { const returning = !pageActive; pageActive = true; if (returning) void load(); });
onDeactivated(invalidatePage);
onBeforeUnmount(invalidatePage);
</script>

<style scoped>
.role-actions { justify-content: center; flex-wrap: nowrap; gap: 4px; }
.role-dialog :deep(.el-dialog__body) { max-height: 70vh; overflow-y: auto; }
.permission-heading { font-weight: 500; margin-bottom: 14px; overflow-wrap: anywhere; }
.permission-note { color: var(--re-text-3); font-size: 12px; font-weight: 400; margin-left: 8px; }
.permission-tools { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.permission-tools :deep(.el-button + .el-button) { margin-left: 0; }
.permission-tree { min-height: 160px; max-height: 48vh; overflow: auto; border: 1px solid var(--el-border-color-light); border-radius: 6px; padding: 12px; }
.permission-tree :deep(.el-checkbox) { --el-checkbox-border-radius: 2px; }
.permission-label { line-height: 1.5; }
</style>
