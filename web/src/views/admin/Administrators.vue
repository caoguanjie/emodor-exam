<template>
  <div class="page-card">
    <FitsTable>
      <template #search>
        <FitsListSearch @submit.prevent>
          <el-form-item label="关键字"><el-input v-model="query.keyword" maxlength="128" placeholder="账号 / 姓名 / 手机号" clearable @keyup.enter="searchAdministrators" /></el-form-item>
          <template #actions><el-button type="primary" @click="searchAdministrators">查询</el-button></template>
        </FitsListSearch>
      </template>
      <template #actions>
        <el-button v-if="auth.can('administrators:create')" type="primary" :disabled="writeBusy" @click="openCreate">新增管理员</el-button>
      </template>
      <el-table v-loading="loading" :data="rows">
        <template #empty><el-empty v-if="!loading" description="暂无管理员" /></template>
        <el-table-column prop="username" label="账号" min-width="130" show-overflow-tooltip />
        <el-table-column label="姓名" min-width="100" show-overflow-tooltip><template #default="{ row }">{{ row.real_name || '—' }}</template></el-table-column>
        <el-table-column label="手机号" min-width="130"><template #default="{ row }">{{ row.phone || '—' }}</template></el-table-column>
        <el-table-column label="登录次数" width="90" align="center"><template #default="{ row }">{{ row.login_count ?? '—' }}</template></el-table-column>
        <el-table-column label="登录IP" min-width="135" show-overflow-tooltip><template #default="{ row }">{{ row.last_login_ip || '—' }}</template></el-table-column>
        <el-table-column label="状态" width="90" align="center"><template #default="{ row }"><el-tag :type="row.status === 1 ? 'success' : 'info'">{{ row.status === 1 ? '正常' : '禁用' }}</el-tag></template></el-table-column>
        <el-table-column label="最后登录时间" min-width="170"><template #default="{ row }">{{ formatTime(row.last_login_at) }}</template></el-table-column>
        <el-table-column label="创建时间" min-width="170"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column>
        <el-table-column v-if="auth.can('administrators:update') || auth.can('administrators:reset_password') || auth.can('administrators:delete')" label="操作" width="210" align="center" fixed="right">
          <template #default="{ row }">
            <FitsTableActions class="administrator-actions">
              <FitsTableAction v-if="auth.can('administrators:reset_password')" type="primary" :disabled="writeBusy || !canResetAdministrator(row)" @click="openResetPassword(row)">重置密码</FitsTableAction>
              <FitsTableAction v-if="auth.can('administrators:update')" type="primary" :disabled="writeBusy || !canEditAdministrator(row)" @click="openEdit(row)">修改</FitsTableAction>
              <FitsTableAction v-if="auth.can('administrators:delete')" type="danger" :disabled="writeBusy || !canDeleteAdministrator(row)" @click="deleteAdministrator(row)">删除</FitsTableAction>
            </FitsTableActions>
          </template>
        </el-table-column>
      </el-table>
      <template #pagination>
        <el-pagination v-model:current-page="query.page" layout="total, prev, pager, next" :total="total" :page-size="query.page_size" @current-change="load" />
      </template>
    </FitsTable>

    <el-dialog v-model="createDialog" :title="createForm.id ? '修改管理员' : '新增管理员'" width="min(600px, calc(100% - 32px))" class="re-form-dialog administrator-dialog" :before-close="beforeCreateDialogClose">
      <el-form v-loading="createLoading" label-width="96px" :disabled="createSaving || createLoading">
        <el-form-item label="账号" required><el-input v-model="createForm.username" :readonly="!!createForm.id" maxlength="64" autocomplete="off" /></el-form-item>
        <template v-if="!createForm.id">
          <el-form-item label="密码" required><el-input v-model="createForm.password" type="password" show-password maxlength="128" autocomplete="new-password" placeholder="8—128 位，含字母和数字" /></el-form-item>
          <el-form-item label="确认密码" required><el-input v-model="createForm.confirm_password" type="password" show-password maxlength="128" autocomplete="new-password" placeholder="请再次输入密码" /></el-form-item>
        </template>
        <el-form-item label="姓名"><el-input v-model="createForm.real_name" maxlength="64" /></el-form-item>
        <el-form-item label="手机号"><el-input v-model="createForm.phone" maxlength="20" inputmode="tel" /></el-form-item>
        <el-form-item v-if="createForm.system_role !== 'super_admin'" label="角色" required>
          <RoleSelect v-model="createForm.role_ids" :options="formRoleChoices" :loading="createLoading" :disabled="createSaving || createLoading" />
          <div v-if="!formRoleChoices.length && !createLoading" class="dialog-note">暂无可用业务角色，请先在角色权限中配置。</div>
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="createForm.status"><el-radio :value="1">正常</el-radio><el-radio :value="0" :disabled="!!createForm.id && !canDisableAdministrator(createBaseline)">禁用</el-radio></el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="createSaving" @click="closeCreateDialog">取消</el-button>
        <el-button v-if="auth.can(createForm.id ? 'administrators:update' : 'administrators:create')" type="primary" :loading="createSaving" :disabled="createSaving || createLoading" @click="createAdministrator">{{ createForm.id ? '保存' : '创建管理员' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resetDialog" title="重置密码" width="min(600px, calc(100% - 32px))" class="re-form-dialog administrator-dialog" :before-close="beforeResetDialogClose">
      <div class="dialog-note">重置账号 {{ resetTarget?.username }} 的密码后，该账号下次登录须修改密码。</div>
      <el-form label-width="96px" :disabled="resetSaving">
        <el-form-item label="新密码" required><el-input v-model="resetForm.password" type="password" show-password maxlength="128" autocomplete="new-password" placeholder="8—128 位，含字母和数字" /></el-form-item>
        <el-form-item label="确认密码" required><el-input v-model="resetForm.confirm_password" type="password" show-password maxlength="128" autocomplete="new-password" placeholder="请再次输入新密码" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="resetSaving" @click="closeResetDialog">取消</el-button><el-button v-if="auth.can('administrators:reset_password')" type="primary" :loading="resetSaving" :disabled="resetSaving" @click="saveResetPassword">重置密码</el-button></template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../../api/http';
import { FitsTable, FitsListSearch, FitsTableActions, FitsTableAction } from '../../components/FitsTable';
import RoleSelect from '../../components/RoleSelect.vue';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { useAuthStore } from '../../stores/auth';

interface AdministratorRow {
  id: string;
  username: string;
  real_name: string;
  phone: string | null;
  email: string | null;
  system_role: string;
  status: number;
  login_count: number | null;
  last_login_ip: string | null;
  last_login_at: string | null;
  created_at: string | null;
  role_ids: string[];
  permissions: string[];
}
interface AdministratorPage { items: AdministratorRow[]; total: number; page: number; page_size: number }
interface AssignableRole { id: string; code: string; name: string; status: number; is_system: boolean }
interface AdministratorForm {
  id: string;
  username: string;
  password: string;
  confirm_password: string;
  real_name: string;
  phone: string;
  system_role: string;
  status: number;
  role_ids: string[];
}

const auth = useAuthStore();
const rows = ref<AdministratorRow[]>([]);
const total = ref(0);
const query = reactive({ page: 1, page_size: 10, keyword: '' });
const roles = ref<AssignableRole[]>([]);
const loading = ref(false);
const editableRoles = computed(() => roles.value.filter((role) => !role.is_system && role.status === 1));
const createDialog = ref(false);
const createSaving = ref(false);
const createLoading = ref(false);
function emptyForm(): AdministratorForm {
  return { id: '', username: '', password: '', confirm_password: '', real_name: '', phone: '', system_role: 'employee', role_ids: [], status: 1 };
}
const createForm = reactive<AdministratorForm>(emptyForm());
const createBaseline = ref<AdministratorForm>(emptyForm());
const createDirty = ref(false);
const resetDialog = ref(false);
const resetSaving = ref(false);
const resetTarget = ref<AdministratorRow | null>(null);
const resetForm = reactive({ password: '', confirm_password: '' });
const resetDirty = ref(false);
const deletingId = ref<string | null>(null);
const deletePendingId = ref<string | null>(null);
const writeBusy = computed(() => createSaving.value || resetSaving.value || deletingId.value !== null || deletePendingId.value !== null);
let pageActive = true;
let listRequest = 0;
let entryRequest = 0;
let deleteRequest = 0;

function cloneForm(value: AdministratorForm): AdministratorForm { return { ...value, role_ids: [...value.role_ids] }; }
function canEditAdministrator(row: { system_role?: string }) {
  return auth.can('administrators:update') && (row.system_role !== 'super_admin' || auth.isSuperAdmin);
}
function isSelf(row: { id?: string }) { return String(row.id) === String(auth.user?.id); }
function canResetAdministrator(row: { id?: string; system_role?: string }) { return auth.can('administrators:reset_password') && (row.system_role !== 'super_admin' || auth.isSuperAdmin) && !isSelf(row); }
function canDeleteAdministrator(row: { id?: string; system_role?: string }) { return auth.can('administrators:delete') && !isSelf(row) && row.system_role !== 'super_admin'; }
function canDisableAdministrator(row: { id?: string; system_role?: string }) { return !isSelf(row) && row.system_role !== 'super_admin'; }
function formatTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
function roleChoices(existingIds: string[]) {
  const choices = editableRoles.value.map((role) => ({ id: String(role.id), name: role.name, code: role.code, unavailable: false }));
  const seen = new Set(choices.map((role) => role.id));
  for (const id of existingIds) {
    if (seen.has(id)) continue;
    const existing = roles.value.find((role) => String(role.id) === id);
    choices.push({ id, name: existing?.name || '已停用角色', code: existing?.code || '', unavailable: true });
    seen.add(id);
  }
  return choices;
}
const formRoleChoices = computed(() => roleChoices(createForm.id ? createBaseline.value.role_ids : []));

function discardCreateDraft() {
  createDialog.value = false;
  createLoading.value = false;
  Object.assign(createForm, cloneForm(createBaseline.value), { password: '', confirm_password: '' });
  createDirty.value = false;
}
function discardResetDraft() {
  resetDialog.value = false;
  Object.assign(resetForm, { password: '', confirm_password: '' });
  resetDirty.value = false;
}
function pendingWriteNotice() { ElMessage.warning('正在保存，请稍候'); }
const createUnsaved = useUnsavedChanges(createDirty, { onDiscard: discardCreateDraft, canDiscard: () => !createSaving.value, onBlocked: pendingWriteNotice });
const resetUnsaved = useUnsavedChanges(resetDirty, { onDiscard: discardResetDraft, canDiscard: () => !resetSaving.value, onBlocked: pendingWriteNotice });
watch([createForm, createDialog, createSaving], () => {
  createDirty.value = createDialog.value && (createSaving.value || JSON.stringify(createForm) !== JSON.stringify(createBaseline.value));
}, { deep: true, flush: 'sync' });
watch([resetForm, resetDialog, resetSaving], () => {
  resetDirty.value = resetDialog.value && (resetSaving.value || resetForm.password !== '' || resetForm.confirm_password !== '');
}, { deep: true, flush: 'sync' });

function currentEntry(request: number) { return pageActive && request === entryRequest; }
async function prepareEntry(permission: string) {
  if (!pageActive || !auth.can(permission) || writeBusy.value) return null;
  const request = ++entryRequest;
  const isCurrent = () => currentEntry(request) && auth.can(permission) && !writeBusy.value;
  if (createDialog.value && !await createUnsaved.confirmDiscard(isCurrent)) return null;
  if (resetDialog.value && !await resetUnsaved.confirmDiscard(isCurrent)) return null;
  if (!isCurrent()) return null;
  discardCreateDraft();
  discardResetDraft();
  return request;
}
async function closeCreateDialog() {
  if (createSaving.value) { pendingWriteNotice(); return false; }
  const request = entryRequest;
  if (!await createUnsaved.confirmDiscard(() => currentEntry(request))) return false;
  entryRequest += 1;
  discardCreateDraft();
  return true;
}
async function beforeCreateDialogClose(done: () => void) { if (await closeCreateDialog()) done(); }
async function closeResetDialog() {
  if (resetSaving.value) { pendingWriteNotice(); return false; }
  const request = entryRequest;
  if (!await resetUnsaved.confirmDiscard(() => currentEntry(request))) return false;
  entryRequest += 1;
  discardResetDraft();
  return true;
}
async function beforeResetDialogClose(done: () => void) { if (await closeResetDialog()) done(); }

async function load() {
  if (!pageActive || !auth.can('administrators:read')) return;
  const request = ++listRequest;
  const params = { ...query, keyword: query.keyword.trim() };
  loading.value = true;
  try {
    const data: AdministratorPage = await http.get('/admin/administrators', { params });
    if (!pageActive || request !== listRequest) return;
    const lastPage = Math.max(1, Math.ceil(data.total / params.page_size));
    if (params.page > lastPage) {
      query.page = lastPage;
      await load();
      return;
    }
    rows.value = data.items;
    total.value = data.total;
  } finally { if (request === listRequest) loading.value = false; }
}
async function searchAdministrators() { query.page = 1; await load(); }
async function loadAssignableRoles(): Promise<AssignableRole[]> {
  if (!['administrators:create', 'administrators:update'].some((permission) => auth.can(permission))) return [];
  return http.get('/admin/administrators/assignable-roles');
}
function fillCreateForm(value: AdministratorForm) {
  createBaseline.value = cloneForm(value);
  Object.assign(createForm, cloneForm(value));
  createDirty.value = false;
}
async function openCreate() {
  const request = await prepareEntry('administrators:create');
  if (request === null) return;
  fillCreateForm(emptyForm());
  createDialog.value = true;
  createLoading.value = true;
  try {
    const availableRoles = await loadAssignableRoles();
    if (currentEntry(request) && createDialog.value) roles.value = availableRoles;
  } catch (error) {
    if (currentEntry(request)) discardCreateDraft();
    throw error;
  } finally { if (currentEntry(request)) createLoading.value = false; }
}
async function openEdit(row: AdministratorRow) {
  if (!row.id || !canEditAdministrator(row)) return;
  const request = await prepareEntry('administrators:update');
  if (request === null) return;
  fillCreateForm({ ...emptyForm(), id: String(row.id), username: row.username, system_role: row.system_role });
  createDialog.value = true;
  createLoading.value = true;
  try {
    const [detail, availableRoles]: [AdministratorRow, AssignableRole[]] = await Promise.all([
      http.get<AdministratorRow, AdministratorRow>('/admin/administrators/' + encodeURIComponent(String(row.id))), loadAssignableRoles(),
    ]);
    if (!currentEntry(request) || !createDialog.value) return;
    if (!canEditAdministrator(detail)) { discardCreateDraft(); return; }
    roles.value = availableRoles;
    fillCreateForm({
      ...emptyForm(), id: String(detail.id), username: detail.username, real_name: detail.real_name || '',
      phone: detail.phone || '', status: detail.status, system_role: detail.system_role,
      role_ids: (detail.role_ids || []).map(String),
    });
  } catch (error) {
    if (currentEntry(request)) discardCreateDraft();
    throw error;
  } finally { if (currentEntry(request)) createLoading.value = false; }
}
function validatePassword(password: string, confirmation: string) {
  if (!/^(?=.*[A-Za-z])(?=.*\d)\S{8,128}$/.test(password)) {
    ElMessage.warning('请设置 8—128 位且含字母和数字的密码');
    return false;
  }
  if (password !== confirmation) { ElMessage.warning('两次输入的密码不一致'); return false; }
  return true;
}
async function createAdministrator() {
  if (!pageActive || !auth.can(createForm.id ? 'administrators:update' : 'administrators:create') || !createDialog.value || createSaving.value || createLoading.value) return;
  const form = cloneForm(createForm);
  if (form.id && !canEditAdministrator(createBaseline.value)) return;
  if (!form.username.trim() || (form.system_role !== 'super_admin' && !form.role_ids.length)) {
    ElMessage.warning('请填写账号并至少选择一个角色');
    return;
  }
  if (!form.id && !validatePassword(form.password, form.confirm_password)) return;
  if (form.status !== 0 && form.status !== 1) { ElMessage.warning('请选择正常或禁用状态'); return; }
  if (form.id && form.status === 0 && !canDisableAdministrator(createBaseline.value)) {
    ElMessage.warning('不能禁用本人或超级管理员');
    return;
  }
  const request = entryRequest;
  const details = { real_name: form.real_name.trim(), phone: form.phone.trim(), status: form.status };
  createSaving.value = true;
  try {
    if (form.id) {
      await http.put('/admin/administrators/' + encodeURIComponent(form.id), {
        ...details, ...(form.system_role === 'super_admin' ? {} : { role_ids: [...form.role_ids] }),
      });
    } else {
      await http.post('/admin/administrators', { username: form.username.trim(), password: form.password, ...details, role_ids: [...form.role_ids] });
    }
    if (!currentEntry(request) || !createDialog.value) return;
    ElMessage.success(form.id ? '管理员已更新' : '管理员已创建');
    createDialog.value = false;
    createForm.password = '';
    createForm.confirm_password = '';
    createBaseline.value = cloneForm(createForm);
    createUnsaved.markClean();
    await load();
  } finally { createSaving.value = false; }
}
async function openResetPassword(row: AdministratorRow) {
  if (!row.id || !canResetAdministrator(row)) return;
  const request = await prepareEntry('administrators:reset_password');
  if (request === null) return;
  resetTarget.value = { ...row, role_ids: [...row.role_ids], permissions: [...row.permissions] };
  Object.assign(resetForm, { password: '', confirm_password: '' });
  resetDialog.value = true;
}
async function saveResetPassword() {
  const target = resetTarget.value;
  if (!pageActive || !resetDialog.value || resetSaving.value || !target || !canResetAdministrator(target)) return;
  if (!validatePassword(resetForm.password, resetForm.confirm_password)) return;
  const request = entryRequest;
  const password = resetForm.password;
  resetSaving.value = true;
  try {
    await http.post('/admin/administrators/' + encodeURIComponent(String(target.id)) + '/reset-password', { password });
    if (!currentEntry(request) || !resetDialog.value) return;
    ElMessage.success('密码已重置，下次登录须修改密码');
    discardResetDraft();
    resetUnsaved.markClean();
  } finally { resetSaving.value = false; }
}
async function deleteAdministrator(row: AdministratorRow) {
  if (!pageActive || !row.id || !canDeleteAdministrator(row) || writeBusy.value) return;
  const request = ++deleteRequest;
  const id = String(row.id);
  deletePendingId.value = id;
  try {
    try {
      await ElMessageBox.confirm('确定删除管理员“' + row.username + '”吗？删除后账号将禁用，历史记录和业务数据继续保留。', '删除管理员', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
    } catch { return; }
    if (!pageActive || request !== deleteRequest || !canDeleteAdministrator(row)) return;
    deletingId.value = id;
    await http.delete('/admin/administrators/' + encodeURIComponent(id));
    if (!pageActive || request !== deleteRequest) return;
    ElMessage.success('管理员已删除');
    await load();
  } finally {
    if (request === deleteRequest) deletePendingId.value = null;
    if (deletingId.value === id) deletingId.value = null;
  }
}
function invalidatePage() {
  pageActive = false;
  listRequest += 1;
  entryRequest += 1;
  deleteRequest += 1;
  loading.value = false;
  deletePendingId.value = null;
  discardCreateDraft();
  discardResetDraft();
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
.administrator-actions { justify-content: center; flex-wrap: nowrap; gap: 4px; }
.dialog-note { color: var(--re-text-3); font-size: 13px; line-height: 1.6; margin-bottom: 16px; }
.administrator-dialog :deep(.el-dialog__body) { max-height: 70vh; overflow-y: auto; }
</style>
