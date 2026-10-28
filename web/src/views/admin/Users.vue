<template>
  <div class="page-card">
    <FitsTable>
      <template #search>
        <FitsListSearch @submit.prevent>
          <el-form-item label="关键字"><el-input v-model="studentQuery.keyword" placeholder="姓名 / 手机号" clearable @keyup.enter="searchStudents" /></el-form-item>
          <el-form-item label="培训类别">
            <el-select v-model="studentQuery.category_id" clearable placeholder="全部类别" @change="searchStudents">
              <el-option v-for="category in categories" :key="category.id" :label="category.name" :value="category.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="来源">
            <el-select v-model="studentQuery.source" clearable placeholder="全部来源" @change="searchStudents">
              <el-option label="本机构" value="institution" /><el-option label="外来" value="external" />
            </el-select>
          </el-form-item>
          <el-form-item label="状态"><el-select v-model="studentQuery.status" clearable placeholder="全部状态" @change="searchStudents"><el-option label="启用" :value="1" /><el-option label="停用" :value="0" /></el-select></el-form-item>
          <template #actions><el-button type="primary" @click="searchStudents">查询</el-button></template>
        </FitsListSearch>
      </template>
      <template v-if="auth.can('students:write')" #actions>
        <el-button v-if="auth.can('students:write')" type="primary" @click="openStudentCreate">新增学员</el-button>
        <el-upload v-if="auth.can('students:write')" :show-file-list="false" accept=".xlsx" :before-upload="onStudentImport">
          <el-button type="success">预览导入</el-button>
        </el-upload>
        <el-button v-if="auth.can('students:write')" @click="downloadStudentTemplate">下载导入模板</el-button>
      </template>
      <el-table v-loading="studentLoading" :data="students">
        <template #empty><el-empty v-if="!studentLoading" description="暂无学员" /></template>
        <el-table-column label="姓名" min-width="110" show-overflow-tooltip><template #default="{ row }">{{ row.real_name || '-' }}</template></el-table-column>
        <el-table-column label="学员头像" width="100" align="center"><template #default="{ row }"><StudentAvatar :asset-id="row.avatar_id" /></template></el-table-column>
        <el-table-column label="性别" width="70" align="center"><template #default="{ row }">{{ row.gender === 'male' ? '男' : row.gender === 'female' ? '女' : '—' }}</template></el-table-column>
        <el-table-column label="年龄" width="70" align="center"><template #default="{ row }">{{ row.age ?? ageFromBirthday(row.birthday) ?? '—' }}</template></el-table-column>
        <el-table-column label="培训类别" min-width="150" show-overflow-tooltip><template #default="{ row }">{{ categoryName(row.category_id) }}</template></el-table-column>
        <el-table-column label="手机号" min-width="140"><template #default="{ row }">{{ row.phone || '—' }}</template></el-table-column>
        <el-table-column label="创建时间" min-width="165"><template #default="{ row }">{{ formatCreatedAt(row.created_at) }}</template></el-table-column>
        <el-table-column label="来源" width="110">
          <template #default="{ row }">
            <el-switch
              v-if="row.source === 'institution' || row.source === 'external'"
              class="student-quick-switch"
              size="large"
              :model-value="row.source"
              active-value="institution"
              inactive-value="external"
              active-text="本机构"
              inactive-text="外来"
              inline-prompt
              :width="78"
              :aria-label="`${row.real_name || row.username}的来源`"
              :loading="studentRowBusy[row.id] === 'source'"
              :disabled="!auth.can('students:write') || !!studentRowBusy[row.id] || studentLoading"
              @change="updateStudentField(row, 'source', $event)"
            />
            <span v-else>{{ sourceLabel(row.source) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-switch
              class="student-quick-switch"
              size="large"
              :model-value="row.status"
              :active-value="1"
              :inactive-value="0"
              active-text="启用"
              inactive-text="停用"
              inline-prompt
              :width="68"
              :aria-label="`${row.real_name || row.username}的启用状态`"
              :loading="studentRowBusy[row.id] === 'status'"
              :disabled="!auth.can('students:write') || !!studentRowBusy[row.id] || studentLoading"
              @change="updateStudentField(row, 'status', $event)"
            />
          </template>
        </el-table-column>
        <el-table-column v-if="auth.can('students:write') || auth.can('exam_records:read')" label="操作" :width="auth.can('exam_records:read') ? 185 : 100" fixed="right">
          <template #default="{ row }">
            <FitsTableActions>
              <FitsTableAction v-if="auth.can('students:write')" type="primary" :disabled="!!studentRowBusy[row.id]" @click="openStudentEdit(row)">编辑</FitsTableAction>
              <FitsTableAction v-if="auth.can('exam_records:read')" type="primary" @click="openStudentRecords(row)">考试记录</FitsTableAction>
            </FitsTableActions>
          </template>
        </el-table-column>
      </el-table>
      <template #pagination>
        <el-pagination v-model:current-page="studentQuery.page" layout="total, prev, pager, next" :total="studentTotal" :page-size="studentQuery.page_size" @current-change="loadStudents" />
      </template>
    </FitsTable>

      <el-dialog v-model="studentDialog" :title="studentForm.id ? '修改学员' : '新增学员'" width="min(1000px, 94vw)" class="re-form-dialog" destroy-on-close :before-close="beforeStudentDialogClose">
        <el-form label-width="92px" class="student-edit-form" :disabled="studentSaveBusy">
          <el-form-item v-if="studentForm.id && auth.can('students:write')" label="学员照片" class="student-photo-field">
            <MediaUpload v-model="studentForm.avatar_id" purpose="avatar" list-type="picture-card" compact :owner-id="String(studentForm.id)" :disabled="studentBaseline.form.status === 0 || studentSaveBusy" @update:model-value="onStudentAvatarChange" />
            <el-alert
              v-if="studentAvatarSync.status === 'unknown'"
              :title="studentAvatarSync.message"
              type="warning"
              :closable="false"
              show-icon
            >
              <template #default>
                <el-button v-if="studentAvatarSync.status === 'unknown'" link type="primary" :disabled="studentSaveBusy" @click="queryStudentAvatarState">查询头像状态</el-button>
              </template>
            </el-alert>
          </el-form-item>
          <div class="student-fields">
            <el-form-item label="姓名" required><el-input v-model="studentForm.real_name" maxlength="64" /></el-form-item>
            <el-form-item v-if="studentForm.id" label="是否禁用"><el-radio-group v-model="studentForm.status"><el-radio :value="1">正常</el-radio><el-radio :value="0">禁用</el-radio></el-radio-group></el-form-item>
            <el-form-item v-else label="来源" required><el-select v-model="studentForm.source" style="width:100%"><el-option label="本机构" value="institution" /><el-option label="外来" value="external" /></el-select></el-form-item>
            <el-form-item label="手机号" required><el-input v-model="studentForm.phone" maxlength="11" inputmode="tel" placeholder="请输入手机号码" /></el-form-item>
            <el-form-item label="性别"><el-radio-group v-model="studentForm.gender"><el-radio value="male">男</el-radio><el-radio value="female">女</el-radio></el-radio-group></el-form-item>
            <el-form-item label="年龄">
              <el-input-number v-model="studentForm.age" :min="0" :max="150" :precision="0" controls-position="right" placeholder="请输入年龄" style="width:100%" />
            </el-form-item>
            <el-form-item label="培训类别"><el-select v-model="studentForm.category_id" clearable placeholder="选填" style="width:100%"><el-option v-for="category in categories" :key="category.id" :label="category.name" :value="category.id" /></el-select></el-form-item>
          </div>
        </el-form>
        <template #footer><el-button @click="cancelStudentDialog">取消</el-button><el-button v-if="auth.can('students:write')" type="primary" :loading="studentSaveBusy" :disabled="studentSaveBusy" @click="saveStudent">确定</el-button></template>
      </el-dialog>

      <el-dialog v-model="previewVisible" title="导入预览" width="650px" class="re-form-dialog" destroy-on-close>
        <ImportPreview v-if="studentPreview" :preview="studentPreview" />
        <template #footer>
          <el-button @click="previewVisible = false">重新上传</el-button>
          <el-button type="primary" :disabled="!studentPreview?.valid_rows.length" @click="studentPreview && commitStudentImport(studentPreview.valid_rows)">
            确认导入 {{ studentPreview?.valid_rows.length || 0 }} 行
          </el-button>
        </template>
      </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, reactive, ref, watch } from 'vue';
import { FitsTable, FitsListSearch, FitsTableActions, FitsTableAction } from '../../components/FitsTable';
import { ElMessage } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import { useDashboardListNavigation } from '../../utils/admin-dashboard-navigation';
import type { UploadFile } from 'element-plus';
import http, { download, upload } from '../../api/http';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { useAuthStore } from '../../stores/auth';
import ImportPreview from '../../components/ImportPreview.vue';
import MediaUpload from '../../components/MediaUpload.vue';
import StudentAvatar from '../../components/StudentAvatar.vue';
import type { ImportPreview as ImportPreviewData } from '../../api/training-types';
import {
  isStudentSaveIdentityCurrent,
  normalizeAvatarId,
  reconcileStudentAvatar,
  runStudentSaveWorkflow,
  type AvatarReconcileResult,
  type AvatarSyncStatus,
  type StudentSaveContext,
} from '../../utils/avatar-save-state';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const formRouteKey = ref(route.fullPath);
function openStudentRecords(row: { id: string; real_name?: string; username: string }) {
  if (auth.can('exam_records:read')) void router.push({ path: '/admin/exam-records', query: { user_id: String(row.id), learner_name: row.real_name || row.username } });
}
const students = ref<any[]>([]);
const studentTotal = ref(0);
const studentLoading = ref(false);
let studentListRequest = 0;
let studentListActive = true;
function invalidateStudentList() {
  studentListActive = false;
  studentListRequest += 1;
  studentLoading.value = false;
}
onActivated(() => { studentListActive = true; });
onDeactivated(invalidateStudentList);
onBeforeUnmount(invalidateStudentList);
const studentRowBusy = reactive<Record<string, 'source' | 'status'>>({});
const categories = ref<any[]>([]);
const studentDialog = ref(false);
const studentForm = reactive<any>({});
function businessToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function formatCreatedAt(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
function ageFromBirthday(birthday: string | null | undefined) {
  if (!birthday) return undefined;
  const today = businessToday();
  return Number(today.slice(0, 4)) - Number(birthday.slice(0, 4)) - (today.slice(5) < birthday.slice(5) ? 1 : 0);
}
const studentAvatarOriginalId = ref<string | null>(null);
const studentAvatarWritePending = ref(false);
const studentAvatarSync = reactive<{ status: AvatarSyncStatus; message: string }>({ status: 'idle', message: '' });
const studentAvatarDialogVersion = ref(0);
const studentSaveInFlightKey = ref<string | null>(null);
const studentSaveBusy = computed(() => studentSaveInFlightKey.value !== null);
const studentQuery = reactive({ page: 1, page_size: 20, keyword: '', category_id: '', source: '', status: '' as 0 | 1 | '' });
const studentPreview = ref<ImportPreviewData | null>(null);
const previewVisible = ref(false);
const studentDirty = ref(false);
interface StudentDraftBaseline {
  form: Record<string, unknown>;
  avatarOriginalId: string | null;
  avatarWritePending: boolean;
  avatarSync: { status: AvatarSyncStatus; message: string };
}
const studentBaseline = ref<StudentDraftBaseline>({
  form: {},
  avatarOriginalId: null,
  avatarWritePending: false,
  avatarSync: { status: 'idle', message: '' },
});

function cloneDraft<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function replaceReactive(target: Record<string, unknown>, value: Record<string, unknown>) {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, value);
}
function captureStudentBaseline() {
  studentBaseline.value = {
    form: cloneDraft(studentForm),
    avatarOriginalId: studentAvatarOriginalId.value,
    avatarWritePending: studentAvatarWritePending.value,
    avatarSync: { ...studentAvatarSync },
  };
  studentDirty.value = false;
}
function discardStudentDraft() {
  studentAvatarDialogVersion.value += 1;
  replaceReactive(studentForm, cloneDraft(studentBaseline.value.form));
  studentAvatarOriginalId.value = studentBaseline.value.avatarOriginalId;
  studentAvatarWritePending.value = studentBaseline.value.avatarWritePending;
  Object.assign(studentAvatarSync, studentBaseline.value.avatarSync);
  studentDirty.value = false;
  studentDialog.value = false;
}
function rebaseStudentAvatar(confirmedId: string | null) {
  if (!studentDialog.value) return;
  studentBaseline.value = {
    ...studentBaseline.value,
    form: { ...studentBaseline.value.form, avatar_id: confirmedId },
    avatarOriginalId: confirmedId,
    avatarWritePending: false,
    avatarSync: { status: 'idle', message: '' },
  };
}

const studentUnsaved = useUnsavedChanges(studentDirty, { routeKey: formRouteKey, onDiscard: discardStudentDraft });
watch([() => JSON.stringify(studentForm), studentAvatarWritePending], () => {
  const baseline = studentBaseline.value;
  studentDirty.value = studentDialog.value && (
    JSON.stringify(studentForm) !== JSON.stringify(baseline.form)
    || studentAvatarWritePending.value !== baseline.avatarWritePending
  );
}, { flush: 'sync' });

function closeCleanStudentDialog() {
  studentAvatarDialogVersion.value += 1;
  studentDialog.value = false;
  studentAvatarOriginalId.value = null;
  resetStudentAvatarState();
  studentUnsaved.markClean();
}

async function cancelStudentDialog() {
  if (!await studentUnsaved.confirmDiscard()) return;
  if (studentDialog.value) closeCleanStudentDialog();
}
async function beforeStudentDialogClose(done: () => void) {
  if (!await studentUnsaved.confirmDiscard()) return;
  if (studentDialog.value) closeCleanStudentDialog();
  done();
}

function sourceLabel(source: string | null) { return source === 'institution' ? '本机构' : source === 'external' ? '外来' : '未设置'; }
function categoryName(id: string | null) { return id ? categories.value.find((item) => String(item.id) === String(id))?.name || '-' : '未填写'; }

async function loadCategories() {
  const data: any = await http.get('/admin/training-categories', { params: { page: 1, page_size: 100, status: 1 } });
  categories.value = data.items || [];
}

async function loadStudents() {
  if (!studentListActive) return;
  const request = ++studentListRequest;
  studentLoading.value = true;
  try {
    const params = Object.fromEntries(
      Object.entries({ page: studentQuery.page, page_size: studentQuery.page_size, keyword: studentQuery.keyword,
        category_id: studentQuery.category_id, source: studentQuery.source,
        status: studentQuery.status === 0 || studentQuery.status === 1 ? studentQuery.status : undefined,
      }).filter(([, value]) => value !== '' && value !== null && value !== undefined),
    );
    const data: any = await http.get('/admin/students', { params });
    if (!studentListActive || request !== studentListRequest) return;
    students.value = data.items || [];
    studentTotal.value = data.total || 0;
  } finally { if (studentListActive && request === studentListRequest) studentLoading.value = false; }
}
async function searchStudents() {
  studentQuery.page = 1;
  await navigation.syncQuery({ source: studentQuery.source || undefined, status: studentQuery.status === 0 || studentQuery.status === 1 ? String(studentQuery.status) : undefined });
  await loadStudents();
}

function resetStudentAvatarState() {
  studentAvatarWritePending.value = false;
  studentAvatarSync.status = 'idle';
  studentAvatarSync.message = '';
}

function setStudentAvatarSync(result: AvatarReconcileResult) {
  studentAvatarSync.status = result.outcome === 'applied' ? 'confirmed' : result.outcome;
  studentAvatarSync.message = result.message;
  if (result.outcome === 'applied') {
    rebaseStudentAvatar(result.confirmedId);
    studentAvatarOriginalId.value = result.confirmedId;
    studentAvatarWritePending.value = false;
  } else if (result.outcome === 'not_applied') {
    // The server has confirmed the current id, while the staged desired id is
    // retained in studentForm.avatar_id for an explicit save retry.
    rebaseStudentAvatar(result.confirmedId);
    studentAvatarOriginalId.value = result.confirmedId;
    studentAvatarWritePending.value = true;
  } else {
    // Do not replace the last known id: the current server value is unknown.
    // Keeping the pending flag forces a later explicit query/save decision.
    studentAvatarWritePending.value = true;
  }
}

function currentStudentSaveContext(): StudentSaveContext | null {
  if (!studentDialog.value) return null;
  return {
    dialogVersion: studentAvatarDialogVersion.value,
    studentId: studentForm.id ? String(studentForm.id) : null,
    desiredId: studentForm.id ? normalizeAvatarId(studentForm.avatar_id) : null,
    ordinary: {
      username: studentForm.username,
      real_name: studentForm.real_name,
      employee_no: studentForm.employee_no,
      source: studentForm.source,
      category_id: studentForm.category_id || null,
      phone: studentForm.phone,
      email: studentForm.email,
      gender: studentForm.gender,
      birthday: studentForm.birthday,
      age: studentForm.age ?? null,
      ...(studentForm.id ? { status: studentForm.status } : {}),
    },
  };
}

async function reconcileStudentAvatarState(context: StudentSaveContext, closeOnApplied = false): Promise<AvatarReconcileResult['outcome'] | 'stale'> {
  if (!context.studentId) return 'stale';
  const result = await reconcileStudentAvatar(
    context.studentId,
    context.desiredId,
    (path) => http.get(path),
  );
  if (!isStudentSaveIdentityCurrent(context, currentStudentSaveContext())) return 'stale';
  setStudentAvatarSync(result);
  if (result.outcome === 'applied') {
    ElMessage.success('头像已通过状态查询确认更新');
    if (closeOnApplied) {
      studentAvatarDialogVersion.value += 1;
      studentDialog.value = false;
      resetStudentAvatarState();
      await loadStudents();
    }
    return result.outcome;
  }
  ElMessage.warning(result.message);
  await loadStudents();
  return result.outcome;
}

function openStudentCreate() {
  studentAvatarDialogVersion.value += 1;
  Object.keys(studentForm).forEach((key) => delete studentForm[key]);
  studentAvatarOriginalId.value = null;
  resetStudentAvatarState();
  Object.assign(studentForm, { source: 'institution', category_id: '' });
  captureStudentBaseline();
  studentDialog.value = true;
}
function openStudentEdit(row: any) {
  studentAvatarDialogVersion.value += 1;
  Object.keys(studentForm).forEach((key) => delete studentForm[key]);
  Object.assign(studentForm, row, { category_id: row.category_id || '', employee_no: row.employee_no || '' });
  studentForm.age = row.age ?? ageFromBirthday(row.birthday);
  studentAvatarOriginalId.value = row.avatar_id ? String(row.avatar_id) : null;
  resetStudentAvatarState();
  captureStudentBaseline();
  studentDialog.value = true;
}

function onStudentAvatarChange(assetId: string | null) {
  // Uploading creates an unbound asset. Keep the id in the dialog only; the
  // final bind is performed by updateStudentAvatar after the user saves.
  // Cancelling therefore never mutates the managed student row.
  if (!studentForm.id) return;
  studentForm.avatar_id = assetId;
  studentAvatarWritePending.value = true;
  studentAvatarSync.status = 'pending';
  studentAvatarSync.message = assetId ? '头像已暂存，点击保存后绑定' : '头像清除已暂存，点击保存后生效';
}

async function queryStudentAvatarState() {
  const context = currentStudentSaveContext();
  if (context) await reconcileStudentAvatarState(context, false);
}

async function saveStudent() {
  if (!studentForm.real_name?.trim() || (!studentForm.id && !studentForm.source)) {
    ElMessage.warning('请填写姓名；新增学员还需填写来源'); return;
  }
  studentForm.phone = studentForm.phone?.trim();
  if (!/^1[3-9]\d{9}$/.test(studentForm.phone || '')) { ElMessage.warning('请输入有效的 11 位手机号码'); return; }
  if (!studentForm.id) studentForm.username = studentForm.phone;
  const context = currentStudentSaveContext();
  if (!context) return;
  const operationKey = `${context.dialogVersion}:${context.studentId || 'new'}`;
  if (studentSaveInFlightKey.value === operationKey) {
    ElMessage.warning('保存正在进行，请稍候');
    return;
  }
  studentSaveInFlightKey.value = operationKey;
  try {
    const avatarChanged = context.studentId !== null
      && (context.desiredId !== studentAvatarOriginalId.value || studentAvatarWritePending.value);
    const result = await runStudentSaveWorkflow(
      studentAvatarSync.status,
      context,
      {
        avatarChanged,
        read: (path) => http.get(path),
        currentContext: currentStudentSaveContext,
        writeOrdinary: async (draft) => {
          if (context.studentId) {
            await http.put(`/admin/students/${context.studentId}`, {
              real_name: draft.real_name,
              category_id: draft.category_id,
              phone: draft.phone,
              gender: draft.gender,
              birthday: draft.birthday,
              age: draft.age,
            });
          } else {
            await http.post('/admin/students', draft);
          }
        },
        writeAvatar: async (desiredId) => {
          if (context.studentId) await http.put(`/admin/students/${context.studentId}/avatar`, { avatar_id: desiredId });
        },
      },
    );
    if (result.outcome === 'stale') return;
    if (result.avatarResult) setStudentAvatarSync(result.avatarResult);
    if (result.outcome === 'blocked') {
      ElMessage.warning(result.avatarResult?.message || '头像绑定未完成，请查询状态后重试');
      await loadStudents();
      return;
    }
    if (context.studentId) studentAvatarOriginalId.value = context.desiredId;
    if (context.studentId && context.ordinary.status !== studentBaseline.value.form.status) {
      try {
        await http.put(`/admin/students/${context.studentId}/status`, { status: context.ordinary.status });
      } catch (error) {
        const current: any = await http.get(`/admin/students/${context.studentId}`);
        if (current.status !== context.ordinary.status) throw error;
      }
    }
    ElMessage.success('已保存');
    studentUnsaved.markClean();
    studentAvatarDialogVersion.value += 1;
    studentDialog.value = false;
    studentAvatarOriginalId.value = null;
    resetStudentAvatarState();
    await loadStudents();
  } finally {
    if (studentSaveInFlightKey.value === operationKey) studentSaveInFlightKey.value = null;
  }
}
async function updateStudentField(row: any, field: 'source' | 'status', value: string | number | boolean) {
  const id = String(row.id);
  if (!auth.can('students:write') || studentRowBusy[id] || studentLoading.value) return;
  if (field === 'source' ? value !== 'institution' && value !== 'external' : value !== 0 && value !== 1) return;
  if (row[field] === value) return;
  studentRowBusy[id] = field;
  // Keep the confirmed value until the server responds. Update by id because a
  // search/page change may have replaced the row object while saving.
  const applyValue = (data: any) => {
    row[field] = data[field];
    const current = students.value.find((item) => String(item.id) === id);
    if (current) current[field] = data[field];
  };
  try {
    const data: any = await http.put(`/admin/students/${id}${field === 'status' ? '/status' : ''}`, { [field]: value });
    applyValue(data);
    ElMessage.success(field === 'source' ? '来源已更新' : data.status === 1 ? '已启用' : '已停用');
  } catch {
    // A lost response does not prove the write failed; read back instead of
    // retrying the mutation or restoring a value that may already be obsolete.
    try { applyValue(await http.get(`/admin/students/${id}`)); }
    catch { ElMessage.warning('暂时无法确认保存结果，请刷新列表核对'); }
  } finally {
    delete studentRowBusy[id];
  }
  if (field === 'source' && studentQuery.source && row.source !== studentQuery.source) {
    // A successful source change can move this learner out of the active filter.
    try { await loadStudents(); } catch { /* The request interceptor reports the error. */ }
  }
}
function downloadStudentTemplate() { download('/admin/students/import-template', '学员导入模板.xlsx'); }
async function onStudentImport(file: UploadFile | File) {
  const raw = (file as UploadFile).raw || file;
  if (!(raw instanceof File)) return false;
  const data: any = await upload('/admin/students/import-preview', raw as File, 'file');
  studentPreview.value = data; previewVisible.value = true;
  return false;
}
async function commitStudentImport(rows: number[]) {
  if (!studentPreview.value) return;
  const result: any = await http.post(`/admin/students/import-batches/${studentPreview.value.batch_id}/commit`, { row_numbers: rows });
  ElMessage.success(`成功导入 ${result.created_ids?.length || 0} 名学员`);
  previewVisible.value = false; studentPreview.value = null; await loadStudents();
}

const navigation = useDashboardListNavigation(route, router, {
  path: '/admin/students', routeKey: formRouteKey,
  beforeEntry: () => studentUnsaved.confirmDiscard(),
  apply(entry, explicit) {
    if (entry.kind !== 'students') return;
    if (explicit) Object.assign(studentQuery, { page: 1, keyword: '', category_id: '' });
    studentQuery.source = entry.source || '';
    studentQuery.status = entry.status ?? '';
  },
  prepare: loadCategories, load: loadStudents,
  onInvalid: () => { ElMessage.warning('已清除无效的学员入口参数'); },
});
</script>

<style scoped>
.student-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 24px; }
.student-edit-form :deep(.el-form-item) { margin-bottom: 20px; }
.student-edit-form :deep(.el-input-number .el-input__inner) { text-align: left; }
.student-photo-field :deep(.media-upload__picture) { --el-upload-picture-card-size: 100px; }
.student-photo-field :deep(.el-alert) { margin-top: 8px; }
@media (max-width: 680px) {
  .student-fields { grid-template-columns: minmax(0, 1fr); }
}
:deep(.student-quick-switch) {
  --el-switch-off-color: #e5e7eb;
}

:deep(.student-quick-switch .el-switch__core) {
  height: 28px;
  border-radius: 14px;
}

:deep(.student-quick-switch .el-switch__action) {
  width: 24px;
  height: 24px;
}

:deep(.student-quick-switch.is-checked .el-switch__action) {
  left: calc(100% - 25px);
}

:deep(.student-quick-switch .el-switch__inner) {
  height: 24px;
  padding: 0 6px 0 28px;
}

:deep(.student-quick-switch.is-checked .el-switch__inner) {
  padding: 0 28px 0 6px;
}

:deep(.student-quick-switch .el-switch__inner-wrapper) {
  font-size: 13px;
  font-weight: 600;
}

:deep(.student-quick-switch:not(.is-checked) .el-switch__inner-wrapper) {
  color: var(--re-text-2, #51565f);
}
</style>
