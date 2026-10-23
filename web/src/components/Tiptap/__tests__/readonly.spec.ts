import type { JSONContent } from '@tiptap/core';
import { Editor, EditorContent } from '@tiptap/vue-3';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import TiptapEditor from '../index.vue';
import { ControlType } from '../type';

type EditorApi = {
  getJSON: () => JSONContent;
  setContent: (document: JSONContent) => void;
  validate: () => Array<{ path: string; code: string; message: string }>;
};

const wrappers: VueWrapper[] = [];

const PassThrough = defineComponent({
  name: 'PassThrough',
  setup(_props, { attrs, slots }) {
    return () => h('div', attrs, slots.default?.());
  },
});

const DatePickerStub = defineComponent({
  name: 'DatePicker',
  props: { value: { default: null }, disabled: Boolean },
  emits: ['update:value', 'update:open'],
  setup(_props, { slots }) {
    return () => h('div', { 'data-test': 'date-picker' }, [slots.input?.(), slots.footer?.()]);
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
  ElDialog: PassThrough,
  ElContainer: PassThrough,
  ElMain: PassThrough,
  ElAside: PassThrough,
  ElTabs: PassThrough,
  ElTabPane: PassThrough,
  ElButton: true,
  Gt: DatePickerStub,
};

function widget(id: string, type: ControlType, text: string, attrs: Record<string, unknown> = {}): JSONContent {
  return {
    type: 'widgetField',
    attrs: {
      id,
      type,
      value: text,
      group: type === ControlType.radio || type === ControlType.checkbox ? `${type}-group` : null,
      checked: false,
      dateFormat: 'YYYY-MM-DD',
      ...attrs,
    },
    content: text ? [{ type: 'text', text }] : undefined,
  };
}

function readonlyDocument(label = '只读正文'): JSONContent {
  return {
    type: 'doc',
    content: [{
      type: 'questionBlock',
      attrs: { client_id: 'readonly-question-00001' },
      content: [{
        type: 'questionStem',
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: label },
            widget('radio-widget-00000001', ControlType.radio, '单选'),
            widget('checkbox-widget-00001', ControlType.checkbox, '多选'),
            widget('date-widget-000000001', ControlType.date, '2026-10-22'),
          ],
        }],
      }],
    }],
  };
}

function mountReadonly(mode: 'preview' | 'review') {
  const wrapper = mount(TiptapEditor, {
    props: {
      modelValue: readonlyDocument(),
      profile: 'question',
      mode,
      presentation: 'inline',
      showToolbar: true,
      showPanels: true,
    },
    global: { stubs: editorStubs },
  });
  wrappers.push(wrapper);
  return wrapper;
}

async function getEditor(wrapper: VueWrapper): Promise<Editor> {
  await nextTick();
  await nextTick();
  const editor = wrapper.findComponent(EditorContent).props('editor') as Editor | null;
  expect(editor).toBeTruthy();
  return editor!;
}

function getApi(wrapper: VueWrapper): EditorApi {
  return wrapper.vm as unknown as EditorApi;
}

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

describe.each(['preview', 'review'] as const)('%s mode', (mode) => {
  it('blocks widget clicks, commands, paste, drop and deletion without changing JSON', async () => {
    const wrapper = mountReadonly(mode);
    const editor = await getEditor(wrapper);
    const before = getApi(wrapper).getJSON();

    for (const prefix of wrapper.findAll('.prefix-start')) {
      await prefix.trigger('click');
    }
    for (const button of wrapper.findAll('.mx-btn')) {
      await button.trigger('click');
    }
    editor.commands.insertFieldText('date-widget-000000001', '2026-10-23');
    editor.commands.updateFieldAttrs('radio-widget-00000001', '7-group', { checked: true });
    editor.commands.updateField('checkbox-widget-00001', { placeholder: 'changed' });
    editor.commands.insertField({ type: ControlType.text, name: '禁止插入' });
    editor.commands.insertContent('禁止命令写入');

    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '禁止粘贴' } });
    editor.view.dom.dispatchEvent(paste);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(drop);
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteContentBackward',
    });
    editor.view.dom.dispatchEvent(beforeInput);
    await nextTick();

    expect(paste.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
    expect(beforeInput.defaultPrevented).toBe(true);
    expect(editor.isEditable).toBe(false);
    expect(wrapper.get('.ProseMirror').attributes('contenteditable')).toBe('false');
    expect(wrapper.findAll('.custom-field').every((field) => field.attributes('data-readonly') === '1')).toBe(true);
    expect(getApi(wrapper).getJSON()).toEqual(before);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.find('.editor-sidebar').exists()).toBe(false);
  });
});

describe('readonly controlled updates', () => {
  it('allows prop refill while readonly but blocks subsequent user and programmatic mutations', async () => {
    const wrapper = mountReadonly('preview');
    const editor = await getEditor(wrapper);
    const replacement = readonlyDocument('受控回填');

    await wrapper.setProps({ modelValue: replacement });
    await nextTick();
    const normalizedReplacement = getApi(wrapper).getJSON();
    expect(JSON.stringify(normalizedReplacement)).toContain('受控回填');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();

    editor.commands.selectAll();
    editor.commands.deleteSelection();
    expect(getApi(wrapper).getJSON()).toEqual(normalizedReplacement);

    getApi(wrapper).setContent(readonlyDocument('命令回填'));
    const imperativeReplacement = getApi(wrapper).getJSON();
    editor.commands.insertContent('不能借回填窗口写入');
    expect(getApi(wrapper).getJSON()).toEqual(imperativeReplacement);
  });

  it('locks an existing edit instance immediately when mode switches to preview', async () => {
    const wrapper = mount(TiptapEditor, {
      props: {
        modelValue: readonlyDocument('编辑态'),
        profile: 'question',
        mode: 'edit',
        presentation: 'inline',
        showToolbar: false,
        showPanels: false,
      },
      global: { stubs: editorStubs },
    });
    wrappers.push(wrapper);
    const editor = await getEditor(wrapper);
    editor.commands.insertContent('可写');
    await nextTick();
    const edited = getApi(wrapper).getJSON();

    await wrapper.setProps({ mode: 'preview', modelValue: edited });
    await nextTick();
    editor.commands.insertContent('不可写');

    expect(editor.isEditable).toBe(false);
    expect(getApi(wrapper).getJSON()).toEqual(edited);

    await wrapper.setProps({ mode: 'edit', modelValue: edited });
    await nextTick();
    expect(editor.isEditable).toBe(true);
    editor.commands.insertContent('恢复可写');
    expect(getApi(wrapper).getJSON()).not.toEqual(edited);
  });
});
