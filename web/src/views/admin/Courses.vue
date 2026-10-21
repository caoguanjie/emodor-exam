<template>
  <div class="page-card">
    <div class="page-head">
      <div class="eyebrow">管理台</div>
      <h2>课程管理</h2>
      <p class="desc">按培训类别组织章节与视频课时；上架前会校验全部必学视频资源。</p>
    </div>

    <el-alert v-if="!canRead && canWrite" type="info" :closable="false" style="margin-bottom:16px"
      title="当前账号可新建课程，但无课程查看权限；创建后需由具备查看权限的管理员继续维护目录。" />

    <div class="toolbar">
      <el-input v-if="canRead" v-model="query.keyword" clearable placeholder="课程标题" style="width:220px" @keyup.enter="search" />
      <el-select v-if="canRead && canWrite" v-model="query.category_id" clearable filterable placeholder="培训类别" style="width:190px" @change="search">
        <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
      </el-select>
      <el-select v-if="canRead" v-model="query.status" clearable placeholder="全部状态" style="width:140px" @change="search">
        <el-option label="草稿" value="draft" />
        <el-option label="已上架" value="published" />
        <el-option label="已下架" value="offline" />
      </el-select>
      <el-button v-if="canRead" type="primary" @click="search">查询</el-button>
      <div style="flex:1" />
      <el-button v-if="canWrite" type="primary" @click="openCreate">新建课程</el-button>
    </div>

    <el-table v-if="canRead" v-loading="loading" :data="items">
      <el-table-column prop="title" label="课程" min-width="220" />
      <el-table-column label="培训类别" width="170">
        <template #default="{ row }">{{ categoryName(row.category_id) }}</template>
      </el-table-column>
      <el-table-column label="必学课时" width="100">
        <template #default="{ row }">{{ row.required_lesson_count }}</template>
      </el-table-column>
      <el-table-column label="推荐 / 排序" width="130">
        <template #default="{ row }">{{ row.is_recommended ? '推荐' : '普通' }} · {{ row.sort_order }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="250" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" @click="router.push(`/admin/courses/${row.id}`)">编辑内容</el-button>
          <el-button v-if="row.status !== 'published' && auth.can('courses:publish')" text type="success" @click="publish(row)">上架</el-button>
          <el-button v-if="row.status === 'published' && auth.can('courses:publish')" text type="warning" @click="offline(row)">下架</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="canRead && !loading && items.length === 0" description="暂无课程" />
    <el-pagination v-if="canRead" v-model:current-page="query.page" style="margin-top:16px; justify-content:flex-end" layout="total, prev, pager, next"
      :total="total" :page-size="query.page_size" @current-change="load" />

    <el-dialog v-model="createVisible" title="新建课程" width="620px" destroy-on-close>
      <el-form label-width="96px">
        <el-form-item label="课程标题"><el-input v-model="form.title" maxlength="255" /></el-form-item>
        <el-form-item label="培训类别">
          <el-select v-model="form.category_id" filterable style="width:100%">
            <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="课程简介"><el-input v-model="form.description" type="textarea" :rows="3" maxlength="10000" /></el-form-item>
        <el-form-item label="课程封面"><MediaUpload v-model="form.cover_asset_id" purpose="course_cover" :disabled="!canUploadMedia" /></el-form-item>
        <el-form-item label="推荐"><el-switch v-model="form.is_recommended" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort_order" :min="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="create">创建草稿</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';
import http from '../../api/http';
import type { CourseStatus, Id, Page } from '../../api/training-types';
import MediaUpload from '../../components/MediaUpload.vue';
import { useAuthStore } from '../../stores/auth';

interface CategoryOption { id: Id; name: string }
interface CourseRow {
  id: Id; title: string; category_id: Id; required_lesson_count: number;
  is_recommended: boolean; sort_order: number; status: CourseStatus;
}

const router = useRouter();
const auth = useAuthStore();
const canRead = computed(() => auth.can('courses:read'));
const canWrite = computed(() => auth.can('courses:write'));
const canUploadMedia = computed(() => canWrite.value && auth.can('media:write'));
const loading = ref(false);
const saving = ref(false);
const items = ref<CourseRow[]>([]);
const total = ref(0);
const categories = ref<CategoryOption[]>([]);
const createVisible = ref(false);
const query = reactive({ page: 1, page_size: 20, keyword: '', category_id: '', status: '' });
const form = reactive({ title: '', category_id: '', description: '', cover_asset_id: null as Id | null, is_recommended: false, sort_order: 0 });

function categoryName(categoryId: Id) {
  return categories.value.find((item) => item.id === categoryId)?.name || `类别 ${categoryId}`;
}
function statusLabel(status: CourseStatus) { return ({ draft: '草稿', published: '已上架', offline: '已下架' })[status]; }
function statusType(status: CourseStatus) { return status === 'published' ? 'success' : status === 'offline' ? 'warning' : 'info'; }

async function loadCategories() {
  if (!canWrite.value) return;
  const result = await http.get('/admin/courses/category-options', { params: { page: 1, page_size: 100 } }) as Page<CategoryOption>;
  categories.value = result.items;
}
async function load() {
  if (!canRead.value) return;
  loading.value = true;
  try {
    const params = {
      page: query.page,
      page_size: query.page_size,
      ...(query.keyword.trim() ? { keyword: query.keyword.trim() } : {}),
      ...(query.category_id ? { category_id: query.category_id } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const result = await http.get('/admin/courses', { params }) as Page<CourseRow>;
    items.value = result.items;
    total.value = result.total;
  } finally { loading.value = false; }
}
function search() { query.page = 1; void load(); }
function openCreate() {
  Object.assign(form, { title: '', category_id: categories.value[0]?.id || '', description: '', cover_asset_id: null, is_recommended: false, sort_order: 0 });
  createVisible.value = true;
}
async function create() {
  if (!form.title.trim() || !form.category_id) { ElMessage.warning('请填写课程标题并选择培训类别'); return; }
  saving.value = true;
  try {
    const created = await http.post('/admin/courses', { ...form }) as { id: Id };
    ElMessage.success('课程草稿已创建');
    createVisible.value = false;
    if (canRead.value) await router.push(`/admin/courses/${created.id}`);
    else ElMessage.info(`课程 ${created.id} 已创建；获得查看权限后可继续维护目录`);
  } finally { saving.value = false; }
}
async function publish(row: CourseRow) {
  await ElMessageBox.confirm('系统将重新校验全部必学视频是否就绪。确认上架？', '上架课程', { type: 'warning' });
  await http.post(`/admin/courses/${row.id}/publish`);
  ElMessage.success('课程已上架');
  await load();
}
async function offline(row: CourseRow) {
  await ElMessageBox.confirm('下架后学员不能再进入课程，历史学习记录保留。确认下架？', '下架课程', { type: 'warning' });
  await http.post(`/admin/courses/${row.id}/offline`);
  ElMessage.success('课程已下架');
  await load();
}

onMounted(async () => { await loadCategories(); if (canRead.value) await load(); });
</script>
