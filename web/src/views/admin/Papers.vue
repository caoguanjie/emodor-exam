<template>
  <div class="page-card">
    <div class="page-head">
      <div class="eyebrow">管理台</div>
      <h2>试卷管理</h2>
      <p class="desc">培训卷按发布版本冻结规则与题目内容；历史固定卷保留原学习门槛与冻结结果。</p>
    </div>

    <el-tabs v-model="activeScope" @tab-change="load">
      <el-tab-pane label="培训考试" name="training" />
      <el-tab-pane label="历史固定卷" name="regulation" />
    </el-tabs>

    <template v-if="activeScope === 'training'">
      <div class="toolbar">
        <el-input v-model="trainingQuery.keyword" placeholder="试卷标题" clearable style="width:220px" @keyup.enter="searchTraining" />
        <el-select v-model="trainingQuery.category_id" placeholder="培训类别" clearable style="width:180px" @change="searchTraining">
          <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-select v-model="trainingQuery.mode" placeholder="组卷模式" clearable style="width:140px" @change="searchTraining">
          <el-option label="固定组卷" value="fixed" /><el-option label="随机组卷" value="random" />
        </el-select>
        <el-select v-model="trainingQuery.status" placeholder="状态" clearable style="width:140px" @change="searchTraining">
          <el-option v-for="item in trainingStatuses" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <div style="flex:1" />
        <el-button v-if="auth.can('papers:write')" type="primary" @click="openTrainingCreate">创建培训试卷</el-button>
      </div>
      <el-table v-loading="loading" :data="trainingItems">
        <el-table-column prop="title" label="试卷" min-width="220" />
        <el-table-column label="类别" min-width="150"><template #default="{ row }">{{ categoryName(row.category_id) }}</template></el-table-column>
        <el-table-column label="模式" width="110"><template #default="{ row }">{{ row.mode === 'fixed' ? '固定组卷' : '随机组卷' }}</template></el-table-column>
        <el-table-column label="规则" min-width="230"><template #default="{ row }">{{ ruleSummary(row) }}</template></el-table-column>
        <el-table-column label="学习门槛" width="100"><template #default="{ row }">{{ row.requires_learning ? '开启' : '关闭' }}</template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><el-button size="small" type="primary" @click="openDetail(row.id, 'training')">配置</el-button></template></el-table-column>
      </el-table>
      <el-pagination class="pager" layout="total, prev, pager, next" :total="trainingTotal" :page-size="trainingQuery.page_size"
        v-model:current-page="trainingQuery.page" @current-change="loadTraining" />
    </template>

    <template v-else>
      <el-alert type="info" :closable="false" title="历史固定卷保留原学习门槛与冻结结果；资料管理和新建入口已取消。" style="margin-bottom:14px" />
      <div class="toolbar">
        <el-input v-model="legacyQuery.regulation_id" placeholder="按历史资料 ID 筛选" clearable style="width:220px" @keyup.enter="loadLegacy" />
        <el-select v-model="legacyQuery.status" placeholder="状态" clearable style="width:140px" @change="loadLegacy">
          <el-option label="草稿" value="draft" /><el-option label="已发布" value="published" /><el-option label="已归档" value="archived" />
        </el-select>
        <div style="flex:1" />
      </div>
      <el-table v-loading="loading" :data="legacyItems">
        <el-table-column prop="title" label="试卷" min-width="220" />
        <el-table-column label="历史资料 ID" min-width="150"><template #default="{ row }">{{ row.regulation_id }}</template></el-table-column>
        <el-table-column label="及格线 / 限时 / 次数" min-width="220"><template #default="{ row }">{{ row.pass_score }} 分 · {{ row.duration_minutes }} 分钟 · {{ row.max_attempts }} 次</template></el-table-column>
        <el-table-column label="发布快照" width="130"><template #default="{ row }"><el-tag :type="row.rules_locked ? 'success' : row.status === 'published' ? 'warning' : 'info'">{{ legacyReleaseLabel(row) }}</el-tag></template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><el-button size="small" type="primary" @click="openDetail(row.id, 'regulation')">{{ row.rules_locked ? '查看' : '组卷' }}</el-button></template></el-table-column>
      </el-table>
      <el-pagination class="pager" layout="total, prev, pager, next" :total="legacyTotal" :page-size="legacyQuery.page_size"
        v-model:current-page="legacyQuery.page" @current-change="loadLegacy" />
    </template>

    <el-dialog v-model="trainingCreateVisible" title="创建培训试卷" width="720px" :before-close="beforeTrainingCreateClose">
      <el-form label-width="120px" :disabled="creating">
        <el-form-item label="试卷标题"><el-input v-model="trainingCreate.title" maxlength="128" /></el-form-item>
        <el-form-item label="组卷模式"><el-radio-group v-model="trainingCreate.mode"><el-radio-button value="fixed">固定组卷</el-radio-button><el-radio-button value="random">随机组卷</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="培训类别"><el-select v-model="trainingCreate.category_id" filterable style="width:100%" @change="loadCreateRelations"><el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="资料来源筛选">
          <el-select v-model="trainingCreate.regulation_ids" multiple filterable clearable style="width:100%"><el-option v-for="item in createRegulations" :key="item.id" :label="item.title" :value="item.id" /></el-select>
          <div class="hint">留空时同类别内无资料来源的人工/导入题也可进入题池。</div>
        </el-form-item>
        <el-form-item label="关联课程"><el-select v-model="trainingCreate.course_ids" multiple filterable clearable style="width:100%"><el-option v-for="item in createCourses" :key="item.id" :label="item.title" :value="item.id" /></el-select><div class="hint">课程仅说明覆盖范围，不参与抽题过滤。</div></el-form-item>
        <el-form-item label="学习门槛"><el-switch v-model="trainingCreate.requires_learning" /><span class="hint inline">培训考试默认关闭。</span></el-form-item>
        <el-form-item label="及格线 / 限时"><el-input-number v-model="trainingCreate.pass_score" :min="1" :max="100" /> <el-input-number v-model="trainingCreate.duration_minutes" :min="1" :max="1440" style="margin-left:12px" /></el-form-item>
        <el-form-item label="次数 / 漏选比例"><el-input-number v-model="trainingCreate.max_attempts" :min="1" :max="100" /> <el-input-number v-model="trainingCreate.partial_credit_ratio" :min="0" :max="1" :step="0.1" style="margin-left:12px" /></el-form-item>
        <el-form-item v-if="trainingCreate.mode === 'random'" label="随机规则">
          <div class="rules"><div v-for="(rule, index) in trainingCreate.rules" :key="rule.type" class="rule-row"><span>{{ typeLabel(rule.type) }}</span><el-input-number v-model="rule.count" :min="1" /><el-input-number v-model="rule.score_cents" :min="1" :max="10000" /><span>整数分</span><el-button text type="danger" @click="trainingCreate.rules.splice(index, 1)">移除</el-button></div><el-button size="small" @click="addRule">添加题型规则</el-button><div class="hint">规则总分 {{ createRuleTotal / 100 }} / 100；随机固定本机构初级、外来高级。</div></div>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="closeTrainingCreate">取消</el-button><el-button type="primary" :loading="creating" @click="createTraining">创建草稿</el-button></template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import http from '../../api/http';
