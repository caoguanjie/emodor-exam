import type { JSONContent } from '@tiptap/core';
import { Editor, type NodeViewRendererProps } from '@tiptap/vue-3';
import { mount, shallowMount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { defineComponent, h, nextTick, reactive } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WidgetSetting from '../components/WidgetSetting.vue';
import DateInput from '../widget/DateInput.vue';
import { ControlType, type OptionType } from '../type';
import { createExtensions } from '../utils/createExtensions';
import { CONTROLLED_UPDATE_META } from '../utils/widgetNodeViewRegistry';

const editors: Editor[] = [];
const wrappers: VueWrapper[] = [];

type SerializedNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: SerializedNode[];
  text?: string;
};

function asQuestionDocument(content: JSONContent): JSONContent {
  if (content.content?.[0]?.type === 'questionBlock') return content;
  return {
    type: 'doc',
    content: [{
      type: 'questionBlock',
      attrs: { client_id: 'widget-regression-question' },
      content: [{
        type: 'questionStem',
        content: content.content?.length ? content.content : [{ type: 'paragraph' }],
      }],
    }],
  };
}

function createQuestionEditor(content?: JSONContent) {
  const editor = new Editor({
    content: asQuestionDocument(content ?? { type: 'doc', content: [{ type: 'paragraph' }] }),
    extensions: createExtensions('question'),
  });
  editors.push(editor);
  return editor;
}

function getParagraphContent(editor: Editor): SerializedNode[] {
  let result: SerializedNode[] = [];
  const visit = (node: SerializedNode) => {
    if (!result.length && node.type === 'paragraph') result = node.content ?? [];
    else node.content?.forEach(visit);
  };
  visit(editor.getJSON() as unknown as SerializedNode);
  return result;
}

function getWidgetPosition(editor: Editor, id: string): number {
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'widgetField' && node.attrs.id === id) position = pos;
  });
  expect(position).toBeGreaterThanOrEqual(0);
  return position;
}

function widget(id: string, type: ControlType, text: string, value = text): JSONContent {
  return {
    type: 'widgetField',
    attrs: { id, type, value },
    content: text ? [{ type: 'text', text }] : undefined,
  };
}

const DatePickerStub = defineComponent({
  name: 'DatePicker',
  props: {
    value: { default: null },
    open: { type: Boolean, default: false },
    format: { type: String, default: '' },
    type: { type: String, default: '' },
  },
  emits: ['update:value', 'update:open'],
  setup(props, { slots }) {
    return () => h('div', {
      'data-test': 'date-picker',
      'data-value': props.value ?? '',
      'data-format': props.format,
      'data-type': props.type,
    }, [slots.input?.(), slots.footer?.()]);
  },
});

function mountDateInput(text: string, format: string) {
  const node = reactive({
    textContent: text,
    attrs: { id: 'date-widget-000000001', dateFormat: format },
  });
  const insertFieldText = vi.fn((_id: string, value: string | OptionType | OptionType[]) => {
    if (typeof value === 'string') node.textContent = value;
    return true;
  });
  const wrapper = shallowMount(DateInput, {
    props: {
      nodeViewProps: {
        node,
        editor: { isEditable: true, commands: { insertFieldText } },
      } as unknown as NodeViewRendererProps,
    },
    global: {
      stubs: {
        Gt: DatePickerStub,
        NodeViewContent: { template: '<span />' },
      },
    },
  });
  wrappers.push(wrapper);
  return { insertFieldText, node, wrapper };
}

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  editors.splice(0).forEach((editor) => editor.destroy());
  vi.restoreAllMocks();
});

