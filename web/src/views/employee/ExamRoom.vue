<template>
  <div class="exam-wrap">
    <div class="exam-header">
      <div class="exam-title-group">
        <span class="exam-title">{{ paper?.title }}</span>
        <span class="exam-meta">第 {{ attemptNo }} 次作答 · 及格线 {{ paper?.pass_score }} 分</span>
      </div>
      <div class="exam-right">
        <el-tag type="warning" effect="light" size="default">切屏 {{ switchCount }} 次（＞3 次将警告，≥5 次计入风控复核）</el-tag>
        <div class="countdown" :class="{ danger: remaining <= 300 }">
          <span class="cd-label">剩余时间</span>
          <span class="cd-value re-mono">{{ countdownText }}</span>
        </div>
      </div>
    </div>

    <el-alert v-if="isMobile" type="warning" :closable="false" title="建议使用桌面端参加考试；切屏将计时照走并计数留痕" />

    <div v-for="(q, idx) in questions" :key="q.question_id" class="question-card">
      <div class="stem">
        <span class="q-no re-mono">{{ idx + 1 }}</span>
        <span class="q-text">{{ q.stem }}</span>
        <el-tag size="small" class="q-type">{{ q.type === 'single' ? '单选' : '多选' }}（{{ q.score }} 分）</el-tag>
      </div>
      <el-radio-group v-if="q.type === 'single'"
        :model-value="answers[q.question_id]?.[0]"
        @update:model-value="(v: number) => setSingle(q.question_id, v)">
        <el-radio v-for="(o, i) in q.options" :key="i" :value="i" class="option-row">{{ o.key }}. {{ o.text }}</el-radio>
      </el-radio-group>
      <el-checkbox-group v-else v-model="answers[q.question_id]" @change="scheduleSave">
        <el-checkbox v-for="(o, i) in q.options" :key="i" :value="i" class="option-row">{{ o.key }}. {{ o.text }}</el-checkbox>
      </el-checkbox-group>
    </div>

    <div class="submit-zone">
      <el-button type="primary" size="large" :loading="submitting" @click="onSubmit">交 卷</el-button>
      <p class="submit-note">交卷后由系统自动判分，成绩不可修改</p>
    </div>

    <el-dialog v-model="resultVisible" title="考试结果" width="640px" :close-on-click-modal="false">
      <div v-if="result" class="result-stage">
        <el-result :icon="result.status === 'passed' ? 'success' : 'error'"
          :title="result.status === 'passed' ? '恭喜，考试通过！' : '未通过'"
          :sub-title="`得分 ${result.score} / 及格线 ${result.pass_score} · 切屏 ${result.switch_count} 次 · 历次最高 ${result.best_score}`" />
        <div v-if="result.status === 'passed'" class="passed-seal re-display">通<br />过</div>
        <div style="text-align:center; padding-bottom:16px">
          <el-button @click="router.push('/my/scores')">查看成绩明细</el-button>
          <el-button type="primary" @click="router.push('/my/exams')">返回考试列表</el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../../api/http';
import { useAuthStore } from '../../stores/auth';

/**
 * 考试作答页（FR-EXM-01~06，07 册 3.2 考试侧防线前端层）：
 * - 服务端 deadline 权威计时（每 30 秒心跳校准，不信任本地时钟）；
 * - 作答暂存：题目变更防抖 1.2 秒随 heartbeat 覆盖写 + pagehide keepalive 补发，
 *   缩小「答完即崩/直接关页」在 30 秒节拍间隙内丢答案的窗口；倒计时归零自动交卷；
 * - visibilitychange/blur 触发切屏上报（前端 500ms 事件合并）。
 */
const route = useRoute();
const router = useRouter();
const paperId = String(route.params.paperId);

const paper = ref<any>(null);
const questions = ref<any[]>([]);
const attemptNo = ref(1);
const answers = reactive<Record<string, number[]>>({});
const switchCount = ref(0);
const remaining = ref(0);
const submitting = ref(false);
const resultVisible = ref(false);
const result = ref<any>(null);
const isMobile = /Android|iPhone|Mobile/i.test(navigator.userAgent);
const auth = useAuthStore();

let examRecordId: string | null = null;
let timer: number | null = null;
let beatTimer: number | null = null;
let zeroSince = 0;
let autoSubmitRetries = 0;

const countdownText = computed(() => {
  const m = Math.floor(remaining.value / 60);
  const s = remaining.value % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
});

function ensureArray(q: any) {
  if (!answers[q.question_id]) answers[q.question_id] = [];
}

/** 单选 radio 的 model 是标量：统一包装为 [下标] 存储，保证与多选/暂存/恢复/提交口径一致 */
function setSingle(qid: string, v: number | string | boolean | undefined) {
  answers[qid] = [Number(v)];
  scheduleSave();
}

function collectAnswers() {
  return questions.value
    .filter((q) => (answers[q.question_id]?.length || 0) > 0)
    .map((q) => ({ question_id: q.question_id, selected: answers[q.question_id] }));
}

