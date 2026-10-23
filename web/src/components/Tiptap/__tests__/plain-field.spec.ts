import type { JSONContent } from '@tiptap/core';
import { EditorContent, type Editor } from '@tiptap/vue-3';
import { mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlainTextField from '../PlainTextField.vue';
import { documentToPlainText } from '../utils/plain-text';

const wrappers: VueWrapper[] = [];

function mountField(
  props: Record<string, unknown> = {},
  attrs: Record<string, unknown> = {},
) {
  const wrapper = mount(PlainTextField, {
    props,
    attrs,
    attachTo: document.body,
    global: { plugins: [ElementPlus] },
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

function pasteText(editor: Editor, text: string, html = '') {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => type === 'text/plain' ? text : html },
  });
  editor.view.dom.dispatchEvent(event);
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

describe('plain string field', () => {
  it('starts with an empty string and applies controlled refills without user writes', async () => {
    const wrapper = mountField();
    const editor = await getEditor(wrapper);

    expect(editor.getJSON()).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();

    await wrapper.setProps({ modelValue: '中文\n\n末尾\n' });
    expect(editor.getJSON()).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '中文' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: '末尾' }] },
        { type: 'paragraph' },
      ],
    });
    await wrapper.setProps({ modelValue: '' });
    expect(editor.getJSON()).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it.each<{ name: string; document: JSONContent; expected: string }>([
    {
      name: 'Chinese text, consecutive lines and a final newline',
      document: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '中文输入' }] },
          { type: 'paragraph' },
          { type: 'paragraph', content: [{ type: 'text', text: '下一行' }] },
          { type: 'paragraph' },
        ],
      },
      expected: '中文输入\n\n下一行\n',
    },
    {
      name: 'empty text',
      document: { type: 'doc', content: [{ type: 'paragraph' }] },
      expected: '',
    },
    {
      name: 'only empty lines',
      document: { type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph' }, { type: 'paragraph' }] },
      expected: '\n\n',
    },
    {
      name: 'a hard break inside a paragraph',
      document: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: '上' }, { type: 'hardBreak' }, { type: 'text', text: '下' }],
        }],
      },
      expected: '上\n下',
    },
  ])('emits a string for $name and accepts its controlled echo once', async ({ document, expected }) => {
    const wrapper = mountField({ modelValue: '待编辑' });
    const editor = await getEditor(wrapper);

    editor.commands.setContent(document);
    await nextTick();
    expect(wrapper.emitted('update:modelValue')).toEqual([[expected]]);

    await wrapper.setProps({ modelValue: expected });
    expect(wrapper.emitted('update:modelValue')).toEqual([[expected]]);
    expect(editor.getText({ blockSeparator: '\n' })).toBe(expected);
  });

  it('normalizes controlled CRLF and CR as LF without writing back during refill', async () => {
    const wrapper = mountField({ modelValue: '上\r\n中\r下\n' });
    const editor = await getEditor(wrapper);

    expect(editor.getJSON()).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '上' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '中' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '下' }] },
        { type: 'paragraph' },
      ],
    });
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    editor.commands.insertContentAt(1, '新');
    await nextTick();
    expect(wrapper.emitted('update:modelValue')).toEqual([['新上\n中\n下\n']]);
  });

  it('shows HTML-looking strings literally instead of creating rich nodes', async () => {
    const literal = '<strong>中文</strong> & <script>example</script>';
    const wrapper = mountField({ modelValue: literal });
    const editor = await getEditor(wrapper);

    expect(wrapper.get('.ProseMirror').text()).toBe(literal);
    expect(wrapper.find('.ProseMirror strong, .ProseMirror script').exists()).toBe(false);
    expect(editor.getJSON()).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: literal }] }],
    });
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, '!');
    await nextTick();
    expect(wrapper.emitted('update:modelValue')).toEqual([[`${literal}!`]]);
  });

  it.each(['readonly', 'disabled'] as const)('prevents %s edits while allowing controlled data to refresh', async (prop) => {
    const wrapper = mountField({ modelValue: '原说明', [prop]: true });
    const editor = await getEditor(wrapper);

    expect(wrapper.get('.ProseMirror').attributes('contenteditable')).toBe('false');
    editor.commands.insertContent('不得写入');
    await nextTick();
    expect(editor.getText()).toBe('原说明');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();

    await wrapper.setProps({ modelValue: '服务端回填' });
    expect(editor.getText()).toBe('服务端回填');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();

    await wrapper.setProps({ [prop]: false });
    expect(wrapper.get('.ProseMirror').attributes('contenteditable')).toBe('true');
    editor.commands.insertContentAt(1, '可编辑');
    await nextTick();
    expect(wrapper.emitted('update:modelValue')).toEqual([['可编辑服务端回填']]);

    await wrapper.setProps({ [prop]: true });
    editor.commands.insertContentAt(1, '再次禁止');
    await nextTick();
    expect(editor.getText()).toBe('可编辑服务端回填');
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
  });

  it('keeps two mounted fields and their updates independent', async () => {
    const first = mountField({ modelValue: '第一份说明' });
    const second = mountField({ modelValue: '第二份说明' });
    const firstEditor = await getEditor(first);
    const secondEditor = await getEditor(second);

    firstEditor.commands.insertContentAt(1, '新');
    await nextTick();
    expect(first.emitted('update:modelValue')).toEqual([['新第一份说明']]);
    expect(secondEditor.getText()).toBe('第二份说明');
    expect(second.emitted('update:modelValue')).toBeUndefined();

    await second.setProps({ modelValue: '第二份异步数据' });
    expect(secondEditor.getText()).toBe('第二份异步数据');
    expect(firstEditor.getText()).toBe('新第一份说明');
    expect(first.emitted('update:modelValue')).toHaveLength(1);
    expect(second.emitted('update:modelValue')).toBeUndefined();
  });

  it('renders inline without toolbar, question panels or a dialog', async () => {
    const wrapper = mountField({ modelValue: '普通备注' });
    await getEditor(wrapper);

    expect(wrapper.find('[data-editor-profile="plain"]').exists()).toBe(true);
    expect(wrapper.find('.ruleexam-tiptap-inline').exists()).toBe(true);
    expect(wrapper.find('.header-menu, .editor-sidebar, .tabs-template, .el-dialog').exists()).toBe(false);
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('keeps its plain and readonly contract when unrelated attributes are supplied', async () => {
    const wrapper = mountField({ modelValue: '只读备注', readonly: true }, {
      profile: 'rich',
      mode: 'edit',
    });
    await getEditor(wrapper);

    expect(wrapper.get('[data-editor-profile]').attributes('data-editor-profile')).toBe('plain');
    expect(wrapper.get('.ProseMirror').attributes('contenteditable')).toBe('false');
  });

  it('counts UTF-16 and paragraph newlines and rejects growth at the limit', async () => {
    const wrapper = mountField({ modelValue: '😀\n', maxlength: '3', showWordLimit: true });
    const editor = await getEditor(wrapper);

    expect(wrapper.get('[data-plain-word-count]').text()).toBe('3 / 3');
    editor.commands.insertContentAt(1, '中');
    await nextTick();
    expect(documentToPlainText(editor.getJSON())).toBe('😀\n');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();

    editor.commands.setTextSelection({ from: 1, to: 3 });
    editor.view.dispatch(editor.state.tr.insertText('中'));
    await wrapper.setProps({ modelValue: '中\n' });
    expect(documentToPlainText(editor.getJSON())).toBe('中\n');
    expect(wrapper.emitted('update:modelValue')).toEqual([['中\n']]);
    expect(wrapper.get('[data-plain-word-count]').text()).toBe('2 / 3');
  });

  it('treats maxlength zero as an empty-only user field', async () => {
    const wrapper = mountField({ maxlength: 0 });
    const editor = await getEditor(wrapper);
    editor.commands.insertContent('a');
    await nextTick();

    expect(documentToPlainText(editor.getJSON())).toBe('');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('budgets multiline paste against the selection and preserves cursor, echo, undo and redo', async () => {
    const wrapper = mountField({ modelValue: 'abCDxy', maxlength: 6 });
    const editor = await getEditor(wrapper);
    editor.commands.setTextSelection({ from: 3, to: 5 });
    pasteText(editor, '中\n余');
    await nextTick();

    expect(documentToPlainText(editor.getJSON())).toBe('ab中\nxy');
    expect(wrapper.emitted('update:modelValue')).toEqual([['ab中\nxy']]);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(6);
    await wrapper.setProps({ modelValue: 'ab中\nxy' });
    expect(editor.state.selection.from).toBe(6);

    expect(editor.commands.undo()).toBe(true);
    expect(documentToPlainText(editor.getJSON())).toBe('abCDxy');
    expect(editor.commands.redo()).toBe(true);
    expect(documentToPlainText(editor.getJSON())).toBe('ab中\nxy');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['ab中\nxy']);
  });

  it('pastes HTML-looking clipboard text literally and does not split a UTF-16 surrogate pair', async () => {
    const wrapper = mountField({ maxlength: 20 });
    const editor = await getEditor(wrapper);
    pasteText(editor, '<b>文</b>', '<strong>其他内容</strong>');
    await nextTick();
    expect(documentToPlainText(editor.getJSON())).toBe('<b>文</b>');
    expect(wrapper.find('.ProseMirror b, .ProseMirror strong').exists()).toBe(false);

    await wrapper.setProps({ modelValue: 'a', maxlength: 2 });
    editor.commands.setTextSelection(2);
    pasteText(editor, '😀');
    await nextTick();
    expect(documentToPlainText(editor.getJSON())).toBe('a');
    expect(wrapper.emitted('update:modelValue')).toEqual([['<b>文</b>']]);
  });

  it('preserves the native context menu so right-click paste uses the plain clipboard handler', async () => {
    const wrapper = mountField();
    const editor = await getEditor(wrapper);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.findComponent({ name: 'ContextMenu' }).exists()).toBe(false);
    pasteText(editor, '<i>原样粘贴</i>', '<i>原样粘贴</i>');
    await nextTick();
    expect(documentToPlainText(editor.getJSON())).toBe('<i>原样粘贴</i>');
    expect(wrapper.find('.ProseMirror i').exists()).toBe(false);
  });

  it('preserves oversized external refills and permits shrinking while rejecting further growth', async () => {
    const wrapper = mountField({ modelValue: 'abcd', maxlength: 2, showWordLimit: true });
    const editor = await getEditor(wrapper);

    expect(documentToPlainText(editor.getJSON())).toBe('abcd');
    expect(wrapper.get('[data-plain-word-count]').text()).toBe('4 / 2');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    editor.commands.insertContentAt(1, 'e');
    expect(documentToPlainText(editor.getJSON())).toBe('abcd');
    editor.view.dispatch(editor.state.tr.delete(1, 2));
    expect(documentToPlainText(editor.getJSON())).toBe('bcd');
    expect(wrapper.emitted('update:modelValue')).toEqual([['bcd']]);
    editor.commands.insertContentAt(1, 'Z');
    expect(documentToPlainText(editor.getJSON())).toBe('bcd');

    await wrapper.setProps({ modelValue: '再次超长' });
    expect(documentToPlainText(editor.getJSON())).toBe('再次超长');
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
  });

  it('settles a real composition DOM overflow without a permanent display/model split and keeps undo usable', async () => {
    const wrapper = mountField({ modelValue: 'a', maxlength: 2 });
    const editor = await getEditor(wrapper);
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    editor.view.dispatch(editor.state.tr.insertText('中', 2).setMeta('composition', 1));
    const textNode = editor.view.dom.querySelector('p')!.firstChild as Text;
    textNode.data = 'a中国';
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中国' }));

    await vi.waitFor(() => {
      expect(editor.view.dom.textContent).toBe('a中');
      expect(documentToPlainText(editor.getJSON())).toBe('a中');
    });
    expect(wrapper.emitted('update:modelValue')).toEqual([['a中']]);
    expect(editor.commands.undo()).toBe(true);
    expect(documentToPlainText(editor.getJSON())).toBe('a');
    expect(editor.commands.redo()).toBe(true);
    expect(documentToPlainText(editor.getJSON())).toBe('a中');
  });

  it('puts live labels, placeholder and rows on the actual editable and links its UTF-16 counter', async () => {
    const wrapper = mountField({
      rows: 3, placeholder: '<b>填写备注</b>', ariaLabel: '课程简介',
      ariaLabelledby: 'course-label', ariaDescribedby: 'course-hint', maxlength: 20, showWordLimit: true,
    });
    const editor = await getEditor(wrapper);
    const editable = wrapper.get('.ProseMirror');
    const counter = wrapper.get('[data-plain-word-count]');

    expect(editable.attributes('role')).toBe('textbox');
    expect(editable.attributes('aria-multiline')).toBe('true');
    expect(editable.attributes('aria-label')).toBe('课程简介');
    expect(editable.attributes('aria-labelledby')).toBe('course-label');
    expect(editable.attributes('aria-describedby')?.split(' ')).toEqual(['course-hint', counter.attributes('id')]);
    expect(editable.attributes('aria-placeholder')).toBe('<b>填写备注</b>');
    expect((editable.element as HTMLElement).style.height).toBe('4.5em');
    expect(wrapper.get('.ProseMirror p').attributes('data-placeholder')).toBe('<b>填写备注</b>');
    expect(wrapper.find('.ProseMirror b').exists()).toBe(false);
    expect(editor.getJSON()).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });

    await wrapper.setProps({ rows: 5, placeholder: '更新提示', ariaLabel: '更新标签' });
    await nextTick();
    expect((editable.element as HTMLElement).style.height).toBe('7.5em');
    expect(editable.attributes('aria-label')).toBe('更新标签');
    expect(wrapper.get('.ProseMirror p').attributes('data-placeholder')).toBe('更新提示');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it.each(['readonly', 'disabled'] as const)('retains length and accessibility semantics under %s', async (prop) => {
    const wrapper = mountField({ modelValue: '超长回填', maxlength: 1, ariaLabel: '说明', [prop]: true });
    const editor = await getEditor(wrapper);
    const editable = wrapper.get('.ProseMirror');

    expect(editable.attributes('aria-readonly')).toBe('true');
    expect(editable.attributes('aria-disabled')).toBe(String(prop === 'disabled'));
    editor.commands.insertContent('禁止');
    pasteText(editor, '禁止粘贴');
    await wrapper.setProps({ modelValue: '新的超长回填' });
    expect(documentToPlainText(editor.getJSON())).toBe('新的超长回填');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
});
