<template>
  <div class="page-card">
    <div class="page-head">
      <div class="eyebrow">我的学习</div>
      <h2>我的成绩</h2>
      <p class="desc">每次作答的最终得分，成绩由系统自动判定、不可修改</p>
    </div>
    <el-table v-loading="loading" :data="list">
      <el-table-column prop="paper_title" label="试卷" min-width="200" />
      <el-table-column prop="regulation_title" label="所属制度" min-width="180" />
      <el-table-column prop="attempt_no" label="第几次" width="80" />
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="得分" width="90">
        <template #default="{ row }">
          <span class="re-mono score-cell" :class="{ passed: row.status === 'passed', failed: row.status === 'failed' }">{{ row.score ?? '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="交卷时间" min-width="150">
        <template #default="{ row }">{{ formatDateTime(row.submitted_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="110" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="$router.push(`/my/scores/${row.id}`)">明细</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import http from '../../api/http';
import { formatDateTime } from '../../utils/format';

const list = ref<any[]>([]);
const loading = ref(false);

function statusLabel(s: string) {
  return ({ in_progress: '进行中', submitted: '已交卷', passed: '已通过', failed: '未通过', timeout: '超时交卷' } as any)[s] || s;
}
function statusType(s: string) {
  return ({ passed: 'success', failed: 'danger', timeout: 'warning', in_progress: 'primary', submitted: 'info' } as any)[s] || 'info';
}

onMounted(async () => {
  loading.value = true;
  try {
    const d: any = await http.get('/exams/records');
    list.value = d.list;
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.score-cell { font-weight: 600; }
.score-cell.passed { color: #1d7a52; }
.score-cell.failed { color: #b42318; }
</style>