import type { Id, Page, PaperMode, PaperRuleInput, QuestionType, TrainingPaperStatus, TrainingPaperSummary } from '../../api/training-types';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { useAuthStore } from '../../stores/auth';

interface NamedOption { id: Id; name?: string; title?: string }
interface TrainingCreateDraft {
  title: string; mode: PaperMode; category_id: Id | ''; regulation_ids: Id[]; course_ids: Id[]; requires_learning: boolean;
  pass_score: number; duration_minutes: number; max_attempts: number; partial_credit_ratio: number; rules: PaperRuleInput[];
}

const router = useRouter();
const auth = useAuthStore();
const activeScope = ref<'training' | 'regulation'>('training');
const loading = ref(false);
const creating = ref(false);
const categories = ref<Array<{ id: Id; name: string }>>([]);
const createRegulations = ref<NamedOption[]>([]);
const createCourses = ref<NamedOption[]>([]);
const trainingItems = ref<TrainingPaperSummary[]>([]);
const trainingTotal = ref(0);
const legacyItems = ref<any[]>([]);
const legacyTotal = ref(0);
const trainingQuery = reactive({ page: 1, page_size: 20, keyword: '', category_id: '', mode: '', status: '' });
const legacyQuery = reactive({ page: 1, page_size: 20, regulation_id: '', status: '' });
const trainingCreateVisible = ref(false);
const trainingCreate = reactive<TrainingCreateDraft>(emptyTrainingCreate());
const trainingCreateDirty = ref(false);
let createBaseline = emptyTrainingCreate();
let relationToken = 0;
let viewContext = 0;
let loadOperation = 0;
let createContext = 0;
let createOperation = 0;
let viewActive = true;
let viewDestroyed = false;
const completedCreateScopes = new Set<'training'>();
const createUnsaved = useUnsavedChanges(trainingCreateDirty, { onDiscard: discardTrainingCreate });
const trainingStatuses = [
  { value: 'draft', label: '草稿' }, { value: 'published', label: '已发布' },
  { value: 'withdrawn', label: '已撤回' }, { value: 'archived', label: '已归档' },
];

