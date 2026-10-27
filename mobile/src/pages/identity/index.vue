<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import AppTopBar from '@/components/common/AppTopBar.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import ConfirmSheet from '@/components/common/ConfirmSheet.vue'
import IdentityCapture from '@/components/identity/IdentityCapture.vue'
import IdentityStatus from '@/components/identity/IdentityStatus.vue'
import { identityScenarios, identityVerifiedInfo, resolveIdentityScenario } from '@/fixtures/ui-scenarios/identity'
import type { IdentityScenario } from '@/fixtures/ui-scenarios/identity'
import { canSubmitIdentity } from '@/types/identity'
import { isStaticSessionPreview } from '@/platform/session'
import type { IdentityMaterialKind, IdentityMaterials } from '@/types/identity'
import { useIdentityStore } from '@/stores/identity'
import type { MediaSource } from '@/platform/media-picker'
import { useSessionStore } from '@/stores/session'
import { useLearnerStore } from '@/stores/learner'
import { identityNeedsProfile } from '@/utils/learner-onboarding'

const preview = ref(false)
const store = useIdentityStore()
const session = useSessionStore()
const learner = useLearnerStore()
const profileReady = ref(false)
let active = true, pageRevision = 0
let reloadPending: Promise<void> | null = null
const fixtureScenario = ref<IdentityScenario>(identityScenarios['identity-collect'])
const fixtureMaterials = ref<IdentityMaterials>({ ...fixtureScenario.value.materials })
const scenario = computed<IdentityScenario>(() => preview.value ? fixtureScenario.value : {
  ...identityScenarios['identity-collect'],
  state: store.verified ? 'verified' : store.pending ? 'pending' : store.submitting ? 'submitting' : 'collecting',
  issue: store.loadError ? 'load' : store.currentSession?.reason_code === 'FACE_MISMATCH' || store.currentSession?.reason_code === 'FACE_QUALITY_FAILED' ? 'face' : undefined,
  title: store.pending ? '身份核验处理中' : '完成本人实名认证',
  description: store.pending ? '可稍后查询结果，或返回继续浏览。' : '请上传本人有效身份证与现场正脸照片',
  feedback: store.error || (store.currentSession?.status === 'rejected' ? rejectionMessage() : store.loading ? '正在读取实名状态…' : store.pending ? '尚未获得最终结果，请稍后查询。' : '照片仅用于本人身份核验，请确保清晰。'),
  feedbackTone: store.error || store.currentSession?.status === 'rejected' ? 'danger' : 'secondary',
})
function rejectionMessage() {
  const reason = store.currentSession?.reason_code
  if (reason === 'IDENTITY_ALREADY_BOUND') return '该身份已绑定其他账号，请使用原账号登录或联系机构。'
  if (reason === 'FACE_MISMATCH' || reason === 'FACE_QUALITY_FAILED') return '正脸核验未通过，请本人重新现场拍照。'
  if (reason === 'ID_CARD_EXPIRED') return '证件已过期，请重新上传有效身份证两面。'
  if (reason === 'ID_CARD_DOCUMENT_INVALID') return '证件核验未通过，请重新上传身份证两面。'
  if (reason === 'ID_CARD_PORTRAIT_PARSE_FAILED') return '身份证人像面识别失败，请重新上传。'
  if (reason === 'ID_CARD_EMBLEM_PARSE_FAILED') return '身份证国徽面识别失败，请重新上传。'
  return '本次核验未完成，请核对材料后重试。'
}
const materials = computed<IdentityMaterials>(() => preview.value ? fixtureMaterials.value : { portrait: store.materials.portrait?.state || null, emblem: store.materials.emblem?.state || null, face: store.materials.face?.state || null, consent: store.consent })
const consent = computed({ get: () => materials.value.consent, set: value => { if (preview.value) fixtureMaterials.value.consent = value; else store.consent = value } })
const previews = computed(() => preview.value ? {} : { portrait: store.materials.portrait?.preview, emblem: store.materials.emblem?.preview, face: store.materials.face?.preview })
const verifiedInfo = computed(() => preview.value ? identityVerifiedInfo : { name: store.authority?.real_name || '', maskedId: store.authority?.id_number_masked || '' })
const overlay = ref<IdentityScenario['overlay']>()
const selectedKind = ref<IdentityMaterialKind>('portrait')
const agreementVisible = ref(false)
const localFeedback = ref('')
const pending = computed(() => scenario.value.state === 'pending')
const busy = computed(() => preview.value ? scenario.value.state === 'submitting' : store.busy || !profileReady.value)
const submitEnabled = computed(() => preview.value ? canSubmitIdentity(materials.value) && !pending.value && !busy.value : profileReady.value && store.canSubmit)
const feedback = computed(() => localFeedback.value || scenario.value.feedback)
const feedbackTone = computed(() => localFeedback.value ? 'secondary' : scenario.value.feedbackTone)
const sourceTitle = computed(() => selectedKind.value === 'emblem' ? '上传身份证国徽面' : '上传身份证人像面')

