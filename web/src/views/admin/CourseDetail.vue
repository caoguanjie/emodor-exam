<template>
  <div v-if="course" class="page-card course-detail">
    <div class="toolbar">
      <el-button text @click="router.push('/admin/courses')"><el-icon><ArrowLeft /></el-icon>返回课程</el-button>
      <el-divider direction="vertical" />
      <h2 class="detail-title">{{ course.title }}</h2>
      <el-tag :type="statusType(course.status)">{{ statusLabel(course.status) }}</el-tag>
      <div style="flex:1" />
      <el-button v-if="course.status !== 'published' && auth.can('courses:publish')" type="success" @click="publish">上架</el-button>
      <el-button v-if="course.status === 'published' && auth.can('courses:publish')" type="warning" plain @click="offline">下架</el-button>
    </div>

    <el-alert v-if="course.missing_required_lesson_ids?.length" type="warning" :closable="false" style="margin-bottom:16px"
      :title="`发布前仍有 ${course.missing_required_lesson_ids.length} 个必学课时缺少可用视频`" />
    <el-alert v-if="course.status === 'published'" type="info" :closable="false" style="margin-bottom:16px"
      title="已上架课程的章节和课时结构已锁定；替换视频会追加内容版本，不覆盖旧版本。" />

    <el-card shadow="never" class="section-card">
      <template #header><span>课程资料</span></template>
      <el-form label-width="96px">
        <el-form-item label="课程标题"><el-input v-model="form.title" maxlength="255" :disabled="!auth.can('courses:write')" /></el-form-item>
        <el-form-item label="培训类别">
          <el-select v-model="form.category_id" filterable style="width:100%" :disabled="!auth.can('courses:write')">
            <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="课程简介"><el-input v-model="form.description" type="textarea" :rows="3" maxlength="10000" :disabled="!auth.can('courses:write')" /></el-form-item>
        <el-form-item label="课程封面"><MediaUpload v-model="form.cover_asset_id" purpose="course_cover" :disabled="!canUploadMedia" /></el-form-item>
        <el-form-item label="制度关联">
          <el-select v-if="auth.can('regulations:read')" v-model="form.regulation_ids" multiple filterable clearable style="width:100%" :disabled="!auth.can('courses:write')">
            <el-option v-for="item in regulations" :key="item.id" :label="item.title" :value="item.id" />
          </el-select>
          <span v-else class="muted">{{ form.regulation_ids.length ? form.regulation_ids.join('、') : '未关联' }}</span>
        </el-form-item>
        <el-form-item label="推荐 / 排序">
          <el-switch v-model="form.is_recommended" :disabled="!auth.can('courses:write')" />
          <el-input-number v-model="form.sort_order" :min="0" style="margin-left:16px" :disabled="!auth.can('courses:write')" />
        </el-form-item>
        <el-form-item><el-button v-if="auth.can('courses:write')" type="primary" :loading="saving" @click="saveCourse">保存课程资料</el-button></el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="section-card">
      <template #header>
        <div class="card-head"><span>章节与视频课时</span><el-button v-if="structureEditable" type="primary" size="small" @click="openChapter()">新增章节</el-button></div>
      </template>
      <el-empty v-if="course.chapters.length === 0" description="暂无章节" />
      <el-collapse v-else v-model="expanded">
        <el-collapse-item v-for="chapter in course.chapters" :key="chapter.id" :name="chapter.id">
          <template #title>
            <span class="chapter-title">{{ chapter.sort_order }} · {{ chapter.title }}</span>
            <el-button v-if="structureEditable" text type="primary" size="small" @click.stop="openChapter(chapter)">编辑章节</el-button>
            <el-button v-if="structureEditable" text type="primary" size="small" @click.stop="openLesson(chapter.id)">新增课时</el-button>
          </template>
          <el-table :data="chapter.lessons">
            <el-table-column label="顺序" prop="sort_order" width="70" />
            <el-table-column label="课时" prop="title" min-width="180" />
            <el-table-column label="要求" width="90"><template #default="{ row }"><el-tag :type="row.required ? 'primary' : 'info'">{{ row.required ? '必学' : '选学' }}</el-tag></template></el-table-column>
            <el-table-column label="视频状态" min-width="210">
              <template #default="{ row }">
                <span v-if="row.current_version">版本 {{ row.current_version.version_id }} · {{ duration(row.current_version.duration_ms) }}</span>
                <el-tag v-else type="warning">缺少视频</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="220" fixed="right">
              <template #default="{ row }">
                <el-button v-if="structureEditable" text type="primary" @click="openLesson(chapter.id, row)">编辑</el-button>
                <el-button v-if="canUploadMedia" text type="primary" @click="openVideo(row)">{{ row.current_version ? '替换视频' : '上传视频' }}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-collapse-item>
      </el-collapse>
    </el-card>

    <el-dialog v-model="chapterVisible" :title="editingChapterId ? '编辑章节' : '新增章节'" width="480px">
      <el-form label-width="82px">
        <el-form-item label="章节标题"><el-input v-model="chapterForm.title" maxlength="255" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="chapterForm.sort_order" :min="0" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="chapterVisible = false">取消</el-button><el-button type="primary" @click="saveChapter">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="lessonVisible" :title="editingLessonId ? '编辑视频课时' : '新增视频课时'" width="620px" destroy-on-close>
      <el-form label-width="92px">
        <el-form-item label="课时标题"><el-input v-model="lessonForm.title" maxlength="255" /></el-form-item>
        <el-form-item label="必学"><el-switch v-model="lessonForm.required" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="lessonForm.sort_order" :min="0" /></el-form-item>
        <el-form-item v-if="!editingLessonId" label="视频"><MediaUpload v-model="lessonForm.asset_id" purpose="video" :disabled="!canUploadMedia" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="lessonVisible = false">取消</el-button><el-button type="primary" @click="saveLesson">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="videoVisible" title="追加视频版本" width="620px" destroy-on-close>
      <el-alert type="info" :closable="false" title="新视频将生成新版本；旧版本与已有引用不会被覆盖。" style="margin-bottom:14px" />
      <MediaUpload v-model="replacementAssetId" purpose="video" />
      <template #footer><el-button @click="videoVisible = false">取消</el-button><el-button type="primary" :disabled="!replacementAssetId" @click="replaceVideo">保存新版本</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ArrowLeft } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import http from '../../api/http';
