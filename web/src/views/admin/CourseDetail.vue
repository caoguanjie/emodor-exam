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

    <el-dialog v-model="chapterVisible" :title="editingChapterId ? '编辑章节' : '新增章节'" width="480px" class="re-form-dialog" :before-close="beforeChapterClose">
      <el-form label-width="82px">
        <el-form-item label="章节标题"><el-input v-model="chapterForm.title" maxlength="255" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="chapterForm.sort_order" :min="0" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="closeChapter">取消</el-button><el-button type="primary" :loading="chapterSaving" :disabled="chapterSaving" @click="saveChapter">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="lessonVisible" :title="editingLessonId ? '编辑视频课时' : '新增视频课时'" width="620px" class="re-form-dialog" destroy-on-close :before-close="beforeLessonClose">
      <el-form label-width="92px">
        <el-form-item label="课时标题"><el-input v-model="lessonForm.title" maxlength="255" /></el-form-item>
        <el-form-item label="必学"><el-switch v-model="lessonForm.required" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="lessonForm.sort_order" :min="0" /></el-form-item>
        <el-form-item v-if="lessonAssetDraftVisible" label="视频">
          <div style="width:100%">
            <MediaUpload v-model="lessonForm.asset_id" purpose="video" :disabled="!canUploadMedia" />
            <div v-if="editingLessonId" class="muted" style="margin-top:8px">已创建课时的视频不能删除；如需调整，请选择新视频生成替换版本。</div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="closeLesson">取消</el-button><el-button type="primary" :loading="lessonSaving" :disabled="lessonSaving" @click="saveLesson">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="videoVisible" title="追加视频版本" width="620px" class="re-form-dialog" destroy-on-close :before-close="beforeVideoClose">
      <el-alert type="info" :closable="false" title="新视频将生成新版本；旧版本与已有引用不会被覆盖。" style="margin-bottom:14px" />
      <MediaUpload v-model="replacementAssetId" purpose="video" />
      <template #footer><el-button @click="closeVideo">取消</el-button><el-button type="primary" :disabled="!replacementAssetId" @click="replaceVideo">保存新版本</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ArrowLeft } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import http from '../../api/http';
import type { CourseChapterView, CourseDetail, CourseLessonView, CourseStatus, Id, LessonVersionView, Page } from '../../api/training-types';
import MediaUpload from '../../components/MediaUpload.vue';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { useAuthStore } from '../../stores/auth';

