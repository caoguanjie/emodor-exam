<template>
  <div class="random-paper-rules">
    <p class="random-paper-rules__hint">本机构：简单题；外来人员：困难题</p>
    <table class="random-paper-rules__table">
      <thead><tr><th scope="col">题型</th><th scope="col" class="random-paper-rules__capacity">可抽题数</th><th scope="col">题数</th><th scope="col">每题分数</th><th scope="col">分值小计</th></tr></thead>
      <tbody>
        <tr v-for="item in types" :key="item.type" :data-rule-type="item.type">
          <th scope="row">{{ item.label }}</th>
          <td class="random-paper-rules__capacity" :class="{ 'random-paper-rules__error': exceedsCapacity(item.type) }"><template v-if="capacityFor(item.type)"><div>简单 {{ capacityFor(item.type)!.easy }}</div><div>困难 {{ capacityFor(item.type)!.hard }}</div><div>最多 {{ Math.min(500, capacityFor(item.type)!.available) }} 道</div></template><span v-else>{{ capacityLoading ? '加载中…' : '—' }}</span></td>
          <td><el-input :model-value="display(ruleFor(item.type).count)" type="number" inputmode="numeric" min="0" :max="capacityFor(item.type) ? Math.min(500, capacityFor(item.type)!.available) : 500" step="1" data-field="count" :aria-invalid="exceedsCapacity(item.type)" :aria-label="`${item.label}题数`" :disabled="disabled" @update:model-value="update(item.type, 'count', $event)" /></td>
          <td><el-input :model-value="display(ruleFor(item.type).score_cents / 100)" type="number" inputmode="decimal" min="0.01" max="999.99" step="0.01" data-field="score" :aria-label="`${item.label}每题分数`" :disabled="disabled" @update:model-value="update(item.type, 'score_cents', $event)" /></td>
          <td>{{ points(ruleFor(item.type).count * ruleFor(item.type).score_cents) }} 分</td>
        </tr>
      </tbody>
    </table>
    <div class="random-paper-rules__summary" data-testid="random-rule-summary">共 {{ summary.count }} 道，分值合计 {{ points(summary.scoreCents) }} 分 / 总分 {{ totalScore }} 分</div>
    <div v-if="error" role="alert" class="random-paper-rules__error">{{ error }}</div>
    <div v-if="capacityError" role="alert" class="random-paper-rules__error">{{ capacityError }}</div>
    <p class="random-paper-rules__hint">题数为 0 时不选该题型。每次打开弹窗自动更新数量，最多可抽数取简单、困难两池较小值，仅统计当前可用题目；发布时重新校验。</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Id, PaperRuleInput, PoolScope, QuestionType, RandomPaperCapacity } from '../api/training-types';
import http from '../api/http';
import { summarizeRandomRules, validateRandomRules } from '../utils/random-paper-rules';

const props = withDefaults(defineProps<{ modelValue: PaperRuleInput[]; totalScore: number; disabled?: boolean; active?: boolean; paperId?: Id; poolScope?: PoolScope; categoryId?: Id | null }>(), { active: true });
const emit = defineEmits<{ 'update:modelValue': [rules: PaperRuleInput[]] }>();
const types: Array<{ type: QuestionType; label: string }> = [
  { type: 'single', label: '单选' }, { type: 'multiple', label: '多选' }, { type: 'judgment', label: '判断' },
];
const summary = computed(() => summarizeRandomRules(props.modelValue));
const error = computed(() => validateRandomRules(props.modelValue, props.totalScore));
const capacities = ref<RandomPaperCapacity[] | null>(null);
const capacityLoading = ref(false);
const capacityFailed = ref(false);
const capacityEnabled = computed(() => !!props.paperId || !!props.poolScope);
let capacityRequest = 0;
function capacityFor(type: QuestionType) { return capacities.value?.find(item => item.type === type); }
function exceedsCapacity(type: QuestionType) { const capacity = capacityFor(type); return !!capacity && ruleFor(type).count > Math.min(500, capacity.available); }
const capacityError = computed(() => {
  if (!capacityEnabled.value) return null;
  if (capacityLoading.value) return '正在加载可抽题数，请稍候';
  if (capacityFailed.value || !capacities.value) return '可抽题数加载失败，请关闭后重新打开弹窗重试';
  const item = types.find(item => exceedsCapacity(item.type));
  if (!item) return null;
  const capacity = capacityFor(item.type)!;
  return `${item.label}最多可抽 ${Math.min(500, capacity.available)} 道（简单 ${capacity.easy}，困难 ${capacity.hard}），当前填写 ${ruleFor(item.type).count} 道`;
});
async function loadCapacity() {
  const request = ++capacityRequest;
  capacities.value = null; capacityFailed.value = false; capacityLoading.value = false;
  if (!capacityEnabled.value || props.active === false) return;
  capacityLoading.value = true;
  try {
    const params = props.paperId ? { paper_id: props.paperId } : { pool_scope: props.poolScope, ...(props.poolScope === 'category' ? { category_id: props.categoryId } : {}) };
    const data = await http.get('/admin/papers/random-capacities', { params }) as { items: RandomPaperCapacity[] };
    if (request !== capacityRequest) return;
    if (!types.every(type => data.items?.some(item => item.type === type.type && [item.easy, item.hard, item.available].every(value => Number.isInteger(value) && value >= 0) && item.available === Math.min(item.easy, item.hard)))) throw new Error('Invalid capacity response');
    capacities.value = data.items;
  } catch { if (request === capacityRequest) capacityFailed.value = true; }
  finally { if (request === capacityRequest) capacityLoading.value = false; }
}
watch(() => [props.paperId, props.poolScope, props.categoryId, props.active], loadCapacity, { immediate: true });
onBeforeUnmount(() => { capacityRequest++; });
defineExpose({ validateCapacity: () => capacityError.value });
function ruleFor(type: QuestionType): PaperRuleInput { return props.modelValue.find(rule => rule.type === type) || { type, count: 0, score_cents: 100 }; }
function display(value: number) { return Number.isFinite(value) ? value : ''; }
function points(cents: number) { return Number.isFinite(cents) ? Number((cents / 100).toFixed(2)) : '—'; }
function update(type: QuestionType, field: 'count' | 'score_cents', value: string | number) {
  let number = String(value).trim() ? Number(value) : NaN;
  if (field === 'score_cents') {
    number *= 100;
    if (Math.abs(number - Math.round(number)) < 1e-7) number = Math.round(number);
  }
  emit('update:modelValue', types.map(item => ({ ...ruleFor(item.type), ...(item.type === type ? { [field]: number } : {}) })));
}
</script>

<style scoped>
.random-paper-rules { width:100%; }
.random-paper-rules__table { border-collapse:collapse; width:100%; table-layout:fixed; }
.random-paper-rules__table th, .random-paper-rules__table td { padding:8px; text-align:left; border-bottom:1px solid var(--el-border-color-lighter); }
.random-paper-rules__table th { font-weight:500; }
.random-paper-rules__table th:first-child { width:60px; }
.random-paper-rules__table .random-paper-rules__capacity { width:132px; font-size:12px; line-height:1.6; }
.random-paper-rules__table td:last-child { white-space:nowrap; }
.random-paper-rules__hint { color:var(--el-text-color-secondary); font-size:12px; line-height:1.6; margin:6px 0; }
.random-paper-rules__summary { margin-top:10px; }
.random-paper-rules__error { color:var(--el-color-danger); font-size:12px; }
</style>
