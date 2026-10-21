<template>
  <div class="page-card">
    <div class="page-head">
      <div class="eyebrow">管理台</div>
      <h2>培训类别</h2>
      <p class="desc">类别是学员、课程和题库的业务归类，来源不授予管理权限。</p>
    </div>
    <div class="toolbar">
      <el-input v-model="query.keyword" clearable placeholder="类别名称" style="width:220px" @keyup.enter="load" />
      <el-select v-model="query.status" clearable placeholder="全部状态" style="width:140px" @change="load">
        <el-option label="启用" :value="1" />
        <el-option label="停用" :value="0" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <div style="flex:1" />
      <el-button v-if="auth.can('training_categories:write')" type="primary" @click="openCreate">新增类别</el-button>
    </div>
    <el-table v-loading="loading" :data="items">
      <el-table-column prop="name" label="类别名称" min-width="180" />
      <el-table-column prop="description" label="说明" min-width="240" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }"><el-tag :type="row.status === 1 ? 'success' : 'info'">{{ row.status === 1 ? '启用' : '停用' }}</el-tag></template>
      </el-table-column>
      <el-table-column label="更新时间" width="180"><template #default="{ row }">{{ formatDateTime(row.updated_at) }}</template></el-table-column>
      <el-table-column v-if="auth.can('training_categories:write')" label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button text :type="row.status === 1 ? 'warning' : 'success'" @click="toggleStatus(row)">{{ row.status === 1 ? '停用' : '启用' }}</el-button>
          <el-button text type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && items.length === 0" description="暂无培训类别" />
    <el-pagination v-model:current-page="query.page" style="margin-top:16px; justify-content:flex-end" layout="total, prev, pager, next" :total="total" :page-size="query.page_size" @current-change="load" />

    <el-dialog v-model="dialog" :title="form.id ? '编辑类别' : '新增类别'" width="480px">
      <el-form label-width="88px">
        <el-form-item label="名称"><el-input v-model="form.name" maxlength="128" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="form.description" type="textarea" maxlength="2000" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialog = false">取消</el-button><el-button v-if="auth.can('training_categories:write')" type="primary" @click="save">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../../api/http';
import { formatDateTime } from '../../utils/format';
import { useAuthStore } from '../../stores/auth';

const items = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const dialog = ref(false);
const form = reactive<any>({});
const query = reactive({ page: 1, page_size: 20, keyword: '', status: undefined as number | undefined });
const auth = useAuthStore();

async function load() {
  loading.value = true;
  try {
    const data: any = await http.get('/admin/training-categories', { params: query });
    items.value = data.items || [];
    total.value = data.total || 0;
  } finally { loading.value = false; }
}
function openCreate() { Object.keys(form).forEach((key) => delete form[key]); form.name = ''; form.description = ''; dialog.value = true; }
function openEdit(row: any) { Object.assign(form, { id: row.id, name: row.name, description: row.description || '' }); dialog.value = true; }
async function save() {
  if (!form.name?.trim()) { ElMessage.warning('请填写类别名称'); return; }
  if (form.id) await http.put(`/admin/training-categories/${form.id}`, { name: form.name, description: form.description });
  else await http.post('/admin/training-categories', { name: form.name, description: form.description });
  ElMessage.success('已保存'); dialog.value = false; await load();
}
async function toggleStatus(row: any) {
  await http.put(`/admin/training-categories/${row.id}/status`, { status: row.status === 1 ? 0 : 1 });
  await load();
}
async function remove(row: any) {
  await ElMessageBox.confirm(`删除「${row.name}」？已被学员引用的类别不能删除。`, '确认删除', { type: 'warning' });
  await http.delete(`/admin/training-categories/${row.id}`); await load();
}
onMounted(load);
</script>