/** 作答暂存 + 剩余时间校准（每 30 秒，服务端权威） */
async function beat() {
  if (!examRecordId) return;
  try {
    const d: any = await http.post(`/exams/records/${examRecordId}/heartbeat`, { answers: collectAnswers() });
    remaining.value = d.remaining_seconds;
  } catch (e: any) {
    if (e?.code === 40905 || e?.code === 42901) return; // 已结束/高频丢弃
  }
}

/** 作答变更防抖暂存：只在 30 秒节拍上报的话，节拍间隙内答完即崩/直接关页的答案不进 Redis 暂存，超时判分按未答计 0 分 */
let saveTimer: number | null = null;
function scheduleSave() {
  if (!examRecordId) return;
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { saveTimer = null; void beat(); }, 1200);
}

/** pagehide 兜底：keepalive 补发最新作答快照（页面卸载期 http 实例不可靠，与学习端 pauseSettle 同款尽力投递） */
function flushOnPageHide() {
  if (!examRecordId) return;
  const payload = collectAnswers();
  if (!payload.length) return;
  try {
    void fetch(`/api/v1/exams/records/${examRecordId}/heartbeat`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
      body: JSON.stringify({ answers: payload }),
    }).catch(() => { /* 尽力投递 */ });
  } catch { /* 尽力投递 */ }
}

// 500ms 事件合并（07 册 3.2.2）
let switchPending = 0;
let switchFlushTimer: number | null = null;
function queueSwitch() {
  switchPending++;
  if (switchFlushTimer === null) {
    switchFlushTimer = window.setTimeout(async () => {
      switchFlushTimer = null;
      const n = switchPending;
      switchPending = 0;
      if (!examRecordId || !n) return;
      try {
        const d: any = await http.post(`/exams/records/${examRecordId}/switch`);
        switchCount.value = d.switch_count;
        if (d.warning) ElMessageBox.alert('您已多次离开考试页面，切屏行为将被记录', '切屏警告', { type: 'warning' });
      } catch { /* ignore */ }
    }, 500);
  }
}

async function startOrRecover() {
  try {
    const d: any = await http.post(`/exams/papers/${paperId}/start`);
    examRecordId = String(d.exam_record_id);
    paper.value = d.paper;
    attemptNo.value = d.attempt_no;
    questions.value = d.questions;
    remaining.value = d.remaining_seconds;
    // 断网重进恢复已暂存作答（呈现位置，UC-06 A2）
    for (const [qid, sel] of Object.entries(d.saved_answers || {})) answers[qid] = sel as number[];
    questions.value.forEach(ensureArray);
  } catch (e: any) {
    if (e?.code === 40901) {
      // 未达标：展示差距并返回
      const gap = e?.data?.gap;
      ElMessageBox.alert(
        `未完成有效学习：${gap?.time_gap_seconds ? `剩余有效时长缺口 ${gap.time_gap_seconds} 秒；` : ''}${gap && !gap.bottom_segment_covered ? '底部段未覆盖' : ''}`,
        '暂无考试资格',
        { type: 'warning', callback: () => router.push('/my/exams') },
      );
    } else {
      router.push('/my/exams');
    }
  }
}

async function submit(final: 'manual' | 'auto') {
  if (submitting.value || !examRecordId) return;
  submitting.value = true;
  try {
    const d: any = await http.post(`/exams/records/${examRecordId}/submit`, { answers: collectAnswers() });
    result.value = d;
    resultVisible.value = true;
    autoSubmitRetries = 0;
    stopTimers();
  } catch (e: any) {
    // 自动交卷失败：有限重试 3 次（典型失败 40905 服务端超时任务已先行收口），
    // 避免倒计时归零后每秒无限重发 + 错误弹窗轰炸
    if (final === 'auto') {
      autoSubmitRetries++;
      if (autoSubmitRetries >= 3) {
        stopTimers();
        ElMessage.error(e?.message || '自动交卷失败，请返回考试列表查看结果');
      }
      return;
    }
    if (e?.code === 40905) {
      stopTimers();
      resultVisible.value = true;
    }
  } finally {
    submitting.value = false;
  }
}

function onTimeoutBeat() {
  remaining.value = Math.max(0, remaining.value - 1);
  // 本地秒表兜底：归零 5 秒后自动交卷（服务端校准每 30 秒进行；校准回正时重置计时）
  if (remaining.value <= 0) {
    if (!zeroSince) zeroSince = Date.now();
    else if (Date.now() - zeroSince > 5_000) void submit('auto');
  } else {
    zeroSince = 0;
  }
}

function stopTimers() {
  if (timer) window.clearInterval(timer);
  timer = null;
  if (beatTimer) window.clearInterval(beatTimer);
  beatTimer = null;
  if (saveTimer) { window.clearTimeout(saveTimer); saveTimer = null; }
  document.removeEventListener('visibilitychange', onVis);
  window.removeEventListener('blur', onBlurSwitch);
  window.removeEventListener('pagehide', flushOnPageHide);
}

