<template>
  <el-alert v-if="loadError" :title="loadError" type="error" :closable="false"><el-button link @click="retryLoad">重试</el-button></el-alert>
  <el-skeleton v-if="!course && !loadError" :rows="5" animated />
  <div v-if="course" class="course-editor">
    <div v-if="mode === 'chapters'" class="course-editor__heading">
      <span>{{ course.title }}</span>
      <el-tag :type="statusType(course.status)">{{ statusLabel(course.status) }}</el-tag>
    </div>

    <el-alert v-if="mode === 'chapters' && course.missing_required_lesson_ids?.length" type="warning" :closable="false" style="margin-bottom:16px"
      :title="`发布前仍有 ${course.missing_required_lesson_ids.length} 个必学课时缺少可用视频`" />
    <el-alert v-if="mode === 'chapters' && course.status === 'published'" type="info" :closable="false" style="margin-bottom:16px"
      title="已上架课程的章节和课时结构已锁定；替换视频会追加内容版本，不覆盖旧版本。" />

      <el-form v-if="mode === 'info'" label-width="96px">
        <el-form-item label="课程名称"><el-input v-model="form.title" maxlength="255" :disabled="!auth.can('courses:write')" /></el-form-item>
        <el-form-item label="课程封面"><MediaUpload v-model="form.cover_asset_id" purpose="course_cover" list-type="picture-card" :disabled="!canUploadMedia" /></el-form-item>
        <el-form-item label="培训类别">
          <el-select v-model="form.category_id" filterable style="width:100%" :disabled="!auth.can('courses:write')">
            <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="课程简介"><el-input v-model="form.description" type="textarea" :rows="3" maxlength="10000" :disabled="!auth.can('courses:write')" /></el-form-item>
        <el-form-item label="首页推荐">
          <el-radio-group v-model="form.is_recommended" :disabled="!auth.can('courses:write')"><el-radio :value="true">是</el-radio><el-radio :value="false">否</el-radio></el-radio-group>
        </el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort_order" :min="0" :disabled="!auth.can('courses:write')" /></el-form-item>
      </el-form>

    <div v-if="mode === 'chapters'" class="chapter-manager">
      <div class="chapter-manager__toolbar">
        <span class="muted">共 {{ course.chapters.length }} 章 · {{ lessonCount }} 个课时</span>
        <el-button v-if="structureEditable" type="primary" @click="openChapter()">新增章节</el-button>
      </div>
      <el-empty v-if="course.chapters.length === 0" description="暂无章节" />
      <section v-for="(chapter, index) in course.chapters" :key="chapter.id" class="chapter-section" :aria-label="chapter.title">
        <div class="chapter-section__header">
          <div class="chapter-section__identity">
            <span class="chapter-section__number">{{ String(index + 1).padStart(2, '0') }}</span>
            <div><h3>{{ chapter.title }}</h3><span class="muted">顺序 {{ chapter.sort_order }} · {{ chapter.lessons.length }} 个课时</span></div>
          </div>
          <FitsTableActions v-if="structureEditable">
            <FitsTableAction type="primary" @click="openChapter(chapter)">编辑章节</FitsTableAction>
            <FitsTableAction type="primary" @click="openLesson(chapter.id)">新增课时</FitsTableAction>
          </FitsTableActions>
        </div>
        <div class="chapter-section__lessons">
          <el-table :data="chapter.lessons" class="lesson-table" row-key="id">
            <el-table-column label="编号" width="74"><template #default="{ $index }">{{ index + 1 }}.{{ $index + 1 }}</template></el-table-column>
            <el-table-column label="课时名称" prop="title" min-width="180" />
            <el-table-column label="要求" width="76"><template #default="{ row }"><el-tag size="small" :type="row.required ? 'primary' : 'info'">{{ row.required ? '必学' : '选学' }}</el-tag></template></el-table-column>
            <el-table-column label="创建时间" width="158"><template #default="{ row }">{{ formatDateTime(row.created_at) }}</template></el-table-column>
            <el-table-column label="视频状态" width="96"><template #default="{ row }"><span :class="row.current_version ? 'lesson-table__ready' : 'lesson-table__missing'">{{ row.current_version ? '已上传' : '未上传' }}</span></template></el-table-column>
            <el-table-column label="时长" width="80"><template #default="{ row }">{{ row.current_version ? duration(row.current_version.duration_ms) : '—' }}</template></el-table-column>
            <el-table-column label="操作" width="146" fixed="right">
              <template #default="{ row }">
                <FitsTableActions>
                  <FitsTableAction v-if="structureEditable || canUploadMedia" type="primary" :disabled="deletingLessonIds.includes(row.id)" @click="openLesson(chapter.id, row)">修改</FitsTableAction>
                  <FitsTableAction v-if="structureEditable" type="danger" :loading="deletingLessonIds.includes(row.id)" :disabled="deletingLessonIds.includes(row.id)" @click="removeLesson(row)">删除</FitsTableAction>
                </FitsTableActions>
              </template>
            </el-table-column>
            <template #empty><el-empty description="暂无课时" :image-size="64" /></template>
          </el-table>
        </div>
      </section>
    </div>

    <el-dialog v-model="chapterVisible" :title="editingChapterId ? '编辑章节' : '新增章节'" width="480px" class="re-form-dialog" append-to-body :before-close="beforeChapterClose">
      <el-form label-width="82px">
        <el-form-item label="章节标题"><el-input v-model="chapterForm.title" maxlength="255" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="chapterForm.sort_order" :min="0" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="closeChapter">取消</el-button><el-button type="primary" :loading="chapterSaving" :disabled="chapterSaving" @click="saveChapter">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="lessonVisible" :title="editingLessonId ? '修改课时' : '新增视频课时'" width="620px" class="re-form-dialog" append-to-body destroy-on-close :before-close="beforeLessonClose">
      <el-form label-width="92px">
        <el-form-item label="课时标题"><el-input v-model="lessonForm.title" maxlength="255" :disabled="!structureEditable" /></el-form-item>
        <el-form-item label="必学"><el-switch v-model="lessonForm.required" :disabled="!structureEditable" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="lessonForm.sort_order" :min="0" :disabled="!structureEditable" /></el-form-item>
        <el-form-item v-if="editingLesson" label="当前视频">
          <div class="lesson-current-video">
            <span>{{ editingLesson.current_version ? `已上传 · ${duration(editingLesson.current_version.duration_ms)}` : '未上传' }}</span>
          </div>
        </el-form-item>
        <el-form-item v-if="lessonAssetDraftVisible" label="视频">
          <div style="width:100%">
            <MediaUpload v-model="lessonForm.asset_id" purpose="video" list-type="drag" :disabled="!canUploadMedia" @pending="lessonMediaPending = $event" />
            <div v-if="editingLessonId" class="muted" style="margin-top:8px">不选新文件则保留当前视频；选择后点击“保存”生成新版本，历史视频和学习记录保留。</div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="closeLesson">取消</el-button><el-button type="primary" :loading="lessonSaving" :disabled="lessonSaving || lessonMediaPending" @click="saveLesson">保存</el-button></template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../../api/http';
