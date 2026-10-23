<script setup lang="ts">
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

const options = ['全部', '单选', '多选', '判断']

function updateValue(value: string | number) {
  emit('update:modelValue', String(value))
}
</script>

<template>
  <view class="wrong-book-filter" role="radiogroup" aria-label="错题类型筛选">
    <wd-segmented
      :value="props.modelValue"
      :options="options"
      custom-class="wrong-book-segmented"
      @update:value="updateValue"
    >
      <template #label="{ option }">
        <view role="radio" :aria-checked="props.modelValue === String(option.value)">
          {{ option.value }}
        </view>
      </template>
    </wd-segmented>
  </view>
</template>

<style scoped>
.wrong-book-filter {
  margin-bottom: 20px;
}
</style>
