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
        <h3>{{ record.paper_title }}</h3>
        <div class="exam-outcome">
          <strong class="exam-score">{{ examRecordScoreLabel(record) }}</strong>
          <el-tag :type="examRecordResultType(record)">{{ examRecordResultLabel(record) }}</el-tag>
          <span>第 {{ record.attempt_no }} 次考试</span>
        </div>
        <div class="exam-times">
          <div><span>开考时间</span><b>{{ formatExamRecordTime(record.started_at) }}</b></div>
          <div><span>交卷时间</span><b>{{ formatExamRecordTime(record.submitted_at) }}</b></div>
          <div><span>考试用时</span><b>{{ examDuration }}</b></div>
        </div>
        <div class="exam-extra">
          <details><summary>更多考试信息</summary><p>截止时间：{{ formatExamRecordTime(record.deadline_at) }}</p><p>提交方式：{{ submissionLabel(record.submission_method) }}</p></details>
          <span>时间均为北京时间</span>
        </div>
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
              <el-tag size="small" type="info">{{ questionTypeLabels[item.type] }}</el-tag>
              <el-tag size="small" type="info">{{ record.grading_state !== 'finalized' || item.gained_score === null ? '—' : `${item.gained_score} / ${item.score} 分` }}</el-tag>
            </header>
            <QuestionPreview :question="previewQuestion(item)" variant="library" :reveal-answer="true" />
            <div class="answer-panel">
              <h4>学员作答</h4>
              <div v-if="selectedOptionLabels(item).length" class="selected-options">
                <el-tag v-for="selected in selectedOptionLabels(item)" :key="selected" type="primary">
                  {{ selected }}
                </el-tag>
              </div>
              <span v-else class="muted">未作答</span>
              <div class="score-meta">得分：{{ record.grading_state !== 'finalized' || item.gained_score === null ? '—' : `${item.gained_score} 分` }}</div>
            </div>
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
function selectedOptionLabels(item: FinalResultItem): string[] {
  if (isCanonicalItem(item)) return item.selected_option_ids.map((id) => {
    const index = item.options.findIndex((option) => option.id === id);
    return index >= 0 ? String.fromCharCode(65 + index) : '未知选项';
  });
  return (item.answer?.selected || []).map((selected) => String.fromCharCode(65 + selected));
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
.exam-overview { padding: 22px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.exam-overview h3 { margin: 0 0 16px; font-size: 17px; line-height: 1.6; overflow-wrap: anywhere; }
.exam-outcome { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; color: var(--el-text-color-secondary); }
.exam-score { font-size: 25px; color: var(--el-text-color-primary); }
.exam-times { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 22px; }
.exam-times > div { display: flex; flex-direction: column; gap: 8px; }
.exam-times span, .exam-extra { color: var(--el-text-color-secondary); font-size: 13px; }
.exam-times b { font-weight: 400; font-variant-numeric: tabular-nums; }
.exam-extra { display: flex; justify-content: space-between; gap: 16px; margin-top: 18px; }
.exam-extra summary { cursor: pointer; }
.exam-extra p { margin: 10px 0 0; }
@media (max-width: 640px) { .exam-times { grid-template-columns: 1fr; }.exam-times > div { flex-direction: row; flex-wrap: wrap; }.exam-extra { flex-wrap: wrap; } }

.readonly-note { margin-top: 18px; }
.result-section { margin-top: 20px; }
.result-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.result-head h3 { margin: 0; }
.result-head p { margin: 5px 0 0; color: var(--el-text-color-secondary); }
.result-metrics { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 16px; color: var(--el-text-color-secondary); }
.result-metrics b { margin-left: 4px; color: var(--el-text-color-primary); }
.question-card { margin-top: 14px; padding: 18px; border: 1px solid var(--el-border-color); border-radius: 8px; }
.question-card > header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.answer-panel { margin-top: 16px; padding: 14px; border-radius: 8px; background: var(--el-fill-color-light); }
.answer-panel h4 { margin: 0 0 10px; }
.selected-options { display: flex; flex-wrap: wrap; gap: 8px; }
.score-meta { margin-top: 12px; color: var(--el-text-color-secondary); font-size: 13px; }
.muted { color: var(--el-text-color-secondary); }
@media (max-width: 900px) { .result-head { display: block; }.result-metrics { justify-content: flex-start; margin-top: 10px; } }
</style>
