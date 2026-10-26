import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import QuestionPreview from '../QuestionPreview.vue';

const wrappers: VueWrapper[] = [];

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

function question(overrides: Record<string, unknown> = {}) {
  return {
    type: 'multiple' as const,
    difficulty: 'easy',
    stem: '<p>以下哪些属于作业前检查？</p>',
    options: [
      { key: 'stable-a', text: '<p>检查设备</p>' },
      { key: 'stable-b', text: '<p>直接开工</p>' },
      { key: 'stable-c', text: '<p>确认防护</p>' },
    ],
    answer: [0, 2],
    analysis: '',
    ...overrides,
  };
}

async function render(props: Record<string, unknown> = {}) {
  const wrapper = mount(QuestionPreview, {
    props: { question: question(), ...props } as never,
    global: { plugins: [ElementPlus] },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

describe('question library lightweight preview', () => {
  it('renders borderless lettered options without question metadata', async () => {
    const wrapper = await render({ variant: 'library' });

    expect(wrapper.classes()).toContain('question-preview--library');
    expect(wrapper.find('.question-preview__meta').exists()).toBe(false);
    expect(wrapper.findAll('.question-preview__option')).toHaveLength(3);
    expect(wrapper.findAll('.question-preview__key').map((node) => node.text())).toEqual(['A.', 'B.', 'C.']);
    expect(wrapper.findAll('.question-preview__option .el-tag')).toHaveLength(0);
  });

  it('lists every correct option on its own line using display letters and option content', async () => {
    const wrapper = await render({ variant: 'library' });

    const answers = wrapper.findAll('.question-preview__correct-option');
    expect(answers).toHaveLength(2);
    expect(answers.map((node) => node.text().replace(/\s+/g, ' ').trim())).toEqual([
      'A · 检查设备',
      'C · 确认防护',
    ]);
  });

  it('keeps the answer area complete when a question has no analysis', async () => {
    const wrapper = await render({ variant: 'library' });

    expect(wrapper.get('.question-preview__result').text()).toContain('正确答案');
    expect(wrapper.get('.question-preview__analysis-content').text()).toBe('暂无解析');
  });

  it('keeps the existing card presentation as the default for other consumers', async () => {
    const wrapper = await render();

    expect(wrapper.classes()).not.toContain('question-preview--library');
    expect(wrapper.find('.question-preview__meta').exists()).toBe(true);
    expect(wrapper.findAll('.question-preview__option .el-tag')).toHaveLength(2);
    expect(wrapper.find('.question-preview__result').exists()).toBe(false);
  });
});
