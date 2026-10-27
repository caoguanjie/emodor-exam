<template>
  <div class="page-card online-sessions">
    <FitsTable>
      <template #search>
        <FitsListSearch @submit.prevent>
          <el-form-item label="账号／姓名"><el-input v-model="filters.keyword" aria-label="搜索账号或姓名" maxlength="128" placeholder="输入账号或姓名" clearable @keyup.enter="search" /></el-form-item>
          <el-form-item label="会话状态"><el-select v-model="filters.status" aria-label="会话状态"><el-option label="有效" value="active" /><el-option label="已过期" value="expired" /><el-option label="已下线" value="revoked" /><el-option label="全部" value="all" /></el-select></el-form-item>
          <template #actions><el-button type="primary" @click="search">查询</el-button><el-button @click="reset">重置</el-button></template>
        </FitsListSearch>
      </template>
      <template #actions><div class="sessions-toolbar"><span>有效会话表示登录凭据仍可使用，不代表用户正在操作</span><el-button circle text :loading="loading" :disabled="loading" aria-label="刷新会话" title="刷新会话" @click="load"><el-icon><Refresh /></el-icon></el-button></div></template>
      <div v-if="error || actionError" class="session-error" role="alert"><span>{{ error || actionError }}</span><el-button v-if="error" link type="primary" @click="load">重试</el-button></div>
      <el-table v-loading="loading" :data="rows" :aria-busy="loading">
        <template #empty><el-empty v-if="!loading && !error" description="暂无符合条件的会话" /></template>
        <el-table-column label="账号／姓名" min-width="190"><template #default="{ row }"><div class="session-account"><strong>{{ row.username || '账号信息缺失' }}</strong><span v-if="row.real_name">{{ row.real_name }}</span><span v-else-if="!row.username" class="account-missing">用户 ID：{{ row.user_id }}</span></div></template></el-table-column>
        <el-table-column label="设备" min-width="230"><template #default="{ row }"><span :title="row.user_agent || '未记录设备信息'">{{ sessionDeviceLabel(row.user_agent, row.client) }}</span></template></el-table-column>
        <el-table-column label="来源 IP" min-width="140"><template #default="{ row }">{{ row.ip_address || '—' }}</template></el-table-column>
        <el-table-column label="登录时间" min-width="180"><template #default="{ row }">{{ formatSessionDateTime(row.created_at) }}</template></el-table-column>
        <el-table-column label="最近活动" min-width="140"><template #default="{ row }"><span :title="formatSessionDateTime(row.last_seen_at)">{{ sessionRelativeTime(row.last_seen_at, now) }}</span></template></el-table-column>
        <el-table-column label="状态" min-width="160"><template #default="{ row }"><div class="session-state"><el-tag :type="row.status === 'active' ? 'success' : 'info'">{{ statusLabel(row.status) }}</el-tag><el-tag v-if="row.is_current" class="current-session" type="primary" effect="plain">当前会话</el-tag></div></template></el-table-column>
        <el-table-column v-if="auth.can('sessions:write')" label="操作" width="110" fixed="right"><template #default="{ row }"><FitsTableActions><FitsTableAction v-if="row.status === 'active'" type="danger" :disabled="!!revokingId" :loading="revokingId === row.id" @click="revoke(row)">强制下线</FitsTableAction></FitsTableActions></template></el-table-column>
      </el-table>
      <template #pagination><el-pagination :current-page="page" :page-size="pageSize" layout="total, sizes, prev, pager, next, jumper" :total="total" :page-sizes="[10,20,50,100]" @current-change="changePage" @size-change="changePageSize" /></template>
    </FitsTable>
  </div>
</template>

<script setup lang="ts">
import { onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Refresh } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../../api/http';
import { FitsTable, FitsListSearch, FitsTableActions, FitsTableAction } from '../../components/FitsTable';
import { useAuthStore } from '../../stores/auth';
import { createLatestRequestScope } from '../../utils/latest-request-scope';
import { formatSessionDateTime, sessionDeviceLabel, sessionRelativeTime } from '../../utils/online-session-display';