describe('widget regressions', () => {
  it('updates the requested widget id instead of the widget under the current selection', () => {
    const firstId = 'first-widget-00000000001';
    const secondId = 'second-widget-0000000001';
    const editor = createQuestionEditor({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { ...widget(firstId, ControlType.text, '甲'), attrs: { id: firstId, type: ControlType.text, value: '甲', placeholder: '甲提示' } },
          { type: 'text', text: '相邻正文' },
          { ...widget(secondId, ControlType.text, '乙'), attrs: { id: secondId, type: ControlType.text, value: '乙', placeholder: '乙提示' } },
        ],
      }],
    });
    editor.commands.setTextSelection(getWidgetPosition(editor, secondId) + 1);

    expect(editor.commands.updateField(firstId, { id: firstId, placeholder: '甲已更新' })).toBe(true);

    const content = getParagraphContent(editor);
    const fields = content.filter((node) => node.type === 'widgetField');
    expect(fields.map((node) => [node.attrs?.id, node.attrs?.placeholder])).toEqual([
      [firstId, '甲已更新'],
      [secondId, '乙提示'],
    ]);
    expect(content.find((node) => node.type === 'text')?.text).toBe('相邻正文');
  });

  it('rejects identity overrides and missing or duplicate widget ids without changing content', () => {
    const firstId = 'identity-widget-00000001';
    const secondId = 'other-widget-00000000001';
    const editor = createQuestionEditor({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          widget(firstId, ControlType.text, '甲'),
          { type: 'text', text: '正文' },
          widget(secondId, ControlType.text, '乙'),
        ],
      }],
    });
    editor.commands.setTextSelection(getWidgetPosition(editor, firstId) + 1);
    const before = editor.getJSON();

    expect(editor.commands.updateField(firstId, { id: secondId, placeholder: '越权身份' })).toBe(false);
    expect(editor.commands.updateField('missing-widget-00000001', { placeholder: '不存在' })).toBe(false);
    expect(editor.getJSON()).toEqual(before);

    const duplicate = createQuestionEditor({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          widget(firstId, ControlType.text, '甲'),
          { type: 'text', text: '正文' },
          widget(firstId, ControlType.text, '乙'),
        ],
      }],
    });
    duplicate.commands.setTextSelection(getWidgetPosition(duplicate, firstId) + 1);
    const duplicateBefore = duplicate.getJSON();
    expect(duplicate.commands.updateField(firstId, { placeholder: '不能批量改' })).toBe(false);
    expect(duplicate.getJSON()).toEqual(duplicateBefore);
  });

  it('cancels an attribute-panel draft when selection moves from widget A to widget B', async () => {
    vi.useFakeTimers();
    const firstId = 'panel-first-widget-000001';
    const secondId = 'panel-second-widget-00001';
    const editor = createQuestionEditor({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { ...widget(firstId, ControlType.text, '甲'), attrs: { id: firstId, type: ControlType.text, value: '甲', placeholder: '甲提示' } },
          { type: 'text', text: '相邻正文' },
          { ...widget(secondId, ControlType.text, '乙'), attrs: { id: secondId, type: ControlType.text, value: '乙', placeholder: '乙提示' } },
        ],
      }],
    });
    const wrapper = mount(WidgetSetting, {
      props: { editor },
      global: { plugins: [ElementPlus] },
    });
    wrappers.push(wrapper);

    editor.commands.setTextSelection(getWidgetPosition(editor, firstId) + 1);
    vi.advanceTimersByTime(320);
    await nextTick();
    const placeholderItem = wrapper.findAll('.el-form-item')
      .find((item) => item.text().includes('提示文字'));
    expect(placeholderItem).toBeDefined();
    await placeholderItem!.get('input').setValue('甲待提交');

    editor.commands.setTextSelection(getWidgetPosition(editor, secondId) + 1);
    vi.advanceTimersByTime(320);
    await nextTick();

    const content = getParagraphContent(editor);
    const fields = content.filter((node) => node.type === 'widgetField');
    expect(fields.map((node) => [node.attrs?.id, node.attrs?.placeholder])).toEqual([
      [firstId, '甲提示'],
      [secondId, '乙提示'],
    ]);
    expect(content.find((node) => node.type === 'text')?.text).toBe('相邻正文');
  });

  it('cancels an attribute-panel draft when a controlled refill keeps the same widget selected', async () => {
    vi.useFakeTimers();
    const id = 'panel-refill-widget-000001';
    const editor = createQuestionEditor({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          ...widget(id, ControlType.text, '正文'),
          attrs: { id, type: ControlType.text, value: '正文', placeholder: '原提示' },
        }],
      }],
    });
    const wrapper = mount(WidgetSetting, {
      props: { editor },
      global: { plugins: [ElementPlus] },
    });
    wrappers.push(wrapper);

    const position = getWidgetPosition(editor, id);
    editor.commands.setTextSelection(position + 1);
    vi.advanceTimersByTime(320);
    await nextTick();
    const placeholderItem = wrapper.findAll('.el-form-item')
      .find((item) => item.text().includes('提示文字'));
    expect(placeholderItem).toBeDefined();
    await placeholderItem!.get('input').setValue('本地待提交');

    const node = editor.state.doc.nodeAt(position)!;
    editor.view.dispatch(editor.state.tr
      .setNodeMarkup(position, undefined, { ...node.attrs, placeholder: '服务端回填' })
      .setMeta(CONTROLLED_UPDATE_META, true));
    vi.advanceTimersByTime(320);
    await nextTick();

    const field = getParagraphContent(editor).find((item) => item.type === 'widgetField');
    expect(field?.attrs?.id).toBe(id);
    expect(field?.attrs?.placeholder).toBe('服务端回填');
    expect(field?.content?.[0]?.text).toBe('正文');
  });

  it('normalizes multiple number widgets in one transaction without damaging intervening text', () => {
    const editor = createQuestionEditor();

    editor.commands.setContent(asQuestionDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          widget('number-widget-0000001', ControlType.inputNumber, '1a'),
          { type: 'text', text: '中间正文' },
          widget('number-widget-0000002', ControlType.inputNumber, '2b'),
        ],
      }],
    }));

    const content = getParagraphContent(editor);
    const numbers = content.filter((node) => node.type === 'widgetField');
    expect(numbers.map((node) => node.content?.[0]?.text ?? '')).toEqual(['1', '2']);
    expect(numbers.map((node) => node.attrs?.value)).toEqual(['1', '2']);
    expect(content.find((node) => node.type === 'text')?.text).toBe('中间正文');
  });

  it('keeps cleared dates and multi-select display text aligned with stored values', () => {
    const editor = createQuestionEditor({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          widget('date-widget-000000001', ControlType.date, '2026-10-22'),
          { type: 'text', text: '|' },
          widget('multi-widget-00000001', ControlType.checkbox, '旧选项', 'old'),
        ],
      }],
    });

    expect(editor.commands.insertFieldText('date-widget-000000001', '')).toBe(true);
    expect(editor.commands.insertFieldText('multi-widget-00000001', [
      { label: '人员一', value: 'staff_1' },
      { label: '人员二', value: 'staff_2' },
    ])).toBe(true);

    let fields = getParagraphContent(editor)
      .filter((node) => node.type === 'widgetField');
    expect(fields[0].content).toBeUndefined();
    expect(fields[0].attrs?.value).toBe('');
    expect(fields[1].content?.[0]?.text).toBe('人员一,人员二');
    expect(fields[1].attrs?.value).toBe('staff_1,staff_2');

    const reloaded = createQuestionEditor(editor.getJSON());
    fields = getParagraphContent(reloaded)
      .filter((node) => node.type === 'widgetField');
    expect(fields[1].content?.[0]?.text).toBe('人员一,人员二');
    expect(fields[1].attrs?.value).toBe('staff_1,staff_2');

    expect(reloaded.commands.insertFieldText('multi-widget-00000001', [])).toBe(true);
    fields = getParagraphContent(reloaded)
      .filter((node) => node.type === 'widgetField');
    expect(fields[1].content).toBeUndefined();
    expect(fields[1].attrs?.value).toBe('');
  });
});