import type { CourseChapterView, CourseDetail, CourseLessonView, CourseStatus, Id, LessonVersionView, Page } from '../../api/training-types';
import MediaUpload from '../../components/MediaUpload.vue';
import { FitsTableActions, FitsTableAction } from '../../components/FitsTable';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { useAuthStore } from '../../stores/auth';
import { formatDateTime } from '../../utils/format';

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

const props = defineProps<{ courseId: Id; mode: 'info' | 'chapters' }>();
const emit = defineEmits<{ (event: 'saved'): void; (event: 'changed'): void }>();
const auth = useAuthStore();
const courseId = props.courseId;
const loadError = ref('');
const course = ref<CourseDetail | null>(null);
const categories = ref<CategoryOption[]>([]);
const ready = computed(() => course.value !== null && !loadError.value);
const lessonCount = computed(() => course.value?.chapters.reduce((count, chapter) => count + chapter.lessons.length, 0) ?? 0);
const saving = ref(false);
const pendingWrites = ref(0);
const deletingLessonIds = ref<Id[]>([]);
const chapterSaving = ref(false);
const lessonSaving = ref(false);
const lessonMediaPending = ref(false);
const chapterVisible = ref(false);
const lessonVisible = ref(false);
const lessonAssetDraftVisible = ref(false);
const courseDirty = ref(false);
const chapterDirty = ref(false);
const lessonDirty = ref(false);
const editingChapterId = ref<Id | null>(null);
const editingLessonId = ref<Id | null>(null);
const form = reactive<CourseDraft>({ title: '', category_id: '', description: '', cover_asset_id: null, is_recommended: false, sort_order: 0 });
const chapterForm = reactive<ChapterDraft>({ title: '', sort_order: 0 });
const lessonForm = reactive<LessonDraft>({ chapter_id: '', title: '', required: true, sort_order: 0, asset_id: null });
const structureEditable = computed(() => auth.can('courses:write') && course.value?.status !== 'published');
const canUploadMedia = computed(() => auth.can('courses:write') && auth.can('media:write'));
const editingLesson = computed(() => editingLessonId.value ? courseLesson(editingLessonId.value) : undefined);
let courseBaseline: CourseDraft = copyCourseDraft(form);
let chapterBaseline = { editingId: null as Id | null, form: { ...chapterForm } };
let lessonBaseline = { editingId: null as Id | null, form: { ...lessonForm } };
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
const courseUnsaved = useUnsavedChanges(courseDirty, { onDiscard: discardCourse });
const chapterUnsaved = useUnsavedChanges(chapterDirty, { onDiscard: discardChapter });
const lessonUnsaved = useUnsavedChanges(lessonDirty, { onDiscard: discardLesson });
useUnsavedChanges(computed(() => pendingWrites.value > 0), {
  canDiscard: () => false, onBlocked: () => ElMessage.warning('正在保存，请稍候再离开'),
});

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
  lessonDirty.value = lessonMediaPending.value || !sameDraft(snapshotLessonDraft(), lessonBaseline);
  lessonAssetDraftVisible.value = lessonVisible.value;
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
  emit('changed');
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
  lessonMediaPending.value = false;
  lessonAssetDraftVisible.value = false;
  editingLessonId.value = lessonBaseline.editingId;
  Object.assign(lessonForm, lessonBaseline.form);
  lessonDirty.value = false;
  lessonVisible.value = false;
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

