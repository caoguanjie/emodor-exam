<template>
  <section class="page-card">
    <div class="page-head">
      <div><h2>考试记录详情</h2><p>只读元数据与服务端确认进度；不展示标准答案、解析或答题图片。</p></div>
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
      <el-alert class="readonly-note" type="info" :closable="false" show-icon title="本页不提供强制交卷、改分或答题图片入口。" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import http from '../../api/http';
import type { ExamRecordDetail, MonitorConnectionState, SubmissionMethod } from '../../api/training-types';
import { createLatestRequestScope } from '../../utils/latest-request-scope';

const route = useRoute();
const router = useRouter();
const record = ref<ExamRecordDetail | null>(null);
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
async function load() {
  const ticket = requestScope.begin();
  loading.value = true;
  errorMessage.value = '';
  try {
    const data = await http.get(`/admin/exam-records/${encodeURIComponent(String(route.params.id))}`, { signal: ticket.signal }) as ExamRecordDetail;
    if (ticket.isCurrent()) record.value = data;
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
</style>
