<template>
  <div class="page-card">
    <div class="page-head question-import-head">
      <div>
        <div class="eyebrow">统一题库</div>
        <h2>Excel / TXT 导入题目</h2>
        <p class="desc">先下载同版模板，上传后只确认预检通过且不重复的行；错误行请修正文件后重新预览。</p>
      </div>
      <el-button @click="router.push('/admin/questions')">返回题库</el-button>
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="TXT 固定使用 UTF-8 TSV；options 与 answer 单元格必须填写 JSON 数组，不支持逗号等手工分隔写法。"
      style="margin-bottom:16px"
    />

    <el-form label-width="110px" class="import-form">
      <el-form-item label="文件格式" required>
        <el-radio-group v-model="format" :disabled="previewBusy || commitBusy">
          <el-radio-button value="xlsx">Excel (.xlsx)</el-radio-button>
          <el-radio-button value="txt">TXT (.txt)</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="默认类别">
        <el-select v-model="defaults.category_id" clearable filterable placeholder="文件 category 为空时使用" style="width:320px" :disabled="previewBusy || commitBusy">
          <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="默认难度">
        <el-select v-model="defaults.difficulty" clearable placeholder="文件 difficulty 为空时使用" style="width:320px" :disabled="previewBusy || commitBusy">
          <el-option label="初级" value="easy" /><el-option label="中级" value="medium" /><el-option label="高级" value="hard" />
        </el-select>
      </el-form-item>
      <el-form-item label="导入文件" required>
        <div class="file-actions">
          <el-button :disabled="previewBusy || commitBusy" @click="downloadTemplate">下载 {{ format.toUpperCase() }} 模板</el-button>
          <el-upload
            :key="uploadKey"
            :show-file-list="false"
            :accept="format === 'xlsx' ? '.xlsx' : '.txt,text/plain'"
            :auto-upload="false"
            :disabled="previewBusy || commitBusy"
            :on-change="previewFile"
          >
            <el-button type="primary" :loading="previewBusy">选择文件并预览</el-button>
          </el-upload>
        </div>
      </el-form-item>
    </el-form>

    <section v-if="preview" class="preview-panel">
      <div class="preview-summary">
        <el-tag type="success">可导入 {{ preview.valid_rows.length }} 行</el-tag>
        <el-tag v-if="preview.errors.length" type="danger">错误 {{ preview.errors.length }} 行</el-tag>
        <el-tag v-if="preview.duplicates.length" type="warning">重复 {{ preview.duplicates.length }} 行</el-tag>
        <span class="batch-id">批次 {{ preview.batch_id }}</span>
      </div>

      <el-alert
        v-if="preview.duplicates.length"
        type="warning"
        :closable="false"
        :title="`重复行默认不导入：${preview.duplicates.join('、')}`"
        style="margin-bottom:12px"
      />
      <el-table v-if="preview.errors.length" :data="preview.errors" size="small" max-height="260">
        <el-table-column prop="row" label="行号" width="90" />
        <el-table-column prop="message" label="错误原因" min-width="320" />
      </el-table>
      <el-empty v-if="!preview.valid_rows.length" description="没有可确认的行，请修正文件后重新上传" :image-size="80" />

      <div class="preview-actions">
        <el-button :disabled="commitBusy" @click="resetPreview">修正后重新上传</el-button>
        <el-button v-if="commitUnknown" :loading="statusBusy" @click="queryBatchStatus">查询原批次状态</el-button>
        <el-button
          type="primary"
          :loading="commitBusy"
          :disabled="!preview.valid_rows.length || commitBusy || commitUnknown"
          @click="commitImport"
        >
          确认导入 {{ preview.valid_rows.length }} 行
        </el-button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { UploadFile } from 'element-plus';
import { useRouter } from 'vue-router';
import http, { ApiError, download, upload } from '../../api/http';
import type { Difficulty, Id, ImportPreview, ImportResult, Page } from '../../api/training-types';

type CategoryOption = { id: Id; name: string };

const router = useRouter();
const format = ref<'xlsx' | 'txt'>('xlsx');
const categories = ref<CategoryOption[]>([]);
const defaults = reactive<{ category_id: Id | ''; difficulty: Difficulty | '' }>({ category_id: '', difficulty: '' });
const preview = ref<ImportPreview | null>(null);
const previewBusy = ref(false);
const commitBusy = ref(false);
const statusBusy = ref(false);
const commitUnknown = ref(false);
const uploadKey = ref(0);

watch(format, () => resetPreview());

async function loadCategories() {
  const result = await http.get('/ai/question-category-options', { params: { page: 1, page_size: 100 } }) as Page<CategoryOption>;
  categories.value = result.items || [];
}

function downloadTemplate() {
  void download(
    '/admin/questions/import-template',
    `题库导入模板.${format.value}`,
    { format: format.value },
  );
}

function resetPreview() {
  preview.value = null;
  commitUnknown.value = false;
  uploadKey.value += 1;
}

async function previewFile(value: UploadFile) {
  const file = value.raw;
  if (!(file instanceof File)) return;
  const expected = format.value === 'xlsx' ? /\.xlsx$/i : /\.txt$/i;
  if (!expected.test(file.name)) {
    ElMessage.warning(`请选择 .${format.value} 文件`);
    uploadKey.value += 1;
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.warning('导入文件不能超过 5MB');
    uploadKey.value += 1;
    return;
  }
  previewBusy.value = true;
  commitUnknown.value = false;
  preview.value = null;
  try {
    const fields = Object.fromEntries(Object.entries({
      format: format.value,
      category_id: defaults.category_id,
      difficulty: defaults.difficulty,
    }).filter(([, item]) => item !== '')) as Record<string, string>;
    preview.value = await upload('/admin/questions/import-preview', file, 'file', fields) as unknown as ImportPreview;
  } finally {
    previewBusy.value = false;
    uploadKey.value += 1;
  }
}

async function finish(result: ImportResult) {
  ElMessage.success(`成功导入 ${result.created_ids.length} 道题目`);
  await router.push('/admin/questions');
}

async function queryBatchStatus() {
  if (!preview.value) return;
  statusBusy.value = true;
  try {
    const state = await http.get(`/admin/questions/import-batches/${preview.value.batch_id}`) as ImportPreview | ImportResult;
    if ('created_ids' in state) {
      await finish(state);
      return;
    }
    preview.value = state;
    commitUnknown.value = false;
    ElMessage.warning('服务器确认该批次尚未提交，请核对后再次明确确认');
  } catch {
    ElMessage.warning('仍无法确认原批次状态；系统没有自动新建或重复提交批次');
  } finally {
    statusBusy.value = false;
  }
}

async function commitImport() {
  if (!preview.value || !preview.value.valid_rows.length) return;
  commitBusy.value = true;
  try {
    const result = await http.post(
      `/admin/questions/import-batches/${preview.value.batch_id}/commit`,
      { row_numbers: preview.value.valid_rows },
    ) as ImportResult;
    await finish(result);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code === 0) {
      commitUnknown.value = true;
      ElMessage.warning('提交响应未确认，请先查询原批次状态；系统不会自动重建批次');
    }
  } finally {
    commitBusy.value = false;
  }
}

onMounted(loadCategories);
</script>

<style scoped>
.question-import-head { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
.import-form { max-width: 720px; }
.file-actions, .preview-summary, .preview-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.preview-panel { margin-top: 22px; border-top: 1px solid #ebeef5; padding-top: 20px; }
.preview-summary { margin-bottom: 14px; }
.batch-id { color: #909399; font-size: 13px; }
.preview-actions { justify-content: flex-end; margin-top: 18px; }
</style>
