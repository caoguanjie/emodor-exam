<template>
  <section class="page-card">
    <div class="page-head">
      <div><h2>考试记录详情</h2><p>在考仅展示服务端确认进度；交卷后可查看冻结题目、作答与判分，答题图片需阅卷权限。</p></div>
      <div><el-button @click="router.back()">返回</el-button><el-button :loading="loading" @click="load">刷新</el-button></div>
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
        <el-descriptions-item label="批改状态">{{ gradingLabel(record.grading_state) }}</el-descriptions-item>
        <el-descriptions-item label="提交方式">{{ submissionLabel(record.submission_method) }}</el-descriptions-item>
        <el-descriptions-item label="成绩">{{ record.score === null ? '—' : `${record.score} 分` }}</el-descriptions-item>
        <el-descriptions-item label="连接提示"><el-tag :type="connectionType(record.connection_state)">{{ connectionLabel(record.connection_state) }}</el-tag></el-descriptions-item>
        <el-descriptions-item label="切屏次数">{{ record.switch_count }}</el-descriptions-item>
        <el-descriptions-item label="开始时间">{{ formatTime(record.started_at) }}</el-descriptions-item>
        <el-descriptions-item label="截止时间">{{ formatTime(record.deadline_at) }}</el-descriptions-item>
        <el-descriptions-item label="剩余时间">{{ formatRemaining(record.remaining_seconds) }}</el-descriptions-item>
        <el-descriptions-item label="最后心跳">{{ formatTime(record.last_heartbeat_at) }}</el-descriptions-item>
        <el-descriptions-item label="提交时间">{{ formatTime(record.submitted_at) }}</el-descriptions-item>
        <el-descriptions-item label="设备摘要">{{ record.device_summary || '未上报' }}</el-descriptions-item>
      </el-descriptions>
      <el-alert v-if="record.status === 'in_progress'" class="readonly-note" type="info" :closable="false" show-icon
        title="考试仍在进行中，本页只展示安全元数据，不请求题目、答案或解析。" />
      <template v-else>
        <el-alert class="readonly-note" type="info" :closable="false" show-icon
          title="本页为只读结果，不提供强制交卷、改分或答题图片下载。" />
        <section v-if="result" class="result-section">
          <div class="result-head">
            <div><h3>卷面结果</h3><p>题目、作答与判分均来自统一冻结结果。</p></div>
            <div class="result-metrics">
              <span>总分 <b>{{ result.score === null ? '待汇总' : `${result.score} 分` }}</b></span>
              <span>正确率 <b>{{ formatRate(result.correct_rate) }}</b></span>
              <span>批改时间 <b>{{ formatTime(result.graded_at) }}</b></span>
            </div>
          </div>
          <el-alert v-if="result.legacy && !result.items.length" type="warning" :closable="false" show-icon
            title="该历史记录没有冻结题单，暂无可安全还原的逐题结果。" />
          <article v-for="(item, index) in result.items" :key="item.item_id" class="question-card">
            <header>
              <strong>第 {{ index + 1 }} 题</strong>
              <el-tag size="small" type="info">{{ item.gained_score === null ? '待批改' : `${item.gained_score} / ${item.score} 分` }}</el-tag>
            </header>
            <QuestionPreview :question="previewQuestion(item)" :reveal-answer="true" />
            <div class="answer-panel">
              <h4>学员作答</h4>
              <template v-if="item.type === 'image'">
                <el-alert v-if="item.answer?.asset_ids?.length" type="warning" :closable="false" show-icon
                  :title="`已提交 ${item.answer.asset_ids.length} 张答题图片；查看图片需要 exam_records:review 权限，请前往人工阅卷页。当前只读页不会发起图片下载。`" />
                <span v-else class="muted">未作答</span>
              </template>
              <template v-else>
                <div v-if="item.answer?.selected?.length" class="selected-options">
                  <el-tag v-for="selected in item.answer.selected" :key="selected" type="primary">
                    {{ answerOptionLabel(item, selected) }}
                  </el-tag>
                </div>
                <span v-else class="muted">未作答</span>
              </template>
              <div class="grading-meta">
                <span>得分：{{ item.gained_score === null ? '待批改' : `${item.gained_score} 分` }}</span>
                <span>评分版本：{{ item.grading_version }}</span>
              </div>
              <div v-if="item.comment" class="comment"><b>评语：</b>{{ item.comment }}</div>
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
import type { ExamRecordDetail, FinalResult, FinalResultItem, MonitorConnectionState, SubmissionMethod } from '../../api/training-types';
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
const statusLabels: Record<string, string> = { in_progress: '进行中', submitted: '已交卷', passed: '已通过', failed: '未通过', timeout: '超时交卷' };
const gradingLabels: Record<string, string> = { not_submitted: '未交卷', pending_manual: '待人工批改', finalized: '已完成批改' };

function sourceLabel(value: string | null) { return value ? sourceLabels[value] || value : '未知'; }
function difficultyLabel(value: string | null) { return value ? difficultyLabels[value] || value : '未知'; }
function statusLabel(value: string) { return statusLabels[value] || value; }
function gradingLabel(value: string) { return gradingLabels[value] || value; }
function submissionLabel(value: SubmissionMethod | null) { return value === 'manual' ? '主动交卷' : value === 'timeout' ? '超时交卷' : '历史未知'; }
function connectionLabel(value: MonitorConnectionState) { return value === 'connected' ? '连接正常' : value === 'uncertain' ? '连接待确认' : '考试已结束'; }
function connectionType(value: MonitorConnectionState) { return value === 'connected' ? 'success' : value === 'uncertain' ? 'warning' : 'info'; }
function statusType(value: string) { return value === 'passed' ? 'success' : value === 'failed' || value === 'timeout' ? 'danger' : value === 'in_progress' ? 'primary' : 'warning'; }
function formatTime(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'; }
function formatRemaining(seconds: number) { const value = Math.max(0, seconds); return `${Math.floor(value / 60)} 分 ${value % 60} 秒`; }
function formatRate(value: number | null) { return value === null ? '待汇总' : `${Math.round(value * 10000) / 100}%`; }
function previewQuestion(item: FinalResultItem) {
  return {
    type: item.type, stem: item.stem, options: item.options, score: item.score,
    answer: item.correct_answer || [], analysis: item.analysis, rubric: item.rubric,
  };
}
function answerOptionLabel(item: FinalResultItem, selected: number) {
  return item.options[selected]?.key || String.fromCharCode(65 + selected);
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
.selected-options, .grading-meta { display: flex; flex-wrap: wrap; gap: 8px; }
.grading-meta { margin-top: 12px; color: var(--el-text-color-secondary); font-size: 13px; }
.comment { margin-top: 10px; white-space: pre-wrap; }
.muted { color: var(--el-text-color-secondary); }
@media (max-width: 900px) { .result-head { display: block; }.result-metrics { justify-content: flex-start; margin-top: 10px; } }
</style>
