<template>
  <div class="page-card">
    <template v-if="isStudentPage">
      <div class="page-head">
        <div class="eyebrow">管理台</div>
        <h2>学员管理</h2>
        <p class="desc">维护培训学员的类别与来源；来源只影响后续组卷策略，不改变权限。</p>
      </div>
      <div class="toolbar">
        <el-input v-model="studentQuery.keyword" placeholder="用户名 / 姓名 / 工号" style="width:210px" clearable @keyup.enter="loadStudents" />
        <el-select v-model="studentQuery.category_id" clearable placeholder="全部类别" style="width:180px" @change="loadStudents">
          <el-option v-for="category in categories" :key="category.id" :label="category.name" :value="category.id" />
        </el-select>
        <el-select v-model="studentQuery.source" clearable placeholder="全部来源" style="width:150px" @change="loadStudents">
          <el-option label="本机构" value="institution" /><el-option label="外来" value="external" />
        </el-select>
        <el-button type="primary" @click="loadStudents">查询</el-button>
        <div style="flex:1" />
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
      </div>
      <el-table v-loading="studentLoading" :data="students">
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
            <el-button text type="danger" @click="resetStudentPassword(row)">重置密码</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!studentLoading && students.length === 0" description="暂无学员" />
      <el-pagination v-model:current-page="studentQuery.page" style="margin-top:16px; justify-content:flex-end" layout="total, prev, pager, next" :total="studentTotal" :page-size="studentQuery.page_size" @current-change="loadStudents" />

      <el-dialog v-model="studentDialog" :title="studentForm.id ? '编辑学员' : '新增学员'" width="500px" destroy-on-close>
        <el-form label-width="88px">
          <el-form-item label="用户名"><el-input v-model="studentForm.username" :disabled="!!studentForm.id" maxlength="64" /></el-form-item>
          <el-form-item label="姓名"><el-input v-model="studentForm.real_name" maxlength="64" /></el-form-item>
          <el-form-item label="工号"><el-input v-model="studentForm.employee_no" maxlength="32" /></el-form-item>
          <el-form-item label="来源"><el-select v-model="studentForm.source" style="width:100%"><el-option label="本机构" value="institution" /><el-option label="外来" value="external" /></el-select></el-form-item>
          <el-form-item label="培训类别"><el-select v-model="studentForm.category_id" style="width:100%"><el-option v-for="category in categories" :key="category.id" :label="category.name" :value="category.id" /></el-select></el-form-item>
          <el-form-item label="部门"><el-tree-select v-model="studentForm.department_id" :data="deptTree" check-strictly clearable style="width:100%" /></el-form-item>
          <el-form-item v-if="!studentForm.id" label="初始密码"><el-input v-model="studentForm.password" show-password placeholder="≥8 位（字母+数字）" /></el-form-item>
          <el-form-item label="手机号"><el-input v-model="studentForm.phone" maxlength="20" /></el-form-item>
          <el-form-item label="邮箱"><el-input v-model="studentForm.email" maxlength="128" /></el-form-item>
          <el-form-item v-if="studentForm.id && auth.can('students:write')" label="头像">
            <MediaUpload v-model="studentForm.avatar_id" purpose="avatar" :owner-id="String(studentForm.id)" :disabled="studentForm.status === 0" @update:model-value="onStudentAvatarChange" />
            <el-alert
              v-if="studentAvatarSync.message"
              :title="studentAvatarSync.message"
              :type="studentAvatarSync.status === 'confirmed' ? 'success' : studentAvatarSync.status === 'unknown' ? 'warning' : 'info'"
              :closable="false"
              show-icon
            >
              <template #default>
                <el-button v-if="studentAvatarSync.status === 'unknown'" link type="primary" @click="queryStudentAvatarState">查询头像状态</el-button>
              </template>
            </el-alert>
          </el-form-item>
        </el-form>
        <template #footer><el-button @click="cancelStudentDialog">取消</el-button><el-button v-if="auth.can('students:write')" type="primary" @click="saveStudent">保存</el-button></template>
      </el-dialog>

      <el-dialog v-model="previewVisible" title="导入预览" width="650px">
        <ImportPreview v-if="studentPreview" :preview="studentPreview" @confirm="commitStudentImport" @retry="previewVisible = false" />
      </el-dialog>
    </template>
    <template v-else>
    <div class="page-head">
      <div class="eyebrow">管理台</div>
      <h2>员工管理</h2>
      <p class="desc">维护员工账号与部门归属，支持 Excel 批量导入</p>
    </div>
    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="用户名 / 姓名 / 工号" style="width:200px" clearable @keyup.enter="load" />
      <el-tree-select v-model="query.department_id" :data="deptTree" check-strictly clearable placeholder="全部部门" style="width:200px" @change="load" />
      <el-select v-model="query.role" placeholder="全部角色" clearable style="width:160px" @change="load">
        <el-option label="超级管理员" value="super_admin" />
        <el-option label="制度管理员" value="regulation_admin" />
        <el-option label="普通员工" value="employee" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <div style="flex:1" />
      <el-button v-if="auth.can('students:write')" @click="downloadTemplate">下载导入模板</el-button>
      <el-upload v-if="auth.can('students:write')" :show-file-list="false" accept=".xlsx" :before-upload="onImport" :auto-upload="false" :on-change="onImport">
        <el-button type="success">Excel 批量导入</el-button>
      </el-upload>
      <el-button v-if="auth.can('students:write')" type="primary" @click="openCreate">新增员工</el-button>
    </div>

    <el-table v-loading="loading" :data="list">
      <el-table-column prop="username" label="用户名" width="130" />
      <el-table-column prop="real_name" label="姓名" width="110" />
      <el-table-column prop="employee_no" label="工号" width="110" />
      <el-table-column label="部门" min-width="140">
        <template #default="{ row }">{{ deptName(row.department_id) }}</template>
      </el-table-column>
      <el-table-column label="角色" width="120">
        <template #default="{ row }">{{ roleLabel(row.role) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'info'">{{ row.status === 1 ? '在职' : '停用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="最后登录" min-width="150">
        <template #default="{ row }">{{ formatDateTime(row.last_login_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <template v-if="auth.can('students:write')">
            <el-button text size="small" type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button text size="small" :type="row.status === 1 ? 'warning' : 'success'" @click="toggleStatus(row)">
              {{ row.status === 1 ? '停用' : '启用' }}
            </el-button>
            <el-button text size="small" type="danger" @click="openReset(row)">重置密码</el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination style="margin-top:16px; justify-content:flex-end" layout="total, prev, pager, next" :total="total"
      :page-size="query.page_size" v-model:current-page="query.page" @current-change="load" />

    <el-dialog v-model="dialog" :title="form.id ? '编辑员工' : '新增员工'" width="480px">
      <el-form label-width="90px">
        <el-form-item label="用户名"><el-input v-model="form.username" :disabled="!!form.id" maxlength="64" /></el-form-item>
        <el-form-item label="姓名"><el-input v-model="form.real_name" maxlength="64" /></el-form-item>
        <el-form-item label="工号"><el-input v-model="form.employee_no" maxlength="32" /></el-form-item>
        <el-form-item label="部门">
          <el-tree-select v-model="form.department_id" :data="deptTree" check-strictly clearable style="width:100%" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role" style="width:100%">
            <el-option label="超级管理员" value="super_admin" />
            <el-option label="制度管理员" value="regulation_admin" />
            <el-option label="普通员工" value="employee" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="!form.id" label="初始密码">
          <el-input v-model="form.password" placeholder="≥8 位（字母+数字），首次登录将强制修改" show-password />
        </el-form-item>
        <el-form-item label="手机号"><el-input v-model="form.phone" maxlength="20" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="form.email" maxlength="128" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button v-if="auth.can('students:write')" type="primary" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importResultVisible" title="导入结果" width="560px">
      <el-result v-if="importResult" :icon="importResult.fail_count ? 'warning' : 'success'"
        :title="`成功 ${importResult.success_count} 条，失败 ${importResult.fail_count} 条`">
        <template #sub-title>
          <el-table v-if="importResult.failures?.length" :data="importResult.failures" size="small">
            <el-table-column prop="row" label="行号" width="80" />
            <el-table-column prop="reason" label="失败原因" />
          </el-table>
        </template>
      </el-result>
    </el-dialog>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { UploadFile } from 'element-plus';
