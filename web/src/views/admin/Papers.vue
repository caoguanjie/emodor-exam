<template>
  <div class="page-card">
    <FitsTable>
      <template #search>
        <FitsListSearch @submit.prevent>
          <el-form-item label="试卷标题"><el-input v-model="trainingQuery.keyword" placeholder="试卷标题" clearable style="width:220px" @keyup.enter="searchTraining" /></el-form-item>
          <el-form-item label="培训类别">
            <el-select v-model="trainingQuery.category_id" placeholder="培训类别" clearable style="width:180px">
              <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="trainingQuery.status" placeholder="状态" clearable style="width:140px">
              <el-option v-for="item in trainingStatuses" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
          <template #actions><el-button type="primary" @click="searchTraining">查询</el-button><el-button @click="resetTrainingQuery">重置</el-button></template>
        </FitsListSearch>
      </template>
      <template v-if="auth.can('papers:write')" #actions>
        <el-button type="primary" @click="openTrainingCreate">新增试卷</el-button>
      </template>
      <el-table v-loading="loading" :data="trainingItems">
        <el-table-column prop="title" label="试卷" min-width="220" />
        <el-table-column label="类别" min-width="150"><template #default="{ row }">{{ categoryName(row.category_id) }}</template></el-table-column>
        <el-table-column label="考前学习要求" width="130"><template #default="{ row }">{{ row.requires_learning ? '开启' : '关闭' }}</template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><FitsTableActions><FitsTableAction type="primary" @click="openDetail(row.id, row.mode === 'fixed' && row.status === 'draft' && auth.can('papers:write') && auth.can('questions:read'))">{{ row.mode === 'fixed' && row.status === 'draft' ? '编辑试卷' : '配置' }}</FitsTableAction></FitsTableActions></template></el-table-column>
      </el-table>
      <template #pagination>
        <el-pagination layout="total, prev, pager, next" :total="trainingTotal" :page-size="trainingQuery.page_size"
          v-model:current-page="trainingQuery.page" @current-change="loadTraining" />
      </template>
    </FitsTable>

    <el-dialog v-model="trainingCreateVisible" title="新增试卷" width="720px" class="re-form-dialog" :before-close="beforeTrainingCreateClose">
      <el-form label-width="120px" label-position="left" :disabled="creating" @submit.prevent>
        <el-form-item label="试卷名称" required><el-input v-model="trainingCreate.title" maxlength="128" /></el-form-item>
        <el-form-item label="考试时间" required>
          <el-input v-model.number="trainingCreate.duration_minutes" class="paper-value-input" type="number" inputmode="numeric" :min="1" :max="1440" :step="1" placeholder="请输入考试时间">
            <template #append>分钟</template>
          </el-input>
        </el-form-item>
        <el-form-item label="培训类别" required><el-select v-model="trainingCreate.category_id" filterable style="width:100%" @change="onCreateCategoryChange"><el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="试卷总分" required>
          <el-input v-model.number="trainingCreate.total_score" class="paper-value-input" type="number" inputmode="decimal" :min="0.01" :max="999.99" :step="0.01" placeholder="请输入试卷总分">
            <template #append>分</template>
          </el-input>
        </el-form-item>
        <el-form-item label="及格分数" required>
          <el-input v-model.number="trainingCreate.pass_score" class="paper-value-input" type="number" inputmode="decimal" :min="0.01" :max="trainingCreate.total_score" :step="0.01" placeholder="请输入及格分数">
            <template #append>分</template>
          </el-input>
        </el-form-item>
        <el-form-item label="考前学习要求"><el-switch v-model="trainingCreate.requires_learning" /></el-form-item>
        <template v-if="trainingCreate.requires_learning">
          <el-form-item label="关联课程" required><el-select v-model="trainingCreate.course_ids" multiple filterable clearable style="width:100%"><el-option v-for="item in createCourses" :key="item.id" :label="item.title" :value="item.id" /></el-select></el-form-item>
          <el-form-item label="累计学习时长" required>
            <el-input v-model.number="trainingCreate.required_learning_minutes" class="paper-value-input" type="number" inputmode="numeric" :min="1" :max="2147483647" :step="1" placeholder="请输入累计学习时长">
              <template #append>分钟</template>
            </el-input>
            <div class="hint">所选课程的累计有效学习时长达到要求后，学员才可开考。</div>
          </el-form-item>
        </template>
        <el-form-item label="备注"><el-input v-model="trainingCreate.remark" type="textarea" :rows="3" :maxlength="1000" show-word-limit placeholder="选填" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="creating" @click="closeTrainingCreate">取消</el-button>
        <el-button :loading="creating && createAction === 'save'" :disabled="creating" @click="createTraining('save')">保存草稿</el-button>
        <el-button type="primary" :loading="creating && createAction === 'design'" :disabled="creating" @click="createTraining('design')">保存并组卷</el-button>
      </template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch } from 'vue';
