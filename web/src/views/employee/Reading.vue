<template>
  <div>
    <div class="learn-bar">
      <el-button text @click="leaveReading"><el-icon><ArrowLeft /></el-icon>返回列表</el-button>
      <div class="learn-title">{{ regInfo?.title }}</div>
      <div class="meters">
        <div class="meter">
          <div class="meter-head"><span>有效学习时长</span><span class="re-mono">{{ totalSec }}/{{ requiredSec }} 秒</span></div>
          <el-progress :percentage="timePercent" :show-text="false" :stroke-width="6" color="#3056d3" />
        </div>
        <div class="meter">
          <div class="meter-head"><span>滚动覆盖</span><span class="re-mono">{{ covered }}/{{ segments }} 段</span></div>
          <el-progress :percentage="coveredPercent" :show-text="false" :stroke-width="6" color="#2e9e6b" />
        </div>
      </div>
      <div class="learn-status">
        <el-tag v-if="isValid" type="success">已达有效学习标准，可参加考试</el-tag>
        <el-tag v-else-if="timeMet" type="info">学习时长已达标：离开本页完成登记后即可参加考试</el-tag>
        <el-tag v-else-if="paused" type="warning">已暂停（页面未聚焦）</el-tag>
      </div>
    </div>

    <div v-if="regInfo?.file_type === 'pdf'" ref="pdfHost" class="pdf-host"></div>
    <div v-else-if="regInfo?.file_type === 'docx'" ref="scrollHost" class="reading-container" v-html="contentHtml"></div>
    <el-empty v-else-if="loaded && !regInfo" description="内容不可见或暂无生效版本" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import { ElMessage } from 'element-plus';
import { ArrowLeft } from '@element-plus/icons-vue';
import http from '../../api/http';
import { useAuthStore } from '../../stores/auth';

/**
 * 在线阅读页（FR-REG-08 / FR-LRN-01~04，07 册 3.1 学习侧四道防线的前端采集层）：
 * - 进入即 start 会话；30 秒心跳携带「停留 ≥10 秒的段集合 + 最大滚动百分比」；
 * - 每 5 秒采样滚动位置，静止 ≥1 秒开始累计段位停留；确认 ≥10 秒进入待上报队列；
 * - visibilitychange/pagehide 以 fetch keepalive（sendBeacon 等价且可带鉴权头）调 pause flush；
 * - 恢复聚焦调 resume；服务端时钟差结算，客户端不参与时长计算。
 */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const regId = String(route.params.id);

const regInfo = ref<any>(null);
const contentHtml = ref('');
const loaded = ref(false);
const paused = ref(false);

const totalSec = ref(0);
const requiredSec = ref(0);
const covered = ref(0);
const segments = ref(10);
const isValid = ref(false);
const validAt = ref<string | null>(null);
/** 时长已达标但尚未落库收口（is_valid 仅由收口事务产生，07 册口径） */
const timeMet = computed(() => requiredSec.value > 0 && totalSec.value >= requiredSec.value);

const timePercent = computed(() => (requiredSec.value ? Math.min(100, Math.round((totalSec.value / requiredSec.value) * 100)) : 0));
const coveredPercent = computed(() => (segments.value ? Math.round((covered.value / segments.value) * 100) : 0));

let sessionId: string | null = null;
let heartbeatTimer: number | null = null;
let sampleTimer: number | null = null;
let currentSegment = 0;
let segmentDwellMs = 0;
let lastScrollTop = -1;
let lastSampleAt = 0;
const pendingSegments = new Set<number>();
let maxScrollPercent = 0;
let destroyed = false;

/** 滚动容器是 MainLayout 的 el-main（overflow:auto），阅读容器随内容增高并非滚动宿主（05 册 459 行硬前提） */
function getScroller(): HTMLElement | null {
  const host = (document.querySelector('.reading-container') as HTMLElement | null)
    || (document.querySelector('.pdf-host') as HTMLElement | null);
  return (host?.closest('.el-main') as HTMLElement | null) || document.scrollingElement as HTMLElement | null;
}

/** 视口底缘映射 0~100% → 段位（05 册 5.4.4 段位计算） */
function currentScrollInfo(): { percent: number; segment: number } {
  const scroller = getScroller();
  if (!scroller) return { percent: 0, segment: 0 };
  const scrollTop = scroller.scrollTop || window.scrollY || 0;
  const viewportBottom = scrollTop + scroller.clientHeight;
  const scrollHeight = Math.max(1, scroller.scrollHeight);
  const percent = Math.max(0, Math.min(100, Math.round((viewportBottom / scrollHeight) * 100)));
  const segment = Math.min(Math.floor((percent * segments.value) / 100), segments.value - 1);
  return { percent, segment };
}