import http, { download, upload } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import { formatDateTime } from '../../utils/format';
import ImportPreview from '../../components/ImportPreview.vue';
import MediaUpload from '../../components/MediaUpload.vue';
import type { ImportPreview as ImportPreviewData } from '../../api/training-types';
import {
  isAvatarReconcileContextCurrent,
  normalizeAvatarId,
  preflightAvatarSave,
  reconcileStudentAvatar,
  type AvatarReconcileContext,
  type AvatarReconcileResult,
  type AvatarSyncStatus,
} from '../../utils/avatar-save-state';

const route = useRoute();
const isStudentPage = computed(() => route.path === '/admin/students');

const list = ref<any[]>([]);
const auth = useAuthStore();
const total = ref(0);
const loading = ref(false);
const deptTree = ref<any[]>([]);
const deptRows = ref<any[]>([]);
const dialog = ref(false);
const form = reactive<any>({});
const query = reactive<any>({ page: 1, page_size: 20, keyword: '', department_id: null, role: '' });
const importResult = ref<any>(null);
const importResultVisible = ref(false);
const students = ref<any[]>([]);
const studentTotal = ref(0);
const studentLoading = ref(false);
const categories = ref<any[]>([]);
const studentDialog = ref(false);
const studentForm = reactive<any>({});
const studentAvatarOriginalId = ref<string | null>(null);
const studentAvatarWritePending = ref(false);
const studentAvatarSync = reactive<{ status: AvatarSyncStatus; message: string }>({ status: 'idle', message: '' });
const studentAvatarDialogVersion = ref(0);
const studentQuery = reactive<any>({ page: 1, page_size: 20, keyword: '', category_id: '', source: '' });
const studentImportDefaults = reactive<{ source: string; category_id: string }>({ source: '', category_id: '' });
const studentPreview = ref<ImportPreviewData | null>(null);
const previewVisible = ref(false);

