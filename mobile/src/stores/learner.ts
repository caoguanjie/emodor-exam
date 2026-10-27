import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { ApiError } from '@/api/client'
import { confirmLearnerTrainingCategory, getLearnerProfile, getLearnerTrainingCategories, saveLearnerProfile, type EditableLearnerProfile, type LearnerProfile, type LearnerTrainingCategory } from '@/api/auth'
import type { MobileSessionUser } from '@/types/api'

function editablePatch(input: EditableLearnerProfile): EditableLearnerProfile {
  const patch: EditableLearnerProfile = {}
  if ('real_name' in input) {
    const name = typeof input.real_name === 'string' ? input.real_name.trim() : ''
    if (!name || name.length > 64) throw new ApiError(40001, '真实姓名须为1—64个字')
    patch.real_name = name
  }
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
  const trainingCategories = ref<LearnerTrainingCategory[]>([])
  const categoryLoading = ref(false), categorySaving = ref(false), categoryError = ref(''), categoryMessage = ref('')
  const categoryReadRequired = ref(true), categoryDraftId = ref(''), categoryConfirmVisible = ref(false)
  const canChooseTrainingCategory = computed(() => !!profile.value && !profile.value.category_id && !categoryReadRequired.value && !profileLoading.value && !profileSaving.value && !categoryLoading.value && !categorySaving.value)
  const categoryDraft = computed(() => trainingCategories.value.find(item => item.id === categoryDraftId.value) || null)
  let revision = 0
  let readVersion = 0
  let categoryReadVersion = 0
  let confirmationId = ''
  function invalidateProfile() {
    revision++
    readVersion++
    categoryReadVersion++
    profile.value = null
    profileLoading.value = false
    profileSaving.value = false
    profileError.value = ''
    trainingCategories.value = []; categoryLoading.value = false; categorySaving.value = false
    categoryError.value = ''; categoryMessage.value = ''; categoryReadRequired.value = true
    categoryDraftId.value = ''; categoryConfirmVisible.value = false
    confirmationId = ''
  }
  watch(() => user.value?.id, invalidateProfile, { flush: 'sync' })

  function acceptProfile(result: LearnerProfile) {
    profile.value = result; categoryReadRequired.value = false
    if (user.value && String(user.value.id) === result.id) user.value = { ...user.value, real_name: result.real_name, category_id: result.category_id }
    if (result.category_id) { categoryDraftId.value = ''; categoryConfirmVisible.value = false }
  }

  async function loadProfile() {
    const started = revision
    const currentRead = ++readVersion
    cancelCategoryConfirmation()
    profileLoading.value = true; profileError.value = ''
    try {
      const result = await getLearnerProfile()
      if (started !== revision) throw new ApiError(40107, '登录会话已切换，请重新操作')
      if (currentRead === readVersion) acceptProfile(result)
      return profile.value || result
    } catch (error) {
      if (started === revision && currentRead === readVersion) { profileError.value = error instanceof Error ? error.message : '资料加载失败，请重试'; categoryReadRequired.value = true }
      throw error
    } finally { if (started === revision && currentRead === readVersion) profileLoading.value = false }
  }

  async function updateProfile(input: EditableLearnerProfile) {
    if (profileSaving.value || categorySaving.value) throw new ApiError(40001, '正在保存，请稍候')
    const patch = editablePatch(input)
    const started = revision
    profileSaving.value = true; profileError.value = ''
    try {
      const result = await saveLearnerProfile(patch)
      if (started !== revision) throw new ApiError(40107, '登录会话已切换，请重新操作')
      readVersion++; acceptProfile(result); profileLoading.value = false
      return result
    } catch (error) {
      if (started === revision) profileError.value = error instanceof Error ? error.message : '资料保存失败，请重试'
      throw error
    } finally { if (started === revision) profileSaving.value = false }
  }
  async function loadTrainingCategories() {
    const started = revision, read = ++categoryReadVersion
    categoryLoading.value = true; categoryError.value = ''; trainingCategories.value = []
    try {
      const options: LearnerTrainingCategory[] = []
      for (let page = 1; ; page++) {
        const result = await getLearnerTrainingCategories(page)
        if (started !== revision || read !== categoryReadVersion) return
        if (result.page !== page || !Array.isArray(result.items) || (!result.items.length && options.length < result.total)) throw new ApiError(-2, '培训工种列表异常，请刷新重试')
        for (const item of result.items) {
          if (!/^[1-9]\d*$/.test(item.id) || options.some(option => option.id === item.id)) throw new ApiError(-2, '培训工种列表异常，请刷新重试')
          options.push(item)
        }
        if (options.length >= result.total) break
      }
      trainingCategories.value = options
      if (!options.some(item => item.id === categoryDraftId.value)) categoryDraftId.value = ''
    } catch (cause) {
      if (started === revision && read === categoryReadVersion) categoryError.value = cause instanceof Error ? cause.message : '培训工种加载失败，请重试'
    } finally { if (started === revision && read === categoryReadVersion) categoryLoading.value = false }
  }
  function chooseTrainingCategory(id: string) {
    if (!canChooseTrainingCategory.value || !trainingCategories.value.some(item => item.id === id)) return
    categoryDraftId.value = id; cancelCategoryConfirmation(); categoryMessage.value = ''
  }
  function requestCategoryConfirmation() {
    if (canChooseTrainingCategory.value && categoryDraft.value) { confirmationId = categoryDraft.value.id; categoryConfirmVisible.value = true }
  }
  function cancelCategoryConfirmation() { categoryConfirmVisible.value = false; confirmationId = '' }
  async function confirmTrainingCategory() {
    if (!confirmationId || confirmationId !== categoryDraft.value?.id || !canChooseTrainingCategory.value || !categoryDraft.value) return
    const id = categoryDraft.value.id, started = revision
    cancelCategoryConfirmation(); categorySaving.value = true; categoryError.value = ''; categoryMessage.value = ''
    readVersion++
    try {
      const result = await confirmLearnerTrainingCategory(id)
      if (started !== revision) return
      readVersion++; acceptProfile(result); profileLoading.value = false
      categoryMessage.value = '培训工种已确认'
    } catch (cause) {
      if (started !== revision) return
      categoryReadRequired.value = true
      try {
        const result = await loadProfile()
        if (started !== revision) return
        if (result.category_id) categoryMessage.value = result.category_id === id ? '培训工种已确认' : '培训工种已更新，请以当前显示为准。如需调整，请联系管理员或监考人员。'
        else categoryError.value = cause instanceof Error ? cause.message : '培训工种保存失败，请重新确认'
      } catch {
        if (started === revision) categoryError.value = '保存结果暂时无法确认，请刷新资料后再操作。'
      }
    } finally { if (started === revision) categorySaving.value = false }
  }
  return { user, profile, profileLoading, profileSaving, profileError, loadProfile, updateProfile, invalidateProfile,
    trainingCategories, categoryLoading, categorySaving, categoryError, categoryMessage, categoryReadRequired,
    categoryDraftId, categoryDraft, categoryConfirmVisible, canChooseTrainingCategory, loadTrainingCategories,
    chooseTrainingCategory, requestCategoryConfirmation, cancelCategoryConfirmation, confirmTrainingCategory }
})
