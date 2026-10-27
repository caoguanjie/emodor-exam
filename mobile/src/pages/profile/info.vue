<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { isProfileFieldReadonly, shellProfile, useShellScenario } from '@/fixtures/ui-scenarios/shell'
import TrainingCategoryField from '@/components/profile/TrainingCategoryField.vue'
import { isStaticSessionPreview } from '@/platform/session'
import { useSessionStore } from '@/stores/session'
import { useLearnerStore } from '@/stores/learner'
import { useIdentityStore } from '@/stores/identity'
import { needsLearnerProfile } from '@/utils/learner-onboarding'
import type { LearnerProfile } from '@/api/auth'
import ProtectedImage from '@/components/common/ProtectedImage.vue'
import { pickAvatar, releasePickedMedia, type PickedMedia } from '@/platform/media-picker'
import { uploadAvatar } from '@/api/media'
const { scenario, loadScenario } = useShellScenario('profile-info')
const preview = ref(false)
const learner = useLearnerStore()
const session = useSessionStore()
const identity = useIdentityStore()
const onboarding = ref(false)
let active = true
const form = reactive({ name: '', phone: '', gender: '', birthday: '' })
const loaded = ref(false)
const error = ref('')
const avatarFile = ref<PickedMedia | null>(null), avatarDraft = ref(''), avatarBusy = ref(false)
const avatarPicking = ref(false)
let pageRevision = 0
function clearAvatar() { pageRevision++; if (avatarFile.value) releasePickedMedia(avatarFile.value); avatarFile.value = null; avatarDraft.value = ''; avatarBusy.value = false; avatarPicking.value = false }
onHide(() => { active = false; if (!avatarPicking.value) { pageRevision++; avatarBusy.value = false } })
onUnload(clearAvatar)
watch(() => session.sessionEpoch, () => { clearAvatar(); loaded.value = false; lastProfile = null; Object.assign(form, { name: '', phone: '', gender: '', birthday: '' }) }, { flush: 'sync' })
onLoad(query => {
  preview.value = isStaticSessionPreview(query); onboarding.value = query?.onboarding === '1'; loadScenario(query)
  if (preview.value) { Object.assign(form, shellProfile); loaded.value = true }
})
onShow(() => { active = true; if (!preview.value && !avatarPicking.value) void loadProfile() })
const picker = ref('')
const birthday = ref(new Date(2000, 0, 1).getTime())
const minBirthday = new Date(1900, 0, 1).getTime()
const maxBirthday = computed(() => preview.value ? new Date(2026, 9, 22).getTime() : new Date().setHours(0, 0, 0, 0))
const saved = ref(false)
const editLocked = computed(() => !preview.value && (!loaded.value || learner.profileLoading || learner.profileSaving || learner.categorySaving || avatarBusy.value || identity.loading || !identity.authority || !!identity.loadError))
const nameReadonly = computed(() => preview.value || editLocked.value || identity.verified)
const needsIdentity = computed(() => !preview.value && !identity.verified)
async function changeAvatar() {
  if (preview.value || editLocked.value) return
  const current = pageRevision, epoch = session.sessionEpoch
  avatarBusy.value = true; avatarPicking.value = true; error.value = ''; saved.value = false
  let file: PickedMedia | null = null
  try {
    file = await pickAvatar()
    if (current === pageRevision && epoch === session.sessionEpoch) avatarPicking.value = false
    if (!file) return
    if (current !== pageRevision || epoch !== session.sessionEpoch) { releasePickedMedia(file); return }
    const result = await uploadAvatar(file)
    if (current !== pageRevision || epoch !== session.sessionEpoch) { releasePickedMedia(file); return }
    if (result.status !== 'ready') { releasePickedMedia(file); throw new Error('头像尚未处理完成，请重试') }
    if (avatarFile.value) releasePickedMedia(avatarFile.value)
    avatarFile.value = file; avatarDraft.value = result.asset_id
  } catch (cause) { if (file && file !== avatarFile.value) releasePickedMedia(file); if (current === pageRevision && epoch === session.sessionEpoch) error.value = cause instanceof Error ? cause.message : '头像上传失败，请重试' }
  finally { if (current === pageRevision && epoch === session.sessionEpoch) { avatarBusy.value = false; avatarPicking.value = false } }
}
watch(() => scenario.value.id, () => { picker.value = scenario.value.picker === 'job' ? '' : scenario.value.picker || '' }, { immediate: true })
const choiceVisible = computed({ get: () => picker.value === 'gender', set: (value) => { if (!value) picker.value = '' } })
const birthdayVisible = computed({ get: () => picker.value === 'birthday', set: (value) => { if (!value) picker.value = '' } })
const choices = ['男', '女']
function openPicker(kind: string) { if (!editLocked.value) picker.value = kind }
function choose(value: string) { if (editLocked.value) return; form.gender = value; picker.value = ''; saved.value = false }
function canConfirmBirthday() { return !editLocked.value }
function chooseBirthday(event: { value: string | number | Array<string | number> }) {
  if (editLocked.value) return
  const date = new Date(Number(event.value))
  if (Number.isNaN(date.getTime())) return
  form.birthday = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  picker.value = ''; saved.value = false
}
let lastProfile: LearnerProfile | null = null
function genderLabel(profile: LearnerProfile) { return profile.gender === 'male' ? '男' : profile.gender === 'female' ? '女' : '' }
function applyProfile(profile: LearnerProfile, force = false) {
  const keepName = !force && !identity.verified && lastProfile && form.name !== lastProfile.real_name
  const keepGender = !force && lastProfile && form.gender !== genderLabel(lastProfile)
  const keepBirthday = !force && lastProfile && form.birthday !== (lastProfile.birthday || '')
  Object.assign(form, { ...(!keepName ? { name: identity.verified ? identity.authority?.real_name || profile.real_name : profile.real_name } : {}), phone: profile.phone || '', ...(!keepGender ? { gender: genderLabel(profile) } : {}), ...(!keepBirthday ? { birthday: profile.birthday || '' } : {}) })
  if (form.birthday) birthday.value = new Date(`${form.birthday}T00:00:00`).getTime()
  lastProfile = profile
}
watch(() => learner.profile, profile => { if (profile && loaded.value && active) applyProfile(profile) })
async function loadProfile() {
  const epoch = session.sessionEpoch, current = pageRevision
  error.value = ''
  if (!session.initialized && !await session.bootstrap()) return
  if (!session.accessToken) return
  try {
    const [profile] = await Promise.all([learner.loadProfile(), identity.load()])
    if (epoch !== session.sessionEpoch || current !== pageRevision || !active) return
    if (identity.loadError || !identity.authority) throw new Error(identity.loadError || '实名状态读取失败，请重试')
    applyProfile(profile); loaded.value = true
    if (!profile.category_id) await learner.loadTrainingCategories()
  } catch (cause) { if (epoch === session.sessionEpoch && current === pageRevision && active) error.value = cause instanceof Error ? cause.message : '资料加载失败，请重试' }
}
async function save() {
  if (preview.value) { saved.value = true; return }
  if (editLocked.value) return
  const epoch = session.sessionEpoch, current = pageRevision
  picker.value = ''; saved.value = false; error.value = ''
  const name = form.name.trim()
  if (!name || name.length > 64) { error.value = !name ? '请输入真实姓名' : '真实姓名最多64个字'; return }
  if (!learner.profile?.category_id || learner.categoryReadRequired) { error.value = '请选择并确认培训工种'; return }
  try {
    const profile = await learner.updateProfile({ ...(!identity.verified ? { real_name: name } : {}), gender: form.gender === '男' ? 'male' : form.gender === '女' ? 'female' : null, birthday: form.birthday || null, ...(avatarDraft.value ? { avatar_id: avatarDraft.value } : {}) })
    if (epoch !== session.sessionEpoch || current !== pageRevision || !active) return
    applyProfile(profile, true); clearAvatar(); saved.value = true
    if (!needsLearnerProfile(profile) && !identity.verified) uni.redirectTo({ url: '/pages/identity/index' })
  } catch (cause) { if (epoch === session.sessionEpoch && current === pageRevision && active) error.value = cause instanceof Error ? cause.message : '资料保存失败，请重试' }
}
</script>
<template>
  <AppPage :title="onboarding ? '完善个人资料' : '个人资料'" :back-target="`/pages/profile/index${preview ? '?scenario=profile-default' : ''}`"><text class="profile-info__intro">{{ identity.verified ? '姓名已通过实名认证，手机号为当前登录手机号。' : '请填写真实姓名并确认培训工种，头像选填；保存后进行实名认证。' }}</text>
    <view v-if="!preview && learner.profileLoading" class="profile-info__notice">资料加载中…</view><view v-if="error" class="profile-info__notice profile-info__notice--error"><text>{{ error }}</text><wd-button size="small" :disabled="learner.profileLoading || learner.profileSaving || learner.categorySaving" @click="loadProfile">重新加载</wd-button></view>
    <view class="profile-info__avatar" role="button" aria-label="更换头像" :aria-disabled="editLocked" @click="changeAvatar"><text>头像（选填）</text><view class="profile-info__avatar-icon"><wd-loading v-if="avatarBusy" /><wd-img v-else-if="avatarFile" :src="avatarFile.tempFilePath" :width="48" :height="48" mode="aspectFill" round /><ProtectedImage v-else-if="!preview && learner.profile?.avatar_id" :asset-id="learner.profile.avatar_id" owner-type="user_avatar" :owner-id="learner.profile.id" :width="48" :height="48"><AppIcon name="user-round" :size="30" color="#1989fa" /></ProtectedImage><AppIcon v-else name="user-round" :size="30" color="#1989fa" /></view><AppIcon name="chevron-right" :size="16" color="#969799" /></view><text v-if="avatarDraft" class="profile-info__notice">头像已选择，保存后生效</text>
    <view class="profile-info__fields"><view class="profile-info__row"><text class="profile-info__label"><text class="profile-info__required">*</text>姓名</text><wd-input v-model="form.name" :readonly="nameReadonly" :maxlength="64" placeholder="请输入姓名" custom-style="flex:1;min-width:0" /></view><view class="profile-info__row"><text class="profile-info__label"><text class="profile-info__required">*</text>手机号</text><wd-input v-model="form.phone" :readonly="isProfileFieldReadonly('phone')" type="tel" :maxlength="11" placeholder="请输入手机号" custom-style="flex:1;min-width:0" /></view>
        <TrainingCategoryField :preview="preview" :initial-open="scenario.picker === 'job'" :disabled="editLocked" @refresh="loadProfile" />
      <view class="profile-info__row" role="button" aria-label="性别" :aria-disabled="editLocked" @click="openPicker('gender')"><text class="profile-info__label">性别</text><text class="profile-info__value">{{ form.gender }}</text><AppIcon name="chevron-right" :size="16" color="#969799" /></view>
      <view class="profile-info__row" role="button" aria-label="生日" :aria-disabled="editLocked" @click="openPicker('birthday')"><text class="profile-info__label">生日</text><text class="profile-info__value">{{ form.birthday }}</text><AppIcon name="chevron-right" :size="16" color="#969799" /></view>
    </view><text v-if="saved" class="profile-info__saved">已保存</text>
    <template #footer><view class="profile-info__footer"><wd-button block :loading="!preview && learner.profileSaving" :disabled="!loaded || editLocked" custom-style="--wot-button-height-medium:50px;--wot-button-radius-main:var(--app-radius-md);font-weight:600" @click="save">{{ needsIdentity ? '保存并去实名认证' : '保存资料' }}</wd-button></view></template>
    <wd-popup v-model="choiceVisible" position="bottom" round safe-area-inset-bottom><view class="profile-picker"><view class="profile-picker__header"><text>选择性别</text><view role="button" aria-label="关闭选择器" @click="picker = ''"><AppIcon name="x" :size="22" /></view></view><view v-for="choice in choices" :key="choice" class="profile-picker__choice" :class="{ 'profile-picker__choice--active': choice === form.gender }" role="button" :aria-disabled="editLocked" :aria-label="`选择${choice}`" @click="choose(choice)"><text>{{ choice }}</text><AppIcon v-if="choice === form.gender" name="check" :size="18" color="#1989fa" /></view></view></wd-popup>
    <wd-datetime-picker v-model="birthday" v-model:visible="birthdayVisible" type="date" title="选择生日" cancel-button-text="取消" confirm-button-text="完成" :min-date="minBirthday" :max-date="maxBirthday" :before-confirm="canConfirmBirthday" :visible-item-count="5" @confirm="chooseBirthday" />
  </AppPage>
