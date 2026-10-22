<template>
  <div class="page-card regulation-page">
    <div class="page-head page-head--hero">
      <div class="page-head__main">
        <div class="eyebrow">制度资产 · ADMIN</div>
        <h2>制度管理</h2>
        <p class="desc">上传制度文件、配置学习要求与发布范围，发布后进入员工学习清单</p>
      </div>
      <div class="page-head__actions">
        <span class="head-note"><i />发布范围与学习配置可在制度详情中继续完善</span>
        <el-button v-if="auth.can('regulations:write')" class="head-action" type="primary" @click="dialog = true">
          <el-icon><Plus /></el-icon>新建制度
        </el-button>
      </div>
    </div>

    <div class="regulation-summary">
      <div class="summary-item">
        <span class="summary-label">当前结果</span>
        <div><strong>{{ total }}</strong><em>条制度</em></div>
        <small>按当前筛选条件统计</small>
      </div>
      <div class="summary-item summary-item--success">
        <span class="summary-label">本页已发布</span>
        <div><strong>{{ publishedCount }}</strong><em>条</em></div>
        <small>已进入员工学习清单</small>
      </div>
      <div class="summary-item summary-item--warning">
        <span class="summary-label">本页待完善</span>
        <div><strong>{{ draftCount }}</strong><em>条草稿</em></div>
        <small>上传文件并完成发布配置</small>
      </div>
    </div>

    <section class="filter-panel">
      <div class="filter-panel__heading">
        <span class="filter-panel__icon"><el-icon><Filter /></el-icon></span>
        <div><strong>筛选制度</strong><span>按标题和发布状态快速定位</span></div>
      </div>
      <div class="filter-panel__controls">
        <el-input v-model="query.keyword" class="filter-control filter-control--keyword" placeholder="搜索制度标题" clearable @keyup.enter="load">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="query.status" class="filter-control" placeholder="全部状态" clearable @change="load">
          <el-option label="草稿" value="draft" />
          <el-option label="已发布" value="published" />
          <el-option label="已归档" value="archived" />
        </el-select>
        <el-button class="filter-submit" type="primary" @click="load"><el-icon><Search /></el-icon>查询</el-button>
      </div>
    </section>

    <section class="table-section">
      <div class="table-section__head">
        <div><span class="section-kicker">CONTENT INDEX</span><strong>制度清单</strong></div>
        <span class="table-total">共 {{ total }} 条结果</span>
      </div>
      <div class="table-shell">
        <el-table class="regulation-table" v-loading="loading" :data="list">
          <el-table-column label="制度标题" min-width="280">
            <template #default="{ row }">
              <div class="title-cell">
                <span class="title-mark" />
                <div><strong>{{ row.title }}</strong><small>{{ row.description || '制度文件与学习配置' }}</small></div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="分类" width="140">
            <template #default="{ row }"><span class="category-text">{{ row.category || '未分类' }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="120">
            <template #default="{ row }"><el-tag class="status-tag" :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
          </el-table-column>
          <el-table-column label="学习要求" width="180">
            <template #default="{ row }"><div class="learning-rule"><strong>≥ {{ row.required_minutes }} 分钟</strong><small>{{ row.scroll_segments }} 段阅读留痕</small></div></template>
          </el-table-column>
          <el-table-column label="发布时间" min-width="160">
            <template #default="{ row }"><span class="date-text">{{ formatDateTime(row.published_at) || '—' }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="116" fixed="right">
            <template #default="{ row }">
              <el-button class="row-action" size="small" type="primary" @click="$router.push(`/admin/regulations/${row.id}`)">管理<el-icon><ArrowRight /></el-icon></el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>
    <el-pagination class="regulation-pagination" layout="total, prev, pager, next" :total="total"
      :page-size="query.page_size" v-model:current-page="query.page" @current-change="load" />

    <el-dialog v-model="dialog" title="新建制度" width="480px">
      <el-form label-width="80px">
        <el-form-item label="标题"><el-input v-model="form.title" maxlength="128" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="form.category" maxlength="32" placeholder="如：安全类 / 人事类" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="form.description" type="textarea" maxlength="512" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button v-if="auth.can('regulations:write')" type="primary" @click="onCreate">创建（草稿）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { ArrowRight, Filter, Plus, Search } from '@element-plus/icons-vue';
import http from '../../api/http';
import { formatDateTime } from '../../utils/format';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const list = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const dialog = ref(false);
const form = reactive<any>({ title: '', category: '', description: '' });
const query = reactive<any>({ page: 1, page_size: 20, keyword: '', status: '' });
const publishedCount = computed(() => list.value.filter((item) => item.status === 'published').length);
const draftCount = computed(() => list.value.filter((item) => item.status === 'draft').length);

function statusLabel(s: string) {
  return ({ draft: '草稿', published: '已发布', archived: '已归档' } as any)[s] || s;
}
function statusType(s: string) {
  return ({ draft: 'info', published: 'success', archived: 'warning' } as any)[s] || 'info';
}

async function load() {
  loading.value = true;
  try {
    const d: any = await http.get('/regulations', { params: query });
    list.value = d.list;
    total.value = d.total;
  } finally {
    loading.value = false;
  }
}