import type { CourseChapterView, CourseDetail, CourseLessonView, CourseStatus, Id, Page } from '../../api/training-types';
import MediaUpload from '../../components/MediaUpload.vue';
import { useAuthStore } from '../../stores/auth';

interface CategoryOption { id: Id; name: string }
interface RegulationOption { id: Id; title: string }

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const courseId = String(route.params.id);
const course = ref<CourseDetail | null>(null);
const categories = ref<CategoryOption[]>([]);
const regulations = ref<RegulationOption[]>([]);
const expanded = ref<Id[]>([]);
const saving = ref(false);
const chapterVisible = ref(false);
const lessonVisible = ref(false);
const videoVisible = ref(false);
const editingChapterId = ref<Id | null>(null);
const editingLessonId = ref<Id | null>(null);
const replacementLessonId = ref<Id | null>(null);
const replacementAssetId = ref<Id | null>(null);
const form = reactive({ title: '', category_id: '', description: '', cover_asset_id: null as Id | null, regulation_ids: [] as Id[], is_recommended: false, sort_order: 0 });
const chapterForm = reactive({ title: '', sort_order: 0 });
const lessonForm = reactive({ chapter_id: '', title: '', required: true, sort_order: 0, asset_id: null as Id | null });
const structureEditable = computed(() => auth.can('courses:write') && course.value?.status !== 'published');
const canUploadMedia = computed(() => auth.can('courses:write') && auth.can('media:write'));