/** 每 5 秒采样：滚动静止 ≥1 秒记段位停留计时（07 册 3.1.3） */
function sampleScroll() {
  const { percent, segment } = currentScrollInfo();
  if (percent > maxScrollPercent) maxScrollPercent = percent;
  const scroller = getScroller();
  const scrollTop = scroller?.scrollTop || 0;
  const now = Date.now();
  if (lastScrollTop !== -1 && Math.abs(scrollTop - lastScrollTop) > 2) {
    segmentDwellMs = 0; // 位置变化即重置停留计时
  } else if (now - lastSampleAt >= 4500) {
    // 静止（两次采样间隔位置未变）累计一个采样周期
    segmentDwellMs += now - (lastSampleAt || now);
  }
  lastScrollTop = scrollTop;
  lastSampleAt = now;
  if (segment !== currentSegment) {
    currentSegment = segment;
    segmentDwellMs = 0;
  }
  if (segmentDwellMs >= 10_000 && !pendingSegments.has(currentSegment)) {
    pendingSegments.add(currentSegment); // 停留 ≥10 秒确认，立即入待上报队列
  }
}

async function startSession() {
  try {
    const d: any = await http.post('/learning/sessions/start', { regulation_id: regId });
    sessionId = String(d.session_id);
    applyProgress(d.progress);
  } catch (e: any) {
    ElMessage.warning(e?.message || '无法开始学习会话');
  }
}

function applyProgress(p: any) {
  if (!p) return;
  totalSec.value = p.total_seconds;
  requiredSec.value = p.required_seconds;
  maxScrollPercent = Math.max(maxScrollPercent, p.max_scroll_percent || 0);
  if (p.scroll_coverage) {
    segments.value = p.scroll_coverage.total_segments;
    covered.value = p.scroll_coverage.covered_count;
  }
  isValid.value = !!p.is_valid;
  validAt.value = p.valid_at;
}

async function heartbeat() {
  if (!sessionId || paused.value || destroyed) return;
  try {
    const d: any = await http.post('/learning/heartbeat', {
      session_id: sessionId,
      dwell_segments: Array.from(pendingSegments),
      scroll_percent: maxScrollPercent,
    });
    pendingSegments.clear();
    totalSec.value = d.total_seconds;
    if (d.scroll_coverage) {
      covered.value = d.scroll_coverage.covered_count;
      segments.value = d.scroll_coverage.total_segments;
    }
    if (d.is_valid && !isValid.value) {
      isValid.value = true;
      validAt.value = d.valid_at;
      ElMessage.success('已达有效学习标准，获得考试资格！');
    }
  } catch (e: any) {
    // 40906 会话冲突（被新会话取代 / 已收口）→ 重新开始
    if (e?.code === 40906) {
      sessionId = null;
      await startSession();
    }
  }
}

async function pauseSettle() {
  if (!sessionId || paused.value) return;
  paused.value = true;
  stopTimers();
  // fetch keepalive：sendBeacon 等价的页面卸载期可靠投递，且可携带鉴权头（07 册 3.1.1）
  try {
    const res = await fetch('/api/v1/learning/heartbeat/pause', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
      body: JSON.stringify({ session_id: sessionId, dwell_segments: Array.from(pendingSegments), scroll_percent: maxScrollPercent }),
    });
    // fetch 对 4xx/5xx 不 reject：投递失败保留 pendingSegments，随恢复后的心跳重报，避免已确认段位被丢弃
    if (res.ok) pendingSegments.clear();
  } catch { /* 卸载期尽力投递，段位保留待心跳重报 */ }
}

async function resumeFocus() {
  if (!sessionId || !paused.value) return;
  paused.value = false;
  lastSampleAt = Date.now();
  try {
    await http.post('/learning/heartbeat/resume', { session_id: sessionId });
  } catch { /* 忽略 */ }
  startTimers();
}

function startTimers() {
  stopTimers();
  heartbeatTimer = window.setInterval(heartbeat, 30_000); // 30 秒节拍
  sampleTimer = window.setInterval(sampleScroll, 5_000); // 5 秒滚动采样
}

