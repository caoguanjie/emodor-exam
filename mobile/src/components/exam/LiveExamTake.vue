<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EmptyState from '@/components/common/EmptyState.vue'
import QuestionView from './QuestionView.vue'
import AnswerCard from './AnswerCard.vue'
import ExamTakeHeader from './ExamTakeHeader.vue'
import { useExamStore } from '@/stores/exam'
import { useSessionStore } from '@/stores/session'
import { saveExamEntryIntent } from '@/utils/exam-entry-intent'
import { protectExamNavigation } from '@/platform/navigation'
import { nativeNavigationStyle } from '@/platform/native-layout'
import { watchNativeExamExitPrompt } from '@/platform/native-exam-exit'
const props = defineProps<{ recordId: string }>(), store = useExamStore()
const card = ref(false), dialog = ref<'submit' | 'exit' | ''>(''), leaving = ref(false), pageVisible = ref(true)
const nativeStyle = nativeNavigationStyle()
const stopNativeExitPrompt = watchNativeExamExitPrompt(computed(() => pageVisible.value && !leaving.value && store.questions.length > 0 && store.phase === 'answering' && !store.locked))
const item = computed(() => store.items[store.currentIndex])
const savedLabel = computed(() => store.draftError || (store.savedAt ? `草稿已保存 ${new Date(store.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '本机草稿尚未保存'))
let interval: ReturnType<typeof setInterval> | null = null, unprotect = () => {}, disposed = false
function back() { if (leaving.value || store.phase === 'terminal' || !store.questions.length) return false; dialog.value = 'exit'; return true }
function show() { if (!disposed) pageVisible.value = true }
function hide() { pageVisible.value = false; void store.persistDraft() }
function dispose() { if (disposed) return; disposed = true; stopNativeExitPrompt(); hide(); if (interval) clearInterval(interval); unprotect() }
onBeforeUnmount(dispose)
onMounted(async () => {
  unprotect = protectExamNavigation(() => !leaving.value && store.questions.length > 0 && store.phase !== 'terminal', () => { dialog.value = 'exit' })
  interval = setInterval(() => { void store.tick() }, 500)
  await reload()
})
async function reload() { if (!props.recordId) return; try { await store.recover(props.recordId) } catch { /* Retry visible. */ } }
watch(() => item.value?.id, id => { if (id) void store.loadItemMedia(id) })
watch(() => store.phase, phase => {
  if (phase === 'terminal' && !leaving.value) { leaving.value = true; uni.redirectTo({ url: `/pages/exam/result?record_id=${encodeURIComponent(props.recordId)}` }) }
})
async function leave() { await store.persistDraft(); leaving.value = true; dialog.value = ''; unprotect(); uni.reLaunch({ url: '/pages/exam/index' }) }
function confirmSubmit() { dialog.value = ''; card.value = false; void store.submit() }
function submit() { if (!store.locked) { card.value = false; dialog.value = 'submit' } }
function identity() {
  const session = useSessionStore(), paperId = store.attempt?.paper_id
  saveExamEntryIntent(paperId ? { kind: 'exam-instructions', paperId } : { kind: 'exam-tab' }, session.user ? String(session.user.id) : undefined)
  uni.navigateTo({ url: '/pages/identity/index' })
}
async function query() { try { await store.queryStatus() } catch { /* Error remains visible. */ } }
defineExpose({ show, hide, dispose, back })
</script>
<template>
  <view class="take-page" :style="nativeStyle"><ExamTakeHeader :remaining-seconds="store.remaining" :answered="store.answered" :total="store.questions.length" :saved-label="savedLabel" :draft-error="!!store.draftError" :disabled="store.locked" @exit="dialog = 'exit'" @submit="submit" />
    <view class="take-body"><text v-if="store.phase === 'loading'">题目加载中…</text><EmptyState v-else-if="store.loadError || !item" :title="store.identityReason ? '实名认证' : '题目加载失败'" :description="store.loadError || '请联网从考试中心进入本次考试。'"><wd-button v-if="store.identityReason" @click="identity">{{ store.identityReason === 'IDENTITY_PENDING' ? '查看实名状态' : '去实名认证' }}</wd-button><wd-button v-else @click="reload">重新加载</wd-button></EmptyState><template v-else><text v-if="store.draftRestored" class="take-notice">已恢复本人本机草稿，考试截止时间不变</text><text v-if="store.draftError" class="take-notice danger" role="alert" @click="store.persistDraft">{{ store.draftError }} · 点击重试</text><QuestionView :item="item" :number="store.currentIndex + 1" :total="store.items.length" :selected="store.answers[item.id] || []" :disabled="store.locked" :assets="store.assets[item.id] || {}" @retry-image="store.loadItemMedia(item.id)" @select="store.choose(item.id, $event)" /><view v-if="store.mediaErrors[item.id]" class="take-notice danger"><text>题目图片加载失败</text><text role="button" @click="store.loadItemMedia(item.id)">重试图片</text></view></template></view>
    <view v-if="item" class="take-footer">
      <wd-button variant="plain" type="info" round :disabled="store.locked || store.currentIndex === 0" @click="store.jump(store.currentIndex - 1)"><view class="take-footer__button-content"><image class="take-footer__arrow" src="/static/icons/pen-gemini/exam-chevron-left.svg" mode="aspectFit" aria-hidden="true" /><text>上一题</text></view></wd-button>
      <view class="take-footer__card" role="button" aria-label="打开答题卡" @click="!store.locked && (card = true)"><image class="take-footer__card-icon" src="/static/icons/pen-gemini/exam-layout-grid.svg" mode="aspectFit" aria-hidden="true" /><text>答题卡</text><text>{{ store.answered }}/{{ store.questions.length }}</text></view>
      <wd-button round :disabled="store.locked || store.currentIndex === store.items.length - 1" @click="store.jump(store.currentIndex + 1)"><view class="take-footer__button-content"><text>下一题</text><image class="take-footer__arrow" src="/static/icons/pen-gemini/exam-chevron-right.svg" mode="aspectFit" aria-hidden="true" /></view></wd-button>
    </view>
    <AnswerCard v-if="item" v-model="card" :items="store.items" :answers="store.answers" :current-id="item.id" @select="store.jump(store.items.findIndex(row => row.id === $event))" @submit="submit" />
    <wd-popup :model-value="!!dialog" position="center" round :close-on-click-modal="false" custom-style="width: calc(100% - 48px); max-width: 366px"><view class="exam-dialog"><text class="exam-dialog__title">{{ dialog === 'exit' ? '确定退出答题？' : '确认交卷？' }}</text><text class="exam-dialog__message">{{ dialog === 'exit' ? '退出后倒计时不会暂停。本机草稿将保留，截止前可继续原次答题。' : '交卷后将无法修改答案，系统将自动评分。' }}</text><text v-if="dialog === 'submit'" class="exam-dialog__warning">还有 {{ store.questions.length - store.answered }} 题未作答</text><view class="exam-dialog__actions"><template v-if="dialog === 'exit'"><wd-button variant="soft" @click="leave">退出</wd-button><wd-button @click="dialog = ''">继续答题</wd-button></template><template v-else><wd-button variant="soft" @click="dialog = ''">继续答题</wd-button><wd-button :disabled="store.locked" @click="confirmSubmit">确定交卷</wd-button></template></view></view></wd-popup>
    <wd-popup :model-value="['submitting', 'uncertain', 'expired'].includes(store.phase) && !dialog" position="center" round :close-on-click-modal="false" custom-style="width: calc(100% - 48px); max-width: 366px"><view class="exam-dialog"><text class="exam-dialog__title">{{ store.phase === 'expired' ? '考试时间已到' : store.phase === 'uncertain' ? '结果确认中' : '正在提交答卷' }}</text><text class="exam-dialog__message">{{ store.phase === 'expired' ? '已锁定作答，正在查询服务端考试状态。未成功交卷按超时处理，不能再交卷。' : store.phase === 'uncertain' ? '暂未确认交卷结果。答案已冻结并保留，请继续查询；重试将使用完全相同的答案。' : '已锁定作答，请等待服务端确认。' }}</text><text v-if="store.submitError" class="exam-dialog__warning">{{ store.identityReason ? store.loadError : store.submitError }}</text><view v-if="store.phase !== 'submitting'" class="exam-dialog__actions"><wd-button variant="soft" @click="query">查询状态</wd-button><wd-button v-if="store.identityReason" @click="identity">{{ store.identityReason === 'IDENTITY_PENDING' ? '查看实名状态' : '去实名认证' }}</wd-button><wd-button v-else-if="store.phase === 'uncertain' && store.remaining > 0" @click="store.retrySubmission">重试交卷</wd-button><wd-button v-else @click="leave">返回考试中心</wd-button></view><wd-button v-else block loading disabled>提交中，请勿关闭页面</wd-button></view></wd-popup>
  </view>
</template>
<style scoped>
.take-page { min-height:100vh; padding-top:var(--app-safe-area-top); display:flex; flex-direction:column; background:var(--app-color-background); }.take-body { flex:1; padding:24px 16px 110px; }.take-notice { display:block; margin-bottom:16px; color:var(--app-color-text-muted); font-size:12px; }.danger { color:var(--app-color-danger); }.take-footer { position:fixed; z-index:3; bottom:0; left:0; right:0; display:flex; align-items:center; gap:10px; padding:10px 16px calc(12px + var(--app-safe-area-bottom)); background:var(--app-color-surface); border-top:1px solid var(--app-color-border); }.take-footer :deep(.wd-button) { width:96px; padding:0 10px; font-size:14px; --wot-button-height-medium:44px; }.take-footer__card { display:flex; align-items:center; justify-content:center; gap:6px; flex:1; min-width:0; height:44px; border-radius:22px; background:var(--app-color-background); font-size:14px; font-weight:600; }.take-footer__card > text:last-child { font:11px monospace; color:var(--app-color-text-muted); }.exam-dialog { padding:26px 22px; text-align:center; }.exam-dialog__title { display:block; font-size:20px; font-weight:600; margin-bottom:14px; }.exam-dialog__message { font-size:13px; color:var(--app-color-text-secondary); line-height:1.7; }.exam-dialog__warning { display:block; margin-top:16px; padding:10px; color:var(--app-color-danger); background:var(--app-color-danger-soft); border-radius:var(--app-radius-sm); font-size:12px; }.exam-dialog__actions { display:flex; gap:10px; margin-top:24px; }.exam-dialog__actions :deep(.wd-button) { flex:1; }
.take-footer__button-content { display: flex; align-items: center; justify-content: center; gap: 2px; }
.take-footer__arrow { flex: none; width: 18px; height: 18px; }
.take-footer__card-icon { flex: none; width: 16px; height: 16px; }
.take-footer__button-content, .take-footer__card { white-space: nowrap; }
@media (max-width: 360px) { .take-footer :deep(.wd-button) { width: 82px; padding: 0 8px; } }
</style>
