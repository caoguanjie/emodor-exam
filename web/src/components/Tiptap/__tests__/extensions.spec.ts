import type { JSONContent } from '@tiptap/core';
import { AllSelection } from '@tiptap/pm/state';
import { Editor, EditorContent } from '@tiptap/vue-3';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, onBeforeUnmount } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import sourceContent from './fixtures/source-content.json';
import { createExtensions, type EditorProfile } from '../utils/createExtensions';
import { ControlType, DateFormatOptions, type TemplateControl } from '../type';
import { commonWidgetData } from '../utils/commonWidget';

const editors: Editor[] = [];

function asQuestionDocument(content: JSONContent): JSONContent {
  if (content.content?.[0]?.type === 'questionBlock') return content;
  return {
    type: 'doc',
    content: [{
      type: 'questionBlock',
      attrs: { client_id: 'extension-test-question01' },
      content: [{
        type: 'questionStem',
        content: content.content?.length ? content.content : [{ type: 'paragraph' }],
      }],
    }],
  };
}

function firstWidget(document: JSONContent): JSONContent | undefined {
  if (document.type === 'widgetField') return document;
  return document.content?.map(firstWidget).find(Boolean);
}

function createEditor(profile: EditorProfile, content: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }) {
  const editor = new Editor({
    content: profile === 'question' ? asQuestionDocument(content) : content,
    extensions: createExtensions(profile),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe('createExtensions', () => {
  it('loads the complete question-dialog base through the Vite module graph', async () => {
    const module = await import('../index.vue');

    expect(module.default).toBeDefined();
  });

  it('mounts plain and rich as independent Vue editor contents', async () => {
    const Host = defineComponent({
      props: { profile: { type: String as () => EditorProfile, required: true } },
      setup(props) {
        const editor = createEditor(props.profile);
        onBeforeUnmount(() => editor.destroy());
        return () => h('div', { class: 'ruleexam-tiptap' }, [h(EditorContent, { editor })]);
      },
    });
    const plain = mount(Host, { props: { profile: 'plain' } });
    const rich = mount(Host, { props: { profile: 'rich' } });
    await nextTick();

    expect(plain.find('.ProseMirror').exists()).toBe(true);
    expect(rich.find('.ProseMirror').exists()).toBe(true);
    expect(plain.find('.ProseMirror').element).not.toBe(rich.find('.ProseMirror').element);

    plain.unmount();
    rich.unmount();
  });

  it('keeps plain documents limited to text blocks without rich or widget nodes', () => {
    const editor = createEditor('plain', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '无工具栏输入' }] }],
    });
    const names = editor.extensionManager.extensions.map((extension) => extension.name);

    expect(editor.getText()).toBe('无工具栏输入');
    expect(names).toEqual(expect.arrayContaining(['doc', 'paragraph', 'text', 'hardBreak']));
    expect(names).not.toEqual(expect.arrayContaining([
      'bold', 'heading', 'horizontalRule', 'table', 'textStyle', 'widgetField',
    ]));
  });

  it('registers every rich extension once and keeps HorizontalRule single', () => {
    const editor = createEditor('rich');
    const names = editor.extensionManager.extensions.map((extension) => extension.name);

    expect(names.filter((name) => name === 'horizontalRule')).toHaveLength(1);
    expect(names.filter((name) => name === 'table')).toHaveLength(1);
    expect(names.filter((name) => name === 'paragraphLineHeight')).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
    const keyedPlugins = editor.state.plugins.flatMap((plugin) => plugin.spec.key ? [plugin.spec.key] : []);
    expect(new Set(keyedPlugins).size).toBe(keyedPlugins.length);
  });

  it('limits headings to levels 1 through 4 and keeps links in the frozen schema', () => {
    const editor = createEditor('rich', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '协议链接' }] }],
    });

    editor.commands.setTextSelection({ from: 1, to: 5 });
    expect(editor.commands.setHeading({ level: 4 })).toBe(true);
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 4 } });
    expect(editor.commands.setParagraph()).toBe(true);
    expect(editor.commands.setHeading({ level: 5 })).toBe(false);
    expect(editor.getJSON().content?.[0]?.type).toBe('paragraph');

    editor.commands.setTextSelection({ from: 1, to: 5 });
    expect(editor.commands.setLink({ href: 'https://example.test/rule' })).toBe(true);
    const container = document.createElement('div');
    container.innerHTML = editor.getHTML();
    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor?.hasAttribute('target')).toBe(false);
    expect(anchor?.hasAttribute('class')).toBe(false);
    expect(anchor?.hasAttribute('title')).toBe(false);
    expect(editor.extensionManager.extensions.find(({ name }) => name === 'link')?.options.openOnClick).toBe(false);
  });

  it('round-trips official font size and legacy paragraph line height JSON', () => {
    const editor = createEditor('rich', sourceContent.paragraphs as JSONContent);

    expect(editor.getJSON().content?.[0].attrs?.lineHeight).toBe('2');
    editor.commands.setTextSelection({ from: 1, to: 4 });
    editor.commands.setFontSize('16pt');
    expect(editor.getJSON().content?.[0].content?.[0].marks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'textStyle',
        attrs: expect.objectContaining({ fontSize: '16pt' }),
      }),
    ]));
  });

  it('applies paragraph line height to every paragraph in a cross-block selection', () => {
    const editor = createEditor('rich', sourceContent.paragraphs as JSONContent);

    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    editor.commands.setLineHeight('2');

    expect(editor.getJSON().content?.map((node) => node.attrs?.lineHeight)).toEqual(['2', '2']);
  });

  it('applies and unsets paragraph line height through a real AllSelection', () => {
    const editor = createEditor('rich', sourceContent.paragraphs as JSONContent);
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));

    expect(editor.commands.setLineHeight('2.5')).toBe(true);
    expect(editor.getJSON().content?.map((node) => node.attrs?.lineHeight)).toEqual(['2.5', '2.5']);
    expect(editor.commands.unsetLineHeight()).toBe(true);
    expect(editor.getJSON().content?.map((node) => node.attrs?.lineHeight)).toEqual([null, null]);
  });

  it('updates every allowed mixed block inside the selection without touching the next block', () => {
    const editor = createEditor('rich', {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '标题' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '正文' }] },
        {
          type: 'bulletList',
          content: [{
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '列表' }] }],
          }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '选区外' }] },
      ],
    });
    let selectedListParagraphEnd = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === 'paragraph' && node.textContent === '列表') {
        selectedListParagraphEnd = position + 1 + node.content.size;
      }
    });
    editor.commands.setTextSelection({ from: 1, to: selectedListParagraphEnd });

    expect(editor.commands.setLineHeight('1.75')).toBe(true);
    const selected = (editor.getJSON() as any).content || [];
    expect(selected[0].attrs?.lineHeight).toBe('1.75');
    expect(selected[1].attrs?.lineHeight).toBe('1.75');
    expect(selected[2].content?.[0].attrs?.lineHeight).toBe('1.75');
    expect(selected[2].content?.[0].content?.[0].attrs?.lineHeight).toBe('1.75');
    expect(selected[3].attrs?.lineHeight).toBe(0);

    expect(editor.commands.unsetLineHeight()).toBe(true);
    const unset = (editor.getJSON() as any).content || [];
    expect(unset[0].attrs?.lineHeight).toBeNull();
    expect(unset[1].attrs?.lineHeight).toBeNull();
    expect(unset[2].content?.[0].attrs?.lineHeight).toBeNull();
    expect(unset[2].content?.[0].content?.[0].attrs?.lineHeight).toBeNull();
    expect(unset[3].attrs?.lineHeight).toBe(0);
  });

  it('accepts only the frozen paragraph line-height values and unsets them to null', () => {
    const editor = createEditor('rich');

    expect(editor.getJSON().content?.[0].attrs?.lineHeight).toBe(0);
    expect(editor.commands.setLineHeight('2.5')).toBe(true);
    expect(editor.getJSON().content?.[0].attrs?.lineHeight).toBe('2.5');
    expect(editor.commands.setLineHeight('4')).toBe(false);
    expect(editor.getJSON().content?.[0].attrs?.lineHeight).toBe('2.5');
    expect(editor.commands.unsetLineHeight()).toBe(true);
    expect(editor.getJSON().content?.[0].attrs?.lineHeight).toBeNull();
  });

  it('normalizes legacy HTML indentation to the frozen 0 through 10 integer range', () => {
    const editor = createEditor('rich');

    editor.commands.setContent('<p style="text-indent: 2em">缩进</p>');
    expect(editor.getJSON().content?.[0].attrs?.indent).toBe(2);
    for (let index = 2; index < 10; index += 1) {
      expect(editor.commands.increaseIndent()).toBe(true);
    }
    expect(editor.getJSON().content?.[0].attrs?.indent).toBe(10);
    expect(editor.commands.increaseIndent()).toBe(false);
  });

  it('creates a resizable TableKit table in the rich profile', () => {
    const editor = createEditor('rich');

    expect(editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })).toBe(true);
    expect(editor.commands.setCellAttribute('colwidth', [120])).toBe(true);
    expect(editor.commands.setCellAttribute('align', 'center')).toBe(true);
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'table' });
    const firstHeader = (editor.getJSON() as any).content[0].content[0].content[0];
    expect(firstHeader).toMatchObject({
      type: 'tableHeader',
      attrs: { colspan: 1, rowspan: 1, colwidth: [120], align: 'center' },
    });
  });

  it('keeps official ordered-list start and type attributes', () => {
    const editor = createEditor('rich');

    editor.commands.setContent('<ol start="3" type="a"><li><p>条目</p></li></ol>');
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'orderedList',
      attrs: { start: 3, type: 'a' },
    });
  });

  it('adds generic controls only to the question profile', () => {
    const rich = createEditor('rich');
    const question = createEditor('question');

    expect(rich.extensionManager.extensions.some((extension) => extension.name === 'widgetField')).toBe(false);
    expect(question.extensionManager.extensions.filter((extension) => extension.name === 'widgetField')).toHaveLength(1);
    expect(question.commands.insertField({ name: '文本输入', type: 1, placeholder: '请输入' })).toBe(true);
    expect(firstWidget(question.getJSON())).toMatchObject({
      type: 'widgetField',
      attrs: {
        name: '文本输入',
        placeholder: '请输入',
        group: null,
        checked: false,
        layout: 1,
        validate: 1,
        dataSourceCode: null,
      },
    });
    const insertedField = firstWidget(question.getJSON());
    expect(insertedField && 'attrs' in insertedField ? insertedField.attrs?.id : undefined)
      .toMatch(/^[0-9a-z]{21,}$/);
  });

  it('normalizes widget HTML flags and round-trips dynamic options without losing data', () => {
    const editor = createEditor('question');
    editor.commands.setContent(`
      <section data-question-block data-client-id="extension-html-question1"><div data-question-stem>
      <p><span data-type="field" data-id="widget-html-123456789" data-widget-name="位置"
        data-widget-type="6" data-widget-type-name="地理位置" data-font-num="12" data-font-size="14"
        data-required="1" data-readonly="0" data-underline="1" data-validate="0" data-align="3"
        data-multiple="0" data-data-source="" data-checked="false" data-layout="1"
        data-dynamic-options='[{"value":"gz","label":"广州","selected":false}]'>广州</span></p>
      </div></section>
    `);

    const parsedField = firstWidget(editor.getJSON());
    const attrs = parsedField && 'attrs' in parsedField ? parsedField.attrs : undefined;
    expect(attrs).toMatchObject({
      type: 6,
      width: 12,
      fontSize: 14,
      isRequired: 1,
      isReadonly: 0,
      isUnderline: 1,
      validate: 0,
      align: 3,
      isMultiple: 0,
      checked: false,
      layout: 1,
      dataSourceCode: '',
      dynamicOptions: [{ value: 'gz', label: '广州', selected: false }],
    });

    const container = document.createElement('div');
    container.innerHTML = editor.getHTML();
    const field = container.querySelector('span[data-type="field"]');
    expect(field?.getAttribute('data-data-source')).toBe('');
    expect(JSON.parse(field?.getAttribute('data-dynamic-options') || 'null')).toEqual([
      { value: 'gz', label: '广州', selected: false },
    ]);
  });

  it('replaces missing or legacy-short widget HTML ids with 21-character ids', () => {
    const editor = createEditor('question');
    editor.commands.setContent('<section data-question-block data-client-id="extension-legacy-question1"><div data-question-stem><p><span data-type="field" data-id="legacy" data-widget-type="1">内容</span></p></div></section>');
    const parsedField = firstWidget(editor.getJSON());
    const id = parsedField && 'attrs' in parsedField ? parsedField.attrs?.id : undefined;

    expect(id).not.toBe('legacy');
    expect(id).toMatch(/^[0-9a-z]{21,}$/);
  });

  it('rejects widget display names longer than 64 Unicode code points', () => {
    const editor = createEditor('question');

    expect(editor.commands.insertField({ type: 1, typeName: '📝'.repeat(64) })).toBe(true);
    expect(editor.commands.insertField({ type: 1, typeName: '📝'.repeat(65) })).toBe(false);
  });

  it('provides non-sensitive static common controls and all 13 date formats', () => {
    const controls = commonWidgetData.flatMap((root) => root.children || [])
      .flatMap((group) => group.children || []) as Partial<TemplateControl>[];
    const controlTypes = new Set(controls.map((control) => control.type));
    const person = controls.find((control) => control.typeName === '人员信息');

    expect([...controlTypes]).toEqual(expect.arrayContaining([
      ControlType.text,
      ControlType.select,
      ControlType.date,
      ControlType.inputNumber,
      ControlType.location,
    ]));
    expect(person?.type).toBe(ControlType.select);
    expect(person?.options).toBe('staff_1:人员一\nstaff_2:人员二');
    expect(DateFormatOptions).toHaveLength(13);
  });

  it('keeps the authoring commands inside the frozen text-style value sets', () => {
    const editor = createEditor('rich', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '样式约束' }] }],
    });
    editor.commands.setTextSelection({ from: 1, to: 5 });

    expect(editor.commands.setFontSize('9pt')).toBe(true);
    expect(editor.commands.setFontSize('36pt')).toBe(true);
    expect(editor.commands.setFontSize('37pt')).toBe(false);
    expect(editor.commands.setFontSize('12px')).toBe(false);
    expect(editor.commands.setFontFamily('Microsoft YaHei')).toBe(true);
    expect(editor.commands.setFontFamily('Arial')).toBe(false);
    expect(editor.commands.setColor('#abc')).toBe(true);
    expect(editor.commands.setColor('rgb(255, 0, 12)')).toBe(true);
    expect(editor.commands.setColor('red')).toBe(false);
    expect(editor.commands.toggleHighlight({ color: '#00ff00' })).toBe(true);
    expect(editor.commands.toggleHighlight({ color: 'linear-gradient(red, blue)' })).toBe(false);
  });
});