import { FitsTable, FitsListSearch, FitsTableActions, FitsTableAction } from '../../components/FitsTable';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import http from '../../api/http';
import type { Id, Page, TrainingPaperStatus, TrainingPaperSummary } from '../../api/training-types';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { useAuthStore } from '../../stores/auth';

interface NamedOption { id: Id; name?: string; title?: string }
interface TrainingCreateDraft {
  title: string; category_id: Id | ''; course_ids: Id[]; requires_learning: boolean;
  required_learning_minutes: number | null; remark: string;
  total_score: number; pass_score: number; duration_minutes: number;
}
type TrainingCreatePayload = Omit<TrainingCreateDraft, 'remark'> & { mode: 'fixed'; remark: string | null };

const router = useRouter();
const auth = useAuthStore();
const loading = ref(false);
const creating = ref(false);
const createAction = ref<'save' | 'design'>('design');
const categories = ref<Array<{ id: Id; name: string }>>([]);
const createCourses = ref<NamedOption[]>([]);
const trainingItems = ref<TrainingPaperSummary[]>([]);
const trainingTotal = ref(0);
const trainingQuery = reactive({ page: 1, page_size: 20, keyword: '', category_id: '', status: '' });
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
];

function emptyTrainingCreate(): TrainingCreateDraft { return { title: '', category_id: '', course_ids: [], requires_learning: false, required_learning_minutes: null, remark: '', total_score: 100, pass_score: 60, duration_minutes: 30 }; }
function snapshotCreate(): TrainingCreateDraft { return JSON.parse(JSON.stringify(trainingCreate)); }
function createPayload(submitted: TrainingCreateDraft): TrainingCreatePayload {
  return {
    title: submitted.title,
    mode: 'fixed',
    category_id: submitted.category_id,
    course_ids: submitted.requires_learning ? [...submitted.course_ids] : [],
    requires_learning: submitted.requires_learning,
    required_learning_minutes: submitted.requires_learning ? submitted.required_learning_minutes : null,
    remark: submitted.remark.trim() || null,
    total_score: submitted.total_score,
    pass_score: submitted.pass_score,
    duration_minutes: submitted.duration_minutes,
  };
}
function discardTrainingCreate() { createContext += 1; relationToken += 1; creating.value = false; trainingCreateVisible.value = false; Object.assign(trainingCreate, JSON.parse(JSON.stringify(createBaseline))); trainingCreateDirty.value = false; createCourses.value = []; }
watch(trainingCreate, () => { if (trainingCreateVisible.value) trainingCreateDirty.value = JSON.stringify(snapshotCreate()) !== JSON.stringify(createBaseline); }, { deep: true });
watch(() => trainingCreate.requires_learning, (enabled) => {
  if (!trainingCreateVisible.value) return;
  if (!enabled) { trainingCreate.course_ids = []; trainingCreate.required_learning_minutes = null; }
  void loadCreateRelations();
}, { flush: 'sync' });

