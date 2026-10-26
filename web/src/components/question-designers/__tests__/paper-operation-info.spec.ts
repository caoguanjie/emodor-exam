import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PaperOperationInfo from '../PaperOperationInfo.vue';
describe('paper operation information', () => {
  it('shows readonly authoritative names and formatted dates', () => {
    const wrapper = mount(PaperOperationInfo, { props: { paper: { id:'2',title:'试卷',created_by_name:'张三',updated_by_name:'李四',created_at:'2025-07-21T16:45:00',updated_at:'2025-07-22T17:30:00' } } });
    expect(wrapper.findAll('dt').map(x=>x.text())).toEqual(['创建人','创建时间','更新人','更新时间']);
    expect(wrapper.findAll('dd').map(x=>x.text())).toEqual(['张三','2025-07-21 16:45','李四','2025-07-22 17:30']);
    expect(wrapper.find('input').exists()).toBe(false);
    wrapper.unmount();
  });
  it('does not invent people or timestamps before save', () => {
    const wrapper = mount(PaperOperationInfo, { props: { paper:{id:'new',title:''} } });
    expect(wrapper.findAll('dd').map(x=>x.text())).toEqual(['—','尚未保存','—','尚未保存']);
    wrapper.unmount();
  });
});