function statusLabel(status: CourseStatus) { return ({ draft: '草稿', published: '已上架', offline: '已下架' })[status]; }
function statusType(status: CourseStatus) { return status === 'published' ? 'success' : status === 'offline' ? 'warning' : 'info'; }
function duration(ms: number) { const seconds = Math.round(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }

async function load(resetForm = true) {
  const data = await http.get(`/admin/courses/${courseId}`) as CourseDetail;
  course.value = data;
  if (resetForm) {
    Object.assign(form, {
      title: data.title, category_id: data.category_id, description: data.description || '', cover_asset_id: data.cover_asset_id,
      regulation_ids: [...(data.regulation_ids || [])], is_recommended: Boolean(data.is_recommended), sort_order: data.sort_order || 0,
    });
  }
  expanded.value = data.chapters.map((item) => item.id);
}
async function loadOptions() {
  if (auth.can('courses:write')) {
    const data = await http.get('/admin/courses/category-options', { params: { page: 1, page_size: 100 } }) as Page<CategoryOption>;
    categories.value = data.items;
  }
  if (auth.can('regulations:read')) {
    const data = await http.get('/regulations', { params: { page: 1, page_size: 100 } }) as { list: { id: string | number; title: string }[] };
    regulations.value = data.list.map((item) => ({ id: String(item.id), title: item.title }));
  }
}
async function saveCourse() {
  if (!form.title.trim() || !form.category_id) { ElMessage.warning('请填写标题并选择培训类别'); return; }
  saving.value = true;
  try { await http.put(`/admin/courses/${courseId}`, { ...form }); ElMessage.success('课程资料已保存'); await load(); }
  finally { saving.value = false; }
}
function openChapter(chapter?: CourseChapterView) {
  editingChapterId.value = chapter?.id || null;
  Object.assign(chapterForm, {
    title: chapter?.title || '',
    sort_order: chapter?.sort_order ?? (course.value?.chapters.length || 0) + 1,
  });
  chapterVisible.value = true;
}
async function saveChapter() {
  if (!chapterForm.title.trim()) { ElMessage.warning('请填写章节标题'); return; }
  if (editingChapterId.value) await http.put(`/admin/courses/${courseId}/chapters/${editingChapterId.value}`, chapterForm);
  else await http.post(`/admin/courses/${courseId}/chapters`, chapterForm);
  chapterVisible.value = false;
  await load(false);
}
function openLesson(chapterId: Id, lesson?: CourseLessonView) {
  editingLessonId.value = lesson?.id || null;
  Object.assign(lessonForm, {
    chapter_id: chapterId,
    title: lesson?.title || '',
    required: lesson?.required ?? true,
    sort_order: lesson?.sort_order ?? 1,
    asset_id: null,
  });
  lessonVisible.value = true;
}
async function saveLesson() {
  if (!lessonForm.title.trim()) { ElMessage.warning('请填写课时标题'); return; }
  const payload = { title: lessonForm.title, required: lessonForm.required, sort_order: lessonForm.sort_order, lesson_type: 'video' as const };
  if (editingLessonId.value) await http.put(`/admin/courses/${courseId}/lessons/${editingLessonId.value}`, payload);
  else await http.post(`/admin/courses/${courseId}/lessons`, { ...payload, chapter_id: lessonForm.chapter_id, asset_id: lessonForm.asset_id });
  lessonVisible.value = false;
  await load(false);
}
function openVideo(lesson: CourseLessonView) { replacementLessonId.value = lesson.id; replacementAssetId.value = null; videoVisible.value = true; }
async function replaceVideo() {
  if (!replacementLessonId.value || !replacementAssetId.value) return;
  await http.post(`/admin/courses/${courseId}/lessons/${replacementLessonId.value}/versions`, { asset_id: replacementAssetId.value });
  ElMessage.success('视频新版本已保存'); videoVisible.value = false; await load(false);
}
async function publish() {
  await ElMessageBox.confirm('系统将重新校验必学视频资源，确认上架？', '上架课程', { type: 'warning' });
  await http.post(`/admin/courses/${courseId}/publish`); ElMessage.success('课程已上架'); await load(false);
}
async function offline() {
  await ElMessageBox.confirm('下架会阻止学员新进入课程，历史记录保留。确认下架？', '下架课程', { type: 'warning' });
  await http.post(`/admin/courses/${courseId}/offline`); ElMessage.success('课程已下架'); await load(false);
}

onMounted(async () => { await Promise.all([loadOptions(), load()]); });
</script>

<style scoped>
.course-detail { display: flex; flex-direction: column; gap: 16px; }
.detail-title { margin: 0; font-size: 18px; font-weight: 600; }
.section-card { border-radius: var(--re-radius); border: 1px solid var(--re-border); }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.chapter-title { margin-right: 12px; font-weight: 600; }
.muted { color: var(--re-text-3); }
</style>
