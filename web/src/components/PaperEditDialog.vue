<template>
  <el-dialog v-model="visible" title="修改试卷" width="720px" class="re-form-dialog paper-edit-dialog" :before-close="beforeClose">
    <div v-if="loading" v-loading="true" class="paper-edit-loading" aria-label="正在加载试卷配置" />
    <el-form v-if="loaded" label-width="120px" label-position="left" :disabled="loading || saving" @submit.prevent>
      <el-form-item label="试卷名称" required><el-input v-model="form.title" maxlength="128" /></el-form-item>
      <el-form-item label="组卷方式">{{ loadedMode === 'random' ? '随机试卷' : '固定试卷' }}（不可变更）</el-form-item>
      <el-form-item label="考试时间" required>
        <el-input v-model.number="form.duration_minutes" class="paper-value-input" type="number" inputmode="numeric" :min="1" :max="1440" :step="1" placeholder="请输入考试时间"><template #append>分钟</template></el-input>
      </el-form-item>
      <el-form-item v-if="!publicRandom" label="培训类别" required>
        <el-select v-model="form.category_id" :disabled="categoryLocked" filterable style="width:100%" @change="onCategoryChange"><el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" /></el-select>
        <div v-if="categoryLocked" class="hint">已有试题，培训类别不可修改</div>
      </el-form-item>
      <el-form-item v-else label="题池范围">公共题库（跨培训类别）</el-form-item>
      <el-form-item label="试卷总分" required>
        <el-input v-model.number="form.total_score" class="paper-value-input" type="number" inputmode="decimal" :min="0.01" :max="999.99" :step="0.01" placeholder="请输入试卷总分"><template #append>分</template></el-input>
      </el-form-item>
      <el-form-item label="及格分数" required>
        <el-input v-model.number="form.pass_score" class="paper-value-input" type="number" inputmode="decimal" :min="0.01" :max="form.total_score" :step="0.01" placeholder="请输入及格分数"><template #append>分</template></el-input>
      </el-form-item>
      <el-form-item v-if="loadedMode === 'random'" label="随机抽题规则" required><RandomPaperRules v-model="form.rules" :total-score="form.total_score" :disabled="loading || saving" /></el-form-item>
      <el-form-item label="最多考试次数" required>
        <el-input v-model.number="form.max_attempts" class="paper-value-input" type="number" inputmode="numeric" :min="1" :max="100" :step="1"><template #append>次</template></el-input>
        <div class="hint">成功开考即占一次，超时未交卷也计次。已有考试归属沿用首次开考时冻结的次数上限。</div>
      </el-form-item>
      <el-form-item label="考前学习要求"><el-switch v-model="form.requires_learning" /></el-form-item>
      <template v-if="form.requires_learning">
        <el-form-item label="关联课程" required><el-select v-model="form.course_ids" multiple filterable clearable style="width:100%"><el-option v-for="item in courses" :key="item.id" :label="item.title" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="累计学习时长" required>
          <el-input v-model.number="form.required_learning_minutes" class="paper-value-input" type="number" inputmode="numeric" :min="1" :max="2147483647" :step="1" placeholder="请输入累计学习时长"><template #append>分钟</template></el-input>
          <div class="hint">所选课程的累计有效学习时长达到要求后，学员才可开考。</div>
        </el-form-item>
      </template>
      <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" :rows="3" :maxlength="1000" show-word-limit placeholder="选填" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="saving" @click="requestClose">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="loading || saving || !loaded" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api/http';
import type { Id, Page, PaperMode, PaperRuleInput, PoolScope, TrainingPaperDetail } from '../api/training-types';
import RandomPaperRules from './RandomPaperRules.vue';
import { selectedRandomRules, validateRandomRules } from '../utils/random-paper-rules';
import { useUnsavedChanges } from '../composables/useUnsavedChanges';
import { useAuthStore } from '../stores/auth';

