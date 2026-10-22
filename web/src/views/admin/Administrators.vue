<template>
  <div class="page-card">
    <div class="page-head">
      <div class="eyebrow">系统治理</div>
      <h2>管理员</h2>
      <p class="desc">查看管理员登录状态与业务角色，角色权限由服务端实时校验。</p>
    </div>
    <div class="toolbar">
      <el-button v-if="auth.can('administrators:write')" type="primary" @click="openCreate">新建管理员</el-button>
      <el-button v-if="auth.can('administrators:write')" type="primary" @click="openAssignment">为账号配置角色</el-button>
      <div style="flex:1" />
      <el-button @click="load">刷新</el-button>
    </div>
    <el-table v-loading="loading" :data="rows" stripe>
      <el-table-column prop="username" label="账号" width="160" />
      <el-table-column prop="real_name" label="姓名" width="140" />
      <el-table-column label="系统身份" width="150">
        <template #default="{ row }"><el-tag :type="row.system_role === 'super_admin' ? 'danger' : 'primary'">{{ roleName(row.system_role) }}</el-tag></template>
      </el-table-column>
      <el-table-column label="当前权限" min-width="300">
        <template #default="{ row }"><el-tag v-for="code in row.permissions" :key="code" size="small" effect="plain" class="permission-tag">{{ code }}</el-tag></template>
      </el-table-column>
      <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status === 1 ? 'success' : 'info'">{{ row.status === 1 ? '启用' : '停用' }}</el-tag></template></el-table-column>
      <el-table-column prop="last_login_at" label="最后登录" min-width="170" />
      <el-table-column label="操作" width="120" fixed="right"><template #default="{ row }"><el-button v-if="auth.can('administrators:write')" text type="primary" :disabled="row.system_role === 'super_admin'" @click="openRoles(row)">配置角色</el-button></template></el-table-column>
    </el-table>

    <el-dialog v-model="createDialog" title="新建管理员" width="520px">
      <el-form label-width="96px" :disabled="createSaving">
        <el-form-item label="账号" required><el-input v-model="createForm.username" maxlength="64" /></el-form-item>
        <el-form-item label="初始密码" required><el-input v-model="createForm.password" show-password placeholder="至少 8 位，且包含字母和数字" /></el-form-item>
        <el-form-item label="姓名" required><el-input v-model="createForm.real_name" maxlength="64" /></el-form-item>
        <el-form-item label="手机号"><el-input v-model="createForm.phone" maxlength="20" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="createForm.email" maxlength="128" /></el-form-item>
        <el-form-item label="业务角色" required>
          <el-checkbox-group v-model="createForm.role_ids" class="role-list">
            <el-checkbox v-for="role in editableRoles" :key="role.id" :label="role.id">{{ role.name }}（{{ role.code }}）</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="createSaving" @click="createDialog = false">取消</el-button>
        <el-button type="primary" :loading="createSaving" :disabled="createSaving" @click="createAdministrator">创建管理员</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="candidateDialog" title="选择账号" width="760px">
      <div class="candidate-search">
        <el-input v-model="candidateQuery.keyword" clearable placeholder="按账号、姓名或工号搜索" @keyup.enter="searchCandidates" />
        <el-button type="primary" @click="searchCandidates">搜索</el-button>
      </div>
      <el-table v-loading="candidateLoading" :data="candidateRows" stripe>
        <el-table-column prop="username" label="账号" width="180" />
        <el-table-column prop="real_name" label="姓名" width="160" />
        <el-table-column label="系统身份" width="150"><template #default="{ row }">{{ roleName(row.system_role) }}</template></el-table-column>
        <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status === 1 ? 'success' : 'info'">{{ row.status === 1 ? '启用' : '停用' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button text type="primary" @click="chooseCandidate(row)">选择</el-button></template></el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="candidateQuery.page"
        class="candidate-pagination"
        layout="total, prev, pager, next"
        :page-size="candidateQuery.page_size"
        :total="candidateTotal"
        @current-change="searchCandidates"
      />
      <template #footer><el-button @click="candidateDialog = false">取消</el-button></template>
    </el-dialog>

    <el-dialog v-model="dialog" :title="selected ? `配置业务角色：${selected.username}` : '配置业务角色'" width="480px" :before-close="beforeRoleDialogClose">
      <div class="dialog-note">保存后旧令牌立即重新计算权限；清空角色表示移除该账号的业务角色。</div>
      <el-checkbox-group v-model="selectedRoleIds" class="role-list">
        <el-checkbox v-for="role in editableRoles" :key="role.id" :label="role.id">{{ role.name }}（{{ role.code }}）</el-checkbox>
      </el-checkbox-group>
      <template #footer><el-button @click="closeRoleDialog">取消</el-button><el-button v-if="auth.can('administrators:write')" type="primary" :loading="saving" @click="saveRoles">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../../api/http';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { useAuthStore } from '../../stores/auth';

interface AdministratorRow {
  id: string;
  username: string;
  real_name: string;
  system_role: string;
  status: number;
  last_login_at: string | null;
  role_ids: string[];
  permissions: string[];
}

interface CandidateAccount {
  id: string;
  username: string;
  real_name: string;
  status: number;
  system_role: string;
}

interface AssignableRole {
  id: string;
  code: string;
  name: string;
  status: number;
  is_system: boolean;
}