function emptyTrainingCreate(): TrainingCreateDraft { return { title: '', mode: 'fixed', category_id: '', regulation_ids: [], course_ids: [], requires_learning: false, pass_score: 60, duration_minutes: 30, max_attempts: 3, partial_credit_ratio: 0.5, rules: [{ type: 'single', count: 1, score_cents: 10000 }] }; }
function snapshotCreate(): TrainingCreateDraft { return JSON.parse(JSON.stringify(trainingCreate)); }
function createPayload(submitted: TrainingCreateDraft): Omit<TrainingCreateDraft, 'rules'> & { rules?: PaperRuleInput[] } { const payload: Omit<TrainingCreateDraft, 'rules'> & { rules?: PaperRuleInput[] } = JSON.parse(JSON.stringify(submitted)); if (submitted.mode === 'fixed') delete payload.rules; return payload; }
function discardTrainingCreate() { createContext += 1; creating.value = false; Object.assign(trainingCreate, JSON.parse(JSON.stringify(createBaseline))); trainingCreateDirty.value = false; trainingCreateVisible.value = false; }
watch(trainingCreate, () => { if (trainingCreateVisible.value) trainingCreateDirty.value = JSON.stringify(snapshotCreate()) !== JSON.stringify(createBaseline); }, { deep: true });
const createRuleTotal = computed(() => trainingCreate.rules.reduce((sum, item) => sum + item.count * item.score_cents, 0));

