<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onHide } from '@dcloudio/uni-app'
import AppIcon from '@/components/common/AppIcon.vue'
import ConfirmSheet from '@/components/common/ConfirmSheet.vue'
import { useLearnerStore } from '@/stores/learner'
import { profileTrainingCategories } from '@/fixtures/ui-scenarios/shell'
const props = defineProps<{ preview: boolean; initialOpen?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ refresh: [] }>()
const learner = useLearnerStore()
const pickerVisible = ref(false), previewConfirmVisible = ref(false), previewId = ref('1'), previewConfirmed = ref(false)
const options = computed(() => props.preview ? profileTrainingCategories : learner.trainingCategories)
const selected = computed(() => props.preview ? options.value.find(item => item.id === previewId.value) : learner.categoryDraft)
const readonly = computed(() => props.preview ? previewConfirmed.value : !!learner.profile?.category_id)
const disabled = computed(() => !!props.disabled || (!props.preview && !learner.canChooseTrainingCategory))
const value = computed(() => readonly.value && !props.preview ? learner.profile?.category_name || '已设置培训工种' : selected.value?.name || '请选择培训工种')
const confirmation = computed({ get: () => props.preview ? previewConfirmVisible.value : learner.categoryConfirmVisible, set: value => { if (props.preview) previewConfirmVisible.value = value; else learner.categoryConfirmVisible = value } })
watch(() => props.initialOpen, value => { if (props.preview && value) pickerVisible.value = true }, { immediate: true })
onHide(() => { pickerVisible.value = false; previewConfirmVisible.value = false; if (!props.preview) learner.cancelCategoryConfirmation() })
function choose(id: string) { if (disabled.value) return; if (props.preview) previewId.value = id; else learner.chooseTrainingCategory(id); pickerVisible.value = false }
function requestConfirmation() { if (props.preview) previewConfirmVisible.value = true; else learner.requestCategoryConfirmation() }
function cancel() { if (props.preview) previewConfirmVisible.value = false; else learner.cancelCategoryConfirmation() }
function confirm() { if (props.preview) previewConfirmed.value = true; else void learner.confirmTrainingCategory() }
</script>
<template>
  <view class="category-field">
    <view class="category-field__row" :role="readonly ? undefined : 'button'" :aria-label="readonly ? undefined : '培训工种'" :aria-disabled="!readonly && disabled" @click="!readonly && !disabled && (pickerVisible = true)"><text class="category-field__label">培训工种</text><text class="category-field__value">{{ value }}</text><AppIcon v-if="!readonly" name="chevron-right" :size="16" color="#969799" /></view>
    <text v-if="readonly" class="category-field__hint">如需修改，请联系管理员或监考人员。</text>
    <template v-else>
      <text class="category-field__hint">确认后将用于匹配考试，学员端无法自行修改。</text>
      <text v-if="!preview && learner.categoryLoading" class="category-field__hint">培训工种加载中…</text>
      <text v-else-if="!preview && !learner.categoryError && !learner.categoryReadRequired && !options.length" class="category-field__hint">暂无可选培训工种，请联系管理员或监考人员。</text>
      <wd-button v-if="selected" size="small" :loading="!preview && learner.categorySaving" :disabled="disabled" @click="requestConfirmation">确认培训工种</wd-button>
    </template>
    <view v-if="!preview && learner.categoryError" class="category-field__error"><text>{{ learner.categoryError }}</text><wd-button size="small" variant="text" :disabled="learner.categorySaving || learner.profileLoading" @click="learner.categoryReadRequired ? emit('refresh') : learner.loadTrainingCategories()">{{ learner.categoryReadRequired ? '刷新资料' : '重新加载工种' }}</wd-button></view>
    <text v-if="!preview && learner.categoryMessage" class="category-field__hint">{{ learner.categoryMessage }}</text>
    <wd-popup v-model="pickerVisible" position="bottom" round safe-area-inset-bottom><view class="category-picker"><view class="category-picker__heading"><text>选择工种</text><view role="button" aria-label="关闭选择器" @click="pickerVisible = false"><AppIcon name="x" :size="22" /></view></view><scroll-view scroll-y class="category-picker__options"><view v-for="option in options" :key="option.id" role="button" :aria-label="`选择${option.name}`" :aria-disabled="disabled" class="category-picker__option" @click="choose(option.id)"><text>{{ option.name }}</text><AppIcon v-if="selected?.id === option.id" name="check" :size="18" color="#1989fa" /></view></scroll-view></view></wd-popup>
    <ConfirmSheet v-model="confirmation" title="确认培训工种" :message="`你选择的培训工种为「${selected?.name || ''}」。确认后将用于匹配考试，学员端无法自行修改。如需调整，请联系管理员或监考人员。`" confirm-text="确认培训工种" cancel-text="返回修改" @cancel="cancel" @confirm="confirm" />
  </view>
</template>
<style scoped>
.category-field { padding:0 0 16px; border-top:1px solid var(--app-color-border); }.category-field__row { min-height:64px; display:flex; align-items:center; gap:12px; font-size:14px; }.category-field__label { flex:none; width:70px; color:var(--app-color-text-secondary); }.category-field__value { flex:1; }.category-field__hint { display:block; margin-bottom:10px; color:var(--app-color-text-muted); font-size:12px; line-height:1.6; }.category-field__error { display:flex; flex-direction:column; align-items:flex-start; margin-top:10px; font-size:13px; color:var(--app-color-danger); }.category-picker { padding:16px 16px 24px; }.category-picker__heading { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; font-size:18px; font-weight:600; }.category-picker__options { max-height:55vh; }.category-picker__option { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:46px; padding:10px 12px; font-size:15px; }
</style>