watch(form, () => { courseDirty.value = !sameDraft(copyCourseDraft(form), courseBaseline); }, { deep: true });
watch(chapterForm, () => {
  if (chapterVisible.value) chapterDirty.value = !sameDraft(snapshotChapterDraft(), chapterBaseline);
}, { deep: true });
watch(lessonForm, () => {
  if (lessonVisible.value) syncLessonDraftState();
}, { deep: true });
watch(lessonMediaPending, () => { if (lessonVisible.value) syncLessonDraftState(); });

function statusLabel(status: CourseStatus) { return ({ draft: '草稿', published: '已上架', offline: '已下架' })[status]; }
function statusType(status: CourseStatus) { return status === 'published' ? 'success' : status === 'offline' ? 'warning' : 'info'; }
function duration(ms: number) { const seconds = Math.round(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }

async function load(resetForm = true) {
  loadError.value = '';
  try {
    const data = await http.get(`/admin/courses/${courseId}`) as CourseDetail;
    course.value = data;
    if (resetForm) {
      Object.assign(form, {
        title: data.title, category_id: data.category_id, description: data.description || '', cover_asset_id: data.cover_asset_id,
        is_recommended: Boolean(data.is_recommended), sort_order: data.sort_order || 0,
      });
      captureCourseBaseline();
    }
    if (!resetForm) emit('changed');
  } catch (error) {
    loadError.value = '课程加载失败，请重试';
    throw error;
  }
}
async function loadOptions() {
  if (auth.can('courses:write')) {
    const data = await http.get('/admin/courses/category-options', { params: { page: 1, page_size: 100 } }) as Page<CategoryOption>;
    categories.value = data.items;
  }
}
async function retryLoad() {
  try {
    await Promise.all([props.mode === 'info' ? loadOptions() : Promise.resolve(), load(!course.value)]);
  } catch {
    loadError.value = '课程加载失败，请重试';
  }
}
async function saveCourse() {
  if (!form.title.trim() || !form.category_id) { ElMessage.warning('请填写标题并选择培训类别'); return; }
  const operation = ++courseOperationSequence;
  courseLatestOperation = operation;
  const submitted = copyCourseDraft(form);
  saving.value = true;
  pendingWrites.value += 1;
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
    pendingWrites.value -= 1;
    if (operation === courseLatestOperation) saving.value = false;
  }
  if (!courseDirty.value) emit('saved');
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
  pendingWrites.value += 1;
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
    pendingWrites.value -= 1;
    if (contextToken === chapterContextToken && operation === chapterLatestOperation) chapterSaving.value = false;
  }
}
function openLesson(chapterId: Id, lesson?: CourseLessonView) {
  lessonContextToken += 1;
  lessonSaving.value = false;
  lessonMediaPending.value = false;
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
  lessonAssetDraftVisible.value = true;
  lessonVisible.value = true;
}
async function removeLesson(lesson: CourseLessonView) {
  if (!structureEditable.value || deletingLessonIds.value.includes(lesson.id)) return;
  deletingLessonIds.value = [...deletingLessonIds.value, lesson.id];
  pendingWrites.value += 1;
  let deleted = false;
  try {
    try {
      await ElMessageBox.confirm(`确认删除课时“${lesson.title}”？删除后不再展示在课程目录中，历史视频版本和学习记录保留。`, '删除课时', {
        type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
      });
    } catch { return; }
    await http.delete(`/admin/courses/${courseId}/lessons/${lesson.id}`);
    deleted = true;
    if (course.value) {
      for (const chapter of course.value.chapters) chapter.lessons = chapter.lessons.filter(item => item.id !== lesson.id);
      syncMissingRequiredLesson(lesson.id, false);
    }
    ElMessage.success('课时已删除');
    await load(false);
  } catch {
    if (deleted) {
      emit('changed');
      ElMessage.warning('课时已删除，目录刷新失败，请重试');
    } else {
      // A lost response does not prove the DELETE was rolled back. Re-read
      // authoritative catalog state before offering another destructive action.
      ElMessage.error('删除请求失败，正在重新核对目录');
      try { await load(false); }
      catch { ElMessage.warning('删除结果暂未确认，请通过“重试”重新查询目录'); }
    }
  } finally {
    pendingWrites.value -= 1;
    deletingLessonIds.value = deletingLessonIds.value.filter(id => id !== lesson.id);
  }
}
async function saveLesson() {
  if (lessonSaving.value) return;
  if (lessonMediaPending.value) { ElMessage.warning('请先完成或清除当前视频上传'); return; }
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
  pendingWrites.value += 1;
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
      if (sameContext && operation === lessonLatestOperation && !lessonMediaPending.value && sameDraft(snapshotLessonDraft(), persisted)) {
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
        emit('changed');
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

    if (!lessonMediaPending.value && sameDraft(snapshotLessonDraft(), lessonBaseline)) {
      lessonUnsaved.markClean();
      lessonSaving.value = false;
      lessonAssetDraftVisible.value = false;
      lessonContextToken += 1;
      lessonVisible.value = false;
    }
  } finally {
    pendingWrites.value -= 1;
    if (contextToken === lessonContextToken && operation === lessonLatestOperation) lessonSaving.value = false;
  }
}
async function confirmClose() {
  if (pendingWrites.value > 0) {
    ElMessage.warning('正在保存，请稍候再关闭');
    return false;
  }
  for (const [dirty, source] of [[courseDirty, courseUnsaved], [chapterDirty, chapterUnsaved], [lessonDirty, lessonUnsaved]] as const) {
    if (dirty.value && !await source.confirmDiscard()) return false;
  }
  return true;
}
defineExpose({ confirmClose, saveCourse, saving, ready });