function applyScenario(next: IdentityScenario) {
  fixtureScenario.value = next
  fixtureMaterials.value = { ...next.materials }
  overlay.value = next.overlay
  localFeedback.value = ''
}
onLoad(query => { preview.value = isStaticSessionPreview(query); if (preview.value) applyScenario(resolveIdentityScenario(query?.scenario)); else void reload() })
onShow(() => { active = true; if (!preview.value && (!profileReady.value || !store.authority) && !store.loading) void reload() })
function reload(): Promise<void> {
  if (reloadPending) return reloadPending
  const epoch = session.sessionEpoch, current = pageRevision
  profileReady.value = false
  const pending = (async () => {
    await store.load()
    if (!active || current !== pageRevision || epoch !== session.sessionEpoch || store.loadError || !store.authority) return
    if (!store.pending && !store.verified) {
      try {
        const profile = await learner.loadProfile()
        if (!active || current !== pageRevision || epoch !== session.sessionEpoch) return
        if (identityNeedsProfile(store.authority.status, profile)) { uni.redirectTo({ url: '/pages/profile/info?onboarding=1' }); return }
      } catch (cause) { if (active && current === pageRevision && epoch === session.sessionEpoch) store.loadError = cause instanceof Error ? cause.message : '资料读取失败，请重试'; return }
    }
    profileReady.value = true
    if (store.pending) void store.poll()
  })().finally(() => { if (reloadPending === pending) reloadPending = null })
  reloadPending = pending
  return pending
}
watch(() => store.pending, (pending, previous) => {
  if (preview.value || !previous || pending || store.authority?.status === 'verified') return
  profileReady.value = false
  overlay.value = undefined
  const epoch = session.sessionEpoch, current = pageRevision
  // A terminal result may arrive while the initial reload is settling.
  // Recheck after that read instead of reusing its pending-state readiness.
  void Promise.resolve(reloadPending).then(() => {
    if (active && epoch === session.sessionEpoch && current === pageRevision && !store.pending && store.authority?.status !== 'verified') return reload()
  })
}, { flush: 'sync' })
function discardTemporaryMaterials() {
  fixtureMaterials.value = { portrait: null, emblem: null, face: null, consent: false }
  if (!preview.value) store.leave()
  overlay.value = undefined
}
onHide(() => { active = false; pageRevision++; if (!store.picking) { profileReady.value = false; reloadPending = null } if (preview.value) discardTemporaryMaterials(); else { overlay.value = undefined; store.hide() } })
onUnload(() => {
  active = false; pageRevision++; profileReady.value = false; reloadPending = null
  discardTemporaryMaterials()
})
function selectMaterial(kind: IdentityMaterialKind) {
  if (pending.value || busy.value) return
  selectedKind.value = kind
  overlay.value = kind === 'face' ? 'face-guide' : 'source'
}
function completeFixtureSelection() {
  fixtureMaterials.value = { ...materials.value, [selectedKind.value]: 'ready' }
  fixtureScenario.value = { ...scenario.value, state: 'collecting', issue: undefined }
  overlay.value = undefined
  localFeedback.value = canSubmitIdentity({ ...materials.value, consent: true })
    ? '三张照片已就绪，请确认后提交。' : '请确认照片为本人证件及本人正脸。'
}
function selectSource(source: MediaSource) { if (preview.value) completeFixtureSelection(); else { overlay.value = undefined; void store.upload(selectedKind.value, source) } }
function submit() {
  if (!submitEnabled.value) return
  if (preview.value) applyScenario({ ...identityScenarios['identity-verifying'], materials: { ...materials.value } })
  else void store.createSession()
}
function profile() { uni.reLaunch({ url: `/pages/profile/index${preview.value ? '?scenario=profile-default' : ''}` }) }
function details() { uni.navigateTo({ url: `/pages/identity/detail${preview.value ? '?scenario=identity-detail' : ''}` }) }
function retry() { if (preview.value) applyScenario(identityScenarios['identity-collect']); else void reload() }
function queryStatus() { if (preview.value) localFeedback.value = '尚未获得最终结果，不代表认证失败。'; else void store.poll() }
function dismissError() { overlay.value = undefined }
</script>

