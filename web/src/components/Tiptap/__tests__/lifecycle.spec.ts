import type { JSONContent } from '@tiptap/core';
import { Editor, EditorContent, type NodeViewRendererProps } from '@tiptap/vue-3';
import { mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { defineComponent, h, markRaw, nextTick, reactive } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TiptapEditor from '../index.vue';
import EditDiv from '../components/EditDiv.vue';
import CheckboxInput from '../widget/CheckboxInput.vue';
import RadioInput from '../widget/RadioInput.vue';
import { createExtensions } from '../utils/createExtensions';
import { ControlType } from '../type';
import {
  beginEditorControlledUpdate,
  clearNodeView,
  endEditorControlledUpdate,
  getNodeView,
  registerNodeView,
} from '../utils/widgetNodeViewRegistry';

type EditorApi = {
  getJSON: () => JSONContent;
  setContent: (document: JSONContent) => void;
  focus: () => void;
  validate: () => Array<{ path: string; code: string; message: string }>;
};

const wrappers: VueWrapper[] = [];
const editors: Editor[] = [];

const PassThrough = defineComponent({
  name: 'PassThrough',
  setup(_props, { attrs, slots }) {
    return () => h('div', attrs, slots.default?.());
  },
});

const ButtonStub = defineComponent({
  name: 'ElButton',
  setup(_props, { attrs, slots }) {
    return () => h('button', attrs, slots.default?.());
  },
});

const DialogStub = defineComponent({
  name: 'ElDialog',
  props: { modelValue: { type: Boolean, default: false } },
  setup(props, { attrs, slots }) {
    return () => props.modelValue ? h('div', attrs, slots.default?.()) : null;
  },
});

const editorStubs = {
  DndProvider: PassThrough,
  DropControl: PassThrough,
  LeftControlPanel: true,
  TemplateSetting: true,
  WidgetSetting: true,
  ContextMenu: true,
  MenuBtn: true,
  EditDiv: true,
  ElDialog: DialogStub,
  ElContainer: PassThrough,
  ElMain: PassThrough,
  ElAside: PassThrough,
  ElTabs: PassThrough,
  ElTabPane: PassThrough,
  ElButton: ButtonStub,
};

function documentWith(text: string): JSONContent {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined }],
  };
}

function asQuestionDocument(content: JSONContent, clientId = 'lifecycle-question-0001'): JSONContent {
  if (content.content?.[0]?.type === 'questionBlock') return content;
  return {
    type: 'doc',
    content: [{
      type: 'questionBlock',
      attrs: { client_id: clientId },
      content: [{
        type: 'questionStem',
        content: content.content?.length ? content.content : [{ type: 'paragraph' }],
      }],
    }],
  };
}

function firstNode(document: JSONContent, type: string): JSONContent | undefined {
  if (document.type === type) return document;
  return document.content?.map((node) => firstNode(node, type)).find(Boolean);
}

function nodePosition(editor: Editor, type: string): number {
  let result = -1;
  editor.state.doc.descendants((node, position) => {
    if (result < 0 && node.type.name === type) result = position;
  });
  expect(result).toBeGreaterThanOrEqual(0);
  return result;
}

function documentText(document: JSONContent): string {
  if (document.text) return document.text;
  return document.content?.map((node) => documentText(node)).join(document.type === 'doc' ? '\n' : '') ?? '';
}

function mountEditor(props: Record<string, unknown>) {
  const wrapper = mount(TiptapEditor, {
    props: {
      presentation: 'inline',
      showToolbar: false,
      showPanels: false,
      ...props,
    },
    global: { stubs: editorStubs },
  });
  wrappers.push(wrapper);
  return wrapper;
}

async function getEditor(wrapper: VueWrapper): Promise<Editor> {
  await nextTick();
  await nextTick();
  const content = wrapper.findComponent(EditorContent);
  const editor = content.props('editor') as Editor | null;
  expect(editor).toBeTruthy();
  return editor!;
}