async function onCreate() {
  await http.post('/regulations', form);
  ElMessage.success('制度已创建（草稿），请上传文件并完成配置');
  dialog.value = false;
  form.title = '';
  form.category = '';
  form.description = '';
  await load();
}

onMounted(load);
</script>

<style scoped>
.regulation-page { padding: 30px; }
.page-head--hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
.page-head__main { min-width: 0; }
.page-head__actions { display: flex; align-items: flex-end; flex-direction: column; gap: 14px; flex: none; }
.head-note { color: var(--re-text-3); font-size: 12px; white-space: nowrap; }
.head-note i { display: inline-block; width: 6px; height: 6px; margin-right: 7px; vertical-align: 1px; border-radius: 50%; background: var(--re-seal); box-shadow: 0 0 0 4px rgba(194,64,42,.1); }
.head-action { min-width: 132px; height: 40px; border-radius: 10px; }
.regulation-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
.summary-item { position: relative; overflow: hidden; padding: 16px 18px; border: 1px solid var(--re-border); border-radius: 12px; background: linear-gradient(135deg, #fbfcff, #f4f7ff); }
.summary-item::after { content: ''; position: absolute; width: 86px; height: 86px; right: -28px; bottom: -42px; border: 1px solid rgba(48,86,211,.12); border-radius: 50%; }
.summary-item--success { background: linear-gradient(135deg, #fbfefc, #f1faf6); }
.summary-item--warning { background: linear-gradient(135deg, #fffdfa, #fff7ed); }
.summary-label, .summary-item small { display: block; color: var(--re-text-3); font-size: 12px; }
.summary-item div { display: flex; align-items: baseline; gap: 7px; margin: 5px 0 2px; }
.summary-item strong { color: var(--re-text); font-size: 25px; font-weight: 700; letter-spacing: -.8px; }
.summary-item em { color: var(--re-text-2); font-size: 12px; font-style: normal; }
.summary-item--success strong { color: var(--re-success); }
.summary-item--warning strong { color: var(--re-warning); }
.filter-panel { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 26px; padding: 14px 16px; border: 1px solid var(--re-border); border-radius: 12px; background: #f8faff; }
.filter-panel__heading { display: flex; align-items: center; gap: 10px; flex: none; }
.filter-panel__heading > div { display: flex; flex-direction: column; gap: 3px; }
.filter-panel__heading strong { color: var(--re-text); font-size: 13px; }
.filter-panel__heading span { color: var(--re-text-3); font-size: 11px; }
.filter-panel__icon { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 9px; background: var(--el-color-primary-light-9); color: var(--re-primary); }
.filter-panel__controls { display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-width: 0; flex: 1; }
.filter-control { width: 150px; }
.filter-control--keyword { width: min(320px, 42vw); }
.filter-submit { height: 32px; padding: 0 16px; border-radius: 8px; }
.table-section__head { display: flex; align-items: center; justify-content: space-between; margin: 0 2px 10px; }
.table-section__head > div { display: flex; align-items: baseline; gap: 10px; }
.section-kicker { color: var(--re-text-3); font-size: 10px; font-weight: 700; letter-spacing: 1.8px; }
.table-section__head strong { color: var(--re-text); font-size: 15px; }
.table-total { color: var(--re-text-3); font-size: 12px; }
.table-shell { overflow: hidden; border: 1px solid var(--re-border); border-radius: 12px; }
.regulation-table { border: 0; }
.regulation-table :deep(.el-table__inner-wrapper::before) { display: none; }
.regulation-table :deep(.el-table__header-wrapper th) { height: 44px; background: #f7f9fc; }
.regulation-table :deep(.el-table__body-wrapper td) { height: 70px; }
.title-cell { display: flex; align-items: center; gap: 11px; min-width: 0; }
.title-mark { width: 4px; height: 34px; flex: none; border-radius: 4px; background: linear-gradient(180deg, var(--re-seal), #e7a08e); }
.title-cell > div { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.title-cell strong { overflow: hidden; color: var(--re-text); font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.title-cell small, .learning-rule small { overflow: hidden; color: var(--re-text-3); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.category-text, .date-text { color: var(--re-text-2); font-size: 13px; }
.status-tag { min-width: 50px; justify-content: center; }
.learning-rule { display: flex; flex-direction: column; gap: 5px; }
.learning-rule strong { color: var(--re-text-2); font-size: 13px; font-weight: 600; }
.row-action { display: inline-flex; align-items: center; gap: 3px; border-radius: 8px; }
.row-action :deep(.el-icon) { margin-left: 2px; transition: transform .18s ease; }
.row-action:hover :deep(.el-icon) { transform: translateX(2px); }
.regulation-pagination { justify-content: flex-end; margin-top: 16px; }
@media (max-width: 900px) {
  .page-head--hero, .filter-panel { align-items: stretch; flex-direction: column; }
  .page-head__actions { align-items: flex-start; }
  .filter-panel__controls { justify-content: flex-start; }
}
@media (max-width: 680px) {
  .regulation-page { padding: 20px; }
  .regulation-summary { grid-template-columns: 1fr; }
  .filter-panel__controls { flex-wrap: wrap; }
  .filter-control, .filter-control--keyword { width: 100%; }
}
</style>