<template>
  <AppPage :padded="false">
    <template #header><AppTopBar title="实名认证" :back-target="`/pages/profile/index${preview ? '?scenario=profile-default' : ''}`" :history-first="false" /></template>
    <IdentityStatus v-if="scenario.state === 'verified'" mode="success" :info="verifiedInfo" @details="details" @profile="profile" />
    <IdentityStatus v-else-if="scenario.issue === 'load'" mode="load-error" :info="verifiedInfo" @retry="retry" @profile="profile" />
    <view v-else class="identity-content">
      <view class="identity-intro"><AppIcon name="shield-check" :size="30" color="#1989fa" /><view class="identity-intro__copy"><text class="identity-intro__title">{{ scenario.title }}</text><text class="identity-intro__description">{{ scenario.description }}</text></view></view>
      <IdentityCapture :materials="materials" :previews="previews" :assets="preview ? {} : store.materials" :owner-id="preview ? '' : String(session.user?.id || '')" :pending="pending || busy" :issue="scenario.issue" @select="selectMaterial" />
      <view class="identity-feedback" :class="`identity-feedback--${feedbackTone}`"><AppIcon :name="feedbackTone === 'danger' ? 'circle-x' : canSubmitIdentity(materials) ? 'circle-check' : 'info'" :size="14" :color="feedbackTone === 'danger' ? '#ee0a24' : feedbackTone === 'primary' ? '#1989fa' : canSubmitIdentity(materials) ? '#07c160' : '#969799'" /><text>{{ feedback }}</text></view>
    </view>
    <template v-if="scenario.state !== 'verified' && scenario.issue !== 'load'" #footer>
      <view class="identity-footer">
        <view class="identity-agreement"><wd-checkbox v-model="consent" type="square" :disabled="pending || busy"><text>我已阅读并同意</text></wd-checkbox><text class="identity-agreement__link" role="button" aria-label="实名认证协议" @click="agreementVisible = true">《实名认证协议》</text></view>
        <wd-button v-if="pending" button-id="identity-query-status" block :disabled="!preview && store.polling" @click="queryStatus">{{ !preview && store.polling ? '查询中…' : '查询认证结果' }}</wd-button>
        <wd-button v-else button-id="identity-submit" block :disabled="!submitEnabled" @click="submit">{{ busy ? '核验中…' : scenario.issue === 'expired' ? '重新提交认证' : '提交认证' }}</wd-button>
        <text v-if="pending" class="identity-footer__back" role="button" @click="profile">返回个人中心</text>
      </view>
    </template>
    <wd-popup :model-value="overlay === 'source'" position="bottom" round safe-area-inset-bottom modal-style="background-color:#00000066" @close="overlay = undefined">
      <view class="identity-source"><text class="identity-source__title">{{ sourceTitle }}</text><text class="identity-source__description">拍摄或选择清晰的身份证原件照片</text><view class="identity-source__option" role="button" aria-label="拍照" @click="selectSource('camera')"><AppIcon name="camera" :size="21" color="#1989fa" /><text>拍照</text></view><view class="identity-source__option" role="button" aria-label="从相册选择" @click="selectSource('album')"><AppIcon name="image" :size="21" color="#1989fa" /><text>从相册选择</text></view><wd-button block type="info" variant="plain" @click="overlay = undefined">取消</wd-button></view>
    </wd-popup>
    <wd-popup :model-value="overlay === 'face-guide' || overlay === 'verifying' || overlay === 'service-error' || overlay === 'bound'" position="center" round :close-on-click-modal="false" modal-style="background-color:#00000066" custom-style="width:calc(100% - 56px);max-width:480px;border-radius:var(--app-radius-lg)">
      <view v-if="overlay === 'face-guide'" class="identity-dialog"><view class="identity-dialog__illustration"><AppIcon name="scan-face" :size="42" color="#1989fa" /></view><text class="identity-dialog__title identity-dialog__title--face">拍摄本人正脸</text><text class="identity-dialog__copy">{{ '接下来将打开系统拍摄界面。\n请保持正脸清晰，面部无遮挡。\n如无法拍摄，请检查相机访问权限。' }}</text><wd-button button-id="identity-live-face" block @click="selectedKind = 'face'; selectSource('camera')">现场拍照</wd-button><wd-button block type="info" variant="plain" @click="overlay = undefined">暂不拍摄</wd-button></view>
      <view v-else-if="overlay === 'verifying'" class="identity-dialog identity-dialog--verifying"><wd-loading :size="38" /><text class="identity-dialog__title">正在核验身份</text><text class="identity-dialog__copy">{{ '正在比对证件信息与本人照片\n请稍候，不要重复提交' }}</text></view>
      <view v-else-if="overlay === 'service-error'" class="identity-dialog"><AppIcon name="cloud-off" :size="36" color="#1989fa" /><text class="identity-dialog__title">核验服务暂不可用</text><text class="identity-dialog__copy">{{ '当前未能完成核验，请稍后重试。\n这不代表你的身份核验未通过。' }}</text><wd-button block @click="dismissError">返回重试</wd-button><wd-button block type="info" variant="plain" @click="profile">稍后再试</wd-button></view>
      <view v-else-if="overlay === 'bound'" class="identity-dialog"><AppIcon name="user-lock" :size="36" color="#ff976a" /><text class="identity-dialog__title identity-dialog__title--bound">该身份已绑定其他账号</text><text class="identity-dialog__copy">{{ '已绑定账号：138****1234\n请确认是否使用了本人证件。\n若为本人原账号，请使用原账号登录。' }}</text><wd-button block @click="dismissError">我知道了</wd-button></view>
    </wd-popup>
    <ConfirmSheet v-model="agreementVisible" title="实名认证协议" message="请确认照片为本人有效证件及本人现场正脸。姓名和证件号将通过身份核验识别。" confirm-text="已阅读" cancel-text="" />
  </AppPage>
