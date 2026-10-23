import { EditorContent } from '@tiptap/vue-3';
import { AllSelection, TextSelection } from '@tiptap/pm/state';
import { Slice, Fragment } from '@tiptap/pm/model';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JSONContent, QuestionAuthoringDocument, QuestionMeta } from '../../../api/question-document-types';
import QuestionEditor from '../../question-designers/QuestionDocumentEditor.vue';
import TiptapEditor from '../index.vue';

const wrappers: VueWrapper[] = [];
const meta = (): QuestionMeta => ({ type: 'single', category_id: '10', difficulty: 'easy', concept_id: null,
  regulation_id: null, regulation_version_id: null, analysis: { type: 'doc', content: [] }, score_cents: 500 });
function value(): QuestionAuthoringDocument {
  return { schema_version: 1, content: { type: 'doc', content: ['first', 'second'].map((id) => ({
    type: 'questionBlock', attrs: { client_id: id }, content: [
      { type: 'questionStem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲乙' }] }] },
      { type: 'questionOption', attrs: { option_id: `${id}_a`, checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '选项' }] }] },
      { type: 'questionOption', attrs: { option_id: `${id}_b`, checked: true }, content: [{ type: 'paragraph' }] },
    ],
  })) }, questions: { first: meta(), second: meta() } };
}
async function mountEditor(overrides: Record<string, unknown> = {}) {
  const wrapper = mount(QuestionEditor, { props: { modelValue: value(), showToolbar: false, showPanels: false,
    canUploadMedia: true, conceptApi: { list: async () => ({ items: [], total: 0, page: 1, page_size: 20 }), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    conceptAccess: { read: true, create: true, edit: true, delete: true }, ...overrides },
  global: { plugins: [ElementPlus], stubs: { QuestionSetting: true, MenuBtn: true, ContextMenu: true } } });
  wrappers.push(wrapper); await flushPromises();
  const core = wrapper.findComponent(EditorContent).props('editor')!;
  return { wrapper, core, commands: wrapper.vm as any };
}
function latest(wrapper: VueWrapper) {
  return wrapper.emitted('update:modelValue')!.at(-1)![0] as QuestionAuthoringDocument;
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe('shared question document editor', () => {
  it('creates each supported type with metadata and a complete structure event using the same editor', async () => {
    const { wrapper, core, commands } = await mountEditor();
    expect(typeof commands.addQuestion).toBe('function');
    for (const type of ['single', 'multiple', 'judgment']) {
      const id = commands.addQuestion(type);
      expect(typeof id).toBe('string');
      const next = latest(wrapper);
      expect(next.questions[id]).toMatchObject({ type });
      expect(next.content.content!.at(-1)!.attrs!.client_id).toBe(id);
      expect(next.content.content!.at(-1)!.content!.filter((node) => node.type === 'questionOption')).toHaveLength(2);
      expect(wrapper.emitted('structure-change')!.at(-1)![0]).toMatchObject({ kind: 'add', client_id: id, document: next });
      await flushPromises();
      expect(wrapper.findComponent(EditorContent).props('editor')).toBe(core);
    }
    const before = core.getJSON();
    expect(core.getJSON()).toEqual(before);
    expect(wrapper.find('.question-editor__media').exists()).toBe(false);
  });

  it('moves and removes whole questions while keeping metadata and ordered identity sidecars consistent', async () => {
    const { wrapper, core, commands } = await mountEditor();
    expect(typeof commands.moveQuestion).toBe('function');
    expect(commands.moveQuestion('second', 0)).toBe(true);
    expect(latest(wrapper).content.content!.map((node) => node.attrs!.client_id)).toEqual(['second', 'first']);
    expect(latest(wrapper).questions).toEqual({ first: meta(), second: meta() });
    expect(wrapper.emitted('structure-change')!.at(-1)![0]).toMatchObject({ kind: 'move', client_ids: ['second', 'first'], from_index: 1, to_index: 0 });
    expect(commands.removeQuestion('second')).toBe(true);
    expect(Object.keys(latest(wrapper).questions)).toEqual(['first']);
    expect(core.getJSON().content!.map((node) => node.attrs!.client_id)).toEqual(['first']);
    expect(core.commands.undo()).toBe(false);
  });

  it.each(['delete', 'replace', 'format'])('rejects a cross-question %s transaction and preserves the full document', async (action) => {
    const { wrapper, core } = await mountEditor();
    core.view.dispatch(core.state.tr.setSelection(new AllSelection(core.state.doc)));
    const before = core.getJSON();
    if (action === 'delete') core.commands.deleteSelection();
    if (action === 'replace') core.commands.insertContent('不应覆盖整卷');
    if (action === 'format') core.commands.setBold();
    expect(core.getJSON()).toEqual(before);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('edit-blocked')?.length).toBeGreaterThan(0);
  });

  it('blocks cross-question cut before clipboard deletion but keeps pure content copying available', async () => {
    const { core } = await mountEditor();
    core.view.dispatch(core.state.tr.setSelection(new AllSelection(core.state.doc)));
    const cut = new Event('cut', { bubbles: true, cancelable: true });
    core.view.dom.dispatchEvent(cut);
    expect(cut.defaultPrevented).toBe(true);
    const serialized = core.view.serializeForClipboard(core.state.selection.content());
    expect(serialized.dom.querySelector('[data-question-block]')).toBeNull();
    expect(serialized.dom.textContent).toContain('甲乙');
  });

  it('rejects structured question paste and unknown root insertion without losing current identities', async () => {
    const { wrapper, core } = await mountEditor();
    core.commands.setTextSelection(4);
    const before = core.getJSON();
    const paste = new Event('paste', { cancelable: true }) as ClipboardEvent;
    const slice = new Slice(Fragment.from(core.state.doc.child(1)), 0, 0);
    let handled = false;
    core.view.someProp('handlePaste', (handler) => { handled = handler(core.view, paste, slice) === true; return handled; });
    expect(handled).toBe(true);
    core.view.dispatch(core.state.tr.insert(core.state.doc.content.size, core.state.doc.child(1)));
    expect(core.getJSON()).toEqual(before);
    expect(wrapper.emitted('structure-change')).toBeUndefined();
  });

  it('inserts controlled media between the current stem characters and refuses an outside caret', async () => {
    const { core, commands } = await mountEditor();
    core.commands.setTextSelection(4);
    expect(typeof commands.insertImage).toBe('function');
    expect(commands.insertImage('123', '示意图')).toBe(true);
    expect((core.getJSON() as JSONContent).content![0].content![0].content![0].content).toEqual([
      { type: 'text', text: '甲' }, { type: 'mediaImage', attrs: { asset_id: '123', alt: '示意图' } }, { type: 'text', text: '乙' },
    ]);
    core.view.dispatch(core.state.tr.setSelection(new AllSelection(core.state.doc)));
    expect(commands.insertImage('456')).toBe(false);
  });

  it('maps a pending upload through typing and keeps the placeholder out of JSON', async () => {
    const { wrapper, core, commands } = await mountEditor();
    core.commands.setTextSelection(4);
    expect(typeof commands.beginImageUpload).toBe('function');
    const token = commands.beginImageUpload();
    expect(typeof token).toBe('string');
    expect(wrapper.emitted('upload-state-change')!.at(-1)![0]).toMatchObject({ pending: true });
    expect(JSON.stringify(core.getJSON())).not.toContain(token);
    core.commands.insertContentAt(3, '前');
    expect(commands.completeImageUpload(token, '123')).toBe(true);
    expect((core.getJSON() as JSONContent).content![0].content![0].content![0].content).toEqual([
      { type: 'text', text: '前甲' }, { type: 'mediaImage', attrs: { asset_id: '123', alt: null } }, { type: 'text', text: '乙' },
    ]);
    expect(wrapper.emitted('upload-state-change')!.at(-1)![0]).toMatchObject({ pending: false });
  });

  it('does not insert a late upload into another question after its target was deleted', async () => {
    const { core, commands } = await mountEditor();
    core.commands.setTextSelection(4);
    expect(typeof commands.beginImageUpload).toBe('function');
    const token = commands.beginImageUpload();
    expect(commands.removeQuestion('first')).toBe(true);
    expect(commands.completeImageUpload(token, '123')).toBe(false);
    expect(JSON.stringify(core.getJSON())).not.toContain('asset_id');
  });

  it('keeps the upload anchored to the same question when that whole question is moved', async () => {
    const { core, commands } = await mountEditor();
    core.commands.setTextSelection(4);
    const token = commands.beginImageUpload();
    expect(commands.moveQuestion('first', 1)).toBe(true);
    expect(commands.completeImageUpload(token, '123')).toBe(true);
    const blocks = (core.getJSON() as JSONContent).content!;
    expect(blocks.map((node) => node.attrs!.client_id)).toEqual(['second', 'first']);
    expect(JSON.stringify(blocks[0])).not.toContain('asset_id');
    expect(blocks[1].content![0].content![0].content).toEqual([
      { type: 'text', text: '甲' }, { type: 'mediaImage', attrs: { asset_id: '123', alt: null } }, { type: 'text', text: '乙' },
    ]);
  });

  it('does not acknowledge a structural command while a controlled replacement locks mutations', async () => {
    const { core, wrapper, commands } = await mountEditor();
    const registry = await import('../utils/widgetNodeViewRegistry');
    registry.beginEditorControlledUpdate(core);
    try {
      expect(commands.addQuestion('single')).toBeNull();
      expect(commands.removeQuestion('first')).toBe(false);
      expect(commands.moveQuestion('first', 1)).toBe(false);
      expect(wrapper.emitted('structure-change')).toBeUndefined();
    } finally { registry.endEditorControlledUpdate(core); }
  });

  it('exposes the main editor while blocking structural and image mutations in readonly mode', async () => {
    const { core, commands, wrapper } = await mountEditor({ disabled: true });
    expect(typeof commands.getEditor).toBe('function');
    expect(commands.getEditor()).toBe(core);
    expect(commands.addQuestion('single')).toBeNull();
    expect(commands.removeQuestion('first')).toBe(false);
    expect(commands.moveQuestion('first', 1)).toBe(false);
    expect(commands.beginImageUpload()).toBeNull();
    expect(commands.insertImage('123')).toBe(false);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('requests deletion from the question header without deleting before the shell confirms', async () => {
    const { core, wrapper } = await mountEditor();
    const remove = wrapper.find('[data-client-id="first"] [data-question-remove]');
    expect(remove.exists()).toBe(true);
    await remove.trigger('click');
    expect(wrapper.emitted('remove-request')).toEqual([['first']]);
    expect(core.getJSON().content).toHaveLength(2);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('has a question drag handle that transfers only the local question identity', async () => {
    const { wrapper } = await mountEditor();
    const handle = wrapper.find('[data-client-id="first"] [data-question-drag-handle]');
    expect(handle.exists()).toBe(true);
    const data = new Map<string, string>();
    await handle.trigger('dragstart', { dataTransfer: { setData: (key: string, text: string) => data.set(key, text), effectAllowed: '' } });
    expect([...data.entries()]).toEqual([['application/x-ruleexam-question', 'first']]);
  });

  it('computes the final move index after removing the dragged question from its old position', async () => {
    const { wrapper, core } = await mountEditor();
    vi.spyOn(core.view, 'posAtCoords').mockReturnValue({ pos: core.state.doc.child(0).nodeSize + 1, inside: 0 });
    const drop = new Event('drop', { cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: (mime: string) => mime === 'application/x-ruleexam-question' ? 'first' : '' } });
    const slice = new Slice(Fragment.empty, 0, 0);
    core.view.someProp('handleDrop', (handler) => handler(core.view, drop, slice, false));
    expect(wrapper.emitted('move-request')).toEqual([[{ client_id: 'first', to_index: 0 }]]);
    expect(core.getJSON().content).toHaveLength(2);
  });

  it('hides question structure controls for a single-question shell', async () => {
    const { wrapper, commands } = await mountEditor({ allowStructure: false });
    expect(wrapper.find('[data-question-drag-handle]').exists()).toBe(false);
    expect(wrapper.find('[data-question-remove]').exists()).toBe(false);
    expect(commands.removeQuestion('first')).toBe(false);
    expect(commands.moveQuestion('first', 1)).toBe(false);
  });

  it.each(['single', 'multiple'] as const)('edits %s options through real node views even when top-level structure is locked', async (type) => {
    const source = value(); source.questions.first!.type = type;
    const { wrapper, core } = await mountEditor({ modelValue: source, allowStructure: false });
    const beforeSecond = core.getJSON().content![1];
    const block = () => wrapper.get('[data-client-id="first"]');
    expect(block().find('button[aria-label="添加选项"]').exists()).toBe(true);
    expect(block().find('button[aria-label="删除选项 A"]').exists()).toBe(false);
    await block().get('button[aria-label="添加选项"]').trigger('click'); await flushPromises();
    await block().get('button[aria-label="添加选项"]').trigger('click'); await flushPromises();
    const four = latest(wrapper);
    const options = four.content.content![0]!.content!.slice(1);
    expect(options).toHaveLength(4);
    expect(options.slice(0, 2).map((node) => node.attrs!.option_id)).toEqual(['first_a', 'first_b']);
    expect(new Set(options.map((node) => node.attrs!.option_id)).size).toBe(4);
    expect(options.slice(2).every((node) => /^[0-9a-z]{21,}$/.test(String(node.attrs!.option_id)))).toBe(true);
    expect(four.questions).toEqual(source.questions);
    expect(four.content.content![1]).toEqual(beforeSecond);
    await block().get('button[aria-label="删除选项 B"]').trigger('click'); await flushPromises();
    await block().get('button[aria-label="删除选项 B"]').trigger('click'); await flushPromises();
    const two = latest(wrapper);
    expect(two.content.content![0]!.content!.slice(1)).toHaveLength(2);
    expect(two.content.content![0]!.content!.slice(1).every((node) => node.attrs!.checked === false)).toBe(true);
    expect(two.questions).toEqual(source.questions);
    expect(block().find('button[aria-label^="删除选项"]').exists()).toBe(false);
    expect(wrapper.find('[data-question-remove]').exists()).toBe(false);
    expect(wrapper.emitted('structure-change')).toBeUndefined();
  });

  it('enforces the 26-option ceiling and two-option floor in commands and node view actions', async () => {
    const source = value();
    const children = source.content.content![0]!.content!;
    for (let index = 2; index < 26; index += 1) children.push({ type: 'questionOption', attrs: { option_id: `extra_${index}`, checked: false }, content: [{ type: 'paragraph' }] });
    const { wrapper, core } = await mountEditor({ modelValue: source });
    expect(typeof core.commands.addQuestionOption).toBe('function');
    expect(typeof core.commands.removeQuestionOption).toBe('function');
    expect(wrapper.get('[data-client-id="first"] button[aria-label="添加选项"]').attributes('disabled')).toBeDefined();
    const before = core.getJSON();
    expect(core.commands.addQuestionOption('first')).toBe(false);
    expect(core.getJSON()).toEqual(before);
    expect(core.commands.removeQuestionOption('second_a')).toBe(false);
    expect(core.getJSON()).toEqual(before);
    expect(core.commands.removeQuestionOption('extra_25')).toBe(true); await flushPromises();
    expect(wrapper.get('[data-client-id="first"] button[aria-label="添加选项"]').attributes('disabled')).toBeUndefined();
    expect(core.commands.addQuestionOption('first')).toBe(true);
    expect(core.getJSON().content![0]!.content).toHaveLength(27);
  });

  it.each(['selection', 'metadata'] as const)('preserves option identity, labels and content on a pure %s transaction', async (kind) => {
    const { wrapper, core } = await mountEditor();
    const original = core.getJSON();
    const option = wrapper.get('[data-option-id="first_a"]').element;
    const transaction = kind === 'selection'
      ? core.state.tr.setSelection(TextSelection.create(core.state.doc, 4))
      : core.state.tr.setMeta('designer-test-metadata', { active: true });
    expect(transaction.docChanged).toBe(false);
    core.view.dispatch(transaction); await flushPromises();
    expect(wrapper.findAll('[data-question-option]')).toHaveLength(4);
    expect(wrapper.get('[data-option-id="first_a"]').element).toBe(option);
    expect(wrapper.findAll('.question-option__toggle').map((item) => item.text())).toEqual(['A', 'B', 'A', 'B']);
    expect(core.getJSON()).toEqual(original);
  });

  it('refreshes option parent context on document changes and keeps structure controls current', async () => {
    const { wrapper, core } = await mountEditor();
    const transaction = core.state.tr.insertText('正文变化', 4);
    core.view.dispatch(transaction); await flushPromises();
    expect(wrapper.get('[data-client-id="first"] [data-question-stem]').text()).toBe('甲正文变化乙');
    await wrapper.get('[data-client-id="first"] button[aria-label="添加选项"]').trigger('click'); await flushPromises();
    expect(wrapper.find('[data-option-id="first_a"] button[aria-label="删除选项 A"]').exists()).toBe(true);
    await wrapper.get('[data-option-id="first_a"] button[aria-label="删除选项 A"]').trigger('click'); await flushPromises();
    expect(wrapper.get('[data-option-id="first_b"] .question-option__toggle').text()).toBe('A');
    expect(wrapper.find('[data-client-id="first"] button[aria-label^="删除选项"]').exists()).toBe(false);
    await wrapper.setProps({ disabled: true }); await flushPromises();
    expect(wrapper.get('[data-option-id="first_b"] .question-option__toggle').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-client-id="first"] button[aria-label="添加选项"]').exists()).toBe(false);
  });

  it.each([{ mode: 'preview' }, { mode: 'review' }, { disabled: true }])('hides option controls and rejects commands when mutations are unavailable: %j', async (overrides) => {
    const source = value();
    const wrapper = 'disabled' in overrides
      ? (await mountEditor(overrides)).wrapper
      : mount(TiptapEditor, { props: { modelValue: source.content, questions: source.questions, profile: 'question',
        mode: overrides.mode as 'preview' | 'review', showPanels: false, showToolbar: false }, global: { plugins: [ElementPlus], stubs: { ContextMenu: true } } });
    if (!('disabled' in overrides)) wrappers.push(wrapper);
    await flushPromises();
    const core = wrapper.findComponent(EditorContent).props('editor')!;
    expect(typeof core.commands.addQuestionOption).toBe('function');
    expect(typeof core.commands.removeQuestionOption).toBe('function');
    expect(wrapper.find('button[aria-label="添加选项"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label^="删除选项"]').exists()).toBe(false);
    const before = core.getJSON();
    expect(core.commands.addQuestionOption('first')).toBe(false);
    expect(core.commands.removeQuestionOption('first_a')).toBe(false);
    expect(core.getJSON()).toEqual(before);
  });

  it('keeps judgment options fixed and rejects option structure commands', async () => {
    const source = value(); source.questions.first!.type = 'judgment';
    source.content.content![0]!.content!.slice(1).forEach((node, index) => { node.content = [{ type: 'paragraph', content: [{ type: 'text', text: index === 0 ? '正确' : '错误' }] }]; });
    const { wrapper, core } = await mountEditor({ modelValue: source });
    expect(typeof core.commands.addQuestionOption).toBe('function');
    expect(typeof core.commands.removeQuestionOption).toBe('function');
    expect(wrapper.get('[data-client-id="first"]').find('button[aria-label="添加选项"]').exists()).toBe(false);
    expect(wrapper.get('[data-client-id="first"]').find('button[aria-label^="删除选项"]').exists()).toBe(false);
    const before = core.getJSON();
    expect(core.commands.addQuestionOption('first')).toBe(false);
    expect(core.commands.removeQuestionOption('first_a')).toBe(false);
    expect(core.getJSON()).toEqual(before);
  });
});