function getApi(wrapper: VueWrapper): EditorApi {
  return wrapper.vm as unknown as EditorApi;
}

afterEach(() => {
  vi.useRealTimers();
  window.getSelection()?.removeAllRanges();
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe('Tiptap editor lifecycle', () => {
  it('keeps three editor instances and their history alive when the middle instance is destroyed', async () => {
    const first = mountEditor({ modelValue: asQuestionDocument(documentWith('正文'), 'lifecycle-first-000001'), profile: 'question', mode: 'edit' });
    const second = mountEditor({ modelValue: documentWith('解析'), profile: 'rich', mode: 'edit' });
    const third = mountEditor({ modelValue: asQuestionDocument(documentWith('预览'), 'lifecycle-third-000001'), profile: 'question', mode: 'edit' });
    const firstEditor = await getEditor(first);
    const secondEditor = await getEditor(second);
    const thirdEditor = await getEditor(third);

    firstEditor.commands.insertContent('一');
    secondEditor.commands.insertContent('二');
    thirdEditor.commands.insertContent('三');
    second.unmount();

    expect(secondEditor.isDestroyed).toBe(true);
    expect(firstEditor.isDestroyed).toBe(false);
    expect(thirdEditor.isDestroyed).toBe(false);
    expect(firstEditor.commands.undo()).toBe(true);
    expect(documentText(getApi(first).getJSON())).toBe('正文');
    expect(documentText(getApi(third).getJSON())).toContain('三');
    expect(thirdEditor.commands.insertContent('四')).toBe(true);
    expect(documentText(getApi(third).getJSON())).toContain('四');
  });

  it('applies an async controlled value without emitting a user update, then emits real edits once', async () => {
    const wrapper = mountEditor({ modelValue: documentWith('载入前'), profile: 'rich', mode: 'edit' });
    const editor = await getEditor(wrapper);
    editor.commands.setTextSelection(editor.state.doc.content.size);

    await wrapper.setProps({ modelValue: documentWith('异步正文') });
    await nextTick();
    expect(documentText(getApi(wrapper).getJSON())).toBe('异步正文');
    expect(editor.state.selection.from).toBe(1);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();

    editor.commands.insertContent('用户输入');
    await nextTick();
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
    expect(documentText(wrapper.emitted('update:modelValue')![0][0] as JSONContent)).toContain('用户输入');
  });

  it('does not turn a controlled widget refill into a delayed user update', async () => {
    vi.useFakeTimers();
    const widgetDocument = (text: string): JSONContent => asQuestionDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'widgetField',
          attrs: {
            id: 'radio-widget-00000001',
            type: 7,
            group: 'radio-group-00000001',
            label: text,
            value: '1',
            checked: false,
          },
          content: [{ type: 'text', text }],
        }],
      }],
    }, 'lifecycle-widget-00001');
    const wrapper = mountEditor({ modelValue: widgetDocument('旧选项'), profile: 'question', mode: 'edit' });
    await getEditor(wrapper);

    await wrapper.setProps({ modelValue: widgetDocument('异步选项') });
    await nextTick();
    vi.advanceTimersByTime(600);
    await nextTick();

    expect(documentText(getApi(wrapper).getJSON())).toBe('异步选项');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it.each([
    ['radio', RadioInput],
    ['checkbox', CheckboxInput],
  ] as const)('cancels a pending %s label update when controlled content replaces it', async (name, component) => {
    vi.useFakeTimers();
    const id = `${name}-pending-widget-00001`;
    const group = `${name}-pending-group-00001`;
    const state = reactive({
      label: '原标签',
      options: '1:原标签',
      dynamicOptions: [{ value: '1', label: '原标签', selected: false }],
    });
    const node = reactive({
      attrs: { id, group, checked: false },
      textContent: '原标签',
    });
    const updateFieldAttrs = vi.fn((_id: string, _group: string, patch: { label?: string }) => {
      if (patch.label !== undefined) {
        state.label = patch.label;
        state.options = `1:${patch.label}`;
        state.dynamicOptions = [{ value: '1', label: patch.label, selected: false }];
      }
      return true;
    });
    const editor = markRaw({
      isEditable: true,
      commands: { updateFieldAttrs },
    }) as unknown as Editor;
    const wrapper = mount(component, {
      props: { nodeViewProps: { editor, node } as unknown as NodeViewRendererProps },
      global: { stubs: { NodeViewContent: PassThrough } },
    });
    wrappers.push(wrapper);

    node.textContent = '旧编辑';
    await nextTick();

    beginEditorControlledUpdate(editor);
    node.textContent = '受控新值';
    node.attrs = { ...node.attrs };
    state.label = '受控新值';
    state.options = '1:受控新值';
    state.dynamicOptions = [{ value: '1', label: '受控新值', selected: false }];
    await nextTick();
    endEditorControlledUpdate(editor);
    await nextTick();
    vi.advanceTimersByTime(620);
    await nextTick();

    expect(state.label).toBe('受控新值');
    expect(state.options).toBe('1:受控新值');
    expect(state.dynamicOptions).toEqual([
      { value: '1', label: '受控新值', selected: false },
    ]);
    expect(updateFieldAttrs).not.toHaveBeenCalled();
  });

  it.each([
    ['radio', RadioInput],
    ['checkbox', CheckboxInput],
  ] as const)('keeps rapid composition-like %s label edits debounced to the final value', async (name, component) => {
    vi.useFakeTimers();
    const node = reactive({
      attrs: { id: `${name}-ime-widget-000000001`, group: `${name}-ime-group-000000001`, checked: false },
      textContent: '原标签',
    });
    const updateFieldAttrs = vi.fn(() => true);
    const editor = markRaw({
      isEditable: true,
      commands: { updateFieldAttrs },
    }) as unknown as Editor;
    const wrapper = mount(component, {
      props: { nodeViewProps: { editor, node } as unknown as NodeViewRendererProps },
      global: { stubs: { NodeViewContent: PassThrough } },
    });
    wrappers.push(wrapper);

    node.textContent = '中';
    await nextTick();
    vi.advanceTimersByTime(200);
    node.textContent = '中文';
    await nextTick();
    vi.advanceTimersByTime(499);
    expect(updateFieldAttrs).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(updateFieldAttrs).toHaveBeenCalledOnce();
    expect(updateFieldAttrs).toHaveBeenCalledWith(
      `${name}-ime-widget-000000001`,
      `${name}-ime-group-000000001`,
      { label: '中文' },
    );
  });

  it.each([
    ['radio', ControlType.radio],
    ['checkbox', ControlType.checkbox],
  ] as const)('cancels a pending %s label update across a readonly mode round-trip', async (_name, type) => {
    vi.useFakeTimers();
    const id = `${_name}-mode-widget-0000001`;
    const content: JSONContent = asQuestionDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'widgetField',
          attrs: {
            id,
            type,
            group: `${_name}-mode-group-0000001`,
            label: '初始标签',
            value: '1',
            checked: false,
            options: '1:初始标签',
            dynamicOptions: [{ value: '1', label: '初始标签', selected: false }],
          },
          content: [{ type: 'text', text: '初始标签' }],
        }],
      }],
    }, `lifecycle-${_name}-mode01`);
    const wrapper = mountEditor({ modelValue: content, profile: 'question', mode: 'edit' });
    const editor = await getEditor(wrapper);

    const widgetPosition = nodePosition(editor, 'widgetField');
    expect(editor.commands.setTextSelection({
      from: widgetPosition + 1,
      to: widgetPosition + 1 + '初始标签'.length,
    })).toBe(true);
    expect(editor.commands.insertContent('切换前编辑')).toBe(true);
    await nextTick();
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);

    await wrapper.setProps({ mode: 'preview' });
    await nextTick();
    await wrapper.setProps({ mode: 'edit' });
    await nextTick();
    vi.advanceTimersByTime(620);
    await nextTick();

    const field = firstNode(getApi(wrapper).getJSON(), 'widgetField');
    expect(field?.content?.[0]?.text).toBe('切换前编辑');
    expect(field?.attrs?.label).toBe('初始标签');
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
  });

  it('does not let a controlled echo overwrite an active composition edit', async () => {
    const wrapper = mountEditor({ modelValue: documentWith('原文'), profile: 'plain', mode: 'edit' });
    const editor = await getEditor(wrapper);

    editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    await wrapper.setProps({ modelValue: documentWith('过期回显') });
    editor.commands.insertContent('中');
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await nextTick();
    await nextTick();

    expect(documentText(getApi(wrapper).getJSON())).toContain('中');
    expect(documentText(getApi(wrapper).getJSON())).not.toBe('过期回显');
  });

  it('settles composition interrupted by readonly mode so later prop and imperative refills apply', async () => {
    const wrapper = mountEditor({ modelValue: documentWith('原文'), profile: 'plain', mode: 'edit' });
    const editor = await getEditor(wrapper);

    editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    await wrapper.setProps({ modelValue: documentWith('预览回填') });
    await wrapper.setProps({ mode: 'preview' });
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, cancelable: true }));
    await nextTick();
    await nextTick();

    expect(documentText(getApi(wrapper).getJSON())).toBe('预览回填');

    await wrapper.setProps({ mode: 'edit' });
    await wrapper.setProps({ modelValue: documentWith('恢复后属性回填') });
    await nextTick();
    expect(documentText(getApi(wrapper).getJSON())).toBe('恢复后属性回填');

    getApi(wrapper).setContent(documentWith('恢复后命令回填'));
    await nextTick();
    expect(documentText(getApi(wrapper).getJSON())).toBe('恢复后命令回填');
  });

  it('keeps registry entries isolated by editor even when widget ids match', () => {
    const first = new Editor({ extensions: createExtensions('question') });
    const second = new Editor({ extensions: createExtensions('question') });
    editors.push(first, second);
    const firstView = { exposeProxy: { source: 'first' } };
    const secondView = { exposeProxy: { source: 'second' } };

    (registerNodeView as any)(first, 'shared-widget-id', firstView);
    (registerNodeView as any)(second, 'shared-widget-id', secondView);

    expect((getNodeView as any)(first, 'shared-widget-id')).toBe(firstView);
    expect((getNodeView as any)(second, 'shared-widget-id')).toBe(secondView);
    (clearNodeView as any)(second);
    expect((getNodeView as any)(first, 'shared-widget-id')).toBe(firstView);
    expect((getNodeView as any)(second, 'shared-widget-id')).toBeUndefined();
  });

  it('reuses the HTML5 backend across simultaneous question panel instances', async () => {
    const mountPanels = () => mount(TiptapEditor, {
      props: {
        modelValue: asQuestionDocument(documentWith('题目'), 'lifecycle-panels-000001'),
        profile: 'question',
        mode: 'edit',
        presentation: 'inline',
        showToolbar: false,
        showPanels: true,
      },
      global: { plugins: [ElementPlus] },
    });

    const first = mountPanels();
    const second = mountPanels();
    wrappers.push(first, second);
    await getEditor(first);
    await getEditor(second);

    expect(first.find('.left-control-panel').exists()).toBe(true);
    expect(second.find('.left-control-panel').exists()).toBe(true);

    first.unmount();
    const replacement = mountPanels();
    wrappers.push(replacement);
    await getEditor(replacement);
    expect(second.find('.left-control-panel').exists()).toBe(true);
    expect(replacement.find('.left-control-panel').exists()).toBe(true);
  });

  it('emits save without closing the controlled dialog', async () => {
    const wrapper = mountEditor({
      modelValue: asQuestionDocument(documentWith('待保存'), 'lifecycle-save-0000001'),
      profile: 'question',
      mode: 'edit',
      presentation: 'dialog',
      dialogVisible: true,
    });
    await getEditor(wrapper);
    const save = wrapper.findAll('button').find((button) => button.text() === '保存');
    expect(save).toBeDefined();

    await save!.trigger('click');

    expect(wrapper.emitted('save')).toHaveLength(1);
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(wrapper.emitted('update:dialogVisible')).toBeUndefined();
  });

  it('closes an uncontrolled explicit dialog and emits the close contract', async () => {
    const wrapper = mountEditor({
      modelValue: asQuestionDocument(documentWith('待关闭'), 'lifecycle-close-000001'),
      profile: 'question',
      mode: 'edit',
      presentation: 'dialog',
    });
    await getEditor(wrapper);
    const close = wrapper.findAll('button').find((button) => button.text() === '关闭');
    expect(close).toBeDefined();

    await close!.trigger('click');
    await nextTick();

    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(wrapper.emitted('update:dialogVisible')).toEqual([[false]]);
    expect(wrapper.find('.ruleexam-tiptap-dialog').exists()).toBe(false);
  });

  it('defaults to inline while preserving the dialogVisible-only compatibility entry', async () => {
    const inline = mount(TiptapEditor, {
      props: { modelValue: documentWith('内联'), profile: 'plain', mode: 'edit' },
      global: { stubs: editorStubs },
    });
    const legacyDialog = mount(TiptapEditor, {
      props: {
        modelValue: asQuestionDocument(documentWith('兼容弹窗'), 'lifecycle-dialog-00001'),
        profile: 'question',
        mode: 'edit',
        dialogVisible: true,
        showPanels: false,
      },
      global: { stubs: editorStubs },
    });
    wrappers.push(inline, legacyDialog);
    await getEditor(inline);
    await getEditor(legacyDialog);

    expect(inline.find('.ruleexam-tiptap-inline').exists()).toBe(true);
    expect(legacyDialog.find('.ruleexam-tiptap-dialog').exists()).toBe(true);
  });

  it('preserves plain hard breaks and keeps question metadata outside editor JSON', async () => {
    const content: JSONContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: '第一行' },
          { type: 'hardBreak' },
          { type: 'text', text: '第二行' },
        ],
      }],
    };
    const wrapper = mountEditor({
      modelValue: content,
      profile: 'plain',
      mode: 'edit',
      questions: { q1: { secret: 'metadata' } },
      review: { q1: [{ option_id: 'o1', selected: true, correct: true, missed: false }] },
    });
    await getEditor(wrapper);

    expect(getApi(wrapper).getJSON()).toEqual(content);
    expect(JSON.stringify(getApi(wrapper).getJSON())).not.toContain('metadata');
    expect(wrapper.find('.editor-sidebar').exists()).toBe(false);
    expect(wrapper.find('[id="editor-content"]').exists()).toBe(false);
  });

  it('uses strict imperative refill and exposes pure validation issues', async () => {
    const required: JSONContent = asQuestionDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'widgetField',
          attrs: { id: 'required-widget-000001', type: 1, isRequired: 1, value: '' },
        }],
      }],
    }, 'lifecycle-required-0001');
    const wrapper = mountEditor({ modelValue: required, profile: 'question', mode: 'edit' });
    await getEditor(wrapper);
    const before = getApi(wrapper).getJSON();

    expect(getApi(wrapper).validate()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'question_metadata_missing' }),
      expect.objectContaining({ code: 'required_widget_empty' }),
    ]));
    expect(getApi(wrapper).getJSON()).toEqual(before);
    expect(() => getApi(wrapper).setContent({
      type: 'doc',
      content: [{ type: 'unsupportedNode' }],
    })).toThrow();
    expect(getApi(wrapper).getJSON()).toEqual(before);
  });
});

