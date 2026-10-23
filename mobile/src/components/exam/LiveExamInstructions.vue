<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppPage from '@/components/common/AppPage.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useExamStore } from '@/stores/exam'
const props = defineProps<{ paperId: string }>(), store = useExamStore(), starting = ref(false)
const paper = computed(() => store.list.items.find(row => row.paper_id === props.paperId))
onMounted(() => { if (!paper.value && props.paperId) void store.loadList().catch(() => {}) })
const rules = ['倒计时以服务端截止时间为准，刷新或切后台不会暂停。', '答案保存为本人本机草稿，短时断网可继续答题；刷新页面需要联网重新获取题目。', '退出前会再次确认，截止前可从考试中心继续原考试。', '时间到只锁定作答。未成功主动交卷按超时处理，不再接受提交。', '请主动点击交卷，交卷后不可修改答案。']
async function start() {
  if (starting.value || !props.paperId) return
  starting.value = true
  try {
    await store.start(props.paperId)
    const attempt = store.attempt
    if (attempt) uni.redirectTo({ url: `/pages/exam/${attempt.status === 'in_progress' ? 'take' : 'result'}?record_id=${encodeURIComponent(attempt.record_id)}` })
  } catch { /* Structured identity/error is rendered below. */ }
  finally { starting.value = false }
}
function identity() { uni.navigateTo({ url: '/pages/identity/index' }) }
</script>
<template>
  <AppPage title="考试须知" back-target="/pages/exam/index"><view class="paper-intro"><text class="paper-intro__eyebrow">PAPER · {{ paperId }}</text><text class="paper-intro__title">{{ paper?.title || '考试须知' }}</text><text class="paper-intro__description">开始后以本次冻结题目和服务端截止时间为准；已有未完成考试时将继续原次作答。</text></view>
    <view class="paper-section"><text class="paper-section__title">考试规则</text><view v-for="(rule, index) in rules" :key="rule" class="paper-rule"><text>{{ String(index + 1).padStart(2, '0') }}</text><text>{{ rule }}</text></view></view>
    <EmptyState v-if="!paperId || store.loadError" :title="store.identityReason ? '实名认证' : '暂时无法开始考试'" :description="store.loadError || '未找到考试，请从考试中心重新进入。'"><wd-button v-if="store.identityReason" @click="identity">{{ store.identityReason === 'IDENTITY_PENDING' ? '查看实名状态' : '去实名认证' }}</wd-button></EmptyState>
    <view class="paper-footer"><wd-button block :disabled="!paperId" :loading="starting" @click="start">开始答题</wd-button><text>开始后计时不可暂停</text></view>
  </AppPage>
</template>
<style scoped>
.paper-intro { padding:10px 0 20px; }.paper-intro__eyebrow { color:var(--app-color-primary); font:12px monospace; letter-spacing:2px; }.paper-intro__title { display:block; margin:14px 0 12px; font-size:25px; font-weight:700; }.paper-intro__description { color:var(--app-color-text-secondary); font-size:13px; line-height:1.7; }.paper-section { background:var(--app-color-surface); border-radius:var(--app-radius-md); padding:18px 16px; margin-bottom:16px; }.paper-section__title { display:block; font-weight:600; }.paper-rule { display:flex; gap:12px; margin-top:14px; font-size:12px; line-height:1.7; }.paper-rule > text:first-child { color:var(--app-color-primary); font-family:monospace; }.paper-rule > text:last-child { flex:1; }.paper-footer { padding:8px 0 22px; text-align:center; }.paper-footer > text { display:block; margin-top:10px; color:var(--app-color-text-muted); font-size:11px; }
</style>
