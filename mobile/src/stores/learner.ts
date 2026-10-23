import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { ApiError } from '@/api/client'
import { getLearnerProfile, saveLearnerProfile, type EditableLearnerProfile, type LearnerProfile } from '@/api/auth'
import type { MobileSessionUser } from '@/types/api'

function editablePatch(input: EditableLearnerProfile): EditableLearnerProfile {
  const patch: EditableLearnerProfile = {}
  if ('avatar_id' in input) patch.avatar_id = input.avatar_id || null
  if ('occupation' in input) {
    const occupation = input.occupation?.trim() || null
    if (occupation && occupation.length > 64) throw new ApiError(40001, '工种最多64个字')
    patch.occupation = occupation
  }
  if ('gender' in input) {
    if (input.gender !== null && input.gender !== 'male' && input.gender !== 'female') throw new ApiError(40001, '请选择有效性别')
    patch.gender = input.gender
  }
  if ('birthday' in input) {
    const birthday = input.birthday || null
    if (birthday) {
      const [year, month, day] = birthday.split('-').map(Number)
      const date = new Date(year, month - 1, day)
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date > today) throw new ApiError(40001, '请选择不晚于今天的有效生日')
    }
    patch.birthday = birthday
  }
  return patch
}

export const useLearnerStore = defineStore('mobile-learner', () => {
  const user = ref<MobileSessionUser | null>(null)
  const profile = ref<LearnerProfile | null>(null)
  const profileLoading = ref(false)
  const profileSaving = ref(false)
  const profileError = ref('')
  let revision = 0
  let readVersion = 0
  watch(() => user.value?.id, () => {
    revision++
    readVersion++
    profile.value = null
    profileLoading.value = false
    profileSaving.value = false
    profileError.value = ''
  }, { flush: 'sync' })

  async function loadProfile() {
    const started = revision
    const currentRead = ++readVersion
    profileLoading.value = true; profileError.value = ''
    try {
      const result = await getLearnerProfile()
      if (started === revision && currentRead === readVersion) profile.value = result
      return profile.value || result
    } catch (error) {
      if (started === revision && currentRead === readVersion) profileError.value = error instanceof Error ? error.message : '资料加载失败，请重试'
      throw error
    } finally { if (started === revision && currentRead === readVersion) profileLoading.value = false }
  }

  async function updateProfile(input: EditableLearnerProfile) {
    if (profileSaving.value) throw new ApiError(40001, '正在保存，请稍候')
    const patch = editablePatch(input)
    const started = revision
    profileSaving.value = true; profileError.value = ''
    try {
      const result = await saveLearnerProfile(patch)
      if (started === revision) { readVersion++; profile.value = result; profileLoading.value = false }
      return result
    } catch (error) {
      if (started === revision) profileError.value = error instanceof Error ? error.message : '资料保存失败，请重试'
      throw error
    } finally { if (started === revision) profileSaving.value = false }
  }
  return { user, profile, profileLoading, profileSaving, profileError, loadProfile, updateProfile }
})
