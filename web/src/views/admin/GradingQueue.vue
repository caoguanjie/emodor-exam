<template>
  <div class="page-card">
    <div class="page-head">
      <div class="eyebrow">考试管理</div>
      <h2>人工阅卷</h2>
      <p class="desc">只展示实际提交过图片答案的记录；最终总分由服务端在最后一题评分后统一汇总。</p>
    </div>

    <div class="toolbar">
      <el-input v-model="query.paper_id" clearable placeholder="试卷 ID" style="width:150px" @keyup.enter="search" />
      <el-select v-model="query.source" clearable placeholder="学员来源" style="width:150px" @change="search">
        <el-option label="本机构" value="institution" />
        <el-option label="外来学员" value="external" />
      </el-select>
      <el-select v-model="query.status" clearable placeholder="批改状态" style="width:160px" @change="search">
        <el-option label="待人工批改" value="pending_manual" />
        <el-option label="已完成批改" value="finalized" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>

    <el-table v-loading="loading" :data="items">
      <el-table-column prop="paper_title" label="试卷" min-width="200">
        <template #default="{ row }"><div>{{ row.paper_title }}</div><small class="muted">ID {{ row.paper_id }}</small></template>
      </el-table-column>
      <el-table-column prop="user_name" label="学员" min-width="130" />
      <el-table-column label="来源" width="110"><template #default="{ row }">{{ row.source === 'external' ? '外来学员' : '本机构' }}</template></el-table-column>
      <el-table-column label="批改进度" width="140"><template #default="{ row }">{{ row.graded_items }}/{{ row.image_items }}<span v-if="row.pending_items">（待 {{ row.pending_items }}）</span></template></el-table-column>
      <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag :type="row.grading_state === 'finalized' ? 'success' : 'warning'">{{ row.grading_state === 'finalized' ? '已完成' : '待批改' }}</el-tag></template></el-table-column>
      <el-table-column label="总分" width="90"><template #default="{ row }">{{ row.score ?? '—' }}</template></el-table-column>
      <el-table-column label="交卷时间" min-width="170"><template #default="{ row }">{{ formatDateTime(row.submitted_at) }}</template></el-table-column>
      <el-table-column label="操作" width="110" fixed="right"><template #default="{ row }"><el-button size="small" type="primary" @click="open(row.record_id)">{{ row.grading_state === 'finalized' ? '查看' : '阅卷' }}</el-button></template></el-table-column>
    </el-table>
    <el-pagination class="pager" layout="total, prev, pager, next" :total="total" :page-size="query.page_size" v-model:current-page="query.page" @current-change="load" />
  </div>
</template>

<script setup lang="ts">
import { onActivated, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import http from '../../api/http';
import type { GradingQueueItem, Page } from '../../api/training-types';
import { formatDateTime } from '../../utils/format';

const router = useRouter();
const loading = ref(false);
const items = ref<GradingQueueItem[]>([]);
const total = ref(0);
const query = reactive({ page: 1, page_size: 20, paper_id: '', source: '', status: '' });

function params() { return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== '')); }
async function load() {
  loading.value = true;
  try {
    const data = await http.get('/admin/grading', { params: params() }) as Page<GradingQueueItem>;
    items.value = data.items;
    total.value = data.total;
  } finally { loading.value = false; }
}
function search() { query.page = 1; void load(); }
function reset() { Object.assign(query, { page: 1, page_size: 20, paper_id: '', source: '', status: '' }); void load(); }
function open(recordId: string) { void router.push(`/admin/grading/${recordId}`); }

onMounted(load);
onActivated(load);
</script>

<style scoped>
.muted { color: var(--re-text-3); }
.pager { margin-top: 16px; justify-content: flex-end; }
</style>