</template>
<style scoped>
.profile-info__intro { display: block; margin: 4px 0 16px; color: var(--app-color-text-muted); font-size: 13px; }
.profile-info__avatar { min-height: 84px; display: flex; gap: 12px; align-items: center; padding: 0 16px; background: var(--app-color-surface); border-radius: var(--app-radius-lg); font-size: 14px; margin-bottom: 16px; }
.profile-info__avatar > text { flex: 1; color: var(--app-color-text-secondary); }
.profile-info__avatar-icon { width: 60px; height: 60px; display: flex; justify-content: center; align-items: center; border-radius: var(--app-radius-full); background: var(--app-color-primary-soft); }
.profile-info__fields { padding: 0 16px; border-radius: var(--app-radius-lg); background: var(--app-color-surface); }
.profile-info__row { min-height: 64px; display: flex; gap: 12px; align-items: center; font-size: 14px; --wot-input-padding: 0; --wot-input-inner-font-size: 14px; --wot-input-bg: transparent; }
.profile-info__row + .profile-info__row { border-top: 1px solid var(--app-color-border); }
.profile-info__label { width: 62px; flex: none; color: var(--app-color-text-secondary); }
.profile-info__required { margin-right: 3px; color: var(--app-color-danger); }
.profile-info__value { flex: 1; }
.profile-info__footer { padding: 12px 16px calc(20px + var(--app-safe-area-bottom)); background: var(--app-color-surface); }
.profile-info__saved { display: block; margin-top: 12px; color: var(--app-color-success); font-size: 13px; }
.profile-info__notice { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 12px; color: var(--app-color-text-muted); font-size: 13px; }
.profile-info__notice--error { color: var(--app-color-danger); }
.profile-picker { padding: 16px 16px 24px; }
.profile-picker__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 18px; font-weight: 600; }
.profile-picker__choice { display: flex; justify-content: space-between; align-items: center; min-height: 46px; padding: 10px 12px; font-size: 15px; }
.profile-picker__choice--active { color: var(--app-color-primary); background: var(--app-color-primary-soft); border-radius: var(--app-radius-sm); }
</style>
