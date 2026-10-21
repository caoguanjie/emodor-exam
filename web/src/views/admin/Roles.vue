<template>
  <div class="page-card">
    <div class="page-head"><div class="eyebrow">系统治理</div><h2>角色与权限</h2><p class="desc">权限只能从服务端注册目录选择，未注册代码不会被接受。</p></div>
    <div class="toolbar"><el-button type="primary" @click="openCreate">新建业务角色</el-button><div style="flex:1" /><el-button @click="load">刷新</el-button></div>
    <el-table v-loading="loading" :data="roles" stripe>
      <el-table-column prop="name" label="角色名称" width="180" />
      <el-table-column prop="code" label="代码" width="230" />
      <el-table-column label="类型" width="110"><template #default="{ row }"><el-tag :type="row.is_system ? 'info' : 'primary'">{{ row.is_system ? '系统角色' : '业务角色' }}</el-tag></template></el-table-column>
      <el-table-column label="权限" min-width="360"><template #default="{ row }"><el-tag v-for="code in row.permissions" :key="code" size="small" effect="plain" class="permission-tag">{{ code }}</el-tag></template></el-table-column>
      <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status === 1 ? 'success' : 'info'">{{ row.status === 1 ? '启用' : '停用' }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><el-button text type="primary" :disabled="row.is_system" @click="openEdit(row)">编辑</el-button></template></el-table-column>
    </el-table>

    <el-dialog v-model="dialog" :title="editing ? '编辑业务角色' : '新建业务角色'" width="620px">
      <el-form label-width="90px"><el-form-item label="角色代码"><el-input v-model="form.code" :disabled="editing" maxlength="64" /></el-form-item><el-form-item label="角色名称"><el-input v-model="form.name" maxlength="128" /></el-form-item><el-form-item label="权限"><el-checkbox-group v-model="form.permissions" class="permission-grid"><el-checkbox v-for="item in catalog" :key="item.code" :label="item.code">{{ item.name }}<span class="code">{{ item.code }}</span></el-checkbox></el-checkbox-group></el-form-item><el-form-item v-if="editing" label="状态"><el-switch v-model="form.status" :active-value="1" :inactive-value="0" /></el-form-item></el-form>
      <template #footer><el-button @click="dialog = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../../api/http';

const roles = ref<any[]>([]);
const catalog = ref<any[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialog = ref(false);
const editing = ref(false);
const form = reactive<any>({ code: '', name: '', permissions: [], status: 1, id: '' });

async function load() {
  loading.value = true;
  try {
    const [roleData, permissionData]: any[] = await Promise.all([http.get('/admin/roles'), http.get('/admin/permissions')]);
    roles.value = roleData;
    catalog.value = permissionData;
  } finally { loading.value = false; }
}
function reset() { Object.assign(form, { id: '', code: '', name: '', permissions: [], status: 1 }); }
function openCreate() { reset(); editing.value = false; dialog.value = true; }
function openEdit(row: any) { Object.assign(form, { id: row.id, code: row.code, name: row.name, permissions: [...row.permissions], status: row.status }); editing.value = true; dialog.value = true; }
async function save() {
  if (!form.code || !form.name) return;
  saving.value = true;
  try {
    if (editing.value) await http.put(`/admin/roles/${form.id}`, { name: form.name, permissions: form.permissions, status: form.status });
    else await http.post('/admin/roles', { code: form.code, name: form.name, permissions: form.permissions });
    ElMessage.success('角色已保存'); dialog.value = false; await load();
  } finally { saving.value = false; }
}
onMounted(load);
</script>

<style scoped>
.permission-tag { margin: 2px 4px 2px 0; }
.permission-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; max-height: 360px; overflow: auto; }
.permission-grid :deep(.el-checkbox) { margin-right: 0; display: flex; align-items: flex-start; }
.code { display: block; margin-left: 4px; color: var(--re-text-3); font-size: 11px; }
</style>
