<template>
  <div class="page-card">
    <div class="page-head">
      <div class="eyebrow">管理台</div>
      <h2>员工管理</h2>
      <p class="desc">维护员工账号与部门归属，支持 Excel 批量导入</p>
    </div>
    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="用户名 / 姓名 / 工号" style="width:200px" clearable @keyup.enter="load" />
      <el-tree-select v-model="query.department_id" :data="deptTree" check-strictly clearable placeholder="全部部门" style="width:200px" @change="load" />
      <el-select v-model="query.role" placeholder="全部角色" clearable style="width:160px" @change="load">
        <el-option label="超级管理员" value="super_admin" />
        <el-option label="制度管理员" value="regulation_admin" />
        <el-option label="普通员工" value="employee" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <div style="flex:1" />
      <el-button @click="downloadTemplate">下载导入模板</el-button>
      <el-upload :show-file-list="false" accept=".xlsx" :before-upload="onImport" :auto-upload="false" :on-change="onImport">
        <el-button type="success">Excel 批量导入</el-button>
      </el-upload>
      <el-button type="primary" @click="openCreate">新增员工</el-button>
    </div>

    <el-table v-loading="loading" :data="list">
      <el-table-column prop="username" label="用户名" width="130" />
      <el-table-column prop="real_name" label="姓名" width="110" />
      <el-table-column prop="employee_no" label="工号" width="110" />
      <el-table-column label="部门" min-width="140">
        <template #default="{ row }">{{ deptName(row.department_id) }}</template>
      </el-table-column>
      <el-table-column label="角色" width="120">
        <template #default="{ row }">{{ roleLabel(row.role) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'info'">{{ row.status === 1 ? '在职' : '停用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="最后登录" min-width="150">
        <template #default="{ row }">{{ formatDateTime(row.last_login_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button text size="small" type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button text size="small" :type="row.status === 1 ? 'warning' : 'success'" @click="toggleStatus(row)">
            {{ row.status === 1 ? '停用' : '启用' }}
          </el-button>
          <el-button text size="small" type="danger" @click="openReset(row)">重置密码</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination style="margin-top:16px; justify-content:flex-end" layout="total, prev, pager, next" :total="total"
      :page-size="query.page_size" v-model:current-page="query.page" @current-change="load" />

    <el-dialog v-model="dialog" :title="form.id ? '编辑员工' : '新增员工'" width="480px">
      <el-form label-width="90px">
        <el-form-item label="用户名"><el-input v-model="form.username" :disabled="!!form.id" maxlength="64" /></el-form-item>
        <el-form-item label="姓名"><el-input v-model="form.real_name" maxlength="64" /></el-form-item>
        <el-form-item label="工号"><el-input v-model="form.employee_no" maxlength="32" /></el-form-item>
        <el-form-item label="部门">
          <el-tree-select v-model="form.department_id" :data="deptTree" check-strictly clearable style="width:100%" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role" style="width:100%">
            <el-option label="超级管理员" value="super_admin" />
            <el-option label="制度管理员" value="regulation_admin" />
            <el-option label="普通员工" value="employee" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="!form.id" label="初始密码">
          <el-input v-model="form.password" placeholder="≥8 位（字母+数字），首次登录将强制修改" show-password />
        </el-form-item>
        <el-form-item label="手机号"><el-input v-model="form.phone" maxlength="20" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="form.email" maxlength="128" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importResultVisible" title="导入结果" width="560px">
      <el-result v-if="importResult" :icon="importResult.fail_count ? 'warning' : 'success'"
        :title="`成功 ${importResult.success_count} 条，失败 ${importResult.fail_count} 条`">
        <template #sub-title>
          <el-table v-if="importResult.failures?.length" :data="importResult.failures" size="small">
            <el-table-column prop="row" label="行号" width="80" />
            <el-table-column prop="reason" label="失败原因" />
          </el-table>
        </template>
      </el-result>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { UploadFile } from 'element-plus';
import http, { download, upload } from '../../api/http';
import { formatDateTime } from '../../utils/format';

const list = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const deptTree = ref<any[]>([]);
const deptRows = ref<any[]>([]);
const dialog = ref(false);
const form = reactive<any>({});
const query = reactive<any>({ page: 1, page_size: 20, keyword: '', department_id: null, role: '' });
const importResult = ref<any>(null);
const importResultVisible = ref(false);

function roleLabel(r: string) {
  return ({ super_admin: '超级管理员', regulation_admin: '制度管理员', employee: '员工' } as any)[r] || r;
}
function deptName(id: number | null) {
  return deptRows.value.find((d) => String(d.id) === String(id))?.name || '—';
}

function flatten(nodes: any[], out: any[] = [], path = ''): any[] {
  for (const n of nodes) {
    const p = path ? `${path}/${n.name}` : n.name;
    out.push({ ...n, path: p });
    if (n.children?.length) flatten(n.children, out, p);
  }
  return out;
}

async function load() {
  loading.value = true;
  try {
    const d: any = await http.get('/users', { params: query });
    list.value = d.list;
    total.value = d.total;
  } finally {
    loading.value = false;
  }
}

async function loadDepts() {
  const d: any = await http.get('/departments/tree');
  deptTree.value = toTree(d.list);
  deptRows.value = flatten(d.list);
}

function toTree(nodes: any[]): any[] {
  return nodes.map((n) => ({ value: n.id, label: n.name, children: n.children?.length ? toTree(n.children) : undefined }));
}

function openCreate() {
  Object.keys(form).forEach((k) => delete form[k]);
  Object.assign(form, { role: 'employee' });
  dialog.value = true;
}

function openEdit(row: any) {
  Object.keys(form).forEach((k) => delete form[k]);
  Object.assign(form, row, {
    employee_no: row.employee_no || '',
    // 列表返回的 department_id 是 number，DTO 按字符串校验，树选择器取值也是字符串
    department_id: row.department_id === null || row.department_id === undefined ? '' : String(row.department_id),
  });
  dialog.value = true;
}

async function onSave() {
  if (form.id) {
    await http.put(`/users/${form.id}`, form);
  } else {
    await http.post('/users', form);
  }
  ElMessage.success('已保存');
  dialog.value = false;
  await load();
}

async function toggleStatus(row: any) {
  const target = row.status === 1 ? 0 : 1;
  await ElMessageBox.confirm(
    target === 0 ? '停用后该账号即刻无法登录、不再计入应学人数，确认停用？' : '确认启用该账号？',
    '确认',
    { type: 'warning' },
  );
  await http.put(`/users/${row.id}/status`, { status: target });
  await load();
}

async function openReset(row: any) {
  const { value } = await ElMessageBox.prompt(`为「${row.real_name}」设置新的初始密码（≥8 位，字母+数字），重置后需重新走强制改密流程`, '重置密码', {
    inputPattern: /^(?=.*[A-Za-z])(?=.*\d).{8,}$/,
    inputErrorMessage: '至少 8 位，且同时包含字母与数字',
  });
  await http.put(`/users/${row.id}/password`, { password: value });
  ElMessage.success('已重置，旧密码立即失效');
}

function downloadTemplate() {
  download('/users/import-template', '员工导入模板.xlsx');
}

async function onImport(file: UploadFile) {
  if (!file.raw) return false;
  const res: any = await upload('/users/import', file.raw);
  importResult.value = res;
  importResultVisible.value = true;
  await load();
  return false;
}

onMounted(async () => {
  await loadDepts();
  await load();
});
</script>