const auth = useAuthStore();
const rows = ref<AdministratorRow[]>([]);
const roles = ref<AssignableRole[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialog = ref(false);
const candidateDialog = ref(false);
const candidateLoading = ref(false);
const selected = ref<AdministratorRow | CandidateAccount | null>(null);
const selectedRoleIds = ref<string[]>([]);
const candidateRows = ref<CandidateAccount[]>([]);
const candidateTotal = ref(0);
const candidateQuery = reactive({ page: 1, page_size: 20, keyword: '' });
const editableRoles = computed(() => roles.value.filter((role) => !role.is_system && role.status === 1));
const createDialog = ref(false);
const createSaving = ref(false);
const createForm = reactive({
  username: '', password: '', real_name: '', phone: '', email: '', role_ids: [] as string[],
});
const dirty = ref(false);
const roleBaseline = ref<{ selected: AdministratorRow | CandidateAccount | null; roleIds: string[] }>({ selected: null, roleIds: [] });

function cloneAccount(value: AdministratorRow | CandidateAccount | null) {
  return value ? { ...value, ...('role_ids' in value ? { role_ids: [...value.role_ids], permissions: [...value.permissions] } : {}) } : null;
}
function beginRoleDraft(account: AdministratorRow | CandidateAccount, roleIds: string[]) {
  selected.value = account;
  selectedRoleIds.value = [...roleIds];
  roleBaseline.value = { selected: cloneAccount(account), roleIds: [...roleIds] };
  dirty.value = false;
  dialog.value = true;
}
function discardRoleDraft() {
  selected.value = cloneAccount(roleBaseline.value.selected);
  selectedRoleIds.value = [...roleBaseline.value.roleIds];
  dirty.value = false;
  dialog.value = false;
}

const unsaved = useUnsavedChanges(dirty, { onDiscard: discardRoleDraft });
watch(selectedRoleIds, (value) => {
  dirty.value = dialog.value && JSON.stringify(value) !== JSON.stringify(roleBaseline.value.roleIds);
}, { deep: true, flush: 'sync' });

async function closeRoleDialog() {
  if (await unsaved.confirmDiscard()) dialog.value = false;
}
async function beforeRoleDialogClose(done: () => void) {
  if (await unsaved.confirmDiscard()) {
    dialog.value = false;
    done();
  }
}

function roleName(code: string) {
  return ({ super_admin: '超级管理员', regulation_admin: '业务管理员', employee: '业务管理员' } as Record<string, string>)[code] || code;
}

async function load() {
  loading.value = true;
  try {
    rows.value = await http.get('/admin/administrators');
  } finally { loading.value = false; }
}

async function loadAssignableRoles() {
  roles.value = await http.get('/admin/administrators/assignable-roles');
}

async function openCreate() {
  await loadAssignableRoles();
  Object.assign(createForm, { username: '', password: '', real_name: '', phone: '', email: '', role_ids: [] });
  createDialog.value = true;
}

async function createAdministrator() {
  if (!createForm.username.trim() || !createForm.password || !createForm.real_name.trim() || !createForm.role_ids.length) {
    ElMessage.warning('请填写账号、初始密码、姓名并至少选择一个业务角色');
    return;
  }
  createSaving.value = true;
  try {
    await http.post('/admin/administrators', {
      username: createForm.username.trim(),
      password: createForm.password,
      real_name: createForm.real_name.trim(),
      phone: createForm.phone.trim(),
      email: createForm.email.trim(),
      role_ids: [...createForm.role_ids],
    });
    ElMessage.success('管理员已创建');
    createDialog.value = false;
    await load();
  } finally {
    createSaving.value = false;
  }
}

async function openRoles(row: AdministratorRow) {
  await loadAssignableRoles();
  const editableIds = new Set(editableRoles.value.map((role) => String(role.id)));
  const roleIds = (row.role_ids || []).map((id) => String(id)).filter((id) => editableIds.has(id));
  beginRoleDraft(row, roleIds);
}

async function openAssignment() {
  candidateQuery.page = 1;
  candidateQuery.keyword = '';
  candidateDialog.value = true;
  await searchCandidates();
}

async function searchCandidates() {
  candidateLoading.value = true;
  try {
    const data: { items: CandidateAccount[]; total: number } = await http.get('/admin/administrators/candidates', { params: candidateQuery });
    candidateRows.value = data.items;
    candidateTotal.value = data.total;
  } finally { candidateLoading.value = false; }
}

async function chooseCandidate(row: CandidateAccount) {
  candidateDialog.value = false;
  await loadAssignableRoles();
  beginRoleDraft(row, []);
}

async function saveRoles() {
  if (!selected.value) return;
  saving.value = true;
  try {
    await http.put(`/admin/administrators/${selected.value.id}/roles`, { role_ids: selectedRoleIds.value });
    ElMessage.success('角色权限已更新');
    roleBaseline.value = { selected: cloneAccount(selected.value), roleIds: [...selectedRoleIds.value] };
    unsaved.markClean();
    dialog.value = false;
    await load();
  } finally { saving.value = false; }
}

onMounted(load);
</script>

<style scoped>
.permission-tag { margin: 2px 4px 2px 0; }
.candidate-search { display: flex; gap: 10px; margin-bottom: 14px; }
.candidate-pagination { justify-content: flex-end; margin-top: 16px; }
.dialog-note { color: var(--re-text-3); font-size: 13px; margin-bottom: 16px; }
.role-list { display: grid; gap: 12px; }
</style>
