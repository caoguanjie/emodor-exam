import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import type { PaperRuleInput } from '../../../api/training-types';
import RandomPaperRules from '../../RandomPaperRules.vue';
import { defaultRandomRules, selectedRandomRules, summarizeRandomRules, validateRandomRules } from '../../../utils/random-paper-rules';

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));
const eighty: PaperRuleInput[] = [
  { type: 'single', count: 60, score_cents: 100 }, { type: 'multiple', count: 10, score_cents: 300 }, { type: 'judgment', count: 10, score_cents: 100 },
];
describe('random paper rule configuration', () => {
  it('starts with 100 single choice questions worth 100 points and omits unused question types from the payload', () => {
    const rules = defaultRandomRules();
    expect(summarizeRandomRules(rules)).toEqual({ count: 100, scoreCents: 10000 });
    expect(validateRandomRules(rules, 100)).toBeNull();
    expect(selectedRandomRules(rules)).toEqual([{ type: 'single', count: 100, score_cents: 100 }]);
    rules[0].count = 1;
    expect(summarizeRandomRules(defaultRandomRules())).toEqual({ count: 100, scoreCents: 10000 });
  });
  it('allows an 80 question distribution worth exactly 100 points', () => {
    expect(summarizeRandomRules(eighty)).toEqual({ count: 80, scoreCents: 10000 });
    expect(validateRandomRules(eighty, 100)).toBeNull();
    expect(validateRandomRules(eighty, 99)).toEqual(expect.any(String));
  });
  it('handles two decimal scores as integer cents', () => {
    expect(validateRandomRules([{ type: 'single', count: 3, score_cents: 10 }], .3)).toBeNull();
    expect(validateRandomRules([{ type: 'judgment', count: 1, score_cents: 99999 }], 999.99)).toBeNull();
  });
  it.each([
    [], [{ type: 'single', count: 0, score_cents: 100 }], [{ type: 'single', count: -1, score_cents: 100 }],
    [{ type: 'single', count: 501, score_cents: 100 }], [{ type: 'single', count: 1.5, score_cents: 100 }],
    [{ type: 'single', count: 1, score_cents: 0 }], [{ type: 'single', count: 1, score_cents: 100.1 }],
    [{ type: 'single', count: 1, score_cents: Infinity }], [{ type: 'essay', count: 1, score_cents: 100 }],
    [{ type: 'single', count: 1, score_cents: 50 }, { type: 'single', count: 1, score_cents: 50 }],
  ].map(rules => ({ rules })))('rejects invalid rules %j', ({ rules }) => {
    expect(validateRandomRules(rules as PaperRuleInput[], 1)).toEqual(expect.any(String));
  });
  it.each([0, -1, 1000, 1.001, NaN, Infinity])('rejects an invalid total %s', total => {
    expect(validateRandomRules(defaultRandomRules(), total)).toEqual(expect.any(String));
  });
  it('updates counts and per-question scores through the real inputs and displays the derived total', async () => {
    const rules = ref(defaultRandomRules());
    const wrapper = mount(defineComponent({ setup: () => () => h(RandomPaperRules, {
      modelValue: rules.value, totalScore: 100, 'onUpdate:modelValue': (value: PaperRuleInput[]) => { rules.value = value; },
    }) }), { global: { plugins: [ElementPlus] } }); wrappers.push(wrapper);
    await wrapper.get('[data-rule-type="single"] input[data-field="count"]').setValue('60');
    await wrapper.get('[data-rule-type="multiple"] input[data-field="count"]').setValue('10');
    await wrapper.get('[data-rule-type="multiple"] input[data-field="score"]').setValue('3');
    await wrapper.get('[data-rule-type="judgment"] input[data-field="count"]').setValue('10');
    expect(selectedRandomRules(rules.value)).toEqual(eighty);
    expect(wrapper.get('[data-testid="random-rule-summary"]').text()).toContain('80 道');
    expect(wrapper.get('[data-testid="random-rule-summary"]').text()).toContain('100 分');
    expect(wrapper.text()).toContain('本机构：简单题；外来人员：困难题');
    await wrapper.get('[data-rule-type="single"] input[data-field="count"]').setValue('59');
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    await wrapper.get('[data-rule-type="single"] input[data-field="score"]').setValue('1.001');
    expect(validateRandomRules(rules.value, 100)).toEqual(expect.any(String));
  });
});