describe('EditDiv lifecycle', () => {
  function selectText(element: HTMLElement, start: number, end: number) {
    const text = element.firstChild;
    expect(text?.nodeType).toBe(Node.TEXT_NODE);
    const range = document.createRange();
    range.setStart(text!, start);
    range.setEnd(text!, end);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function pasteText(element: HTMLElement, text: string) {
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => text },
    });
    element.dispatchEvent(paste);
    return paste;
  }

  function caretOffsetWithin(element: HTMLElement): number {
    const selection = window.getSelection()!;
    expect(selection.rangeCount).toBe(1);
    expect(selection.isCollapsed).toBe(true);
    const prefix = document.createRange();
    prefix.selectNodeContents(element);
    prefix.setEnd(selection.anchorNode!, selection.anchorOffset);
    return prefix.toString().length;
  }

  it('replaces the active text selection and restores the caret after pasted text', async () => {
    const updateModel = vi.fn();
    const wrapper = mount(EditDiv, {
      props: { modelValue: 'ABCD', 'onUpdate:modelValue': updateModel },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await nextTick();
    const editable = wrapper.get('[contenteditable="true"]').element as HTMLElement;
    selectText(editable, 1, 3);

    const paste = pasteText(editable, 'X');
    await nextTick();
    await nextTick();

    expect(paste.defaultPrevented).toBe(true);
    expect(editable.textContent).toBe('AXD');
    expect(updateModel).toHaveBeenLastCalledWith('AXD');
    expect(caretOffsetWithin(editable)).toBe(2);
  });

  it('inserts at a collapsed caret, falls back safely for an outside selection, and ignores disabled paste', async () => {
    const updateModel = vi.fn();
    const wrapper = mount(EditDiv, {
      props: { modelValue: 'ABCD', 'onUpdate:modelValue': updateModel },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await nextTick();
    const editable = wrapper.get('[contenteditable="true"]').element as HTMLElement;
    selectText(editable, 2, 2);

    pasteText(editable, 'X');
    await nextTick();
    await nextTick();
    expect(editable.textContent).toBe('ABXCD');
    expect(updateModel).toHaveBeenLastCalledWith('ABXCD');
    expect(caretOffsetWithin(editable)).toBe(3);

    const outside = document.createElement('div');
    outside.textContent = '外部';
    document.body.append(outside);
    selectText(outside, 0, 2);
    pasteText(editable, 'Y');
    await nextTick();
    await nextTick();
    outside.remove();
    expect(editable.textContent).toBe('ABXCDY');
    expect(updateModel).toHaveBeenLastCalledWith('ABXCDY');
    expect(caretOffsetWithin(editable)).toBe(6);

    const disabledUpdate = vi.fn();
    const disabled = mount(EditDiv, {
      props: { modelValue: '锁定', disabled: true, 'onUpdate:modelValue': disabledUpdate },
    });
    wrappers.push(disabled);
    await nextTick();
    const locked = disabled.get('[contenteditable="false"]').element as HTMLElement;
    const disabledPaste = pasteText(locked, '禁止');
    await nextTick();
    expect(disabledPaste.defaultPrevented).toBe(false);
    expect(locked.textContent).toBe('锁定');
    expect(disabledUpdate).not.toHaveBeenCalled();
  });

  it('synchronizes plain-text paste to v-model and removes the native listener on unmount', async () => {
    const updateModel = vi.fn();
    const wrapper = mount(EditDiv, {
      props: { modelValue: '标题', 'onUpdate:modelValue': updateModel },
    });
    wrappers.push(wrapper);
    await nextTick();
    const editable = wrapper.get('[contenteditable="true"]');
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => '追加' },
    });

    editable.element.dispatchEvent(paste);
    await nextTick();

    expect(updateModel).toHaveBeenLastCalledWith('标题追加');
    const emittedCount = updateModel.mock.calls.length;
    wrapper.unmount();
    editable.element.dispatchEvent(paste);
    expect(updateModel).toHaveBeenCalledTimes(emittedCount);
  });
});
