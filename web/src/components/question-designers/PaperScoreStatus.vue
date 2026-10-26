<template>
  <el-popover v-model:visible="opened" placement="bottom-end" trigger="click" :width="240" :show-arrow="false">
    <template #reference>
      <el-button class="paper-score-status" :type="statusType" plain :aria-expanded="opened" aria-label="试卷分值分配">
        已配 {{ allocated }} / 总分 {{ target }}
        <SvgIcon icon-class="arrow-down-s-line" />
      </el-button>
    </template>
    <div class="paper-score-status__details">
      <div><span>目标总分</span><strong>{{ target }} 分</strong></div>
      <div><span>已分配</span><strong>{{ allocated }} 分</strong></div>
      <div :class="`is-${statusType}`"><span>{{ differenceLabel }}</span><strong>{{ differenceText }}</strong></div>
      <button v-if="!readonly" type="button" aria-label="设置试卷总分" :disabled="disabled" @click="configure">设置试卷总分 →</button>
    </div>
  </el-popover>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import SvgIcon from '../Tiptap/components/SvgIcon.vue';
const props = withDefaults(defineProps<{ totalScore: number; allocatedScoreCents: number; readonly?: boolean; disabled?: boolean }>(), { readonly: false, disabled: false });
const emit = defineEmits<{ configure: [] }>();
const opened = ref(false);
const valid = computed(() => Number.isFinite(props.totalScore) && props.totalScore > 0 && props.totalScore <= 999.99 && Number.isFinite(props.allocatedScoreCents));
const difference = computed(() => Math.round(props.totalScore * 100) - props.allocatedScoreCents);
const target = computed(() => Number.isFinite(props.totalScore) ? props.totalScore : '—');
const allocated = computed(() => Number.isFinite(props.allocatedScoreCents) ? props.allocatedScoreCents / 100 : '—');
const statusType = computed(() => !valid.value || difference.value < 0 ? 'danger' : difference.value === 0 ? 'success' : 'warning');
const differenceLabel = computed(() => !valid.value ? '待设置' : difference.value > 0 ? '还差' : difference.value < 0 ? '超出' : '已配齐');
const differenceText = computed(() => !valid.value ? '请填写有效总分' : difference.value === 0 ? '✓' : `${Math.abs(difference.value) / 100} 分`);
function configure() { opened.value = false; emit('configure'); }
</script>
<style scoped>
.paper-score-status.el-button {
  gap:4px; font-size:12px; padding:8px 10px;
  --el-button-text-color:var(--el-text-color-regular);
  --el-button-bg-color:var(--el-fill-color-light);
  --el-button-border-color:var(--el-border-color-lighter);
  --el-button-hover-text-color:var(--el-text-color-primary);
  --el-button-hover-bg-color:var(--el-fill-color);
  --el-button-hover-border-color:var(--el-border-color);
  --el-button-active-text-color:var(--el-text-color-primary);
  --el-button-active-bg-color:var(--el-fill-color);
  --el-button-active-border-color:var(--el-border-color);
}
.paper-score-status :deep(.svg-icon) { margin-left:4px; }
.paper-score-status__details { display:grid; gap:12px; color:var(--el-text-color-regular); font-size:13px; }
.paper-score-status__details > div { display:flex; align-items:center; justify-content:space-between; gap:16px; }
.paper-score-status__details strong { font-weight:500; }
.paper-score-status__details .is-warning { color:var(--el-color-warning-dark-2); }
.paper-score-status__details .is-success { color:var(--el-color-success); }
.paper-score-status__details .is-danger { color:var(--el-color-danger); }
.paper-score-status__details > button { border:0; border-top:1px solid var(--el-border-color-lighter); background:transparent; padding:12px 0 0; text-align:left; font:inherit; color:var(--el-color-primary); cursor:pointer; }
.paper-score-status__details > button:disabled { color:var(--el-text-color-disabled); cursor:default; }
</style>
