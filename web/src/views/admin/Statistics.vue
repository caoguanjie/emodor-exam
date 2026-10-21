<template>
  <div class="page-card">
    <div class="page-head">
      <div class="eyebrow">管理台</div>
      <h2>统计报表</h2>
      <p class="desc">保留旧制度跨试卷口径；培训场次、难度分榜请进入培训统计</p>
    </div>
    <div class="toolbar">
      <el-select v-model="regId" placeholder="选择制度" filterable style="width:300px" @change="loadAll">
        <!-- regId 为字符串（URL/导出参数口径），option value 需同为字符串才能回显标题 -->
        <el-option v-for="r in regulations" :key="r.id" :label="r.title" :value="String(r.id)" />
      </el-select>
      <div style="flex:1" />
      <el-button v-if="auth.can('statistics:read')" type="primary" plain @click="router.push('/admin/training-statistics')">培训统计</el-button>
      <el-button v-if="auth.can('statistics:export')" @click="exportExcel('regulation_overview', '制度维度统计表')">导出制度维度统计表</el-button>
      <el-button v-if="regId && auth.can('statistics:export')" @click="exportExcel('uncompleted', '未完成人员清单')">导出未完成人员清单</el-button>
      <el-button v-if="regId && auth.can('statistics:export')" @click="exportExcel('user_detail', '个人维度明细表')">导出个人维度明细表</el-button>
    </div>

    <template v-if="overview">
      <div class="kpi-grid">
        <div class="kpi-card">
          <span class="kpi-icon" style="--tint:#edf0fc; --fg:#3056d3"><el-icon><User /></el-icon></span>
          <div class="kpi-meta">
            <span class="kpi-label">应学人数</span>
            <span class="kpi-value re-mono">{{ overview.assigned_count }}</span>
            <span class="kpi-foot">发布范围内在职</span>
          </div>
        </div>
        <div class="kpi-card">
          <span class="kpi-icon" style="--tint:#e9f6f0; --fg:#2e9e6b"><el-icon><Reading /></el-icon></span>
          <div class="kpi-meta">
            <span class="kpi-label">学习完成率</span>
            <span class="kpi-value re-mono">{{ (overview.learning.completion_rate * 100).toFixed(1) }}<small>%</small></span>
            <span class="kpi-foot">以有效学习（is_valid）口径</span>
          </div>
        </div>
        <div class="kpi-card">
          <span class="kpi-icon" style="--tint:#fdf3e7; --fg:#d97706"><el-icon><EditPen /></el-icon></span>
          <div class="kpi-meta">
            <span class="kpi-label">参考人数</span>
            <span class="kpi-value re-mono">{{ overview.exam.participant_count }}</span>
            <span class="kpi-foot">至少完成一次作答</span>
          </div>
        </div>
        <div class="kpi-card">
          <span class="kpi-icon" style="--tint:#fdeceb; --fg:#c2402a"><el-icon><Medal /></el-icon></span>
          <div class="kpi-meta">
            <span class="kpi-label">通过率</span>
            <span class="kpi-value re-mono">{{ (overview.exam.pass_rate * 100).toFixed(1) }}<small>%</small></span>
            <span class="kpi-foot">按每人最高分</span>
          </div>
        </div>
      </div>

      <el-row :gutter="14" style="margin-top:14px">
        <el-col :span="10">
          <div class="panel-card">
            <div class="panel-title">分数分布 <span class="panel-note">每人最高分 · 左闭右开</span></div>
            <div v-for="(v, k) in overview.exam.score_distribution" :key="k" class="dist-row">
              <span class="dist-key re-mono">{{ k }}</span>
              <div class="dist-track"><div class="dist-bar" :style="{ width: distPercent(v) + '%' }" /></div>
              <span class="dist-val re-mono">{{ v }}</span>
            </div>
          </div>
        </el-col>
        <el-col :span="7">
          <div class="panel-card panel-center">
            <div class="panel-title">平均分 <span class="panel-note">每人最高分的算术平均</span></div>
            <div class="avg-score re-mono">{{ overview.exam.average_score }}</div>
          </div>
        </el-col>
        <el-col :span="7">
          <div class="panel-card panel-center">
            <div class="panel-title">未完成人员</div>
            <div class="avg-score re-mono" :style="overview.uncompleted_count ? 'color:#c2402a' : 'color:#2e9e6b'">{{ overview.uncompleted_count }}</div>
            <el-button text type="primary" style="margin-top:8px" @click="activeTab = 'uncompleted'">查看清单 →</el-button>
          </div>
        </el-col>
      </el-row>
    </template>

    <el-tabs v-model="activeTab" style="margin-top:28px">
      <el-tab-pane label="全部制度概览" name="all">
        <el-table v-loading="loading" :data="allOverviews">
          <el-table-column prop="title" label="制度" min-width="200" />
          <el-table-column prop="assigned_count" label="应学" width="70" />
          <el-table-column label="完成率" width="90">
            <template #default="{ row }">{{ (row.learning.completion_rate * 100).toFixed(1) }}%</template>
          </el-table-column>
          <el-table-column prop="exam.participant_count" label="参考" width="70" />
          <el-table-column label="通过率" width="90">
            <template #default="{ row }">{{ (row.exam.pass_rate * 100).toFixed(1) }}%</template>
          </el-table-column>
          <el-table-column prop="exam.average_score" label="平均分" width="80" />
          <el-table-column prop="uncompleted_count" label="未完成" width="80" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="部门维度对比" name="departments">
        <el-table v-loading="loading" :data="departments">
          <el-table-column prop="department_name" label="部门" min-width="180" />
          <el-table-column prop="assigned_count" label="应学" width="80" />
          <el-table-column prop="valid_count" label="有效学习" width="90" />
          <el-table-column label="完成率" width="100">
            <template #default="{ row }">{{ (row.completion_rate * 100).toFixed(1) }}%</template>
          </el-table-column>
          <el-table-column prop="participant_count" label="参考" width="80" />
          <el-table-column prop="passed_count" label="通过" width="80" />
          <el-table-column label="通过率" width="100">
            <template #default="{ row }">{{ (row.pass_rate * 100).toFixed(1) }}%</template>
          </el-table-column>
          <el-table-column prop="average_score" label="平均分" width="90" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="未完成人员清单" name="uncompleted">
        <el-table v-loading="loading" :data="uncompleted">
          <el-table-column prop="department_name" label="部门" min-width="130" />
          <el-table-column prop="real_name" label="姓名" width="100" />
          <el-table-column prop="employee_no" label="工号" width="100" />
          <el-table-column prop="type" label="未完成类型" width="110">
            <template #default="{ row }">
              <el-tag :type="row.type === '学习未达标' ? 'warning' : row.type === '考试未通过' ? 'danger' : 'info'" size="small">{{ row.type }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="时长进度" min-width="200">
            <template #default="{ row }">
              <el-progress :percentage="Math.min(100, Math.round((row.total_seconds / row.required_seconds) * 100))"
                :format="() => `${row.total_seconds}/${row.required_seconds}s`" />
            </template>
          </el-table-column>
          <el-table-column label="覆盖" width="110">
            <template #default="{ row }">
              {{ row.covered_count }}/{{ row.total_segments }} 段
              <el-tag v-if="!row.bottom_segment_covered" size="small" type="danger">底部未覆盖</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="best_score" label="最高分" width="80" />
          <el-table-column prop="reason" label="未完成原因" min-width="220" show-overflow-tooltip />
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { User, Reading, EditPen, Medal } from '@element-plus/icons-vue';
import http, { download } from '../../api/http';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const regulations = ref<any[]>([]);
const regId = ref<string>('');
const overview = ref<any>(null);
const allOverviews = ref<any[]>([]);
const departments = ref<any[]>([]);
const uncompleted = ref<any[]>([]);
const loading = ref(false);
const activeTab = ref('all');

function distPercent(v: number) {
  const total = Object.values(overview.value?.exam?.score_distribution || {}).reduce((a: number, b: any) => a + Number(b), 0) || 1;
  return Math.round((v / (total as number)) * 100);
}

// 请求序号守卫：快速切换制度时丢弃慢响应，防旧制度数据覆盖新选择（导出与面板口径不一致）
let loadEpoch = 0;

async function loadAll() {
  if (!regId.value) return;
  const epoch = ++loadEpoch;
  const rid = regId.value;
  loading.value = true;
  try {
    const o: any = await http.get(`/statistics/regulations/${rid}/overview`);
    if (epoch !== loadEpoch) return;
    overview.value = o;
    const d: any = await http.get(`/statistics/regulations/${rid}/departments`);
    if (epoch !== loadEpoch) return;
    departments.value = d.list;
    const u: any = await http.get(`/statistics/regulations/${rid}/uncompleted`);
    if (epoch !== loadEpoch) return;
    uncompleted.value = u.list;
  } finally {
    if (epoch === loadEpoch) loading.value = false;
  }
}

function exportExcel(type: string, name: string) {
  download('/statistics/export', `${name}.xlsx`, { type, regulation_id: regId.value || undefined });
}

onMounted(async () => {
  const d: any = await http.get('/statistics/regulations');
  allOverviews.value = d.list;
  const r: any = await http.get('/regulations', { params: { page_size: 100 } });
  regulations.value = r.list;
  if (r.list.length) {
    regId.value = String(r.list[0].id);
    await loadAll();
  }
});
</script>

<style scoped>
.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.kpi-card {
  display: flex; align-items: center; gap: 14px; padding: 18px;
  border: 1px solid var(--re-border); border-radius: var(--re-radius); background: var(--re-surface);
  transition: box-shadow 0.18s ease, transform 0.18s ease;
}
.kpi-card:hover { box-shadow: var(--re-shadow-pop); transform: translateY(-2px); }
.kpi-icon {
  flex: none; width: 44px; height: 44px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center; font-size: 20px;
  background: var(--tint, #edf0fc); color: var(--fg, #3056d3);
}
.kpi-meta { display: flex; flex-direction: column; min-width: 0; }
.kpi-label { font-size: 12px; color: var(--re-text-3); }
.kpi-value { font-size: 26px; font-weight: 700; line-height: 1.3; color: var(--re-text); }
.kpi-value small { font-size: 14px; font-weight: 600; margin-left: 1px; }
.kpi-foot { font-size: 11px; color: var(--re-text-3); }

.panel-card {
  border: 1px solid var(--re-border); border-radius: var(--re-radius); background: var(--re-surface);
  padding: 18px 20px; height: 100%;
}
.panel-title { font-size: 14px; font-weight: 600; margin-bottom: 14px; }
.panel-note { font-size: 12px; font-weight: 400; color: var(--re-text-3); margin-left: 6px; }
.panel-center { display: flex; flex-direction: column; align-items: center; text-align: center; }
.panel-center .panel-title { margin-bottom: 4px; }
.avg-score { font-size: 40px; font-weight: 700; line-height: 1.4; }

.dist-row { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
.dist-key { width: 64px; font-size: 12px; color: var(--re-text-2); }
.dist-track { flex: 1; height: 8px; border-radius: 4px; background: #eef1f6; overflow: hidden; }
.dist-bar { height: 100%; border-radius: 4px; background: linear-gradient(90deg, #6d87e0, var(--re-primary)); transition: width 0.4s ease; }
.dist-val { width: 36px; text-align: right; font-size: 12px; color: var(--re-text-2); }
</style>