type SessionStatus = 'active' | 'expired' | 'revoked';
type SessionStatusFilter = SessionStatus | 'all';
interface SessionRow {
  id: string; user_id: string; username: string | null; real_name: string | null;
  client: 'pc' | 'mobile'; user_agent: string | null; ip_address: string | null;
  created_at: string; last_seen_at: string | null; status: SessionStatus; is_current: boolean;
}
interface SessionPage { items: SessionRow[]; total: number; page: number; page_size: number }
const auth = useAuthStore();
const router = useRouter();
const rows = ref<SessionRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const filters = reactive({ keyword: '', status: 'active' as SessionStatusFilter });
let appliedFilters = { keyword: '', status: 'active' as SessionStatusFilter };
const loading = ref(false);
const error = ref('');
const actionError = ref('');
const revokingId = ref('');
const now = ref(Date.now());
let active = false;
let listScope = createLatestRequestScope();
let relativeTimer: ReturnType<typeof setInterval> | undefined;

function statusLabel(status: SessionStatus) { return ({ active: '有效', expired: '已过期', revoked: '已下线' })[status] || '未知状态'; }

async function load() {
  if (!active || !auth.can('sessions:read')) return;
  const ticket = listScope.begin();
  loading.value = true; error.value = '';
  const params = { page: page.value, page_size: pageSize.value, status: appliedFilters.status, ...(appliedFilters.keyword ? { keyword: appliedFilters.keyword } : {}) };
  try {
    const data = await http.get<never, SessionPage>('/admin/sessions', { params, signal: ticket.signal });
    if (!ticket.isCurrent()) return;
    rows.value = data.items; total.value = data.total; now.value = Date.now();
    const finalPage = Math.max(1, Math.ceil(data.total / pageSize.value));
    if (page.value > finalPage) { page.value = finalPage; await load(); }
  } catch (cause) {
    if (!ticket.isCurrent() || ticket.signal.aborted) return;
    error.value = cause instanceof Error ? cause.message : '会话加载失败，请重试';
  } finally {
    if (ticket.isCurrent()) loading.value = false;
    ticket.finish();
  }
}

function search() {
  appliedFilters = { keyword: filters.keyword.trim().slice(0, 128), status: filters.status };
  filters.keyword = appliedFilters.keyword;
  page.value = 1; actionError.value = '';
  return load();
}
function reset() { filters.keyword = ''; filters.status = 'active'; return search(); }
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

async function revoke(row: SessionRow) {
  if (!active || revokingId.value || row.status !== 'active' || !auth.can('sessions:write')) return;
  revokingId.value = row.id; actionError.value = '';
  try {
    try {
      await ElMessageBox.confirm(`确认将账号「${row.username || row.real_name || '账号信息缺失'}」在「${sessionDeviceLabel(row.user_agent, row.client)}」上的会话下线？${row.is_current ? '当前页面将退出登录。' : '该设备需要重新登录。'}`, '确认下线', { type: 'warning', confirmButtonText: '确认下线', cancelButtonText: '取消' });
    } catch { return; }
    if (!active || !auth.can('sessions:write')) return;
    await http.post(`/admin/sessions/${row.id}/revoke`);
    if (row.is_current) {
      auth.logoutLocal();
      deactivate();
      await router.replace('/login');
      return;
    }
    if (active) { ElMessage.success('会话已下线'); await load(); }
  } catch (cause) {
    if (active) actionError.value = cause instanceof Error ? cause.message : '下线失败，请重试';
  } finally { revokingId.value = ''; }
}

function activate() {
  if (active) return;
  active = true; listScope = createLatestRequestScope(); now.value = Date.now();
  relativeTimer = setInterval(() => { now.value = Date.now(); }, 30_000);
  void load();
}
function deactivate() {
  active = false; listScope.stop(); loading.value = false;
  if (relativeTimer) clearInterval(relativeTimer);
  relativeTimer = undefined;
}
onMounted(activate); onActivated(activate); onDeactivated(deactivate); onUnmounted(deactivate);
</script>

<style scoped>
.sessions-toolbar{display:flex;width:100%;align-items:center;justify-content:space-between;gap:16px}.sessions-toolbar>span{color:var(--re-text-3);font-size:12px;line-height:1.6}.sessions-toolbar .el-button{flex:none;color:var(--re-text-2)}.session-account{display:flex;flex-direction:column;gap:2px;line-height:1.6}.session-account strong{font-weight:500;color:var(--re-text)}.session-account>span{color:var(--re-text-3);font-size:12px}.session-state{display:flex;align-items:center;flex-wrap:wrap;gap:6px}.session-error{display:flex;align-items:center;gap:12px;margin-bottom:12px;color:var(--el-color-danger);font-size:13px}
</style>
