<template>
  <div class="random-paper-rules">
    <p class="random-paper-rules__hint">本机构：简单题；外来人员：困难题</p>
    <table class="random-paper-rules__table">
      <thead><tr><th scope="col">题型</th><th scope="col">题数</th><th scope="col">每题分数</th><th scope="col">分值小计</th></tr></thead>
      <tbody>
        <tr v-for="item in types" :key="item.type" :data-rule-type="item.type">
          <th scope="row">{{ item.label }}</th>
          <td><el-input :model-value="display(ruleFor(item.type).count)" type="number" inputmode="numeric" min="0" max="500" step="1" data-field="count" :aria-label="`${item.label}题数`" :disabled="disabled" @update:model-value="update(item.type, 'count', $event)" /></td>
          <td><el-input :model-value="display(ruleFor(item.type).score_cents / 100)" type="number" inputmode="decimal" min="0.01" max="999.99" step="0.01" data-field="score" :aria-label="`${item.label}每题分数`" :disabled="disabled" @update:model-value="update(item.type, 'score_cents', $event)" /></td>
          <td>{{ points(ruleFor(item.type).count * ruleFor(item.type).score_cents) }} 分</td>
        </tr>
      </tbody>
    </table>
    <div class="random-paper-rules__summary" data-testid="random-rule-summary">共 {{ summary.count }} 道，分值合计 {{ points(summary.scoreCents) }} 分 / 总分 {{ totalScore }} 分</div>
    <div v-if="error" role="alert" class="random-paper-rules__error">{{ error }}</div>
    <p class="random-paper-rules__hint">题数为 0 时不选该题型。发布时简单题和困难题均须满足各题型数量。</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PaperRuleInput, QuestionType } from '../api/training-types';
import { summarizeRandomRules, validateRandomRules } from '../utils/random-paper-rules';

const props = defineProps<{ modelValue: PaperRuleInput[]; totalScore: number; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [rules: PaperRuleInput[]] }>();
const types: Array<{ type: QuestionType; label: string }> = [
  { type: 'single', label: '单选' }, { type: 'multiple', label: '多选' }, { type: 'judgment', label: '判断' },
];
const summary = computed(() => summarizeRandomRules(props.modelValue));
const error = computed(() => validateRandomRules(props.modelValue, props.totalScore));
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
.random-paper-rules__table td:last-child { white-space:nowrap; }
.random-paper-rules__hint { color:var(--el-text-color-secondary); font-size:12px; line-height:1.6; margin:6px 0; }
.random-paper-rules__summary { margin-top:10px; }
.random-paper-rules__error { color:var(--el-color-danger); font-size:12px; }
</style>
