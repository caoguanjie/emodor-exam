<template>
  <div v-if="paper" class="page-card">
    <div class="toolbar">
      <el-button text @click="$router.push('/admin/papers')"><el-icon><ArrowLeft /></el-icon>返回</el-button>
      <el-divider direction="vertical" />
      <div class="detail-head">
        <h2 class="detail-title">{{ paper.title }}</h2>
        <el-tag :type="paper.status === 'published' ? 'success' : paper.status === 'draft' ? 'info' : 'warning'" size="small">
          {{ ({ draft: '草稿', published: '已发布', archived: '已归档' } as any)[paper.status] }}
        </el-tag>
        <el-tag :type="sumScore === 100 ? 'success' : 'danger'" size="small">分值合计 {{ sumScore }} / 100</el-tag>
      </div>
      <div style="flex:1" />
      <el-button v-if="paper.status === 'draft' && auth.can('papers:publish')" type="success" :disabled="sumScore !== 100 || sumScore !== persistedSum"
        @click="onPublish">发布试卷（SUM=100）</el-button>
      <el-button v-if="paper.status === 'published' && auth.can('papers:write')" type="warning" plain @click="onArchive">归档</el-button>
    </div>

    <el-alert v-if="paper.status !== 'draft'" type="info" :closable="false" style="margin-bottom:14px"
      title="已发布试卷：题目组成与分值锁定；及格线 / 漏选比例 / 限时 / 补考次数仍可调整（按各自生效边界对后续作答生效）" />

    <el-card shadow="never" style="margin-bottom:16px">
      <template #header>考试策略</template>
      <el-form inline label-width="130px">
        <el-form-item label="及格线">
            <el-input-number v-model="strategy.pass_score" :min="1" :max="100" :disabled="strategyLocked || !auth.can('papers:write')" />
        </el-form-item>
        <el-form-item label="限时（分钟）">
            <el-input-number v-model="strategy.duration_minutes" :min="1" :max="300" :disabled="strategyLocked || !auth.can('papers:write')" />
        </el-form-item>
        <el-form-item label="最大作答次数">
            <el-input-number v-model="strategy.max_attempts" :min="1" :max="10" :disabled="strategyLocked || !auth.can('papers:write')" />
        </el-form-item>
        <el-form-item label="漏选部分分比例">
            <el-input-number v-model="strategy.partial_credit_ratio" :min="0" :max="1" :step="0.1" :disabled="strategyLocked || !auth.can('papers:write')" />
        </el-form-item>
        <el-form-item>
          <el-button v-if="auth.can('papers:write')" type="primary" :disabled="strategyLocked" @click="saveStrategy">保存策略</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" style="margin-bottom:16px">
      <template #header>
        <div style="display:flex; justify-content:space-between; align-items:center">
          <span>题目组成（{{ paper.questions?.length || 0 }} 题，{{ sumScore }} 分）</span>
          <el-button v-if="paper.status === 'draft' && auth.can('papers:write')" type="primary" @click="pickVisible = true">选题入卷</el-button>
        </div>
      </template>
      <el-table :data="paper.questions || []">
        <el-table-column prop="sort" label="顺序" width="70" />
        <el-table-column prop="stem" label="题干" min-width="280" show-overflow-tooltip />
        <el-table-column label="题型" width="80">
          <template #default="{ row }">{{ row.type === 'single' ? '单选' : '多选' }}</template>
        </el-table-column>
        <el-table-column label="分值" width="180">
          <template #default="{ row }">
            <el-input-number v-model="row.score" :min="0.5" :max="100" :step="0.5" size="small"
              :disabled="paper.status !== 'draft' || !auth.can('papers:write')" @change="dirty = true" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button v-if="paper.status === 'draft' && auth.can('papers:write')" text size="small" type="danger" @click="removeOne(row)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-button v-if="paper.status === 'draft' && auth.can('papers:write') && (dirty || sumScore !== persistedSum)" type="primary" style="margin-top:14px"
        @click="saveQuestions">保存题目组成</el-button>
    </el-card>

    <el-dialog v-model="pickVisible" title="选题入卷（仅已通过审核的题目）" width="760px">
      <el-table ref="pickTableRef" :data="candidates" @selection-change="(rows: any[]) => (picked = rows)">
        <el-table-column type="selection" width="50" />
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="stem" label="题干" min-width="280" show-overflow-tooltip />
        <el-table-column label="题型" width="80">
          <template #default="{ row }">{{ row.type === 'single' ? '单选' : '多选' }}</template>
        </el-table-column>
        <el-table-column prop="score" label="建议分值" width="90" />
      </el-table>
      <template #footer>
        <el-button @click="pickVisible = false">取消</el-button>
        <el-button v-if="auth.can('papers:write')" type="primary" @click="addPicked">加入试卷（默认带出建议分值）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft } from '@element-plus/icons-vue';
