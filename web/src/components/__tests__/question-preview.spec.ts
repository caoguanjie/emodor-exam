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

describe('paper question preview', () => {
  it('renders a numbered Word-style question without metadata, cards, or answer leakage', async () => {
    const wrapper = await render({
      variant: 'paper',
      questionNumber: 1,
      revealAnswer: false,
      showScore: true,
      question: question({ analysis: '<p>仅答案版可见的解析</p>' }),
    });

    expect(wrapper.classes()).toContain('question-preview--paper');
    expect(wrapper.find('.question-preview__meta').exists()).toBe(false);
    expect(wrapper.get('.question-preview__paper-number').text()).toBe('1、');
    expect(wrapper.get('.question-preview__paper-stem').text()).toContain('1、以下哪些属于作业前检查？');
    expect(wrapper.findAll('.question-preview__key').map((node) => node.text())).toEqual(['A、', 'B、', 'C、']);
    expect(wrapper.findAll('.question-preview__option .el-tag')).toHaveLength(0);
    expect(wrapper.find('.question-preview__paper-result').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('仅答案版可见的解析');
  });

  it('keeps the paper stem as ordinary text while preserving explicit rich-text font choices', async () => {
    const richDoc = (text: string) => ({ type: 'doc' as const, content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }] });
    const wrapper = await render({
      variant: 'paper',
      questionNumber: 2,
      revealAnswer: false,
      question: {
        type: 'single',
        content_schema_version: 3,
        content_json: {
          stem: { type: 'doc', content: [{ type: 'paragraph', content: [
            { type: 'text', text: '默认正文' },
            { type: 'text', text: '局部格式', marks: [{ type: 'textStyle', attrs: { fontFamily: 'SimHei', fontSize: '18px' } }] },
          ] }] },
          options: [{ id: 'stable-a', content: richDoc('检查设备') }, { id: 'stable-b', content: richDoc('直接开工') }],
        },
      },
    });

    const stem = wrapper.get('.question-preview__paper-stem');
    const inline = stem.get('span[style]');
    expect(stem.find('strong').exists()).toBe(false);
    expect(inline.attributes('style')).toContain('font-family:SimHei');
    expect(inline.attributes('style')).toContain('font-size:18px');
  });

  it('shows compact correct-answer and analysis text only when explicitly requested', async () => {
    const wrapper = await render({
      variant: 'paper',
      questionNumber: 3,
      revealAnswer: false,
      question: question({ analysis: '<p>作业前应先完成设备与防护检查。</p>' }),
    });

    expect(wrapper.find('.question-preview__paper-result').exists()).toBe(false);
    await wrapper.setProps({ revealAnswer: true });
    await flushPromises();

    const result = wrapper.get('.question-preview__paper-result');
    expect(result.text().replace(/\s+/g, ' ').trim()).toContain('正确答案：A、C');
    expect(result.text()).toContain('解析：');
    expect(result.text()).toContain('作业前应先完成设备与防护检查。');
    expect(wrapper.findAll('.question-preview__option .el-tag')).toHaveLength(0);
  });
});

describe('saved answer feedback', () => {
  it.each([
    { name: 'all correct', selected: ['stable-a', 'stable-c'], states: ['correct', '', 'correct'], missed: false },
    { name: 'wrong selection', selected: ['stable-b'], states: ['correct', 'wrong', 'correct'], missed: false },
    { name: 'partial correct selection', selected: ['stable-a'], states: ['correct', '', 'missed'], missed: true },
    { name: 'unanswered', selected: [], states: ['', '', ''], missed: false },
  ])('$name uses only the agreed option colors', async ({ selected, states, missed }) => {
    const wrapper = await render({ variant: 'paper', showAnswerFeedback: true, selectedOptionIds: selected });
    const options = wrapper.findAll('.question-preview__option');
    expect(options.map(option => ['correct','wrong','missed'].find(state => option.classes().includes(`is-${state}`)) || '')).toEqual(states);
    expect(wrapper.find('.question-preview__missed').exists()).toBe(missed);
    expect(wrapper.text()).not.toContain('正确答案：');
    expect(wrapper.text()).not.toContain('学员答案：');
    expect(wrapper.text()).toContain('解析：');
  });
  it('updates feedback when moving to an unanswered question and respects hidden answers', async () => {
    const wrapper = await render({ variant: 'paper', showAnswerFeedback: true, selectedOptionIds: ['stable-b'] });
    expect(wrapper.find('.is-wrong').exists()).toBe(true);
    await wrapper.setProps({ selectedOptionIds: [] });
    expect(wrapper.find('.is-wrong, .is-correct, .is-missed').exists()).toBe(false);
    await wrapper.setProps({ selectedOptionIds: ['stable-b'], revealAnswer: false });
    await flushPromises();
    expect(wrapper.find('.is-wrong, .is-correct, .is-missed').exists()).toBe(false);
  });
});