onMounted(retryLoad);
</script>

<style scoped>
.course-editor { display: flex; flex-direction: column; gap: 16px; }
.course-editor__heading { display: flex; align-items: center; gap: 12px; font-weight: 600; }
.chapter-manager { display: flex; flex-direction: column; gap: 20px; }
.chapter-manager__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.chapter-section { border: 1px solid var(--re-border); border-radius: var(--re-radius-sm); overflow: hidden; }
.chapter-section__header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px; background: var(--el-fill-color-light); border-bottom: 1px solid var(--re-border); }
.chapter-section__identity { display: flex; align-items: center; gap: 12px; min-width: 0; }
.chapter-section__number { display: grid; place-items: center; flex: 0 0 36px; height: 36px; border-radius: 8px; background: var(--el-color-primary-light-9); color: var(--el-color-primary); font-weight: 600; }
.chapter-section h3 { margin: 0; color: var(--re-text); font-size: 14px; line-height: 22px; overflow-wrap: anywhere; }
.chapter-section__identity .muted { font-size: 12px; }
.chapter-section__lessons { padding: 0 16px 12px; }
.lesson-table__ready { color: var(--el-color-success); }
.lesson-table__missing { color: var(--el-color-warning); }
.lesson-current-video { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; }
.muted { color: var(--re-text-3); }
@media (max-width: 800px) {
  .chapter-section__header { align-items: flex-start; flex-wrap: wrap; }
}
</style>
