import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import QuestionEditor from '../QuestionEditor.vue';
import QuestionPreview from '../QuestionPreview.vue';
import { questionDraftFromView, questionDraftWithContent } from '../../api/training-types';

const Container = defineComponent({ setup(_props, { slots }) { return () => h('div', slots.default?.()); } });
const Button = defineComponent({ setup(_props, { attrs, slots }) { return () => h('button', attrs, slots.default?.()); } });
const Option = defineComponent({ setup(_props, { attrs }) { return () => h('option', attrs); } });
const stubs = { ElForm: Container, ElFormItem: Container, ElSelect: Container, ElOption: Option, ElInput: true,
  ElInputNumber: true, ElCheckbox: true, ElButton: Button, ElText: Container, ElRadio: true, ElRadioGroup: true, MediaUpload: true };

describe('existing QuestionEditor compatibility', () => {
  it.each([9, 10])('previews the server-valid indent %s and a zero-width table column', async (indent) => {
    const doc = (text: string) => ({ type: 'doc' as const, content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }] });
    const wrapper = mount(QuestionPreview, { props: { question: { type: 'single', content_schema_version: 3,
      content_json: { stem: { type: 'doc', content: [
        { type: 'paragraph', attrs: { indent }, content: [{ type: 'text', text: '合法缩进' }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [0], align: null }, content: doc('零宽列').content }] }] },
      ] }, options: [{ id: 'A', content: doc('甲') }, { id: 'B', content: doc('乙') }], analysis: null, answer_option_ids: ['A'] } } },
      global: { stubs: { ElTag: Container } } });
    await flushPromises();
    expect(wrapper.text()).toContain('合法缩进');
    expect(wrapper.text()).toContain('零宽列');
    expect(wrapper.find('td').attributes('data-colwidth')).toBe('0');
    expect(wrapper.emitted('ready')!.at(-1)).toEqual([{ ok: true }]);
    wrapper.unmount();
  });

  it('applies validated non-equal schema 3 table column widths in the preview DOM', async () => {
    const paragraph = (text: string) => ({ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] });
    const doc = (text: string) => ({ type: 'doc' as const, content: [paragraph(text)] });
    const wrapper = mount(QuestionPreview, { props: { question: { type: 'single', content_schema_version: 3,
      content_json: { stem: { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [80], align: 'left' }, content: [paragraph('窄列')] },
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [120], align: 'right' }, content: [paragraph('宽列')] },
      ] }] }] }, options: [{ id: 'A', content: doc('甲') }, { id: 'B', content: doc('乙') }], analysis: null, answer_option_ids: ['A'] } } },
      global: { stubs: { ElTag: Container } } });
    await flushPromises();
    const cells = wrapper.findAll('td');
    expect(cells.map((cell) => cell.attributes('style'))).toEqual(['text-align:left;width:80px', 'text-align:right;width:120px']);
    wrapper.unmount();
  });
  // Old clone strips schema 3; a subsequent answer change must not erase canonical content.
  it('emits ordinary form edits with unchanged stable IDs and immutable canonical content', async () => {
    const content = { stem: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '题干', marks: [{ type: 'bold' }] }] }] },
      options: ['A', 'B'].map((id) => ({ id, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }] } })),
      analysis: null, answer_option_ids: ['A'] };
    const value = { category_id: '7', difficulty: 'easy', type: 'single', score: 5,
      stem: '<h2><strong>题干</strong></h2>', options: [{ key: 'A', text: '<p>A</p>' }, { key: 'B', text: '<p>B</p>' }], answer: [0], analysis: null,
      content_schema_version: 3, content_json: content } as any;
    const wrapper = mount(QuestionEditor, { props: { modelValue: value, difficultyOptions: [{ value: 'easy', label: '简单' }, { value: 'hard', label: '困难' }] } as any,
      global: { stubs } });
    await nextTick();
    const down = wrapper.findAll('button').find((button) => button.text() === '下移');
    await down!.trigger('click');
    const changed = wrapper.emitted('update:modelValue')!.at(-1)![0] as any;
    expect(changed.content_schema_version).toBe(3);
    expect(changed.content_json).toEqual(content);
    expect(changed.options.map((option: any) => option.key)).toEqual(['B', 'A']);
    expect(changed.answer).toEqual([1]);
    wrapper.unmount();
  });

  it('shows only server-enabled new difficulty choices while retaining a disabled historic value', () => {
    const wrapper = mount(QuestionEditor, { props: { modelValue: { category_id: '7', difficulty: 'medium', type: 'single', score: 5,
      stem: '题干', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [0], analysis: null },
      difficultyOptions: [{ value: 'easy', label: '简单' }, { value: 'hard', label: '困难' }] } as any,
      global: { stubs } });
    const options = wrapper.findAll('option').filter((option) => ['easy', 'medium', 'hard'].includes(option.attributes('value') || ''));
    expect(options.map((option) => [option.attributes('value'), option.attributes('label'), option.attributes('disabled')])).toEqual([
      ['medium', '中级（历史，当前停用）', ''], ['easy', '简单', undefined], ['hard', '困难', undefined],
    ]);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    wrapper.unmount();
  });

  it('previews schema 3 frozen rich nodes instead of the legacy HTML projection', async () => {
    const wrapper = mount(QuestionPreview, { props: { question: { type: 'single', difficulty: 'hard', stem: '过期题干', options: [], answer: [], score: 5,
      content_schema_version: 3, content_json: { stem: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '冻结富题干', marks: [{ type: 'bold' }] }] }] },
        options: [{ id: 'A', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '答案' }] }] } },
          { id: 'B', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '干扰项' }] }] } }],
        analysis: null, answer_option_ids: ['A'] } } }, global: { stubs: { ElTag: Container } } });
    await flushPromises();
    expect(wrapper.find('h2 strong').text()).toBe('冻结富题干');
    expect(wrapper.text()).toContain('困难');
    expect(wrapper.text()).toContain('正确答案');
    expect(wrapper.text()).not.toContain('过期题干');
    wrapper.unmount();
  });

  it('renders an answer-free schema 3 paper preview without exposing the correct option', async () => {
    const doc = (text: string) => ({ type: 'doc' as const, content: [{ type: 'paragraph' as const, attrs: { indent: 10 }, content: [{ type: 'text' as const, text, marks: [{ type: 'bold' as const }] }] }] });
    const wrapper = mount(QuestionPreview, { props: { revealAnswer: false, question: {
      type: 'single', difficulty: 'easy', score: 5, content_schema_version: 3,
      content_json: { stem: doc('安全预览题干'), options: [{ id: 'A', content: doc('选项甲') }, { id: 'B', content: doc('选项乙') }] },
    } as any }, global: { stubs: { ElTag: Container } } });
    await flushPromises();
    expect(wrapper.text()).toContain('安全预览题干');
    expect(wrapper.findAll('strong').some((node) => node.text() === '安全预览题干')).toBe(true);
    expect(wrapper.text()).not.toContain('正确答案');
    expect(wrapper.text()).not.toContain('题目内容格式不正确');
    expect(wrapper.emitted('ready')!.at(-1)).toEqual([{ ok: true }]);
    wrapper.unmount();
  });

  it('inserts an uploaded controlled asset through the existing form action and reopens the saved schema 3', async () => {
    const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
    const value = questionDraftFromView({ category_id: '7', difficulty: 'easy', type: 'single', score: 5,
      stem: '', options: [], answer: [], analysis: null, content_schema_version: 3,
      content_json: { stem: doc('普通题干'), options: [{ id: 'A', content: doc('甲') }, { id: 'B', content: doc('乙') }], analysis: null, answer_option_ids: ['A'] } } as any);
    const wrapper = mount(QuestionEditor, { props: { modelValue: value, canUploadMedia: true,
      difficultyOptions: [{ value: 'easy', label: '简单' }] }, global: { stubs } });
    wrapper.findComponent({ name: 'MediaUpload' }).vm.$emit('update:modelValue', '44');
    await nextTick();
    await wrapper.findAll('button').find((button) => button.text() === '插入题干')!.trigger('click');
    const changed = wrapper.emitted('update:modelValue')!.at(-1)![0] as typeof value;
    const saved = questionDraftWithContent(changed);
    expect(saved.content_schema_version).toBe(3);
    expect(saved.content_json.stem.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: '普通题干' }] },
      { type: 'paragraph', content: [{ type: 'image', attrs: { asset_id: '44' } }] },
    ]);
    expect(questionDraftFromView(saved).stem).toBe('<p>普通题干</p><p><img data-media-id="44"></p>');
    wrapper.unmount();
  });
});
