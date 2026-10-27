<template>
  <ElSelect
    class="role-select"
    popper-class="role-select-popper"
    :model-value="selection"
    multiple
    filterable
    clearable
    :reserve-keyword="preserveBulkQuery"
    :filter-method="filterRoles"
    :loading="loading"
    :disabled="disabled"
    :placeholder="placeholder"
    :aria-label="ariaLabel"
    loading-text="正在加载角色"
    no-match-text="未找到匹配角色"
    :no-data-text="keyword ? '未找到匹配角色' : emptyText"
    @update:model-value="updateSelection"
    @visible-change="onVisibleChange"
  >
    <template #header>
      <div class="role-select__bulk-tools" @mousedown.prevent @click.stop>
        <div class="role-select__bulk-row">
          <span class="role-select__count">已选 {{ selection.length }} 项</span>
          <div class="role-select__bulk-actions">
            <button type="button" class="role-select__tool" :disabled="bulkBlocked || !canSelectAll" @click="selectAll">全选</button>
            <button type="button" class="role-select__tool" :disabled="bulkBlocked || !availableIds.length" @click="invertSelection">反选</button>
            <button type="button" class="role-select__tool" :disabled="bulkBlocked || !selection.length" @click="clearAll">清空</button>
          </div>
        </div>
        <div v-if="keyword" class="role-select__bulk-row">
          <span class="role-select__count">结果 {{ filteredOptions.length }} 项</span>
          <div class="role-select__bulk-actions">
            <button type="button" class="role-select__tool" :disabled="bulkBlocked || !canSelectSearch" @click="selectSearchResults">选中搜索结果</button>
            <button type="button" class="role-select__tool" :disabled="bulkBlocked || !canCancelSearch" @click="cancelSearchResults">取消搜索结果</button>
          </div>
        </div>
      </div>
    </template>
    <template #label="{ value, label }">{{ roleNames.get(String(value)) ?? label }}</template>
    <ElOption v-for="option in filteredOptions" :key="option.id" :value="option.id" :label="option.name">
      <span class="role-select__option-name">{{ option.name }}</span>
      <span v-if="option.unavailable" class="role-select__unavailable">已停用</span>
    </ElOption>
  </ElSelect>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { ElOption, ElSelect } from 'element-plus';

interface RoleOption { id: string; name: string; code?: string; unavailable?: boolean }
const props = withDefaults(defineProps<{
  modelValue: string[];
  options: RoleOption[];
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  emptyText?: string;
  ariaLabel?: string;
}>(), {
  loading: false,
  disabled: false,
  placeholder: '请选择角色，可多选',
  emptyText: '暂无可用业务角色',
  ariaLabel: '角色',
});
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();
const query = ref('');
const preserveBulkQuery = ref(false);
let bulkUpdate = 0;
const selection = computed(() => [...new Set(props.modelValue)]);
const selectedIds = computed(() => new Set(selection.value));
const keyword = computed(() => query.value.trim().toLowerCase());
// Bulk grants can include options unmounted by filtering; resolve native tag labels from the full catalog.
const roleNames = computed(() => new Map(props.options.map((option) => [option.id, option.name])));
const filteredOptions = computed(() => props.options.filter((option) => !keyword.value || [option.name, option.code || ''].some((value) => value.toLowerCase().includes(keyword.value))));
const availableIds = computed(() => [...new Set(props.options.filter((option) => !option.unavailable).map((option) => option.id))]);
const searchIds = computed(() => [...new Set(filteredOptions.value.filter((option) => !option.unavailable).map((option) => option.id))]);
const bulkBlocked = computed(() => props.disabled || props.loading);
const canSelectAll = computed(() => availableIds.value.some((id) => !selectedIds.value.has(id)));
const canSelectSearch = computed(() => searchIds.value.some((id) => !selectedIds.value.has(id)));
const canCancelSearch = computed(() => searchIds.value.some((id) => selectedIds.value.has(id)));

function filterRoles(value: string) { query.value = value; }
function updateSelection(value: string[]) { emit('update:modelValue', [...new Set(value)]); }
function onVisibleChange(visible: boolean) { if (!visible) query.value = ''; }

async function applyBulkSelection(value: string[]) {
  if (bulkBlocked.value) return;
  const next = [...new Set(value)];
  if (next.length === selection.value.length && next.every((id, index) => id === selection.value[index])) return;
  const update = ++bulkUpdate;
  preserveBulkQuery.value = true;
  emit('update:modelValue', next);
  // Keep the native query through this model update; ordinary option picks still clear it.
  await nextTick();
  if (update === bulkUpdate) preserveBulkQuery.value = false;
}
function selectAll() { return applyBulkSelection([...selection.value, ...availableIds.value]); }
function invertSelection() {
  const available = new Set(availableIds.value);
  return applyBulkSelection([
    ...selection.value.filter((id) => !available.has(id)),
    ...availableIds.value.filter((id) => !selectedIds.value.has(id)),
  ]);
}
function clearAll() { return applyBulkSelection([]); }
function selectSearchResults() { return applyBulkSelection([...selection.value, ...searchIds.value]); }
function cancelSearchResults() {
  const matches = new Set(searchIds.value);
  return applyBulkSelection(selection.value.filter((id) => !matches.has(id)));
}
</script>

<style scoped>
.role-select { width: 100%; }
.role-select__bulk-tools { display: grid; gap: 4px; }
.role-select__bulk-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px 16px; }
.role-select__bulk-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 12px; margin-left: auto; }
.role-select__tool { appearance: none; padding: 2px 0; margin: 0; min-height: 24px; border: 0; background: transparent; box-shadow: none; color: var(--el-color-primary); font: inherit; font-size: 12px; font-weight: 400; line-height: 20px; white-space: nowrap; cursor: pointer; }
.role-select__tool:enabled:hover { color: var(--el-color-primary-light-3); text-decoration: underline; }
.role-select__tool:disabled { color: var(--el-text-color-placeholder); cursor: not-allowed; }
.role-select__tool:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; border-radius: 2px; }
.role-select__count { color: var(--re-text-3, var(--el-text-color-secondary)); font-size: 12px; white-space: nowrap; }
.role-select__option-name { overflow: hidden; text-overflow: ellipsis; }
.role-select__unavailable { color: var(--re-text-3, var(--el-text-color-secondary)); font-size: 12px; margin-left: 10px; }
</style>

<style>
.role-select-popper .el-select-dropdown__header { padding: 8px 12px; border-bottom: 1px solid var(--el-border-color-extra-light); }
.role-select-popper .el-select-dropdown__list { padding: 4px 0; }
.role-select-popper .el-select-dropdown__item { height: 34px; padding: 0 14px; color: var(--el-text-color-regular); font-size: 13px; font-weight: 400; line-height: 34px; }
.role-select-popper .el-select-dropdown__item.is-selected { color: var(--el-text-color-regular); font-weight: 500; }
.role-select-popper .el-select-dropdown__item:hover,
.role-select-popper .el-select-dropdown__item.is-hovering { background-color: var(--el-color-primary-light-9); }
.role-select-popper .el-select-dropdown__empty { padding: 14px 12px; font-size: 13px; }
</style>