</template>

<style scoped>
.identity-content { display: flex; flex-direction: column; gap: 16px; padding: 20px 16px 18px; }
.identity-intro { display: flex; align-items: center; gap: 12px; padding: 14px; border-radius: var(--app-radius-md); background: var(--app-color-primary-soft); }
.identity-intro__copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.identity-intro__title { font-size: 17px; font-weight: 600; }
.identity-intro__description { font-size: 12px; color: var(--app-color-text-secondary); white-space: pre-line; }
.identity-feedback { display: flex; align-items: flex-start; gap: 7px; font-size: 12px; }
.identity-feedback text { flex: 1; min-width: 0; }
.identity-feedback :deep(.app-icon) { margin-top: 2px; }
.identity-feedback--muted { color: var(--app-color-text-muted); }
.identity-feedback--secondary { color: var(--app-color-text-secondary); }
.identity-feedback--primary { color: var(--app-color-primary); }
.identity-feedback--danger { color: var(--app-color-danger); }
.identity-footer { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px calc(20px + var(--app-safe-area-bottom)); border-top: 1px solid var(--app-color-border); background: var(--app-color-surface); --wot-button-height-medium: 50px; --wot-button-radius-main: var(--app-radius-md); --wot-button-disabled: .45; }
.identity-agreement { min-height: 36px; display: flex; align-items: center; gap: 2px; flex-wrap: wrap; --wot-checkbox-icon-size: 20px; --wot-checkbox-label-margin: 0 0 0 10px; --wot-checkbox-label-font-size: 12px; --wot-checkbox-label-color: var(--app-color-text-secondary); }
.identity-agreement__link { color: var(--app-color-primary); font-size: 12px; }
.identity-footer__back { text-align: center; color: var(--app-color-text-secondary); font-size: 14px; }
.identity-source { padding: 22px 20px 24px; display: flex; flex-direction: column; gap: 14px; --wot-button-height-medium: 50px; --wot-button-radius-main: var(--app-radius-md); --wot-button-info-plain-bg: var(--app-color-surface); --wot-button-info-plain-border: var(--app-color-border-strong); }
.identity-source__title { font-size: 18px; font-weight: 600; }
.identity-source__description { font-size: 13px; color: var(--app-color-text-secondary); }
.identity-source__option { min-height: 54px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--app-color-border); font-size: 15px; }
.identity-dialog { padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; --wot-button-height-medium: 50px; --wot-button-radius-main: var(--app-radius-md); --wot-button-spacing-block: 0; --wot-button-info-plain-bg: var(--app-color-surface); --wot-button-info-plain-border: var(--app-color-border-strong); }
.identity-dialog :deep(.wd-button) { width: 100%; }
.identity-dialog__illustration { display: flex; align-items: center; justify-content: center; width: 80px; height: 80px; border-radius: var(--app-radius-full); background: var(--app-color-primary-soft); }
.identity-dialog__title { font-size: 19px; font-weight: 600; text-align: center; }
.identity-dialog__title--face { font-size: 20px; }
.identity-dialog__title--bound { font-size: 18px; }
.identity-dialog__copy { align-self: stretch; white-space: pre-line; font-size: 13px; text-align: center; color: var(--app-color-text-secondary); }
.identity-dialog--verifying { padding: 28px 24px; }
</style>