function roleLabel(r: string) {
  return ({ super_admin: '超级管理员', regulation_admin: '制度管理员', employee: '员工' } as any)[r] || r;
}
function deptName(id: number | null) {
  return deptRows.value.find((d) => String(d.id) === String(id))?.name || '—';
}
function sourceLabel(source: string | null) { return source === 'institution' ? '本机构' : source === 'external' ? '外来' : '未设置'; }
function categoryName(id: string | null) { return categories.value.find((item) => String(item.id) === String(id))?.name || '未设置'; }

function flatten(nodes: any[], out: any[] = [], path = ''): any[] {
  for (const n of nodes) {
    const p = path ? `${path}/${n.name}` : n.name;
    out.push({ ...n, path: p });
    if (n.children?.length) flatten(n.children, out, p);
  }
  return out;
}

async function load() {
  loading.value = true;
  try {
    const d: any = await http.get('/users', { params: query });
    list.value = d.list;
    total.value = d.total;
  } finally {
    loading.value = false;
  }
}

async function loadDepts() {
  const d: any = await http.get('/departments/tree');
  deptTree.value = toTree(d.list);
  deptRows.value = flatten(d.list);
}

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

function toTree(nodes: any[]): any[] {
  return nodes.map((n) => ({ value: n.id, label: n.name, children: n.children?.length ? toTree(n.children) : undefined }));
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
    studentAvatarOriginalId.value = result.confirmedId;
    studentAvatarWritePending.value = false;
  } else if (result.outcome === 'not_applied') {
    // The server has confirmed the current id, while the staged desired id is
    // retained in studentForm.avatar_id for an explicit save retry.
    studentAvatarOriginalId.value = result.confirmedId;
    studentAvatarWritePending.value = true;
  } else {
    // Do not replace the last known id: the current server value is unknown.
    // Keeping the pending flag forces a later explicit query/save decision.
    studentAvatarWritePending.value = true;
  }
}

