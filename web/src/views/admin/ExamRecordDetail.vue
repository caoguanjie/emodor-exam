<template>
  <section class="page-card">
    <div class="toolbar">
      <el-button @click="router.back()">返回</el-button><el-button :loading="loading" @click="load">刷新</el-button>
    </div>
    <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon :closable="false"><el-button link @click="load">重试</el-button></el-alert>
    <el-skeleton v-if="loading && !record" :rows="7" animated />
    <template v-else-if="record">
      <el-descriptions :column="3" border>
        <el-descriptions-item label="记录 ID">{{ record.record_id }}</el-descriptions-item>
        <el-descriptions-item label="试卷">{{ record.paper_title }}（{{ record.paper_id }}）</el-descriptions-item>
        <el-descriptions-item label="作答次数">第 {{ record.attempt_no }} 次</el-descriptions-item>
        <el-descriptions-item label="学员">{{ record.name }}（{{ record.username }}）</el-descriptions-item>
        <el-descriptions-item label="来源 / 难度">{{ sourceLabel(record.source) }} / {{ difficultyLabel(record.difficulty) }}</el-descriptions-item>
        <el-descriptions-item label="进度">{{ record.answered_count }} / {{ record.total_count }}</el-descriptions-item>
        <el-descriptions-item label="考试状态"><el-tag :type="statusType(record.status)">{{ statusLabel(record.status) }}</el-tag></el-descriptions-item>
        <el-descriptions-item label="结果状态">{{ gradingLabel(record.grading_state) }}</el-descriptions-item>
        <el-descriptions-item label="提交方式">{{ submissionLabel(record.submission_method) }}</el-descriptions-item>
        <el-descriptions-item label="成绩">{{ record.score === null ? '—' : `${record.score} 分` }}</el-descriptions-item>
        <el-descriptions-item label="开始时间">{{ formatTime(record.started_at) }}</el-descriptions-item>
        <el-descriptions-item label="截止时间">{{ formatTime(record.deadline_at) }}</el-descriptions-item>
        <el-descriptions-item label="提交时间">{{ formatTime(record.submitted_at) }}</el-descriptions-item>
      </el-descriptions>
      <el-alert v-if="record.status === 'in_progress'" class="readonly-note" type="info" :closable="false" show-icon
        title="考试仍在进行中，本页只展示安全元数据，不请求题目、答案或解析。" />
      <template v-else>
        <el-alert class="readonly-note" type="info" :closable="false" show-icon
          title="本页为只读结果，不提供强制交卷或改分。" />
        <section v-if="result" class="result-section">
          <div class="result-head">
            <div><h3>卷面结果</h3><p>题目、作答与判分均来自统一冻结结果。</p></div>
            <div class="result-metrics">
              <span>总分 <b>{{ result.score === null ? '待汇总' : `${result.score} 分` }}</b></span>
              <span>正确率 <b>{{ formatRate(result.correct_rate) }}</b></span>
              <span>结算时间 <b>{{ formatTime(result.graded_at) }}</b></span>
            </div>
          </div>
          <el-alert v-if="result.legacy && !result.items.length" type="warning" :closable="false" show-icon
            title="该历史记录没有冻结题单，暂无可安全还原的逐题结果。" />
          <article v-for="(item, index) in result.items" :key="item.item_id" class="question-card">
            <header>
              <strong>第 {{ index + 1 }} 题</strong>
              <el-tag size="small" type="info">{{ item.gained_score === null ? '—' : `${item.gained_score} / ${item.score} 分` }}</el-tag>
            </header>
            <QuestionPreview :question="previewQuestion(item)" :reveal-answer="true" />
            <div class="answer-panel">
              <h4>学员作答</h4>
              <div v-if="selectedOptionLabels(item).length" class="selected-options">
                <el-tag v-for="selected in selectedOptionLabels(item)" :key="selected" type="primary">
                  {{ selected }}
                </el-tag>
              </div>
              <span v-else class="muted">未作答</span>
              <div class="score-meta">得分：{{ item.gained_score === null ? '—' : `${item.gained_score} 分` }}</div>
            </div>
          </article>
        </section>
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import http from '../../api/http';
import type { ExamRecordDetail, FinalResult, FinalResultItem, FinalResultItemCanonical, SubmissionMethod } from '../../api/training-types';
import QuestionPreview from '../../components/QuestionPreview.vue';
import { createLatestRequestScope } from '../../utils/latest-request-scope';

const route = useRoute();
const router = useRouter();
const record = ref<ExamRecordDetail | null>(null);
const result = ref<FinalResult | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const requestScope = createLatestRequestScope();
const sourceLabels: Record<string, string> = { institution: '本机构', external: '外来' };
const difficultyLabels: Record<string, string> = { easy: '初级', medium: '中级', hard: '高级', mixed: '混合', unknown: '历史未知' };
const statusLabels: Record<string, string> = { in_progress: '进行中', submitted: '历史结果待确认', passed: '已通过', failed: '未通过', timeout: '超时未交卷' };
const gradingLabels: Record<string, string> = { not_submitted: '未交卷', finalized: '已出分' };

function sourceLabel(value: string | null) { return value ? sourceLabels[value] || value : '未知'; }
function difficultyLabel(value: string | null) { return value ? difficultyLabels[value] || value : '未知'; }
function statusLabel(value: string) { return statusLabels[value] || value; }
function gradingLabel(value: string) { return gradingLabels[value] || value; }
function submissionLabel(value: SubmissionMethod | null) { return value === 'manual' ? '主动交卷' : value === 'timeout' ? '超时交卷' : record.value?.status === 'timeout' ? '未交卷' : '历史未知'; }
function statusType(value: string) { return value === 'passed' ? 'success' : value === 'failed' || value === 'timeout' ? 'danger' : value === 'in_progress' ? 'primary' : 'warning'; }
function formatTime(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'; }
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
  loading.value = true;
  errorMessage.value = '';
  try {
    const data = await http.get(`/admin/exam-records/${encodeURIComponent(String(route.params.id))}`, { signal: ticket.signal }) as ExamRecordDetail;
    if (!ticket.isCurrent()) return;
    record.value = data;
    result.value = null;
    if (data.status === 'in_progress') return;
    const finalResult = await http.get(`/admin/exam-records/${encodeURIComponent(String(route.params.id))}/result`, {
      signal: ticket.signal,
      headers: { 'X-Question-Content-Version': '3' },
    }) as FinalResult;
    if (ticket.isCurrent()) result.value = finalResult;
  } catch (error) {
    if (ticket.isCurrent()) errorMessage.value = error instanceof Error ? error.message : '考试记录详情加载失败';
  } finally {
    if (ticket.isCurrent()) loading.value = false;
  }
}

onMounted(load);
onBeforeUnmount(requestScope.stop);
</script>

<style scoped>
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