const formatCases = [
  ['YYYY-MM-DD', '2026-10-22', 'DD/MM/YYYY', '22/10/2026'],
  ['YYYY/MM/DD', '2026/10/22', 'MM/DD/YYYY', '10/22/2026'],
  ['MM/DD/YYYY', '10/22/2026', 'DD-MM-YYYY', '22-10-2026'],
  ['DD-MM-YYYY', '22-10-2026', 'YYYY/MM/DD', '2026/10/22'],
  ['DD/MM/YYYY', '05/10/2026', 'YYYY-MM-DD', '2026-10-05'],
  ['YYYY-MM', '2026-10', 'MM/YYYY', '10/2026'],
  ['YYYY/MM', '2026/10', 'MM-YYYY', '10-2026'],
  ['MM-YYYY', '10-2026', 'YYYY/MM', '2026/10'],
  ['MM/YYYY', '10/2026', 'YYYY-MM', '2026-10'],
  ['YYYY-MM-DD HH:mm:ss', '2026-10-22 09:08:07', 'YYYY/MM/DD HH:mm:ss', '2026/10/22 09:08:07'],
  ['YYYY/MM/DD HH:mm:ss', '2026/10/22 09:08:07', 'YYYY-MM-DD HH:mm:ss', '2026-10-22 09:08:07'],
  ['YYYY-MM-DD HH:mm', '2026-10-22 09:08', 'YYYY/MM/DD HH:mm', '2026/10/22 09:08'],
  ['YYYY/MM/DD HH:mm', '2026/10/22 09:08', 'YYYY-MM-DD HH:mm', '2026-10-22 09:08'],
] as const;

describe('DateInput strict formats', () => {
  it.each(formatCases)(
    'round-trips %s and converts it from the declared old format',
    async (format, text, nextFormat, expected) => {
      const mounted = mountDateInput(text, format);

      expect(mounted.wrapper.get('[data-test="date-picker"]').attributes('data-value')).toBe(text);

      mounted.node.attrs.dateFormat = nextFormat;
      await nextTick();
      await nextTick();
      await nextTick();

      expect(mounted.insertFieldText).toHaveBeenCalledTimes(1);
      expect(mounted.insertFieldText).toHaveBeenCalledWith('date-widget-000000001', expected);
      expect(mounted.wrapper.get('[data-test="date-picker"]').attributes('data-value')).toBe(expected);
    },
  );

  it('does not replace an invalid non-empty value with today on confirm or format change', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mounted = mountDateInput('2026-02-30', 'YYYY-MM-DD');

    expect(mounted.wrapper.get('[data-test="date-picker"]').attributes('data-value')).toBe('');
    const confirm = mounted.wrapper.findAll('button').find((button) => button.text() === '确定');
    expect(confirm).toBeDefined();
    await confirm!.trigger('click');
    expect(mounted.insertFieldText).not.toHaveBeenCalled();
    expect(mounted.node.textContent).toBe('2026-02-30');

    mounted.node.attrs.dateFormat = 'YYYY/MM/DD';
    await nextTick();
    await nextTick();

    expect(mounted.insertFieldText).not.toHaveBeenCalled();
    expect(mounted.node.textContent).toBe('2026-02-30');
    expect(error).toHaveBeenCalledOnce();
  });
});
