import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElSelect, ElSwitch } from 'element-plus';
import PaperProperties from '../PaperProperties.vue';

let wrapper: VueWrapper;
afterEach(() => wrapper?.unmount());
describe('paper settings sidebar', () => {
  it('edits a configurable total without a duplicate allocation line or changing the pass score', async () => {
    wrapper = mount(PaperProperties, { props: { modelValue: { id: '2', title: '试卷', total_score: 120, pass_score: 72 } }, global: { plugins: [ElementPlus] } });
    expect((wrapper.get('input[aria-label="试卷总分"]').element as HTMLInputElement).value).toBe('120');
    expect(wrapper.get('input[aria-label="及格分数"]').attributes('max')).toBe('120');
    expect(wrapper.text()).not.toContain('已分配');
    await wrapper.get('input[aria-label="试卷总分"]').setValue('150');
    expect(wrapper.emitted('change')?.at(-1)).toEqual([{ total_score: 150 }]);
    expect((wrapper.get('input[aria-label="及格分数"]').element as HTMLInputElement).value).toBe('72');
  });

  it('shows no stale learning values while the requirement is off, but retains enabled readonly values', async () => {
    const modelValue = { id: '2', title: '试卷', requires_learning: false, course_ids: ['41'], required_learning_minutes: 30 };
    wrapper = mount(PaperProperties, { props: { modelValue, readonly: true }, global: { plugins: [ElementPlus] } });
    const courses = () => wrapper.findAllComponents(ElSelect).find(item => item.props('ariaLabel') === '试卷关联课程')!;
    expect(courses().props('modelValue')).toEqual([]);
    expect(wrapper.findAll('.el-select__tags-text')).toHaveLength(0);
    expect((wrapper.get('input[aria-label="累计学习时长（分钟）"]').element as HTMLInputElement).value).toBe('');
    expect(wrapper.emitted('change')).toBeUndefined();
    await wrapper.setProps({ modelValue: { ...modelValue, requires_learning: true } });
    expect(courses().props('modelValue')).toEqual(['41']);
    expect(courses().props('disabled')).toBe(true);
    expect((wrapper.get('input[aria-label="累计学习时长（分钟）"]').element as HTMLInputElement).value).toBe('30');
  });

  it('keeps learning fields visible but disabled until enabled and rejects queued disabled edits', async () => {
    wrapper = mount(PaperProperties, { props: { modelValue: { id: '2', title: '试卷', requires_learning: false } }, global: { plugins: [ElementPlus] } });
    const courses = () => wrapper.findAllComponents(ElSelect).find(item => item.props('ariaLabel') === '试卷关联课程')!;
    expect(courses()).toBeDefined();
    expect(courses().props('disabled')).toBe(true);
    expect(wrapper.get('input[aria-label="累计学习时长（分钟）"]').attributes('disabled')).toBeDefined();
    courses().vm.$emit('update:modelValue', ['41']);
    expect(wrapper.emitted('change')).toBeUndefined();
    wrapper.getComponent(ElSwitch).vm.$emit('update:modelValue', true);
    expect(wrapper.emitted('change')?.at(-1)).toEqual([{ requires_learning: true }]);
    await wrapper.setProps({ modelValue: { id: '2', title: '试卷', requires_learning: true } });
    expect(courses().props('disabled')).toBe(false);
    await wrapper.get('input[aria-label="累计学习时长（分钟）"]').setValue('45');
    expect(wrapper.emitted('change')?.at(-1)).toEqual([{ required_learning_minutes: 45 }]);
    await wrapper.get('input[aria-label="试卷排序"]').setValue('8');
    expect(wrapper.emitted('change')?.at(-1)).toEqual([{ sort_order: 8 }]);
  });
});
