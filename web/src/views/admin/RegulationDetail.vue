<template>
  <div v-if="reg" class="page-card">
    <div class="toolbar">
      <el-button text @click="$router.push('/admin/regulations')"><el-icon><ArrowLeft /></el-icon>返回</el-button>
      <el-divider direction="vertical" />
      <div class="detail-head">
        <h2 class="detail-title">{{ reg.title }}</h2>
        <el-tag :type="statusType(reg.status)" size="small">{{ statusLabel(reg.status) }}</el-tag>
      </div>
      <div style="flex:1" />
      <el-button v-if="reg.status !== 'archived' && auth.can('regulations:publish')" type="success" @click="onPublish">发布制度</el-button>
      <el-button v-if="reg.status !== 'archived' && auth.can('regulations:write')" type="warning" plain @click="onArchive">归档</el-button>
    </div>

    <el-tabs>
      <el-tab-pane label="基本信息">
        <el-form label-width="140px" style="max-width:560px; margin-top:12px">
          <el-form-item label="旧制度分类"><el-input :model-value="reg.category" disabled /></el-form-item>
          <el-form-item label="培训类别">
            <el-select v-if="auth.can('regulations:write')" v-model="categoryId" clearable filterable style="width:100%">
              <el-option v-for="item in categoryOptions" :key="item.id" :label="item.name" :value="item.id" />
            </el-select>
            <span v-else>{{ categoryId ? `类别 ID ${categoryId}` : '未关联' }}</span>
          </el-form-item>
          <el-form-item v-if="auth.can('regulations:write')"><el-button type="primary" @click="saveCategory">保存培训类别</el-button></el-form-item>
        </el-form>
      </el-tab-pane>
      <el-tab-pane label="制度版本">
        <div class="toolbar">
          <el-upload v-if="auth.can('regulations:write')" :show-file-list="false" accept=".pdf,.docx" :auto-upload="false" :on-change="onUploadChange">
            <el-button type="primary">上传制度文件（PDF / DOCX ≤ 50MB）</el-button>
          </el-upload>
          <span style="color:#909399; font-size:13px">版本 append-only；解析为异步，状态实时轮询</span>
        </div>
        <el-table :data="versions">
          <el-table-column prop="version_no" label="版本" width="70">
            <template #default="{ row }">v{{ row.version_no }}</template>
          </el-table-column>
          <el-table-column prop="file_type" label="类型" width="80" />
          <el-table-column label="解析状态" width="110">
            <template #default="{ row }">
              <el-tag :type="row.parse_status === 'parsed' ? 'success' : row.parse_status === 'failed' ? 'danger' : 'info'">
                {{ ({ parsed: '已解析', pending: '解析中', failed: '解析失败' } as any)[row.parse_status] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="retry_count" label="重试次数" width="90" />
          <el-table-column label="当前生效" width="110">
            <template #default="{ row }">
              <el-tag v-if="row.is_current" type="success">生效中</el-tag>
              <el-button v-else-if="row.parse_status === 'parsed' && reg.status !== 'archived' && auth.can('regulations:write')" text size="small" type="primary" @click="switchVersion(row)">设为生效</el-button>
            </template>
          </el-table-column>
          <el-table-column label="上传时间" min-width="150">
            <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button text size="small" @click="preview(row)">预览</el-button>
              <el-button v-if="row.parse_status === 'failed' && auth.can('regulations:write')" text size="small" type="warning" @click="retryParse(row)">重新解析</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="学习要求">
        <el-form label-width="160px" style="max-width:520px; margin-top:12px">
          <el-form-item label="规定有效学习时长（分钟）">
            <!-- key 随每次 load 递增：el-input-number 在程序化更新场景下内部显示可能不回同步，重挂载保证显示=数据 -->
            <el-input-number :key="configKey" v-model="config.required_minutes" :min="1" :max="600" :disabled="!auth.can('regulations:write')" />
          </el-form-item>
          <el-form-item label="滚动分段数">
            <el-input-number :key="configKey + 1" v-model="config.scroll_segments" :min="10" :max="10" disabled />
            <span style="color:#909399; font-size:12px; margin-left:8px">本期固定 10 段（配置项前向保留）</span>
          </el-form-item>
          <el-form-item>
            <el-button v-if="auth.can('regulations:write')" type="primary" @click="saveConfig">保存学习要求</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="发布范围">
        <el-radio-group v-model="scope.is_all" :disabled="!auth.can('regulations:write')">
          <el-radio :value="true">面向全员</el-radio>
          <el-radio :value="false">按部门圈定（含子部门）</el-radio>
        </el-radio-group>
        <div v-if="!scope.is_all" style="margin-top:14px; max-width:420px">
          <el-tree ref="scopeTreeRef" :data="deptTree" show-checkbox node-key="id" default-expand-all :disabled="!auth.can('regulations:write')"
            :props="{ label: 'name' }" @check="onScopeCheck" />
        </div>
        <el-button v-if="auth.can('regulations:write')" type="primary" style="margin-top:14px" @click="saveScope">保存发布范围</el-button>
      </el-tab-pane>

      <el-tab-pane label="内容预览">
        <div class="reading-container" v-html="previewHtml" />
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="previewVisible" title="版本内容预览" width="760px">
      <div class="reading-container" style="max-height:60vh; overflow:auto" v-html="previewHtml" />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft } from '@element-plus/icons-vue';
import type { UploadFile } from 'element-plus';
import http, { upload } from '../../api/http';
import { formatDateTime } from '../../utils/format';
import { useAuthStore } from '../../stores/auth';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';

const route = useRoute();
const regId = String(route.params.id);
const auth = useAuthStore();

const reg = ref<any>(null);
const versions = ref<any[]>([]);
const deptTree = ref<any[]>([]);
const config = reactive({ required_minutes: 10, scroll_segments: 10 });
const configKey = ref(0);
const scope = reactive<{ is_all: boolean; departmentIds: string[] }>({ is_all: false, departmentIds: [] });
const previewHtml = ref('');
const previewVisible = ref(false);
const scopeTreeRef = ref();
const categoryOptions = ref<Array<{ id: string; name: string }>>([]);
const categoryId = ref<string | null>(null);
const categoryBaseline = ref<string | null>(null);
const configBaseline = ref({ required_minutes: 10, scroll_segments: 10 });
const scopeBaseline = ref<{ is_all: boolean; departmentIds: string[] }>({ is_all: false, departmentIds: [] });
const categoryDirty = ref(false);
const configDirty = ref(false);
const scopeDirty = ref(false);

function normalizeDepartmentIds(values: unknown[]): string[] {
  return [...new Set(values.map(String))].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function configSnapshot() {
  return { required_minutes: Number(config.required_minutes), scroll_segments: Number(config.scroll_segments) };
}

function scopeSnapshot() {
  return {
    is_all: !!scope.is_all,
    departmentIds: scope.is_all ? [] : normalizeDepartmentIds(scope.departmentIds),
  };
}

function captureCategoryBaseline() {
  categoryBaseline.value = categoryId.value;
  categoryDirty.value = false;
}

function captureConfigBaseline() {
  configBaseline.value = configSnapshot();
  configDirty.value = false;
}

function captureScopeBaseline() {
  scopeBaseline.value = scopeSnapshot();
  scopeDirty.value = false;
}

function restoreCategoryBaseline() {
  categoryId.value = categoryBaseline.value;
  categoryDirty.value = false;
}

function restoreConfigBaseline() {
  Object.assign(config, configBaseline.value);
  configKey.value += 1;
  configDirty.value = false;
}

function restoreScopeBaseline() {
  scope.is_all = scopeBaseline.value.is_all;
  scope.departmentIds = [...scopeBaseline.value.departmentIds];
  scopeDirty.value = false;
  void nextTick(() => (scopeTreeRef.value as any)?.setCheckedKeys(scope.departmentIds));
}

const categoryUnsaved = useUnsavedChanges(categoryDirty, { onDiscard: restoreCategoryBaseline });
const configUnsaved = useUnsavedChanges(configDirty, { onDiscard: restoreConfigBaseline });
const scopeUnsaved = useUnsavedChanges(scopeDirty, { onDiscard: restoreScopeBaseline });

watch(categoryId, () => {
  categoryDirty.value = categoryId.value !== categoryBaseline.value;
}, { flush: 'sync' });
watch(config, () => {
  configDirty.value = JSON.stringify(configSnapshot()) !== JSON.stringify(configBaseline.value);
}, { deep: true, flush: 'sync' });
watch(scope, () => {
  scopeDirty.value = JSON.stringify(scopeSnapshot()) !== JSON.stringify(scopeBaseline.value);
}, { deep: true, flush: 'sync' });
watch(() => scope.is_all, (isAll) => {
  if (!isAll) void nextTick(() => (scopeTreeRef.value as any)?.setCheckedKeys(scope.departmentIds));
});

function statusLabel(s: string) {
  return ({ draft: '草稿', published: '已发布', archived: '已归档' } as any)[s] || s;
}
function statusType(s: string) {
  return ({ draft: 'info', published: 'success', archived: 'warning' } as any)[s] || 'info';
}

async function load() {
  reg.value = await http.get(`/regulations/${regId}`);
  categoryId.value = reg.value.category_id ? String(reg.value.category_id) : null;
  config.required_minutes = reg.value.required_minutes;
  config.scroll_segments = reg.value.scroll_segments;
  configKey.value++; // 强制 el-input-number 重挂载，显示与数据保持一致
  // 发布范围回显（详情接口含 scope：is_all / department_ids）
  scope.is_all = !!reg.value.scope?.is_all;
  scope.departmentIds = (reg.value.scope?.department_ids || []).map(String);
  // 在首次异步等待前建立服务端基线，避免加载中的数据回显被误判成用户草稿。
  captureCategoryBaseline();
  captureConfigBaseline();
  captureScopeBaseline();
  await loadVersions();
  const tree: any = await http.get('/departments/tree');
  deptTree.value = tree.list;
  await nextTick();
  (scopeTreeRef.value as any)?.setCheckedKeys(scope.departmentIds);
  scope.departmentIds = currentScopeDepartmentIds();
  captureScopeBaseline();
}

async function loadVersions() {
  versions.value = await http.get(`/regulations/${regId}/versions`) as any;
}

function currentScopeDepartmentIds(): string[] {
  if (scope.is_all) return [];
  const tree = scopeTreeRef.value as any;
  if (!tree) return normalizeDepartmentIds(scope.departmentIds);
  return normalizeDepartmentIds([...(tree.getCheckedKeys?.() || []), ...(tree.getHalfCheckedKeys?.() || [])]);
}

function onScopeCheck(_data: unknown, state: { checkedKeys?: unknown[]; halfCheckedKeys?: unknown[] }) {
  scope.departmentIds = normalizeDepartmentIds([...(state.checkedKeys || []), ...(state.halfCheckedKeys || [])]);
}

async function loadCategoryOptions() {
  if (!auth.can('regulations:write')) return;
  const result: any = await http.get('/regulations/category-options', { params: { page: 1, page_size: 100 } });
  categoryOptions.value = result.items || [];
}

async function saveCategory() {
  await http.put(`/regulations/${regId}`, { category_id: categoryId.value || null });
  if (reg.value) reg.value.category_id = categoryId.value || null;
  captureCategoryBaseline();
  categoryUnsaved.markClean();
  ElMessage.success(categoryId.value ? '培训类别已保存' : '已清除培训类别关联');
}

async function handleUpload(file: File) {
  const res: any = await upload(`/regulations/${regId}/versions`, file);
  if (res.duplicate_hint) ElMessage.warning(res.duplicate_hint + '（已创建新版本）');
  else ElMessage.success('上传成功，解析中…');
  pollVersions(res.version_id);
  return false;
}

async function onUploadChange(file: UploadFile) {
  if (!file.raw) return;
  await handleUpload(file.raw);
}

let pollTimer: number | null = null;
async function pollVersions(versionId: number) {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(async () => {
    versions.value = await http.get(`/regulations/${regId}/versions`) as any;
    const v = versions.value.find((x: any) => x.id === versionId);
    if (v && v.parse_status !== 'pending') {
      if (pollTimer) window.clearInterval(pollTimer);
      pollTimer = null;
      if (v.parse_status === 'parsed') ElMessage.success(`v${v.version_no} 解析成功`);
      else ElMessage.error('解析失败：可能为扫描版 PDF，请上传含可复制文本的文件');
    }
  }, 2000);
}

async function switchVersion(row: any) {
  await http.put(`/regulations/${regId}/current-version`, { version_id: String(row.id) });
  ElMessage.success(`已切换生效版本至 v${row.version_no}`);
  await loadVersions();
}

async function retryParse(row: any) {
  await http.post(`/regulations/${regId}/versions/${row.id}/retry`);
  ElMessage.success('已重新入队解析');
  pollVersions(row.id);
}

async function saveConfig() {
  // el-input-number 聚焦期间不改写 model（显示与实际值会短暂脱节），保存前先失焦提交
  (document.activeElement as HTMLElement | null)?.blur?.();
  await http.put(`/regulations/${regId}/learning-config`, { ...config });
  if (reg.value) {
    reg.value.required_minutes = config.required_minutes;
    reg.value.scroll_segments = config.scroll_segments;
  }
  captureConfigBaseline();
  configUnsaved.markClean();
  ElMessage.success('学习要求已保存（已达标员工不回退）');
}

async function saveScope() {
  scope.departmentIds = currentScopeDepartmentIds();
  const snapshot = scopeSnapshot();
  await http.put(`/regulations/${regId}/scope`, { is_all: snapshot.is_all, department_ids: snapshot.departmentIds });
  if (reg.value) reg.value.scope = { is_all: snapshot.is_all, department_ids: [...snapshot.departmentIds] };
  captureScopeBaseline();
  scopeUnsaved.markClean();
  ElMessage.success('发布范围已保存');
}

async function onPublish() {
  await ElMessageBox.confirm('发布前置：存在已解析的生效版本且已配置发布范围。确认发布？', '发布制度', { type: 'warning' });
  await http.post(`/regulations/${regId}/publish`);
  if (reg.value) reg.value.status = 'published';
  ElMessage.success('发布成功，范围内员工已可见');
}

async function onArchive() {
  await ElMessageBox.confirm('归档后员工端不可见、不可再学习与考试，历史数据保留并计入统计。确认归档？', '归档', { type: 'warning' });
  await http.post(`/regulations/${regId}/archive`);
  if (reg.value) reg.value.status = 'archived';
  ElMessage.success('已归档');
}

async function preview(row?: any) {
  const q = row ? `?versionId=${row.id}` : '';
  try {
    const d: any = await http.get(`/regulations/${regId}/preview${q}`);
    previewHtml.value = d.content_html || `（该版本为 ${d.file_type?.toUpperCase()}，解析状态：${d.parse_status}）`;
  } catch {
    // 进入详情页时可能尚无生效版本：占位提示即可，不弹错误 toast（避免开页即报错）
    if (row) {
      // 手动点「预览」失败：拦截器已弹过 toast，不 rethrow（模板事件链无 catch，会产生 unhandled rejection）
      ElMessage.error('该版本内容暂不可预览');
      return;
    }
    previewHtml.value = '（暂无生效版本或内容不可见：请先在「制度版本」中上传并设置生效版本）';
  }
  if (row) previewVisible.value = true;
}

onMounted(async () => {
  await loadCategoryOptions();
  await load();
  await preview();
});

onBeforeUnmount(() => {
  // 解析轮询仅由终态自清，离开页面时必须兜底清理
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = null;
});
</script>

<style scoped>
.detail-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.detail-title { font-size: 18px; font-weight: 600; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 420px; }
</style>