interface BasicConfiguration {
  title: string; category_id: Id | '' | null; duration_minutes: number; total_score: number; pass_score: number;
  requires_learning: boolean; course_ids: Id[]; required_learning_minutes: number | null; remark: string;
  rules: PaperRuleInput[]; max_attempts: number;
}
const props = defineProps<{ categories: Array<{ id: Id; name: string }> }>();
const emit = defineEmits<{ saved: [] }>();
const auth = useAuthStore();
const visible = ref(false);
const loaded = ref(false);
const loading = ref(false);
const saving = ref(false);
const categoryLocked = ref(false);
const loadedMode = ref<PaperMode>('fixed');
const loadedPoolScope = ref<PoolScope>('category');
const publicRandom = computed(() => loadedMode.value === 'random' && loadedPoolScope.value === 'public');
const paperId = ref<Id | null>(null);
const courses = ref<Array<{ id: Id; title: string }>>([]);
const form = reactive<BasicConfiguration>(emptyForm());
const dirty = ref(false);
let baseline = emptyForm();
let loadedCategory: Id | '' | null = '';
let session = 0;
let openRequest = 0;
let courseRequest = 0;
let hydrating = false;
let destroyed = false;
const unsaved = useUnsavedChanges(dirty, {
  onDiscard: invalidateSession,
  canDiscard: () => !saving.value,
  onBlocked: () => ElMessage.warning('正在保存，请等待请求完成'),
});
function emptyForm(): BasicConfiguration {
  return { title: '', category_id: '', duration_minutes: 30, total_score: 100, pass_score: 60, max_attempts: 3, rules: [], requires_learning: false, course_ids: [], required_learning_minutes: null, remark: '' };
}
function snapshot(): BasicConfiguration { return JSON.parse(JSON.stringify(form)); }
function isCurrent(operation: number) { return !destroyed && visible.value && operation === session; }
function canWrite() { return auth.can('papers:read') && auth.can('papers:write'); }
function invalidateSession() {
  session += 1; courseRequest += 1;
  visible.value = false; loading.value = false; saving.value = false; loaded.value = false;
  categoryLocked.value = false; loadedCategory = '';
  loadedMode.value = 'fixed'; loadedPoolScope.value = 'category';
  paperId.value = null; courses.value = []; dirty.value = false;
}
function close() { openRequest += 1; invalidateSession(); }
async function requestClose(): Promise<boolean> {
  if (saving.value) { ElMessage.warning('正在保存，请等待请求完成'); return false; }
  const request = openRequest; const operation = session;
  if (!await unsaved.confirmDiscard(() => request === openRequest && operation === session && !destroyed)) return false;
  if (request !== openRequest || destroyed) return false;
  close(); return true;
}
async function beforeClose(done: () => void) { if (await requestClose() && !visible.value) done(); }
async function open(row: { id: Id; mode?: string; status?: string }) {
  if (destroyed || !canWrite() || !['fixed', 'random'].includes(row.mode || '') || row.status !== 'draft' || saving.value) return;
  const request = ++openRequest;
  if (!await unsaved.confirmDiscard(() => request === openRequest && !destroyed)) return;
  if (request !== openRequest || destroyed || !canWrite()) return;
  invalidateSession();
  const operation = session;
  paperId.value = row.id; loading.value = true; visible.value = true;
  try {
    const detail = await http.get(`/admin/papers/${row.id}`) as TrainingPaperDetail;
    if (!isCurrent(operation)) return;
    if (!canWrite() || detail.status !== 'draft' || detail.mode !== row.mode || (detail.pool_scope === 'public' && detail.mode !== 'random')) {
      ElMessage.warning('当前试卷已不可修改，请刷新列表'); close(); return;
    }
    loadedCategory = detail.category_id;
    loadedMode.value = detail.mode; loadedPoolScope.value = detail.pool_scope || 'category';
    categoryLocked.value = detail.mode === 'fixed' && detail.questions.length > 0;
    hydrating = true;
    Object.assign(form, {
      title: detail.title, category_id: detail.category_id, duration_minutes: Number(detail.duration_minutes),
      total_score: Number(detail.total_score), pass_score: Number(detail.pass_score),
      max_attempts: Number(detail.max_attempts), rules: detail.rules.map(rule => ({ ...rule })),
      requires_learning: detail.requires_learning,
      course_ids: detail.requires_learning ? [...detail.course_ids] : [],
      required_learning_minutes: detail.requires_learning ? detail.required_learning_minutes : null,
      remark: detail.remark || '',
    });
    baseline = snapshot(); hydrating = false;
    loaded.value = true; unsaved.markClean();
    await loadCourses(operation);
  } catch { if (isCurrent(operation)) close(); }
  finally { if (isCurrent(operation)) loading.value = false; }
}
async function loadCourses(operation = session) {
  const request = ++courseRequest; const categoryId = form.category_id;
  const isPublic = publicRandom.value;
  courses.value = [];
  if (!isCurrent(operation) || !loaded.value || !form.requires_learning || (!isPublic && !categoryId)) return;
  try {
    const data = await http.get('/admin/papers/course-options', { params: { ...(isPublic ? { pool_scope: 'public' } : { category_id: categoryId }), page: 1, page_size: 100 } }) as Page<{ id: Id; title: string }>;
    if (!isCurrent(operation) || request !== courseRequest || publicRandom.value !== isPublic || form.category_id !== categoryId || !form.requires_learning) return;
    courses.value = data.items;
  } catch { /* The shared interceptor reports failures; retain the current user input. */ }
}
function onCategoryChange() {
  if (categoryLocked.value) { form.category_id = loadedCategory; return; }
  form.course_ids = []; void loadCourses();
}
watch(form, () => {
  if (!hydrating && visible.value && loaded.value) dirty.value = JSON.stringify(snapshot()) !== JSON.stringify(baseline);
}, { deep: true, flush: 'sync' });
watch(() => form.requires_learning, enabled => {
  if (hydrating || !visible.value || !loaded.value) return;
  if (!enabled) { form.course_ids = []; form.required_learning_minutes = null; }
  void loadCourses();
}, { flush: 'sync' });
function validPoints(value: number) { return Number.isFinite(value) && value > 0 && value <= 999.99 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7; }
function validate(): boolean {
  if (!form.title.trim() || (!publicRandom.value && !form.category_id)) { ElMessage.warning('请填写试卷名称，类别题池须选择培训类别'); return false; }
  if (Array.from(form.title).length > 128) { ElMessage.warning('试卷名称最多 128 个字符'); return false; }
  if (!Number.isInteger(form.duration_minutes) || form.duration_minutes < 1 || form.duration_minutes > 1440) { ElMessage.warning('考试时间须为 1–1440 的整数分钟'); return false; }
  if (!validPoints(form.total_score)) { ElMessage.warning('试卷总分须为 0.01～999.99 分，最多两位小数'); return false; }
  if (!validPoints(form.pass_score) || form.pass_score > form.total_score) { ElMessage.warning('及格分数须大于 0，且不能超过试卷总分，最多两位小数'); return false; }
  if (!Number.isInteger(form.max_attempts) || form.max_attempts < 1 || form.max_attempts > 100) { ElMessage.warning('最多考试次数须为 1–100 的整数'); return false; }
  if (loadedMode.value === 'random') { const error = validateRandomRules(form.rules, form.total_score); if (error) { ElMessage.warning(error); return false; } }
  if (form.requires_learning && !form.course_ids.length) { ElMessage.warning('请至少选择一门关联课程'); return false; }
  const minutes = form.required_learning_minutes;
  if (form.requires_learning && (minutes === null || !Number.isInteger(minutes) || minutes < 1 || minutes > 2147483647)) { ElMessage.warning('累计学习时长须为 1–2147483647 的整数分钟'); return false; }
  if (Array.from(form.remark).length > 1000) { ElMessage.warning('备注最多 1000 个字符'); return false; }
  return true;
}
async function save() {
  if (saving.value || loading.value || !loaded.value || !paperId.value || !canWrite() || !validate()) return;
  const operation = session; const id = paperId.value; const submitted = snapshot();
  if (categoryLocked.value) submitted.category_id = loadedCategory;
  saving.value = true;
  try {
    await http.put(`/admin/papers/${id}`, {
      title: submitted.title.trim(), category_id: publicRandom.value ? null : submitted.category_id, duration_minutes: submitted.duration_minutes,
      total_score: submitted.total_score, pass_score: submitted.pass_score,
      max_attempts: submitted.max_attempts,
      ...(loadedMode.value === 'random' ? { pool_scope: loadedPoolScope.value, rules: selectedRandomRules(submitted.rules) } : { preserve_questions: true }),
      requires_learning: submitted.requires_learning,
      course_ids: submitted.requires_learning ? [...submitted.course_ids] : [],
      required_learning_minutes: submitted.requires_learning ? submitted.required_learning_minutes : null,
      remark: submitted.remark.trim() || null,
    });
    if (!isCurrent(operation)) return;
    unsaved.markClean(); close(); ElMessage.success('试卷已修改'); emit('saved');
  } catch { /* Preserve edits on failure and never retry an uncertain write automatically. */ }
  finally { if (isCurrent(operation)) saving.value = false; }
}
onDeactivated(close);
onBeforeUnmount(() => { destroyed = true; close(); });
defineExpose({ open, close });
</script>

<style scoped>
.paper-edit-loading { min-height:160px; }
.paper-value-input { width:100%; }
.paper-value-input :deep(.el-input-group__append) { width:64px; padding:0; }
.paper-value-input :deep(input[type="number"]) { appearance:textfield; -moz-appearance:textfield; }
.paper-value-input :deep(input::-webkit-inner-spin-button),
.paper-value-input :deep(input::-webkit-outer-spin-button) { -webkit-appearance:none; margin:0; }
.hint { color:var(--el-text-color-secondary); font-size:12px; line-height:1.5; margin-top:4px; width:100%; }
</style>
