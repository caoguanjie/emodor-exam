<template>
  <el-dialog :model-value="true" title="考试记录详情" width="1000px" align-center
    :append-to="contentDialogTarget || 'body'" class="re-form-dialog exam-record-dialog" @close="returnToList">
    <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon :closable="false"><el-button link @click="load">重试</el-button></el-alert>
    <el-skeleton v-if="loading && !record" :rows="7" animated />
    <template v-else-if="record">
      <section class="learner-profile" aria-label="学员档案">
        <el-avatar :size="72" :src="imageUrl || undefined" class="profile-avatar" @error="retryImage"><el-icon :size="32"><UserFilled /></el-icon></el-avatar>
        <div class="profile-info">
          <h2>{{ record.name || '未填写姓名' }}</h2>
          <p>账号：{{ record.username }}</p>
          <span>培训类别：{{ record.category_name || '—' }}</span>
        </div>
      </section>
      <section class="exam-overview" aria-label="本次考试">
        <el-descriptions :column="2" border label-width="110px" class="exam-description">
          <el-descriptions-item label="试卷名称" :span="2">{{ record.paper_title }}</el-descriptions-item>
          <el-descriptions-item label="考试成绩">{{ examRecordScoreLabel(record) }}</el-descriptions-item>
          <el-descriptions-item label="考试状态"><el-tag :type="examRecordResultType(record)">{{ examRecordResultLabel(record) }}</el-tag></el-descriptions-item>
          <el-descriptions-item label="考试次数">第 {{ record.attempt_no }} 次</el-descriptions-item>
          <el-descriptions-item label="考试用时">{{ examDuration }}</el-descriptions-item>
          <el-descriptions-item label="开考时间">{{ formatExamRecordTime(record.started_at) }}</el-descriptions-item>
          <el-descriptions-item label="交卷时间">{{ formatExamRecordTime(record.submitted_at) }}</el-descriptions-item>
          <el-descriptions-item label="截止时间">{{ formatExamRecordTime(record.deadline_at) }}</el-descriptions-item>
          <el-descriptions-item label="提交方式">{{ submissionLabel(record.submission_method) }}</el-descriptions-item>
        </el-descriptions>
        <p class="time-note">时间均为北京时间</p>
      </section>
      <el-alert v-if="!canReadExamRecordResult(record)" class="readonly-note" type="info" :closable="false" show-icon :title="businessNote" />
      <template v-if="canReadExamRecordResult(record)">
        <section v-if="result" class="result-section">
          <div class="result-head">
            <div><h3>答卷详情</h3><p>本次考试的题目、作答与评分。</p></div>
            <div v-if="result.grading_state === 'finalized'" class="result-metrics">
              <span>正确率 <b>{{ formatRate(result.correct_rate) }}</b></span>
              <span>评分时间 <b>{{ formatExamRecordTime(result.graded_at) }}</b></span>
            </div>
          </div>
          <el-alert v-if="result.legacy && !result.items.length" type="warning" :closable="false" show-icon
            title="该历史记录未保存逐题答卷，暂时无法查看题目与作答。" />
          <article v-for="(item, index) in result.items" :key="item.item_id" class="question-card">
            <header>
              <strong>第 {{ index + 1 }} 题</strong>
              <el-tag size="small" type="info" effect="plain" class="question-type-tag">{{ questionTypeLabels[item.type] }}</el-tag>
              <el-tag size="small" :type="feedbackTagType(item)" effect="light" class="question-feedback-status">{{ itemFeedback(item).status }}</el-tag>
              <span class="question-points">{{ record.grading_state !== 'finalized' || item.gained_score === null ? '—' : `${item.gained_score} / ${item.score} 分` }}</span>
            </header>
            <QuestionPreview :question="previewQuestion(item)" variant="paper" :reveal-answer="true"
              show-answer-feedback :selected-option-ids="selectedIds(item)" />
          </article>
        </section>
      </template>
    </template>
    <template #footer>
      <el-button :loading="loading" @click="load">刷新</el-button>
      <el-button type="primary" @click="returnToList">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import http from '../../api/http';
import type { ExamRecordDetail, FinalResult, FinalResultItem, FinalResultItemCanonical, QuestionType, SubmissionMethod } from '../../api/training-types';
import { UserFilled } from '@element-plus/icons-vue';
import { usePcMediaUrl } from '../../composables/usePcMediaUrl';
import { answerFeedback } from '../../utils/answer-feedback';
import QuestionPreview from '../../components/QuestionPreview.vue';
import { createLatestRequestScope } from '../../utils/latest-request-scope';
import {
  canReadExamRecordResult, examRecordResultLabel, examRecordResultStatus, examRecordResultType,
  examRecordScoreLabel, formatExamRecordTime, safeExamRecordsReturnTo,
} from '../../utils/exam-records';

