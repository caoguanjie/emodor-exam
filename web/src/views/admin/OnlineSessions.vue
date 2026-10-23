<template>
  <div class="page-card">
    <FitsTable>
      <template #actions><el-button type="primary" @click="load">刷新会话</el-button></template>
      <el-table v-loading="loading" :data="rows" stripe>
        <el-table-column prop="user_id" label="用户 ID" width="110" />
        <el-table-column prop="ip_address" label="来源 IP" width="150" />
        <el-table-column prop="user_agent" label="设备" min-width="240" show-overflow-tooltip />
        <el-table-column prop="created_at" label="登录时间" min-width="170" />
        <el-table-column prop="last_seen_at" label="最近活动" min-width="170" />
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.status === 'active' ? 'success' : 'info'">{{ row.status === 'active' ? '在线' : '已下线' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="110" fixed="right"><template #default="{ row }"><FitsTableActions><FitsTableAction v-if="row.status === 'active' && auth.can('sessions:write')" type="danger" @click="revoke(row)">强制下线</FitsTableAction></FitsTableActions></template></el-table-column>
      </el-table>
      <template #pagination><el-pagination layout="total, prev, pager, next" :total="total" :page-size="pageSize" v-model:current-page="page" @current-change="load" /></template>
    </FitsTable>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../../api/http';
import { FitsTable, FitsTableActions, FitsTableAction } from '../../components/FitsTable';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const rows = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);

async function load() {
  loading.value = true;
  try { const data: any = await http.get('/admin/sessions', { params: { page: page.value, page_size: pageSize } }); rows.value = data.items; total.value = data.total; }
  finally { loading.value = false; }
}
async function revoke(row: any) {
  try {
    await ElMessageBox.confirm('强制下线后，该设备需要重新登录，确认继续？', '确认下线', { type: 'warning' });
  } catch {
    return;
  }
  await http.post(`/admin/sessions/${row.id}/revoke`);
  ElMessage.success('会话已下线');
  await load();
}
onMounted(load);
</script>