function typeLabel(type: QuestionType) { return ({ single: '单选', multiple: '多选', judgment: '判断' })[type]; }
function statusLabel(status: TrainingPaperStatus | string) { return ({ draft: '草稿', published: '已发布', withdrawn: '已撤回', archived: '已归档' } as Record<string, string>)[status] || status; }
function statusType(status: TrainingPaperStatus | string) { return status === 'published' ? 'success' : status === 'draft' ? 'info' : 'warning'; }
function categoryName(categoryId: Id) { return categories.value.find((item) => item.id === categoryId)?.name || `类别 ${categoryId}`; }
function ruleSummary(row: TrainingPaperSummary) { return row.mode === 'fixed' ? '手选题单 · 发布时冻结' : row.rules.map((item) => `${typeLabel(item.type)} ${item.count}×${item.score_cents / 100}分`).join('；'); }
function legacyReleaseLabel(row: { status?: string; release_id?: string | null; rules_locked?: boolean }) { if (row.rules_locked && row.release_id) return '内容已冻结'; if (row.status === 'published') return '升级前旧卷'; return '待发布冻结'; }
function openDetail(id: Id | number, scope: 'training' | 'regulation') { void router.push({ path: `/admin/papers/${id}`, query: { scope } }); }
function searchTraining() { trainingQuery.page = 1; void loadTraining(); }
async function load() { if (activeScope.value === 'training') await loadTraining(); else await loadLegacy(); }
function nonBlankParams(source: Record<string, unknown>) { return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== '')); }
async function loadTraining() { const context = viewContext; const operation = ++loadOperation; loading.value = true; try { const data = await http.get('/admin/papers', { params: nonBlankParams(trainingQuery) }) as Page<TrainingPaperSummary>; if (context !== viewContext || operation !== loadOperation) return; trainingItems.value = data.items; trainingTotal.value = data.total; } finally { if (context === viewContext && operation === loadOperation) loading.value = false; } }
async function loadLegacy() { const context = viewContext; const operation = ++loadOperation; loading.value = true; try { const data = await http.get('/ai/papers', { params: nonBlankParams(legacyQuery) }) as any; if (context !== viewContext || operation !== loadOperation) return; legacyItems.value = data.list; legacyTotal.value = data.total; } finally { if (context === viewContext && operation === loadOperation) loading.value = false; } }
async function loadOptions() {
  const context = viewContext;
  if (auth.can('papers:read')) { const data = await http.get('/admin/papers/category-options', { params: { page: 1, page_size: 100 } }) as Page<{ id: Id; name: string }>; if (context !== viewContext) return; categories.value = data.items; }
}
async function loadCreateRelations() {
  const token = ++relationToken; const categoryId = trainingCreate.category_id;
  trainingCreate.regulation_ids = []; trainingCreate.course_ids = []; createRegulations.value = []; createCourses.value = [];
  if (!categoryId) return;
  const [regulationsPage, coursesPage] = await Promise.all([
    http.get('/admin/papers/regulation-options', { params: { category_id: categoryId, page: 1, page_size: 100 } }) as Promise<Page<NamedOption>>,
    http.get('/admin/papers/course-options', { params: { category_id: categoryId, page: 1, page_size: 100 } }) as Promise<Page<NamedOption>>,
  ]);
  if (token !== relationToken || trainingCreate.category_id !== categoryId) return;
  createRegulations.value = regulationsPage.items; createCourses.value = coursesPage.items;
}
function openTrainingCreate() { createContext += 1; creating.value = false; Object.assign(trainingCreate, emptyTrainingCreate(), { category_id: categories.value[0]?.id || '' }); createBaseline = snapshotCreate(); createUnsaved.markClean(); trainingCreateVisible.value = true; void loadCreateRelations(); }
function closeTrainingCreateContext() { createContext += 1; creating.value = false; trainingCreateVisible.value = false; }
async function closeTrainingCreate() { if (await createUnsaved.confirmDiscard()) closeTrainingCreateContext(); }
async function beforeTrainingCreateClose(done: () => void) { if (await createUnsaved.confirmDiscard()) { closeTrainingCreateContext(); done(); } }
function addRule() { const used = new Set(trainingCreate.rules.map((item) => item.type)); const next = (['single', 'multiple', 'judgment'] as QuestionType[]).find((item) => !used.has(item)); if (next) trainingCreate.rules.push({ type: next, count: 1, score_cents: 1000 }); }
function flushCompletedCreates() {
  if (viewDestroyed || !viewActive || completedCreateScopes.size === 0) return;
  const scopes = [...completedCreateScopes];
  completedCreateScopes.clear();
  ElMessage.info('先前的创建请求已完成，可在试卷列表中查看');
  if (scopes.includes('training')) void loadTraining();
}
function reconcileCompletedCreate(scope: 'training') { if (viewDestroyed) return; completedCreateScopes.add(scope); flushCompletedCreates(); }
async function createTraining() {
  if (creating.value) return;
  if (!trainingCreate.title.trim() || !trainingCreate.category_id) { ElMessage.warning('请填写标题并选择培训类别'); return; }
  if (trainingCreate.mode === 'random' && createRuleTotal.value !== 10000) { ElMessage.warning('随机规则总分必须等于 100 分'); return; }
  const context = viewContext; const dialogContext = createContext; const operation = ++createOperation; const submitted = snapshotCreate();
  const payload = createPayload(submitted);
  creating.value = true;
  try {
    const created = await http.post('/admin/papers', payload) as TrainingPaperSummary;
    if (context !== viewContext) { reconcileCompletedCreate('training'); return; }
    if (dialogContext !== createContext || operation !== createOperation || !trainingCreateVisible.value) {
      reconcileCompletedCreate('training');
      return;
    }
    createUnsaved.markClean(); trainingCreateVisible.value = false; ElMessage.success('培训试卷草稿已创建'); openDetail(created.id, 'training');
  } finally { if (context === viewContext && dialogContext === createContext && operation === createOperation) creating.value = false; }
}
onMounted(async () => { await loadOptions(); await loadTraining(); });
function invalidateView() { viewContext += 1; loadOperation += 1; createContext += 1; relationToken += 1; creating.value = false; trainingCreateVisible.value = false; }
onActivated(() => { viewActive = true; flushCompletedCreates(); });
onDeactivated(() => { viewActive = false; invalidateView(); });
onBeforeUnmount(() => { viewDestroyed = true; viewActive = false; invalidateView(); });
</script>

<style scoped>
.pager { margin-top:16px; justify-content:flex-end; }
.hint { color:var(--el-text-color-secondary); font-size:12px; line-height:1.5; margin-top:4px; width:100%; }
.hint.inline { margin-left:10px; width:auto; }
.rules { width:100%; }
.rule-row { display:grid; grid-template-columns:90px 120px 140px 60px 60px; align-items:center; gap:8px; margin-bottom:8px; }
</style>
