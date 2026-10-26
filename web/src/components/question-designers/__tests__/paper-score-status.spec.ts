import { afterEach, describe, expect, it } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import PaperScoreStatus from '../PaperScoreStatus.vue';
const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));
describe('paper score status button', () => {
  it('shows allocation states and opens a configuration action without changing scores', async () => {
    const wrapper = mount(PaperScoreStatus, { props: { totalScore: 123, allocatedScoreCents: 11000 }, global: { plugins: [ElementPlus] } });
    wrappers.push(wrapper);
    expect(wrapper.get('button').text()).toContain('已配 110 / 总分 123');
    expect(wrapper.get('button').classes()).toContain('el-button--warning');
    await wrapper.get('button').trigger('click'); await flushPromises();
    expect(document.body.textContent).toContain('还差');
    expect(document.body.textContent).toContain('13 分');
    const configure = document.body.querySelector<HTMLButtonElement>('[aria-label="设置试卷总分"]');
    configure!.click(); await flushPromises();
    expect(wrapper.emitted('configure')).toHaveLength(1);
    await wrapper.setProps({ allocatedScoreCents: 12300 });
    expect(wrapper.get('button').classes()).toContain('el-button--success');
    await wrapper.setProps({ allocatedScoreCents: 13000 });
    expect(wrapper.get('button').classes()).toContain('el-button--danger');
    await wrapper.setProps({ totalScore: Number.NaN });
    expect(wrapper.get('button').text()).toContain('总分 —');
  });
});