function statusLabel(status: TrainingPaperStatus | string) { return ({ draft: '草稿', published: '已发布', withdrawn: '已撤回', archived: '已归档' } as Record<string, string>)[status] || status; }
function statusType(status: TrainingPaperStatus | string) { return status === 'published' ? 'success' : status === 'draft' ? 'info' : 'warning'; }
function categoryName(categoryId: Id) { return categories.value.find((item) => item.id === categoryId)?.name || `类别 ${categoryId}`; }
function openDetail(id: Id | number, designer = false) { void router.push({ path: `/admin/papers/${id}`, query: { scope: 'training', ...(designer ? { designer: '1' } : {}) } }); }
function searchTraining() { trainingQuery.page = 1; void loadTraining(); }
function resetTrainingQuery() { Object.assign(trainingQuery, { page: 1, keyword: '', category_id: '', status: '' }); void loadTraining(); }
function nonBlankParams(source: Record<string, unknown>) { return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== '')); }
async function loadTraining() { const context = viewContext; const operation = ++loadOperation; loading.value = true; try { const data = await http.get('/admin/papers', { params: nonBlankParams(trainingQuery) }) as Page<TrainingPaperSummary>; if (context !== viewContext || operation !== loadOperation) return; trainingItems.value = data.items; trainingTotal.value = data.total; } finally { if (context === viewContext && operation === loadOperation) loading.value = false; } }
async function loadOptions() {
  const context = viewContext;
  if (auth.can('papers:read')) { const data = await http.get('/admin/papers/category-options', { params: { page: 1, page_size: 100 } }) as Page<{ id: Id; name: string }>; if (context !== viewContext) return; categories.value = data.items; }
}
async function loadCreateRelations() {
  const token = ++relationToken; const categoryId = trainingCreate.category_id; const context = createContext;
  createCourses.value = [];
  if (!categoryId || !trainingCreate.requires_learning || !trainingCreateVisible.value) return;
  const coursesPage = await http.get('/admin/papers/course-options', { params: { category_id: categoryId, page: 1, page_size: 100 } }) as Page<NamedOption>;
  if (token !== relationToken || context !== createContext || trainingCreate.category_id !== categoryId || !trainingCreate.requires_learning || !trainingCreateVisible.value) return;
  createCourses.value = coursesPage.items;
}
function onCreateCategoryChange() { trainingCreate.course_ids = []; void loadCreateRelations(); }
function openTrainingCreate() { createContext += 1; relationToken += 1; creating.value = false; trainingCreateVisible.value = false; createCourses.value = []; Object.assign(trainingCreate, emptyTrainingCreate(), { category_id: categories.value[0]?.id || '' }); createBaseline = snapshotCreate(); createUnsaved.markClean(); trainingCreateVisible.value = true; }
function closeTrainingCreateContext() { createContext += 1; relationToken += 1; creating.value = false; trainingCreateVisible.value = false; }
async function closeTrainingCreate() { if (await createUnsaved.confirmDiscard()) closeTrainingCreateContext(); }
async function beforeTrainingCreateClose(done: () => void) { if (await createUnsaved.confirmDiscard()) { closeTrainingCreateContext(); done(); } }
function flushCompletedCreates() {
  if (viewDestroyed || !viewActive || completedCreateScopes.size === 0) return;
  const scopes = [...completedCreateScopes];
  completedCreateScopes.clear();
  ElMessage.info('先前的创建请求已完成，可在试卷列表中查看');
  if (scopes.includes('training')) void loadTraining();
}
function reconcileCompletedCreate(scope: 'training') { if (viewDestroyed) return; completedCreateScopes.add(scope); flushCompletedCreates(); }
function validPoints(value: number) { return Number.isFinite(value) && value > 0 && value <= 999.99 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7; }
async function createTraining(action: 'save' | 'design' = 'design') {
  if (creating.value) return;
  if (!trainingCreate.title.trim() || !trainingCreate.category_id) { ElMessage.warning('请填写试卷名称并选择培训类别'); return; }
  if (!Number.isInteger(trainingCreate.duration_minutes) || trainingCreate.duration_minutes < 1 || trainingCreate.duration_minutes > 1440) { ElMessage.warning('考试时间须为 1–1440 的整数分钟'); return; }
  if (!validPoints(trainingCreate.total_score)) { ElMessage.warning('试卷总分须为 0.01～999.99 分，最多两位小数'); return; }
  if (!validPoints(trainingCreate.pass_score) || trainingCreate.pass_score > trainingCreate.total_score) { ElMessage.warning('及格分数须大于 0，且不能超过试卷总分，最多两位小数'); return; }
  if (trainingCreate.requires_learning && !trainingCreate.course_ids.length) { ElMessage.warning('请至少选择一门关联课程'); return; }
  const minutes = trainingCreate.required_learning_minutes;
  if (trainingCreate.requires_learning && (minutes === null || !Number.isInteger(minutes) || minutes < 1 || minutes > 2147483647)) { ElMessage.warning('累计学习时长须为 1–2147483647 的整数分钟'); return; }
  if (Array.from(trainingCreate.remark).length > 1000) { ElMessage.warning('备注最多 1000 个字符'); return; }
  const context = viewContext; const dialogContext = createContext; const operation = ++createOperation; const submitted = snapshotCreate();
  const payload = createPayload(submitted);
  createAction.value = action;
  creating.value = true;
  try {
    const created = await http.post('/admin/papers', payload) as TrainingPaperSummary;
    if (context !== viewContext) { reconcileCompletedCreate('training'); return; }
    if (dialogContext !== createContext || operation !== createOperation || !trainingCreateVisible.value) {
      reconcileCompletedCreate('training');
      return;
    }
    createUnsaved.markClean(); trainingCreateVisible.value = false; ElMessage.success('试卷草稿已保存');
    if (action === 'design') openDetail(created.id, true);
    else await loadTraining();
  } finally { if (context === viewContext && dialogContext === createContext && operation === createOperation) creating.value = false; }
}
onMounted(async () => { await loadOptions(); await loadTraining(); });
function invalidateView() { viewContext += 1; loadOperation += 1; createContext += 1; relationToken += 1; creating.value = false; trainingCreateVisible.value = false; }
onActivated(() => { viewActive = true; flushCompletedCreates(); });
onDeactivated(() => { viewActive = false; invalidateView(); });
onBeforeUnmount(() => { viewDestroyed = true; viewActive = false; invalidateView(); });
</script>

<style scoped>
.paper-value-input { width: 100%; }
.paper-value-input :deep(.el-input-group__append) { width: 64px; padding: 0; }
.paper-value-input :deep(input[type="number"]) { appearance: textfield; -moz-appearance: textfield; }
.paper-value-input :deep(input::-webkit-inner-spin-button),
.paper-value-input :deep(input::-webkit-outer-spin-button) { -webkit-appearance: none; margin: 0; }
.hint { color:var(--el-text-color-secondary); font-size:12px; line-height:1.5; margin-top:4px; width:100%; }
.hint.inline { margin-left:10px; width:auto; }
</style>