function stopTimers() {
  if (heartbeatTimer) window.clearInterval(heartbeatTimer);
  if (sampleTimer) window.clearInterval(sampleTimer);
  heartbeatTimer = null;
  sampleTimer = null;
}

function onVisibility() {
  if (document.visibilityState === 'hidden') void pauseSettle();
  else void resumeFocus();
}
function onPageHide() {
  void pauseSettle();
}
function onBlur() {
  if (document.visibilityState === 'visible') void pauseSettle(); // blur 兜底（未切后台也暂停）
}
function onFocus() {
  void resumeFocus();
}

/** 结束会话：最终段位随 end 请求一并收口（flush 单独发会撞 10 秒限流窗导致 end 被跳过、会话悬挂） */
async function endSession() {
  if (!sessionId) return;
  const sid = sessionId;
  sessionId = null;
  stopTimers();
  try {
    const d: any = await http.post(`/learning/sessions/${sid}/end`, {
      dwell_segments: Array.from(pendingSegments),
      scroll_percent: maxScrollPercent,
    });
    pendingSegments.clear();
    applyProgress(d.progress);
  } catch { /* 尽力收口：兜底扫描任务会按最后心跳+45 秒封顶离线收口 */ }
}

// ---- PDF 渲染（pdfjs-dist，07 册 3.9：canvas 渲染滚动可观测） ----
const pdfHost = ref<HTMLElement | null>(null);
async function renderPdf(url: string) {
  const pdfjsLib: any = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });
  const doc = await pdfjsLib.getDocument({ data: res.data }).promise;
  const host = pdfHost.value;
  if (!host) return;
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: Math.min(1.6, (host.clientWidth || 800) / 620) });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = '100%';
    canvas.style.marginBottom = '12px';
    canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,.15)';
    host.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas }).promise;
  }
}

/** 离开阅读页：先等收口请求落库再跳转，避免列表页抢在收口前读到旧进度 */
async function leaveReading() {
  await endSession();
  router.push('/my/regulations');
}

// 路由级守卫：侧边栏跳转 / 浏览器返回 / 登出等一切 SPA 内离开路径统一等待收口落库，
// 消除按钮级 await 的遗漏路径（页内按钮自身的 await 会因 sessionId 已置空而自动短路）。
onBeforeRouteLeave(async () => {
  await endSession();
});

onMounted(async () => {
  try {
    const d: any = await http.get(`/regulations/${regId}/content`);
    if (destroyed) return; // 卸载后不得再 start 会话/挂定时器/挂监听（onBeforeUnmount 已先行执行）
    regInfo.value = d;
    segments.value = d.scroll_segments || 10;
    requiredSec.value = (d.required_minutes || 10) * 60;
    if (d.file_type === 'docx') {
      contentHtml.value = d.content_html || '';
    }
    loaded.value = true;
    // 内容渲染后再启动会话与计时
    await startSession();
    if (destroyed) {
      // start 落在卸载之后：立即收口刚开的会话，不留幽灵活跃会话
      void endSession();
      return;
    }
    const prog: any = await http.get(`/learning/records/${regId}`);
    if (destroyed) return;
    applyProgress(prog);
    if (d.file_type === 'pdf') await renderPdf(d.file_download_url);
    if (destroyed) return;
    startTimers();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('beforeunload', onPageHide);
  } catch (e: any) {
    ElMessage.error(e?.message || '内容加载失败');
  }
});

onBeforeUnmount(() => {
  destroyed = true;
  endSession();
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', onPageHide);
  window.removeEventListener('blur', onBlur);
  window.removeEventListener('focus', onFocus);
  window.removeEventListener('beforeunload', onPageHide);
});
</script>

<style scoped>
.learn-bar {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; gap: 16px;
  background: rgba(255, 255, 255, 0.94); backdrop-filter: blur(8px);
  border: 1px solid var(--re-border); border-radius: var(--re-radius);
  box-shadow: var(--re-shadow-card);
  padding: 10px 16px; margin-bottom: 16px;
}
.learn-title { font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
.meters { display: flex; gap: 20px; flex: 1; min-width: 0; }
.meter { flex: 1; min-width: 140px; max-width: 300px; }
.meter-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--re-text-3); margin-bottom: 4px; }
.meter-head .re-mono { color: var(--re-text-2); }
.learn-status { display: flex; }
.pdf-host { max-width: 860px; margin: 0 auto; }
</style>
