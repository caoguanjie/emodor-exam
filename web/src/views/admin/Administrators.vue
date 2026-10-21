<template>
  <div class="page-card">
    <div class="page-head">
      <div class="eyebrow">系统治理</div>
      <h2>管理员</h2>
      <p class="desc">查看管理员登录状态与业务角色，角色权限由服务端实时校验。</p>
    </div>
    <div class="toolbar"><el-button type="primary" @click="load">刷新</el-button></div>
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
      <el-table-column label="操作" width="120" fixed="right"><template #default="{ row }"><el-button v-if="auth.can('administrators:write')" text type="primary" :disabled="row.id === '1'" @click="openRoles(row)">配置角色</el-button></template></el-table-column>
    </el-table>

    <el-dialog v-model="dialog" title="配置业务角色" width="480px">
      <div class="dialog-note">账号：{{ selected?.username }}；保存后旧令牌立即重新计算权限。</div>
      <el-checkbox-group v-model="selectedRoleIds" class="role-list">
        <el-checkbox v-for="role in editableRoles" :key="role.id" :label="role.id">{{ role.name }}（{{ role.code }}）</el-checkbox>
      </el-checkbox-group>
      <template #footer><el-button @click="dialog = false">取消</el-button><el-button v-if="auth.can('administrators:write')" type="primary" :loading="saving" @click="saveRoles">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../../api/http';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const rows = ref<any[]>([]);
const roles = ref<any[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialog = ref(false);
const selected = ref<any>(null);
const selectedRoleIds = ref<string[]>([]);
const editableRoles = computed(() => roles.value.filter((role) => !role.is_system));

function roleName(code: string) { return ({ super_admin: '超级管理员', regulation_admin: '制度管理员', employee: '员工' } as any)[code] || code; }

async function load() {
  loading.value = true;
  try {
    const [admins, roleData]: any[] = await Promise.all([http.get('/admin/administrators'), http.get('/admin/roles')]);
    rows.value = admins;
    roles.value = roleData;
  } finally { loading.value = false; }
}

function openRoles(row: any) {
  selected.value = row;
  const editableIds = new Set(editableRoles.value.map((role) => String(role.id)));
  selectedRoleIds.value = (row.role_ids || []).map((id: string | number) => String(id)).filter((id: string) => editableIds.has(id));
  dialog.value = true;
}

async function saveRoles() {
  if (!selected.value) return;
  saving.value = true;
  try {
    await http.put(`/admin/administrators/${selected.value.id}/roles`, { role_ids: selectedRoleIds.value });
    ElMessage.success('角色权限已更新');
    dialog.value = false;
    await load();
  } finally { saving.value = false; }
}

onMounted(load);
</script>

<style scoped>
.permission-tag { margin: 2px 4px 2px 0; }
.dialog-note { color: var(--re-text-3); font-size: 13px; margin-bottom: 16px; }
.role-list { display: grid; gap: 12px; }
</style>
