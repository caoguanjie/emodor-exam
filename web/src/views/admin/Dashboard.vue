<template>
  <div class="page-card">
    <div v-if="auth.can('statistics:read')" class="toolbar dashboard-toolbar">
      <el-button type="primary" plain @click="router.push('/admin/training-statistics')">
        查看培训统计
      </el-button>
    </div>

    <div v-loading="loading" class="dashboard-body">
      <div v-if="metricCards.length" class="metric-grid">
        <div v-for="card in metricCards" :key="card.key" class="metric-card">
          <span class="metric-label">{{ card.label }}</span>
          <strong class="re-mono">{{ card.value }}</strong>
          <span class="metric-note">{{ card.note }}</span>
        </div>
      </div>

      <div v-if="data?.exam_trend" class="trend-card">
        <div class="panel-title">
          <span>近 7 日考试开考趋势</span>
          <span class="panel-note">Asia/Shanghai · 统计成功创建的考试记录</span>
        </div>
        <div class="trend-list">
          <div v-for="item in data.exam_trend" :key="item.date" class="trend-item">
            <span class="trend-date re-mono">{{ item.date.slice(5) }}</span>
            <div class="trend-track"><div class="trend-bar" :style="{ width: trendWidth(item.count) }" /></div>
            <b class="re-mono">{{ item.count }}</b>
          </div>
        </div>
      </div>

      <el-empty v-if="!loading && !metricCards.length && !data?.exam_trend" description="当前账号没有可展示的首页指标" />
      <p v-if="data" class="as-of">统计时点：{{ formatTime(data.as_of) }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import http from '../../api/http';
import type { AdminDashboard } from '../../api/training-types';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const loading = ref(false);
const data = ref<AdminDashboard | null>(null);

const metricCards = computed(() => {
  const metrics = data.value?.metrics;
  if (!metrics) return [];
  const candidates = [
    { key: 'learner_count', label: '正常学员', value: metrics.learner_count, note: '当前启用且非管理身份' },
    { key: 'question_count', label: '题目总数', value: metrics.question_count, note: '当前题库题目记录' },
    { key: 'paper_count', label: '试卷总数', value: metrics.paper_count, note: '含各状态试卷' },
  ];
  return candidates.filter((item) => item.value !== undefined);
});

const maxTrend = computed(() => Math.max(1, ...(data.value?.exam_trend || []).map((item) => item.count)));
function trendWidth(value: number) { return `${Math.round((value / maxTrend.value) * 100)}%`; }
function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Shanghai' }).format(new Date(value));
}

let loadEpoch = 0;
async function load() {
  const epoch = ++loadEpoch;
  loading.value = true;
  try {
    const response = await http.get('/admin/dashboard') as AdminDashboard;
    if (epoch === loadEpoch) data.value = response;
  } finally {
    if (epoch === loadEpoch) loading.value = false;
  }
}

let initialActivationSeen = false;
onMounted(load);
onActivated(() => {
  if (!initialActivationSeen) {
    initialActivationSeen = true;
    return;
  }
  void load();
});
</script>

<style scoped>
.dashboard-toolbar{justify-content:flex-end}.dashboard-body{min-height:280px}.metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.metric-card{display:flex;flex-direction:column;gap:6px;padding:20px;border:1px solid var(--re-border);border-radius:var(--re-radius);background:linear-gradient(145deg,#fff,#f8faff)}.metric-card strong{font-size:32px;color:var(--re-primary)}.metric-label{font-size:13px;color:var(--re-text-2)}.metric-note,.panel-note,.as-of{font-size:12px;color:var(--re-text-3)}.trend-card{margin-top:18px;padding:20px;border:1px solid var(--re-border);border-radius:var(--re-radius);background:#fff}.panel-title{display:flex;align-items:center;justify-content:space-between;font-weight:600;margin-bottom:18px}.trend-list{display:grid;gap:12px}.trend-item{display:grid;grid-template-columns:52px 1fr 40px;align-items:center;gap:12px}.trend-date{font-size:12px;color:var(--re-text-2)}.trend-track{height:12px;background:#eef1f6;border-radius:999px;overflow:hidden}.trend-bar{height:100%;border-radius:999px;background:linear-gradient(90deg,#6d87e0,var(--re-primary));transition:width .25s}.trend-item b{text-align:right}.as-of{text-align:right;margin:16px 0 0}@media(max-width:1100px){.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
