<template>
  <div class="page-card">
    <FitsTable>
      <template #search>
        <FitsListSearch @submit.prevent>
          <el-form-item label="关键字"><el-input v-model="studentQuery.keyword" placeholder="用户名 / 姓名 / 工号" style="width:210px" clearable @keyup.enter="loadStudents" /></el-form-item>
          <el-form-item label="培训类别">
            <el-select v-model="studentQuery.category_id" clearable placeholder="全部类别" style="width:180px" @change="loadStudents">
              <el-option v-for="category in categories" :key="category.id" :label="category.name" :value="category.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="来源">
            <el-select v-model="studentQuery.source" clearable placeholder="全部来源" style="width:150px" @change="loadStudents">
              <el-option label="本机构" value="institution" /><el-option label="外来" value="external" />
            </el-select>
          </el-form-item>
          <template #actions><el-button type="primary" @click="loadStudents">查询</el-button></template>
        </FitsListSearch>
      </template>
      <template v-if="auth.can('students:write')" #actions>
        <el-select v-if="auth.can('students:write')" v-model="studentImportDefaults.source" clearable placeholder="导入默认来源" style="width:150px">
          <el-option label="本机构" value="institution" /><el-option label="外来" value="external" />
        </el-select>
        <el-select v-if="auth.can('students:write')" v-model="studentImportDefaults.category_id" clearable placeholder="导入默认类别" style="width:170px">
          <el-option v-for="category in categories" :key="category.id" :label="category.name" :value="category.id" />
        </el-select>
        <el-button v-if="auth.can('students:write')" @click="downloadStudentTemplate">下载导入模板</el-button>
        <el-upload v-if="auth.can('students:write')" :show-file-list="false" accept=".xlsx" :before-upload="onStudentImport">
          <el-button type="success">预览导入</el-button>
        </el-upload>
        <el-button v-if="auth.can('students:write')" type="primary" @click="openStudentCreate">新增学员</el-button>
      </template>
      <el-table v-loading="studentLoading" :data="students">
        <template #empty><el-empty v-if="!studentLoading" description="暂无学员" /></template>
        <el-table-column prop="username" label="用户名" width="130" />
        <el-table-column prop="real_name" label="姓名" width="110" />
        <el-table-column prop="employee_no" label="工号" width="110" />
        <el-table-column label="来源" width="90"><template #default="{ row }">{{ sourceLabel(row.source) }}</template></el-table-column>
        <el-table-column label="培训类别" min-width="150"><template #default="{ row }">{{ categoryName(row.category_id) }}</template></el-table-column>
        <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status === 1 ? 'success' : 'info'">{{ row.status === 1 ? '启用' : '停用' }}</el-tag></template></el-table-column>
        <el-table-column v-if="auth.can('students:write')" label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button text type="primary" @click="openStudentEdit(row)">编辑</el-button>
            <el-button text :type="row.status === 1 ? 'warning' : 'success'" @click="toggleStudentStatus(row)">{{ row.status === 1 ? '停用' : '启用' }}</el-button>
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
            <el-form-item label="培训类别" required><el-select v-model="studentForm.category_id" style="width:100%"><el-option v-for="category in categories" :key="category.id" :label="category.name" :value="category.id" /></el-select></el-form-item>
          </div>
        </el-form>
        <template #footer><el-button @click="cancelStudentDialog">取消</el-button><el-button v-if="auth.can('students:write')" type="primary" :loading="studentSaveBusy" :disabled="studentSaveBusy" @click="saveStudent">确定</el-button></template>
      </el-dialog>

      <el-dialog v-model="previewVisible" title="导入预览" width="650px">
        <ImportPreview v-if="studentPreview" :preview="studentPreview" @confirm="commitStudentImport" @retry="previewVisible = false" />
      </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { FitsTable, FitsListSearch } from '../../components/FitsTable';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { UploadFile } from 'element-plus';
import http, { download, upload } from '../../api/http';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { useAuthStore } from '../../stores/auth';
import ImportPreview from '../../components/ImportPreview.vue';
import MediaUpload from '../../components/MediaUpload.vue';
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
const students = ref<any[]>([]);
const studentTotal = ref(0);
const studentLoading = ref(false);
const categories = ref<any[]>([]);
const studentDialog = ref(false);
const studentForm = reactive<any>({});
function businessToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
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
const studentQuery = reactive<any>({ page: 1, page_size: 20, keyword: '', category_id: '', source: '' });
const studentImportDefaults = reactive<{ source: string; category_id: string }>({ source: '', category_id: '' });
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

const studentUnsaved = useUnsavedChanges(studentDirty, { onDiscard: discardStudentDraft });
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
function categoryName(id: string | null) { return categories.value.find((item) => String(item.id) === String(id))?.name || '未设置'; }

async function loadCategories() {
  const data: any = await http.get('/admin/training-categories', { params: { page: 1, page_size: 100, status: 1 } });
  categories.value = data.items || [];
}

async function loadStudents() {
  studentLoading.value = true;
  try {
    const params = Object.fromEntries(
      Object.entries(studentQuery).filter(([, value]) => value !== '' && value !== null && value !== undefined),
    );
    const data: any = await http.get('/admin/students', { params });
    students.value = data.items || [];
    studentTotal.value = data.total || 0;
  } finally { studentLoading.value = false; }
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
      category_id: studentForm.category_id,
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
  Object.assign(studentForm, { source: 'institution', category_id: categories.value[0]?.id || '' });
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
  if (!studentForm.real_name?.trim() || !studentForm.category_id || (!studentForm.id && !studentForm.source)) {
    ElMessage.warning('请填写姓名、培训类别；新增学员还需填写来源'); return;
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
async function toggleStudentStatus(row: any) {
  await ElMessageBox.confirm(row.status === 1 ? '停用后该学员旧令牌立即失效，确认停用？' : '确认启用该学员？', '确认', { type: 'warning' });
  await http.put(`/admin/students/${row.id}/status`, { status: row.status === 1 ? 0 : 1 }); await loadStudents();
}
function downloadStudentTemplate() { download('/admin/students/import-template', '学员导入模板.xlsx'); }
async function onStudentImport(file: UploadFile | File) {
  const raw = (file as UploadFile).raw || file;
  if (!(raw instanceof File)) return false;
  const defaults = Object.fromEntries(Object.entries(studentImportDefaults).filter(([, value]) => value));
  const data: any = await upload('/admin/students/import-preview', raw as File, 'file', { defaults: JSON.stringify(defaults) });
  studentPreview.value = data; previewVisible.value = true;
  return false;
}
async function commitStudentImport(rows: number[]) {
  if (!studentPreview.value) return;
  const result: any = await http.post(`/admin/students/import-batches/${studentPreview.value.batch_id}/commit`, { row_numbers: rows });
  ElMessage.success(`成功导入 ${result.created_ids?.length || 0} 名学员`);
  previewVisible.value = false; studentPreview.value = null; await loadStudents();
}

onMounted(async () => {
  await loadCategories();
  await loadStudents();
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
</style>