function onVis() {
  if (document.visibilityState === 'hidden') queueSwitch();
}

/** blur 独立触发（07 册 3.2.2：visibilitychange 与 window blur 均触发切屏上报），不去查 visibilityState */
function onBlurSwitch() {
  queueSwitch();
}

onMounted(async () => {
  await startOrRecover();
  if (!examRecordId) return;
  timer = window.setInterval(onTimeoutBeat, 1000);
  beatTimer = window.setInterval(beat, 30_000);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('blur', onBlurSwitch);
  window.addEventListener('pagehide', flushOnPageHide);
  window.onbeforeunload = () => '考试进行中，确认离开？';
});

onBeforeUnmount(() => {
  stopTimers();
  window.onbeforeunload = null;
});

async function onSubmit() {
  const unanswered = questions.value.filter((q) => !(answers[q.question_id]?.length > 0)).length;
  const ok = await ElMessageBox.confirm(
    unanswered ? `还有 ${unanswered} 题未作答，未答题目不得分，确认交卷？` : '确认交卷？',
    '交卷确认',
    { type: 'warning' },
  ).then(() => true).catch(() => false);
  if (ok) await submit('manual');
}
</script>

<style scoped>
.exam-wrap { max-width: 880px; margin: 0 auto; }

.exam-header {
  position: sticky; top: 0; z-index: 10;
  background: rgba(255, 255, 255, 0.94); backdrop-filter: blur(8px);
  display: flex; gap: 16px; align-items: center; justify-content: space-between;
  padding: 12px 18px; border: 1px solid var(--re-border); border-radius: var(--re-radius);
  box-shadow: var(--re-shadow-card);
}
.exam-title-group { display: flex; flex-direction: column; min-width: 0; }
.exam-title { font-weight: 600; font-size: 15px; }
.exam-meta { font-size: 12px; color: var(--re-text-3); }
.exam-right { display: flex; align-items: center; gap: 14px; }
.countdown { display: flex; flex-direction: column; align-items: center; line-height: 1.2; }
.cd-label { font-size: 11px; color: var(--re-text-3); }
.cd-value { font-size: 24px; font-weight: 700; color: var(--re-primary); letter-spacing: 1px; }
.countdown.danger .cd-value { color: var(--re-danger); animation: cd-blink 1s step-end infinite; }
@keyframes cd-blink { 50% { opacity: 0.55; } }

.question-card {
  background: var(--re-surface); border: 1px solid var(--re-border); border-radius: var(--re-radius);
  padding: 20px 24px; margin-top: 14px; box-shadow: var(--re-shadow-card);
}
.stem { font-weight: 600; margin-bottom: 12px; display: flex; align-items: flex-start; gap: 10px; line-height: 1.6; }
.question-card :deep(.el-radio-group), .question-card :deep(.el-checkbox-group) {
  display: flex; flex-direction: column; align-items: stretch;
}
.q-no {
  flex: none; width: 26px; height: 26px; border-radius: 8px; font-size: 13px; font-weight: 700;
  background: var(--el-color-primary-light-9); color: var(--re-primary);
  display: inline-flex; align-items: center; justify-content: center; margin-top: 1px;
}
.q-text { flex: 1; }
.q-type { flex: none; margin-top: 2px; font-weight: 500; }

.option-row {
  display: flex; align-items: center; height: auto; padding: 10px 12px;
  border-radius: var(--re-radius-sm); margin: 4px 0; margin-right: 0 !important;
  transition: background 0.15s ease;
}
.option-row:hover { background: #f6f8fb; }
.option-row.is-checked { background: var(--el-color-primary-light-9); }
.option-row :deep(.el-radio__label), .option-row :deep(.el-checkbox__label) {
  font-size: 14px; color: var(--re-text); line-height: 1.6; white-space: normal;
}

.submit-zone { text-align: center; padding: 26px 0 8px; }
.submit-note { font-size: 12px; color: var(--re-text-3); margin: 10px 0 0; }

.result-stage { position: relative; }
.passed-seal {
  position: absolute; top: 6px; right: 36px; width: 96px; height: 96px;
  border: 3px solid var(--re-seal); border-radius: 50%; color: var(--re-seal);
  display: flex; align-items: center; justify-content: center; text-align: center;
  font-size: 28px; font-weight: 700; line-height: 1.25; letter-spacing: 2px;
  transform: rotate(-14deg); opacity: 0.88;
  box-shadow: inset 0 0 0 2px rgba(194, 64, 42, 0.25);
}
@media (prefers-reduced-motion: no-preference) {
  .passed-seal { animation: stamp-in 0.4s cubic-bezier(0.2, 1.4, 0.4, 1) both 0.25s; }
  @keyframes stamp-in {
    from { transform: rotate(-14deg) scale(1.8); opacity: 0; }
    to { transform: rotate(-14deg) scale(1); opacity: 0.88; }
  }
}
</style>