function currentStudentAvatarContext(): AvatarReconcileContext | null {
  if (!studentDialog.value || !studentForm.id) return null;
  return {
    dialogVersion: studentAvatarDialogVersion.value,
    studentId: String(studentForm.id),
    desiredId: normalizeAvatarId(studentForm.avatar_id),
  };
}

async function reconcileStudentAvatarState(closeOnApplied = false): Promise<AvatarReconcileResult['outcome'] | 'stale'> {
  const context = currentStudentAvatarContext();
  if (!context) return 'stale';
  const result = await reconcileStudentAvatar(
    context.studentId,
    context.desiredId,
    (path) => http.get(path),
  );
  if (!isAvatarReconcileContextCurrent(context, currentStudentAvatarContext())) return 'stale';
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
  Object.assign(studentForm, { source: 'institution', category_id: categories.value[0]?.id || '', department_id: '' });
  studentDialog.value = true;
}
function openStudentEdit(row: any) {
  studentAvatarDialogVersion.value += 1;
  Object.keys(studentForm).forEach((key) => delete studentForm[key]);
  Object.assign(studentForm, row, { department_id: row.department_id || '', category_id: row.category_id || '', employee_no: row.employee_no || '' });
  studentAvatarOriginalId.value = row.avatar_id ? String(row.avatar_id) : null;
  resetStudentAvatarState();
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

function cancelStudentDialog() {
  studentAvatarDialogVersion.value += 1;
  studentDialog.value = false;
  studentAvatarOriginalId.value = null;
  resetStudentAvatarState();
}

async function queryStudentAvatarState() {
  await reconcileStudentAvatarState(false);
}

async function saveStudent() {
  if (!studentForm.username || !studentForm.real_name || !studentForm.source || !studentForm.category_id || (!studentForm.id && !studentForm.password)) {
    ElMessage.warning('请填写用户名、姓名、来源、培训类别和密码'); return;
  }
  if (studentForm.id) {
    const studentId = String(studentForm.id);
    const nextAvatarId = normalizeAvatarId(studentForm.avatar_id);
    const avatarChanged = nextAvatarId !== studentAvatarOriginalId.value || studentAvatarWritePending.value;
    if (studentAvatarSync.status === 'unknown') {
      const context = currentStudentAvatarContext();
      if (!context) return;
      const preflight = await preflightAvatarSave(
        studentAvatarSync.status,
        context,
        (path) => http.get(path),
        currentStudentAvatarContext,
      );
      if (preflight.action === 'stale' || !preflight.result) return;
      setStudentAvatarSync(preflight.result);
      if (preflight.action === 'confirmed') {
        ElMessage.success('头像已通过状态查询确认更新');
        studentAvatarDialogVersion.value += 1;
        studentDialog.value = false;
        studentAvatarOriginalId.value = null;
        resetStudentAvatarState();
        await loadStudents();
        return;
      }
      ElMessage.warning(preflight.result.message);
      await loadStudents();
      return;
    }
    await http.put(`/admin/students/${studentForm.id}`, {
      real_name: studentForm.real_name,
      employee_no: studentForm.employee_no,
      source: studentForm.source,
      category_id: studentForm.category_id,
      department_id: studentForm.department_id,
      phone: studentForm.phone,
      email: studentForm.email,
    });
    if (avatarChanged) {
      try {
        await http.put(`/admin/students/${studentId}/avatar`, { avatar_id: nextAvatarId });
        studentAvatarOriginalId.value = nextAvatarId;
        resetStudentAvatarState();
      } catch {
        // The avatar endpoint re-checks the managed-student boundary in its
        // own transaction. Query the exact student once; never re-post an
        // uncertain PUT and never throw away the staged asset id.
        await reconcileStudentAvatarState(true);
        return;
      }
    }
  } else {
    await http.post('/admin/students', {
      username: studentForm.username,
      password: studentForm.password,
      real_name: studentForm.real_name,
      employee_no: studentForm.employee_no,
      source: studentForm.source,
      category_id: studentForm.category_id,
      department_id: studentForm.department_id,
      phone: studentForm.phone,
      email: studentForm.email,
    });
  }
  ElMessage.success('已保存'); studentAvatarDialogVersion.value += 1; studentDialog.value = false; studentAvatarOriginalId.value = null; resetStudentAvatarState(); await loadStudents();
}
async function toggleStudentStatus(row: any) {
  await ElMessageBox.confirm(row.status === 1 ? '停用后该学员旧令牌立即失效，确认停用？' : '确认启用该学员？', '确认', { type: 'warning' });
  await http.put(`/admin/students/${row.id}/status`, { status: row.status === 1 ? 0 : 1 }); await loadStudents();
}
async function resetStudentPassword(row: any) {
  const { value } = await ElMessageBox.prompt(`为「${row.real_name}」设置新的初始密码`, '重置密码', { inputType: 'password', inputPattern: /^(?=.*[A-Za-z])(?=.*\d).{8,}$/, inputErrorMessage: '至少 8 位，且同时包含字母与数字' });
  await http.put(`/admin/students/${row.id}/password`, { password: value }); ElMessage.success('已重置');
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

function openCreate() {
  Object.keys(form).forEach((k) => delete form[k]);
  Object.assign(form, { role: 'employee' });
  dialog.value = true;
}

function openEdit(row: any) {
  Object.keys(form).forEach((k) => delete form[k]);
  Object.assign(form, row, {
    employee_no: row.employee_no || '',
    // 列表返回的 department_id 是 number，DTO 按字符串校验，树选择器取值也是字符串
    department_id: row.department_id === null || row.department_id === undefined ? '' : String(row.department_id),
  });
  dialog.value = true;
}

async function onSave() {
  if (form.id) {
    await http.put(`/users/${form.id}`, form);
  } else {
    await http.post('/users', form);
  }
  ElMessage.success('已保存');
  dialog.value = false;
  await load();
}

async function toggleStatus(row: any) {
  const target = row.status === 1 ? 0 : 1;
  await ElMessageBox.confirm(
    target === 0 ? '停用后该账号即刻无法登录、不再计入应学人数，确认停用？' : '确认启用该账号？',
    '确认',
    { type: 'warning' },
  );
  await http.put(`/users/${row.id}/status`, { status: target });
  await load();
}

async function openReset(row: any) {
  const { value } = await ElMessageBox.prompt(`为「${row.real_name}」设置新的初始密码（≥8 位，字母+数字），重置后需重新走强制改密流程`, '重置密码', {
    inputPattern: /^(?=.*[A-Za-z])(?=.*\d).{8,}$/,
    inputErrorMessage: '至少 8 位，且同时包含字母与数字',
  });
  await http.put(`/users/${row.id}/password`, { password: value });
  ElMessage.success('已重置，旧密码立即失效');
}

function downloadTemplate() {
  download('/users/import-template', '员工导入模板.xlsx');
}

async function onImport(file: UploadFile) {
  if (!file.raw) return false;
  const res: any = await upload('/users/import', file.raw);
  importResult.value = res;
  importResultVisible.value = true;
  await load();
  return false;
}

onMounted(async () => {
  await loadDepts();
  if (isStudentPage.value) { await loadCategories(); await loadStudents(); }
  else await load();
});
</script>