const props = defineProps<{ recordId?: string }>();
const emit = defineEmits<{ close: [] }>();
const contentDialogTarget = inject<Ref<HTMLElement | undefined>>('contentDialogTarget', ref());
const route = useRoute();
const router = useRouter();
const record = ref<ExamRecordDetail | null>(null);
const result = ref<FinalResult | null>(null);
const { imageUrl, retryImage } = usePcMediaUrl(computed(() => record.value?.avatar_id || null));
const examDuration = computed(() => {
  const item = record.value;
  if (!item || !canReadExamRecordResult(item) || !item.submitted_at) return '—';
  const seconds = Math.floor((Date.parse(item.submitted_at) - Date.parse(item.started_at)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
});
const loading = ref(false);
const errorMessage = ref('');
const requestScope = createLatestRequestScope();
const questionTypeLabels: Record<QuestionType, string> = { single: '单选题', multiple: '多选题', judgment: '判断题' };
const businessNote = computed(() => {
  if (!record.value) return '';
  switch (examRecordResultStatus(record.value)) {
    case 'in_progress': return '考试仍在进行中，学员交卷后可查看成绩与答卷。';
    case 'timeout': return '考试已结束，学员未在规定时间内交卷，暂无成绩和答卷。';
    default: return '可查看本次考试的成绩与逐题作答。';
  }
});

function returnToList() {
  requestScope.stop();
  if (props.recordId) emit('close');
  else void router.replace(safeExamRecordsReturnTo(route.query?.return_to));
}
function submissionLabel(value: SubmissionMethod | null) {
  if (value === 'manual') return '主动交卷';
  return record.value && ['timeout', 'in_progress'].includes(examRecordResultStatus(record.value)) ? '未交卷' : '—';
}
function formatRate(value: number | null) { return value === null ? '待汇总' : `${Math.round(value * 10000) / 100}%`; }
function isCanonicalItem(item: FinalResultItem): item is FinalResultItemCanonical { return typeof item.stem !== 'string'; }
function previewQuestion(item: FinalResultItem) {
  if (isCanonicalItem(item)) {
    if (item.content_schema_version === 3) return {
      type: item.type, score: item.score, content_schema_version: 3 as const,
      content_json: { stem: item.stem, options: item.options, analysis: item.analysis, answer_option_ids: item.correct_option_ids },
    };
    return {
      type: item.type, score: item.score, content_schema_version: 2 as const,
      content_json: { stem: item.stem, options: item.options, analysis: item.analysis, answer_option_ids: item.correct_option_ids },
    };
  }
  return {
    type: item.type, stem: item.stem, options: item.options, score: item.score,
    answer: item.correct_answer || [], analysis: item.analysis,
  };
}
function selectedIds(item: FinalResultItem): string[] {
  if (isCanonicalItem(item)) return item.selected_option_ids;
  return (item.answer?.selected || []).flatMap(index => item.options[index] ? [item.options[index].key] : []);
}
function itemFeedback(item: FinalResultItem) {
  const correct = isCanonicalItem(item) ? item.correct_option_ids
    : (item.correct_answer || []).flatMap(index => item.options[index] ? [item.options[index].key] : []);
  return answerFeedback(selectedIds(item), correct);
}
function feedbackTagType(item: FinalResultItem): 'success' | 'danger' | 'info' {
  const status = itemFeedback(item).status;
  return status === '答对' ? 'success' : status === '答错' || status === '漏选' ? 'danger' : 'info';
}
async function load() {
  const ticket = requestScope.begin();
  const recordId = encodeURIComponent(String(props.recordId || route.params.id));
  loading.value = true;
  errorMessage.value = '';
  record.value = null;
  result.value = null;
  try {
    const data = await http.get(`/admin/exam-records/${recordId}`, { signal: ticket.signal }) as ExamRecordDetail;
    if (!ticket.isCurrent()) return;
    record.value = data;
    if (!canReadExamRecordResult(data)) return;
    const finalResult = await http.get(`/admin/exam-records/${recordId}/result`, {
      signal: ticket.signal,
      headers: { 'X-Question-Content-Version': '3' },
    }) as FinalResult;
    if (ticket.isCurrent()) result.value = finalResult;
  } catch (error) {
    if (ticket.isCurrent()) errorMessage.value = error instanceof Error ? error.message : '考试记录详情加载失败';
  } finally {
    if (ticket.isCurrent()) loading.value = false;
    ticket.finish();
  }
}

watch(() => props.recordId || route.params.id, () => { void load(); }, { immediate: true });
onBeforeUnmount(requestScope.stop);
</script>

<style scoped>
.learner-profile { display: flex; align-items: center; gap: 20px; padding-bottom: 24px; border-bottom: 1px solid var(--el-border-color-lighter); }
.profile-avatar { flex: none; background: var(--el-fill-color-light); color: var(--el-text-color-placeholder); }
.profile-info { min-width: 0; overflow-wrap: anywhere; }
.profile-info h2 { margin: 0 0 8px; font-size: 22px; color: var(--el-text-color-primary); }
.profile-info p { margin: 0 0 6px; color: var(--el-text-color-regular); }
.profile-info > span { color: var(--el-text-color-secondary); font-size: 13px; }
.exam-overview { padding-top: 20px; }
.exam-description :deep(.el-descriptions__table) { table-layout: fixed; }
.exam-description :deep(.el-descriptions__content) { overflow-wrap: anywhere; }
.exam-description :deep(.el-descriptions__label) { white-space: nowrap; }
.time-note { margin: 10px 0 0; color: var(--el-text-color-secondary); font-size: 12px; text-align: right; }
.readonly-note { margin-top: 18px; }
.result-section { margin-top: 20px; }
.result-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.result-head h3 { margin: 0; }
.result-head p { margin: 5px 0 0; color: var(--el-text-color-secondary); }
.result-metrics { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 16px; color: var(--el-text-color-secondary); }
.result-metrics b { margin-left: 4px; color: var(--el-text-color-primary); }
.question-card { padding: 22px 0; border-top: 1px solid var(--el-border-color-lighter); }
.question-card > header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.question-points { margin-left: auto; color: var(--el-text-color-secondary); }
.question-type-tag { color: var(--el-text-color-regular); background: transparent; border: 1px solid var(--el-border-color); }
@media (max-width: 900px) { .result-head { display: block; }.result-metrics { justify-content: flex-start; margin-top: 10px; } }
</style>
