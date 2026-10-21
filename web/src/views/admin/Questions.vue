<template>
  <div class="page-card">
    <div class="page-head">
      <div class="eyebrow">管理台</div>
      <h2>题库与出题</h2>
      <p class="desc">AI 依据制度原文生成题目，人工审核通过后方可入卷</p>
    </div>
      <el-alert
        v-if="!regulations.length"
        type="warning"
        show-icon
        :closable="false"
        title="暂无可出题制度，请先到“制度管理”上传制度，完成解析并发布有效版本。"
        style="margin-bottom:16px"
      />
    <div class="toolbar">
      <el-select v-model="query.regulation_id" placeholder="按制度筛选" clearable filterable style="width:260px" @change="load">
        <el-option v-for="r in regulations" :key="r.id" :label="r.title" :value="r.id" />
      </el-select>
      <el-select v-model="query.status" placeholder="审核状态" clearable style="width:140px" @change="load">
        <el-option label="待审核" value="pending" />
        <el-option label="已通过" value="approved" />
        <el-option label="已驳回" value="rejected" />
      </el-select>
      <el-select v-model="query.type" placeholder="题型" clearable style="width:120px" @change="load">
        <el-option label="单选" value="single" />
        <el-option label="多选" value="multiple" />
      </el-select>
      <div style="flex:1" />
      <el-button @click="manualVisible = true">人工录入题目</el-button>
        <el-button type="primary" :disabled="!regulations.length" @click="genVisible = true">发起 AI 出题</el-button>
    </div>

    <el-table v-loading="loading" :data="list">
        <template #empty>
          <el-empty description="暂无题目；请先创建并发布制度，再发起 AI 出题" :image-size="96" />
        </template>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="stem" label="题干" min-width="280" show-overflow-tooltip />
      <el-table-column label="题型" width="80">
        <template #default="{ row }">{{ row.type === 'single' ? '单选' : '多选' }}</template>
      </el-table-column>
      <el-table-column prop="score" label="建议分值" width="90" />
      <el-table-column label="来源" width="80">
        <template #default="{ row }">{{ row.source === 'ai' ? 'AI' : '人工' }}</template>
      </el-table-column>
      <el-table-column label="审核状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'info'">
            {{ ({ approved: '已通过', pending: '待审核', rejected: '已驳回' } as any)[row.status] }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="230" fixed="right">
        <template #default="{ row }">
          <el-button text size="small" type="primary" @click="openView(row)">查看</el-button>
          <el-button v-if="row.status === 'pending'" text size="small" type="success" @click="review(row, 'approved')">通过</el-button>
          <el-button v-if="row.status !== 'rejected'" text size="small" type="warning" @click="review(row, 'rejected')">驳回</el-button>
          <el-button text size="small" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.source === 'ai'" text size="small" @click="regenerate(row)">重新生成</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination style="margin-top:16px; justify-content:flex-end" layout="total, prev, pager, next" :total="total"
      :page-size="query.page_size" v-model:current-page="query.page" @current-change="load" />

    <!-- 生成任务对话框 -->
    <el-dialog v-model="genVisible" title="发起 AI 出题（异步任务）" width="560px">
        <el-alert
          v-if="!regulations.length"
          type="warning"
          show-icon
          :closable="false"
          title="暂无可用制度，请先到“制度管理”上传、解析并发布制度。"
          style="margin-bottom:16px"
        />
      <el-form label-width="130px">
        <el-form-item label="目标制度">
            <el-select v-model="genForm.regulation_id" filterable style="width:100%" no-data-text="暂无可用制度">
            <el-option v-for="r in regulations" :key="r.id" :label="r.title" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="单选题量（1-40）"><el-input-number v-model="genForm.question_count_single" :min="1" :max="40" /></el-form-item>
        <el-form-item label="单选每题分值"><el-input-number v-model="genForm.score_single" :min="0.5" :max="100" :step="0.5" /></el-form-item>
        <el-form-item label="多选题量（0-20）"><el-input-number v-model="genForm.question_count_multiple" :min="0" :max="20" /></el-form-item>
        <el-form-item label="多选每题分值"><el-input-number v-model="genForm.score_multiple" :min="0.5" :max="100" :step="0.5" /></el-form-item>
        <el-form-item label="分值合计">
          <el-tag :type="sumScore === 100 ? 'success' : 'danger'">{{ sumScore }} / 100 分</el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="genVisible = false">取消</el-button>
        <el-button type="primary" :disabled="sumScore !== 100 || !genForm.regulation_id" @click="startGenerate">发起出题</el-button>
      </template>
    </el-dialog>

    <!-- 任务进度对话框 -->
    <el-dialog v-model="taskVisible" title="出题任务" width="640px" :close-on-click-modal="false">
      <el-result :icon="taskStatus === 'completed' ? 'success' : taskStatus === 'failed' ? 'error' : 'info'"
        :title="({ completed: '生成完成', failed: '生成失败', running: '生成中…', queued: '排队中…' } as any)[taskStatus] || taskStatus">
        <template #sub-title>
          <div v-if="taskStatus === 'completed'">生成 {{ taskData?.question_ids?.length || 0 }} 道题目（status=pending 待审核）</div>
          <div v-else-if="taskStatus === 'failed'" style="color:#f56c6c">{{ taskData?.error }}</div>
          <div v-else style="color:#909399">AI 正在解读制度内容并生成题目，预计 120 秒内完成</div>
        </template>
      </el-result>
      <template #footer>
        <el-button @click="taskVisible = false">关闭</el-button>
        <el-button v-if="taskStatus === 'completed'" type="primary" @click="taskVisible = false; load()">查看题库</el-button>
      </template>
    </el-dialog>

    <!-- 题目查看/编辑 -->
    <el-dialog v-model="editVisible" :title="editMode === 'view' ? '查看题目' : '编辑题目'" width="680px">
      <el-form label-width="80px">
        <el-form-item label="题型"><el-input :value="editForm.type === 'single' ? '单选' : '多选'" disabled /></el-form-item>
        <el-form-item label="题干">
          <el-input v-model="editForm.stem" type="textarea" :rows="3" :disabled="editMode === 'view' || inUseLocked" />
        </el-form-item>
        <el-form-item v-for="(o, i) in editForm.options" :key="i" :label="`选项 ${o.key || String.fromCharCode(65 + i)}`">
          <div style="display:flex; gap:8px; width:100%">
            <el-input v-model="o.text" :disabled="editMode === 'view' || inUseLocked" />
            <el-checkbox :model-value="(editForm.answer || []).includes(i)"
              :disabled="editMode === 'view' || inUseLocked"
              @update:model-value="(v: any) => toggleAnswer(i, v)">正确</el-checkbox>
          </div>
        </el-form-item>
        <el-form-item label="解析"><el-input v-model="editForm.analysis" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="建议分值"><el-input-number v-model="editForm.score" :min="0.5" :max="100" :step="0.5" :disabled="editMode === 'view' || inUseLocked" /></el-form-item>
        <el-alert v-if="inUseLocked" type="warning" :closable="false" title="该题目正被进行中的考试引用，仅允许修改解析（防判分依据漂移）" />
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">关闭</el-button>
        <el-button v-if="editMode === 'edit'" type="primary" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 人工录入 -->
    <el-dialog v-model="manualVisible" title="人工录入题目（免审核直接入卷）" width="680px">
      <el-form label-width="80px">
        <el-form-item label="所属制度">
          <el-select v-model="manualForm.regulation_id" filterable style="width:100%">
            <el-option v-for="r in regulations" :key="r.id" :label="r.title" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="题型">
          <el-radio-group v-model="manualForm.type">
            <el-radio value="single">单选</el-radio>
            <el-radio value="multiple">多选</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="题干"><el-input v-model="manualForm.stem" type="textarea" :rows="3" /></el-form-item>
        <el-form-item v-for="(o, i) in manualForm.options" :key="i" :label="`选项 ${String.fromCharCode(65 + i)}`">
          <div style="display:flex; gap:8px; width:100%">
            <el-input v-model="o.text" />
            <el-checkbox :model-value="manualForm.answer.includes(i)" @update:model-value="(v: any) => toggleManualAnswer(i, v)">正确</el-checkbox>
          </div>
        </el-form-item>
        <el-form-item label="解析"><el-input v-model="manualForm.analysis" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="分值"><el-input-number v-model="manualForm.score" :min="0.5" :max="100" :step="0.5" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="manualVisible = false">取消</el-button>
        <el-button type="primary" @click="saveManual">保存（source=manual）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../../api/http';

const list = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const regulations = ref<any[]>([]);
const query = reactive<any>({ page: 1, page_size: 20, regulation_id: '', status: '', type: '' });

const genVisible = ref(false);
const genForm = reactive<any>({ regulation_id: '', question_count_single: 20, score_single: 3, question_count_multiple: 5, score_multiple: 8 });
const sumScore = computed(() => {
  const s = genForm.question_count_single * genForm.score_single + genForm.question_count_multiple * genForm.score_multiple;
  return Math.round(s * 100) / 100;
});

const taskVisible = ref(false);
const taskStatus = ref('');
const taskData = ref<any>(null);
let pollTimer: number | null = null;

const editVisible = ref(false);
const editMode = ref<'view' | 'edit'>('view');
const editForm = reactive<any>({});
const inUseLocked = ref(false);

const manualVisible = ref(false);
const manualForm = reactive<any>({ regulation_id: '', type: 'single', stem: '', options: [0, 1, 2, 3].map(() => ({ text: '' })), answer: [0], analysis: '', score: 3 });

function toggleAnswer(i: number, checked: any) {
  const set = new Set<number>(editForm.answer || []);
  if (checked) set.add(i);
  else set.delete(i);
  let arr = Array.from(set).sort((a, b) => a - b);
  if (editForm.type === 'single' && arr.length > 1) arr = [i];
  editForm.answer = arr;
}

function toggleManualAnswer(i: number, checked: any) {
  const set = new Set<number>(manualForm.answer || []);
  if (checked) set.add(i);
  else set.delete(i);
  let arr = Array.from(set).sort((a, b) => a - b);
  if (manualForm.type === 'single' && arr.length > 1) arr = [i];
  manualForm.answer = arr;
}

async function load() {
  loading.value = true;
  try {
    const d: any = await http.get('/ai/questions', { params: query });
    list.value = d.list;
    total.value = d.total;
  } finally {
    loading.value = false;
  }
}

async function startGenerate() {
  // 后端 DTO 要求 id 为字符串（bigint 序列化口径），下拉绑定的是数字，提交前显式转换
  const d: any = await http.post('/ai/generate-questions', { ...genForm, regulation_id: String(genForm.regulation_id) });
  genVisible.value = false;
  taskStatus.value = d.status || 'running';
  taskData.value = null;
  taskVisible.value = true;
  // 旧任务的 interval 必须先清理：否则旧回调会误清新任务的轮询句柄（闭环自持 id）
  if (pollTimer) window.clearInterval(pollTimer);
  const timerId = window.setInterval(async () => {
    try {
      const st: any = await http.get(`/ai/generate-status/${d.task_id}`);
      taskStatus.value = st.status;
      taskData.value = st;
      if (st.status === 'completed' || st.status === 'failed') {
        if (pollTimer === timerId) window.clearInterval(timerId);
        if (pollTimer === timerId) pollTimer = null;
      }
    } catch { /* 状态查询失败保留轮询，下一次再试 */ }
  }, 3000);
  pollTimer = timerId;
}

async function review(row: any, status: 'approved' | 'rejected') {
  let reason: string | undefined;
  if (status === 'rejected') {
    const r = await ElMessageBox.prompt('填写驳回意见（可选）', '驳回题目', { inputPlaceholder: '驳回原因' }).catch(() => null);
    if (!r) return;
    reason = r.value;
  }
  await http.put(`/ai/questions/${row.id}/review`, { status, reason });
  ElMessage.success(status === 'approved' ? '已通过' : '已驳回');
  await load();
}

function openView(row: any) {
  editMode.value = 'view';
  inUseLocked.value = false;
  Object.assign(editForm, JSON.parse(JSON.stringify(row)));
  editVisible.value = true;
}

async function openEdit(row: any) {
  editMode.value = 'edit';
  Object.assign(editForm, JSON.parse(JSON.stringify(row)));
  // 被 in_progress 记录引用的题目后端仅允许改 analysis（40908），前端先行提示
  inUseLocked.value = false;
  editVisible.value = true;
}

async function saveEdit() {
  try {
    await http.put(`/ai/questions/${editForm.id}`, {
      stem: editForm.stem,
      options: editForm.options.map((o: any, i: number) => ({ key: o.key || String.fromCharCode(65 + i), text: o.text })),
      answer: editForm.answer,
      analysis: editForm.analysis,
      score: editForm.score,
    });
    ElMessage.success('已保存（判分以当前答案为准）');
    editVisible.value = false;
    await load();
  } catch (e: any) {
    if (e?.code === 40908) {
      inUseLocked.value = true;
      ElMessage.error(e.message);
    }
  }
}

async function regenerate(row: any) {
  await ElMessageBox.confirm('将重新调用 AI 生成替换内容，成功后题目回到待审核，失败则原内容不变。继续？', '重新生成', { type: 'info' });
  await http.post(`/ai/questions/${row.id}/regenerate`);
  ElMessage.success('已重新生成，状态回到待审核');
  await load();
}

async function saveManual() {
  await http.post('/ai/questions', { ...manualForm, regulation_id: String(manualForm.regulation_id) });
  ElMessage.success('已录入（approved，可直接入卷）');
  manualVisible.value = false;
  await load();
}

onMounted(async () => {
  const d: any = await http.get('/regulations', { params: { page_size: 100 } });
  regulations.value = d.list;
  await load();
});

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer);
});
</script>
