<template>
  <div class="page-card">
    <div class="page-head">
      <div class="eyebrow">我的学习</div>
      <h2>我的考试</h2>
      <p class="desc">完成有效学习后即可参加考试；倒计时由服务端校准，交卷后自动评分</p>
    </div>
    <el-alert v-if="isMobile" type="warning" :closable="false" style="margin-bottom:16px"
      title="建议使用桌面端 Chrome / Edge 参加考试；离开页面不会暂停服务端计时。" />
    <el-table v-loading="loading" :data="list">
      <el-table-column prop="paper_title" label="试卷" min-width="200" />
      <el-table-column prop="regulation_title" label="所属制度" min-width="180" />
      <el-table-column label="限时 / 补考" width="150">
        <template #default="{ row }">{{ row.duration_minutes }} 分钟 · 最多 {{ row.max_attempts }} 次</template>
      </el-table-column>
      <el-table-column label="我的最高分" width="110">
        <template #default="{ row }"><span class="re-mono score-best">{{ row.best_score ?? '—' }}</span></template>
      </el-table-column>
      <el-table-column label="作答次数" width="90">
        <template #default="{ row }"><span class="re-mono">{{ row.attempt_used }}/{{ row.max_attempts }}</span></template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-tag v-if="row.has_passed" type="success">已通过</el-tag>
          <el-tooltip v-else-if="!row.is_eligible" content="未完成有效学习：先完成学习（时长 + 覆盖底部段）">
            <el-button size="small" disabled>开始考试</el-button>
          </el-tooltip>
          <el-button v-else type="primary" size="small" @click="$router.push(`/my/exams/${row.paper_id}`)">开始考试</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import http from '../../api/http';

const list = ref<any[]>([]);
const loading = ref(false);
const isMobile = /Android|iPhone|Mobile/i.test(navigator.userAgent);

onMounted(async () => {
  loading.value = true;
  try {
    const d: any = await http.get('/exams/papers');
    list.value = d.list;
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.score-best { font-weight: 600; color: var(--re-text); }
</style>
