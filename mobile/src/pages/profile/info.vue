<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { onLoad, onHide, onUnload } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { isProfileFieldReadonly, profileJobs, shellProfile, useShellScenario } from '@/fixtures/ui-scenarios/shell'
import { isStaticSessionPreview } from '@/platform/session'
import { useSessionStore } from '@/stores/session'
import { useLearnerStore } from '@/stores/learner'
import type { LearnerProfile } from '@/api/auth'
import ProtectedImage from '@/components/common/ProtectedImage.vue'
import { pickAvatar, releasePickedMedia, type PickedMedia } from '@/platform/media-picker'
import { uploadAvatar } from '@/api/media'
const { scenario, loadScenario } = useShellScenario('profile-info')
const preview = ref(false)
const learner = useLearnerStore()
const session = useSessionStore()
const form = reactive({ name: '', phone: '', job: '', gender: '', birthday: '' })
const loaded = ref(false)
const error = ref('')
const avatarFile = ref<PickedMedia | null>(null), avatarDraft = ref(''), avatarBusy = ref(false)
const avatarPicking = ref(false)
let pageRevision = 0
function clearAvatar() { pageRevision++; if (avatarFile.value) releasePickedMedia(avatarFile.value); avatarFile.value = null; avatarDraft.value = ''; avatarBusy.value = false; avatarPicking.value = false }
onHide(() => { if (!avatarPicking.value) clearAvatar() })
onUnload(clearAvatar)
watch(() => session.sessionEpoch, () => { clearAvatar(); loaded.value = false; Object.assign(form, { name: '', phone: '', job: '', gender: '', birthday: '' }) }, { flush: 'sync' })
onLoad(query => {
  preview.value = isStaticSessionPreview(query); loadScenario(query)
  if (preview.value) { Object.assign(form, shellProfile); loaded.value = true }
  else void loadProfile()
})
const picker = ref('')
const birthday = ref(new Date(2000, 0, 1).getTime())
const minBirthday = new Date(1900, 0, 1).getTime()
const maxBirthday = computed(() => preview.value ? new Date(2026, 9, 22).getTime() : new Date().setHours(0, 0, 0, 0))
const saved = ref(false)
const editLocked = computed(() => !preview.value && (!loaded.value || learner.profileLoading || learner.profileSaving || avatarBusy.value))
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
watch(() => scenario.value.id, () => { picker.value = scenario.value.picker || '' }, { immediate: true })
const choiceVisible = computed({ get: () => picker.value === 'job' || picker.value === 'gender', set: (value) => { if (!value) picker.value = '' } })
const birthdayVisible = computed({ get: () => picker.value === 'birthday', set: (value) => { if (!value) picker.value = '' } })
const choices = computed(() => picker.value === 'job' ? profileJobs : ['男', '女'])
function openPicker(kind: string) { if (!editLocked.value) picker.value = kind }
function choose(value: string) { if (editLocked.value) return; if (picker.value === 'job') form.job = value; else if (picker.value === 'gender') form.gender = value; picker.value = ''; saved.value = false }
function canConfirmBirthday() { return !editLocked.value }
function chooseBirthday(event: { value: string | number | Array<string | number> }) {
  if (editLocked.value) return
  const date = new Date(Number(event.value))
  if (Number.isNaN(date.getTime())) return
  form.birthday = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  picker.value = ''; saved.value = false
}
function applyProfile(profile: LearnerProfile) {
  Object.assign(form, { name: profile.real_name, phone: profile.phone || '', job: profile.occupation || '', gender: profile.gender === 'male' ? '男' : profile.gender === 'female' ? '女' : '', birthday: profile.birthday || '' })
  if (profile.birthday) birthday.value = new Date(`${profile.birthday}T00:00:00`).getTime()
}
async function loadProfile() {
  error.value = ''
  if (!session.initialized && !await session.bootstrap()) return
  if (!session.accessToken) return
  try { applyProfile(await learner.loadProfile()); loaded.value = true }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '资料加载失败，请重试' }
}
async function save() {
  if (preview.value) { saved.value = true; return }
  if (!loaded.value || learner.profileSaving || avatarBusy.value) return
  picker.value = ''; saved.value = false; error.value = ''
  try {
    const profile = await learner.updateProfile({ occupation: form.job || null, gender: form.gender === '男' ? 'male' : form.gender === '女' ? 'female' : null, birthday: form.birthday || null, ...(avatarDraft.value ? { avatar_id: avatarDraft.value } : {}) })
    applyProfile(profile); clearAvatar(); saved.value = true
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '资料保存失败，请重试' }
}
</script>
<template>
  <AppPage title="个人资料" :back-target="`/pages/profile/index${preview ? '?scenario=profile-default' : ''}`"><text class="profile-info__intro">请核对机构登记的姓名与手机号。</text>
    <view v-if="!preview && learner.profileLoading" class="profile-info__notice">资料加载中…</view><view v-if="error" class="profile-info__notice profile-info__notice--error"><text>{{ error }}</text><wd-button v-if="!loaded" size="small" @click="loadProfile">重新加载</wd-button></view>
    <view class="profile-info__avatar" role="button" aria-label="更换头像" :aria-disabled="editLocked" @click="changeAvatar"><text>头像</text><view class="profile-info__avatar-icon"><wd-loading v-if="avatarBusy" /><wd-img v-else-if="avatarFile" :src="avatarFile.tempFilePath" :width="48" :height="48" mode="aspectFill" round /><ProtectedImage v-else-if="!preview && learner.profile?.avatar_id" :asset-id="learner.profile.avatar_id" owner-type="user_avatar" :owner-id="learner.profile.id" :width="48" :height="48"><AppIcon name="user-round" :size="30" color="#1989fa" /></ProtectedImage><AppIcon v-else name="user-round" :size="30" color="#1989fa" /></view><AppIcon name="chevron-right" :size="16" color="#969799" /></view><text v-if="avatarDraft" class="profile-info__notice">头像已选择，保存后生效</text>
    <view class="profile-info__fields"><view class="profile-info__row"><text class="profile-info__label"><text class="profile-info__required">*</text>姓名</text><wd-input v-model="form.name" :readonly="isProfileFieldReadonly('name')" placeholder="请输入姓名" custom-style="flex:1;min-width:0" /></view><view class="profile-info__row"><text class="profile-info__label"><text class="profile-info__required">*</text>手机号</text><wd-input v-model="form.phone" :readonly="isProfileFieldReadonly('phone')" type="tel" :maxlength="11" placeholder="请输入手机号" custom-style="flex:1;min-width:0" /></view>
      <view class="profile-info__row" role="button" aria-label="工种" :aria-disabled="editLocked" @click="openPicker('job')"><text class="profile-info__label">工种</text><text class="profile-info__value">{{ form.job }}</text><AppIcon name="chevron-right" :size="16" color="#969799" /></view>
      <view class="profile-info__row" role="button" aria-label="性别" :aria-disabled="editLocked" @click="openPicker('gender')"><text class="profile-info__label">性别</text><text class="profile-info__value">{{ form.gender }}</text><AppIcon name="chevron-right" :size="16" color="#969799" /></view>
      <view class="profile-info__row" role="button" aria-label="生日" :aria-disabled="editLocked" @click="openPicker('birthday')"><text class="profile-info__label">生日</text><text class="profile-info__value">{{ form.birthday }}</text><AppIcon name="chevron-right" :size="16" color="#969799" /></view>
    </view><text v-if="saved" class="profile-info__saved">已保存</text>
    <template #footer><view class="profile-info__footer"><wd-button block :loading="!preview && learner.profileSaving" :disabled="!loaded || (!preview && learner.profileLoading)" custom-style="--wot-button-height-medium:50px;--wot-button-radius-main:var(--app-radius-md);font-weight:600" @click="save">保存资料</wd-button></view></template>
    <wd-popup v-model="choiceVisible" position="bottom" round safe-area-inset-bottom><view class="profile-picker"><view class="profile-picker__header"><text>{{ picker === 'job' ? '选择工种' : '选择性别' }}</text><view role="button" aria-label="关闭选择器" @click="picker = ''"><AppIcon name="x" :size="22" /></view></view><view v-for="choice in choices" :key="choice" class="profile-picker__choice" :class="{ 'profile-picker__choice--active': choice === (picker === 'job' ? form.job : form.gender) }" role="button" :aria-disabled="editLocked" :aria-label="`选择${choice}`" @click="choose(choice)"><text>{{ choice }}</text><AppIcon v-if="choice === (picker === 'job' ? form.job : form.gender)" name="check" :size="18" color="#1989fa" /></view></view></wd-popup>
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