interface CategoryOption { id: Id; name: string }
interface CourseDraft {
  title: string; category_id: Id | ''; description: string; cover_asset_id: Id | null;
  is_recommended: boolean; sort_order: number;
}
interface ChapterDraft { title: string; sort_order: number }
interface LessonDraft { chapter_id: Id | ''; title: string; required: boolean; sort_order: number; asset_id: Id | null }
interface SavedLessonMetadata {
  id: Id; course_id: Id; chapter_id: Id; title: string; lesson_type: 'video';
  required: boolean; sort_order: number; current_version_id: Id | null;
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const courseId = String(route.params.id);
const course = ref<CourseDetail | null>(null);
const categories = ref<CategoryOption[]>([]);
const expanded = ref<Id[]>([]);
const saving = ref(false);
const chapterSaving = ref(false);
const lessonSaving = ref(false);
const chapterVisible = ref(false);
const lessonVisible = ref(false);
const videoVisible = ref(false);
const lessonAssetDraftVisible = ref(false);
const courseDirty = ref(false);
const chapterDirty = ref(false);
const lessonDirty = ref(false);
const videoDirty = ref(false);
const editingChapterId = ref<Id | null>(null);
const editingLessonId = ref<Id | null>(null);
const replacementLessonId = ref<Id | null>(null);
const replacementAssetId = ref<Id | null>(null);
const form = reactive<CourseDraft>({ title: '', category_id: '', description: '', cover_asset_id: null, is_recommended: false, sort_order: 0 });
const chapterForm = reactive<ChapterDraft>({ title: '', sort_order: 0 });
const lessonForm = reactive<LessonDraft>({ chapter_id: '', title: '', required: true, sort_order: 0, asset_id: null });
const structureEditable = computed(() => auth.can('courses:write') && course.value?.status !== 'published');
const canUploadMedia = computed(() => auth.can('courses:write') && auth.can('media:write'));
let courseBaseline: CourseDraft = copyCourseDraft(form);
let chapterBaseline = { editingId: null as Id | null, form: { ...chapterForm } };
let lessonBaseline = { editingId: null as Id | null, form: { ...lessonForm } };
let videoBaseline = { lessonId: null as Id | null, assetId: null as Id | null };
let courseOperationSequence = 0;
let courseLatestOperation = 0;
let courseLastAppliedOperation = 0;
let chapterContextToken = 0;
let chapterOperationSequence = 0;
let chapterLatestOperation = 0;
let chapterLastAppliedOperation = 0;
let lessonContextToken = 0;
let lessonOperationSequence = 0;
let lessonLatestOperation = 0;
let lessonLastAppliedOperation = 0;
let videoContextToken = 0;
let videoOperationSequence = 0;
let videoLatestOperation = 0;
let videoLastAppliedOperation = 0;
const courseUnsaved = useUnsavedChanges(courseDirty, { onDiscard: discardCourse });
const chapterUnsaved = useUnsavedChanges(chapterDirty, { onDiscard: discardChapter });
const lessonUnsaved = useUnsavedChanges(lessonDirty, { onDiscard: discardLesson });
const videoUnsaved = useUnsavedChanges(videoDirty, { onDiscard: discardVideo });

function copyCourseDraft(value: CourseDraft): CourseDraft {
  return { ...value };
}
function sameDraft(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function snapshotChapterDraft() {
  return { editingId: editingChapterId.value, form: { ...chapterForm } };
}
function snapshotLessonDraft() {
  return { editingId: editingLessonId.value, form: { ...lessonForm } };
}
function lessonMetadata(value: LessonDraft) {
  return { title: value.title, required: value.required, sort_order: value.sort_order };
}
function syncLessonDraftState() {
  lessonDirty.value = !sameDraft(snapshotLessonDraft(), lessonBaseline);
  lessonAssetDraftVisible.value = editingLessonId.value === null || lessonForm.asset_id !== lessonBaseline.form.asset_id;
}
function courseLesson(lessonId: Id) {
  return course.value?.chapters.flatMap((chapter) => chapter.lessons).find((lesson) => lesson.id === lessonId);
}
function syncMissingRequiredLesson(lessonId: Id, missing: boolean) {
  if (!course.value) return;
  const missingIds = new Set(course.value.missing_required_lesson_ids || []);
  if (missing) missingIds.add(lessonId);
  else missingIds.delete(lessonId);
  course.value.missing_required_lesson_ids = [...missingIds];
}
function syncSavedLessonMetadata(saved: SavedLessonMetadata) {
  const row = courseLesson(saved.id);
  syncMissingRequiredLesson(saved.id, saved.required && !saved.current_version_id && !row?.current_version);
  if (!row) return;
  Object.assign(row, {
    title: saved.title,
    lesson_type: saved.lesson_type,
    required: saved.required,
    sort_order: saved.sort_order,
  });
}
function syncSavedLessonVersion(lessonId: Id, saved: LessonVersionView) {
    syncMissingRequiredLesson(lessonId, false);
  const row = courseLesson(lessonId);
  if (row) row.current_version = { ...saved };
}
function snapshotVideoDraft() {
  return { lessonId: replacementLessonId.value, assetId: replacementAssetId.value };
}
function captureCourseBaseline() {
  courseBaseline = copyCourseDraft(form);
  courseUnsaved.markClean();
}
function discardCourse() {
  Object.assign(form, copyCourseDraft(courseBaseline));
  courseDirty.value = false;
}
function discardChapter() {
  chapterContextToken += 1;
  chapterSaving.value = false;
  editingChapterId.value = chapterBaseline.editingId;
  Object.assign(chapterForm, chapterBaseline.form);
  chapterDirty.value = false;
  chapterVisible.value = false;
}
function discardLesson() {
  lessonContextToken += 1;
  lessonSaving.value = false;
  lessonAssetDraftVisible.value = false;
  editingLessonId.value = lessonBaseline.editingId;
  Object.assign(lessonForm, lessonBaseline.form);
  lessonDirty.value = false;
  lessonVisible.value = false;
}
function discardVideo() {
  videoContextToken += 1;
  replacementLessonId.value = videoBaseline.lessonId;
  replacementAssetId.value = videoBaseline.assetId;
  videoDirty.value = false;
  videoVisible.value = false;
}
async function closeChapter() {
  if (!chapterDirty.value) {
    chapterContextToken += 1;
    chapterSaving.value = false;
    chapterVisible.value = false;
    return;
  }
  await chapterUnsaved.confirmDiscard();
}
async function beforeChapterClose(done: () => void) {
  if (!chapterDirty.value) {
    chapterContextToken += 1;
    chapterSaving.value = false;
    done();
    return;
  }
  if (await chapterUnsaved.confirmDiscard()) done();
}
async function closeLesson() {
  if (!lessonDirty.value) {
    lessonContextToken += 1;
    lessonSaving.value = false;
    lessonAssetDraftVisible.value = false;
    lessonVisible.value = false;
    return;
  }
  await lessonUnsaved.confirmDiscard();
}
async function beforeLessonClose(done: () => void) {
  if (!lessonDirty.value) {
    lessonContextToken += 1;
    lessonSaving.value = false;
    lessonAssetDraftVisible.value = false;
    done();
    return;
  }
  if (await lessonUnsaved.confirmDiscard()) done();
}
async function closeVideo() {
  if (!videoDirty.value) {
    videoContextToken += 1;
    videoVisible.value = false;
    return;
  }
  await videoUnsaved.confirmDiscard();
}
async function beforeVideoClose(done: () => void) {
  if (!videoDirty.value) {
    videoContextToken += 1;
    done();
    return;
  }
  if (await videoUnsaved.confirmDiscard()) done();
}

watch(form, () => { courseDirty.value = !sameDraft(copyCourseDraft(form), courseBaseline); }, { deep: true });
watch(chapterForm, () => {
  if (chapterVisible.value) chapterDirty.value = !sameDraft(snapshotChapterDraft(), chapterBaseline);
}, { deep: true });
watch(lessonForm, () => {
  if (lessonVisible.value) syncLessonDraftState();
}, { deep: true });
watch([replacementLessonId, replacementAssetId], () => {
  if (videoVisible.value) videoDirty.value = !sameDraft(snapshotVideoDraft(), videoBaseline);
});

function statusLabel(status: CourseStatus) { return ({ draft: '草稿', published: '已上架', offline: '已下架' })[status]; }
function statusType(status: CourseStatus) { return status === 'published' ? 'success' : status === 'offline' ? 'warning' : 'info'; }
function duration(ms: number) { const seconds = Math.round(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }

async function load(resetForm = true) {
  const data = await http.get(`/admin/courses/${courseId}`) as CourseDetail;
  course.value = data;
  if (resetForm) {
    Object.assign(form, {
      title: data.title, category_id: data.category_id, description: data.description || '', cover_asset_id: data.cover_asset_id,
      is_recommended: Boolean(data.is_recommended), sort_order: data.sort_order || 0,
    });
    captureCourseBaseline();
  }
  expanded.value = data.chapters.map((item) => item.id);
}
async function loadOptions() {
  if (auth.can('courses:write')) {
    const data = await http.get('/admin/courses/category-options', { params: { page: 1, page_size: 100 } }) as Page<CategoryOption>;
    categories.value = data.items;
  }
}
async function saveCourse() {
  if (!form.title.trim() || !form.category_id) { ElMessage.warning('请填写标题并选择培训类别'); return; }
  const operation = ++courseOperationSequence;
  courseLatestOperation = operation;
  const submitted = copyCourseDraft(form);
  saving.value = true;
  try {
    await http.put(`/admin/courses/${courseId}`, submitted);
    if (operation > courseLastAppliedOperation) {
      courseLastAppliedOperation = operation;
      courseBaseline = copyCourseDraft(submitted);
      courseDirty.value = !sameDraft(copyCourseDraft(form), courseBaseline);
    }
    ElMessage.success('课程资料已保存');
    await load(false);
  }
  finally {
    if (operation === courseLatestOperation) saving.value = false;
  }
}
function openChapter(chapter?: CourseChapterView) {
  chapterContextToken += 1;
  chapterSaving.value = false;
  editingChapterId.value = chapter?.id || null;
  Object.assign(chapterForm, {
    title: chapter?.title || '',
    sort_order: chapter?.sort_order ?? (course.value?.chapters.length || 0) + 1,
  });
  chapterBaseline = snapshotChapterDraft();
  chapterUnsaved.markClean();
  chapterVisible.value = true;
}
async function saveChapter() {
  if (chapterSaving.value) return;
  if (!chapterForm.title.trim()) { ElMessage.warning('请填写章节标题'); return; }
  const contextToken = chapterContextToken;
  const operation = ++chapterOperationSequence;
  chapterLatestOperation = operation;
  const submitted = snapshotChapterDraft();
  chapterSaving.value = true;
  try {
    let persistedId = submitted.editingId;
    if (persistedId !== null) await http.put(`/admin/courses/${courseId}/chapters/${persistedId}`, submitted.form);
    else {
      const created = await http.post(`/admin/courses/${courseId}/chapters`, submitted.form) as { id: Id };
      persistedId = created.id;
    }
    const persisted = { editingId: persistedId, form: { ...submitted.form } };
    const sameContext = contextToken === chapterContextToken;
    if (sameContext && operation > chapterLastAppliedOperation) {
      chapterLastAppliedOperation = operation;
      editingChapterId.value = persistedId;
      chapterBaseline = persisted;
      chapterDirty.value = !sameDraft(snapshotChapterDraft(), chapterBaseline);
    }
    if (sameContext && operation === chapterLatestOperation && sameDraft(snapshotChapterDraft(), persisted)) {
      chapterUnsaved.markClean();
      chapterSaving.value = false;
      chapterContextToken += 1;
      chapterVisible.value = false;
    }
    await load(false);
  } finally {
    if (contextToken === chapterContextToken && operation === chapterLatestOperation) chapterSaving.value = false;
  }
}
function openLesson(chapterId: Id, lesson?: CourseLessonView) {
  lessonContextToken += 1;
  lessonSaving.value = false;
  editingLessonId.value = lesson?.id || null;
  Object.assign(lessonForm, {
    chapter_id: chapterId,
    title: lesson?.title || '',
    required: lesson?.required ?? true,
    sort_order: lesson?.sort_order ?? 1,
    asset_id: null,
  });
  lessonBaseline = snapshotLessonDraft();
  lessonUnsaved.markClean();
  lessonAssetDraftVisible.value = editingLessonId.value === null;
  lessonVisible.value = true;
}
async function saveLesson() {
  if (lessonSaving.value) return;
  if (!lessonForm.title.trim()) { ElMessage.warning('请填写课时标题'); return; }
  const contextToken = lessonContextToken;
  const operation = ++lessonOperationSequence;
  lessonLatestOperation = operation;
  const submitted = snapshotLessonDraft();
  const payload = {
    title: submitted.form.title,
    required: submitted.form.required,
    sort_order: submitted.form.sort_order,
    lesson_type: 'video' as const,
  };
  lessonSaving.value = true;
  try {
    let persistedId = submitted.editingId;
    if (persistedId === null) {
      const created = await http.post(`/admin/courses/${courseId}/lessons`, {
        ...payload,
        chapter_id: submitted.form.chapter_id,
        asset_id: submitted.form.asset_id,
      }) as { id: Id };
      persistedId = created.id;
      const persisted = { editingId: persistedId, form: { ...submitted.form } };
      const sameContext = contextToken === lessonContextToken;
      if (sameContext && operation > lessonLastAppliedOperation) {
        lessonLastAppliedOperation = operation;
        editingLessonId.value = persistedId;
        lessonBaseline = persisted;
        syncLessonDraftState();
      }
      if (sameContext && operation === lessonLatestOperation && sameDraft(snapshotLessonDraft(), persisted)) {
        lessonUnsaved.markClean();
        lessonSaving.value = false;
        lessonAssetDraftVisible.value = false;
        lessonContextToken += 1;
        lessonVisible.value = false;
      }
      await load(false);
      return;
    }

    const metadataChanged = !sameDraft(lessonMetadata(submitted.form), lessonMetadata(lessonBaseline.form));
    const assetChanged = submitted.form.asset_id !== lessonBaseline.form.asset_id;
    if (metadataChanged) {
      const saved = await http.put(`/admin/courses/${courseId}/lessons/${persistedId}`, payload) as SavedLessonMetadata;
      syncSavedLessonMetadata(saved);
      if (contextToken !== lessonContextToken || operation !== lessonLatestOperation) return;
      lessonLastAppliedOperation = Math.max(lessonLastAppliedOperation, operation);
      lessonBaseline = {
        editingId: persistedId,
        form: {
          ...lessonBaseline.form,
          title: saved.title,
          required: saved.required,
          sort_order: saved.sort_order,
        },
      };
      syncLessonDraftState();
    }

    if (contextToken !== lessonContextToken || operation !== lessonLatestOperation) return;
    if (assetChanged) {
      if (!submitted.form.asset_id) {
        lessonAssetDraftVisible.value = true;
        ElMessage.warning('已创建课时的视频不能删除；请选择新视频生成替换版本');
        return;
      }
      try {
        const saved = await http.post(`/admin/courses/${courseId}/lessons/${persistedId}/versions`, {
          asset_id: submitted.form.asset_id,
        }) as LessonVersionView;
        syncSavedLessonVersion(persistedId, saved);
      } catch (error) {
        if (contextToken === lessonContextToken && operation === lessonLatestOperation) {
          syncLessonDraftState();
          ElMessage.error('视频版本保存失败；未提交的视频草稿已保留，请确认后重试');
        }
        throw error;
      }
      if (contextToken !== lessonContextToken || operation !== lessonLatestOperation) return;
      lessonLastAppliedOperation = Math.max(lessonLastAppliedOperation, operation);
      lessonBaseline = {
        editingId: persistedId,
        form: { ...lessonBaseline.form, asset_id: submitted.form.asset_id },
      };
      syncLessonDraftState();
    }

    if (sameDraft(snapshotLessonDraft(), lessonBaseline)) {
      lessonUnsaved.markClean();
      lessonSaving.value = false;
      lessonAssetDraftVisible.value = false;
      lessonContextToken += 1;
      lessonVisible.value = false;
    }
  } finally {
    if (contextToken === lessonContextToken && operation === lessonLatestOperation) lessonSaving.value = false;
  }
}
function openVideo(lesson: CourseLessonView) {
  videoContextToken += 1;
  replacementLessonId.value = lesson.id;
  replacementAssetId.value = null;
  videoBaseline = snapshotVideoDraft();
  videoUnsaved.markClean();
  videoVisible.value = true;
}
async function replaceVideo() {
  if (!replacementLessonId.value || !replacementAssetId.value) return;
  const contextToken = videoContextToken;
  const operation = ++videoOperationSequence;
  videoLatestOperation = operation;
  const submitted = snapshotVideoDraft();
  await http.post(`/admin/courses/${courseId}/lessons/${submitted.lessonId}/versions`, { asset_id: submitted.assetId });
  const sameContext = contextToken === videoContextToken;
  if (sameContext && operation > videoLastAppliedOperation) {
    videoLastAppliedOperation = operation;
    videoBaseline = { ...submitted };
    videoDirty.value = !sameDraft(snapshotVideoDraft(), videoBaseline);
  }
  if (sameContext && operation === videoLatestOperation && sameDraft(snapshotVideoDraft(), submitted)) {
    videoUnsaved.markClean();
    videoContextToken += 1;
    videoVisible.value = false;
  }
  ElMessage.success('视频新版本已保存');
  await load(false);
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