import http from '../../api/http';
import { useAuthStore } from '../../stores/auth';

const route = useRoute();
const paperId = String(route.params.id);
const auth = useAuthStore();

const paper = ref<any>(null);
const strategy = reactive<any>({});
// 考试策略（及格线/限时/补考/漏选比例）发布后仍可调，仅归档锁定（后端 updateStrategy 仅拦 archived，NFR-15）；
// 题目组成与分值才是发布后锁定（paper.status !== 'draft'）
const strategyLocked = computed(() => paper.value?.status === 'archived');
const dirty = ref(false);
const pickVisible = ref(false);
const candidates = ref<any[]>([]);
const picked = ref<any[]>([]);

const sumScore = computed(() =>
  Math.round((paper.value?.questions || []).reduce((a: number, q: any) => a + Number(q.score || 0), 0) * 100) / 100,
);
// 服务端已持久化的分值合计：与本地合计不一致即视为有未保存改动
//（el-input-number 聚焦中回车不改写 dirty，单靠 @change 会漏掉「改了分值但未失焦」的场景）
const persistedSum = ref(0);

async function load() {
  paper.value = await http.get(`/ai/papers/${paperId}`);
  Object.assign(strategy, {
    pass_score: paper.value.pass_score,
    duration_minutes: paper.value.duration_minutes,
    max_attempts: paper.value.max_attempts,
    partial_credit_ratio: paper.value.partial_credit_ratio,
  });
  persistedSum.value = sumScore.value;
  dirty.value = false;
}

async function saveStrategy() {
  await http.put(`/ai/papers/${paperId}`, strategy);
  ElMessage.success('策略已保存');
  await load();
}

async function loadCandidates() {
  const d: any = await http.get('/ai/questions', {
    params: { regulation_id: paper.value.regulation_id, status: 'approved', page_size: 100 },
  });
  candidates.value = d.list;
}

async function addPicked() {
  const items = [
    ...(paper.value.questions || []).map((q: any) => ({ question_id: q.question_id, score: Number(q.score) })),
    ...picked.value.map((q: any) => ({ question_id: q.id, score: Number(q.score) })),
  ];
  if (!items.length) return;
  await http.put(`/ai/papers/${paperId}/questions`, { items });
  ElMessage.success('已加入试卷');
  pickVisible.value = false;
  await load();
}

function removeOne(row: any) {
  paper.value.questions = paper.value.questions.filter((q: any) => q.question_id !== row.question_id);
  paper.value.questions.forEach((q: any, i: number) => (q.sort = i));
  dirty.value = true;
}

async function saveQuestions() {
  const items = (paper.value.questions || []).map((q: any) => ({ question_id: q.question_id, score: Number(q.score) }));
  await http.put(`/ai/papers/${paperId}/questions`, { items });
  ElMessage.success('题目组成已保存');
  await load();
}

async function onPublish() {
  await ElMessageBox.confirm('发布前校验题目分值合计 = 100 分。确认发布？', '发布试卷', { type: 'warning' });
  await http.post(`/ai/papers/${paperId}/publish`);
  ElMessage.success('发布成功，范围内员工可发起考试');
  await load();
}

async function onArchive() {
  await ElMessageBox.confirm('归档后不可再发起新作答，历史数据保留。确认归档？', '归档', { type: 'warning' });
  await http.post(`/ai/papers/${paperId}/archive`);
  await load();
}

onMounted(async () => {
  await load();
  await loadCandidates();
});
</script>

<style scoped>
.detail-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.detail-title { font-size: 18px; font-weight: 600; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 380px; }
:deep(.el-card) { border-radius: var(--re-radius); border: 1px solid var(--re-border); box-shadow: var(--re-shadow-card); }
:deep(.el-card__header) { font-weight: 600; }
</style>
