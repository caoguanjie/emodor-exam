import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'https://editor-research.invalid',
});
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DOMParser', 'MutationObserver']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { Editor, Extension } = await import('@tiptap/core');
const { StarterKit } = await import('@tiptap/starter-kit');
const { HorizontalRule } = await import('@tiptap/extension-horizontal-rule');
const { TableKit } = await import('@tiptap/extension-table');
const { TextStyleKit, FontSize, LineHeight } = await import('@tiptap/extension-text-style');
const vueBindings = await import('@tiptap/vue-3');
const results = [];
const created = [];
const makeEditor = options => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({ element, content: '<p>example</p>', ...options });
  created.push(editor);
  return editor;
};
function check(name, run) {
  try {
    const evidence = run();
    results.push({ name, status: 'passed', evidence });
  } catch (error) {
    results.push({ name, status: 'failed', error: error.stack });
  }
}

check('public exports used by Vue editor remain present', () => {
  assert.ok(TableKit && TextStyleKit && FontSize && LineHeight);
  for (const name of ['useEditor', 'EditorContent', 'VueNodeViewRenderer', 'NodeViewContent']) {
    assert.ok(vueBindings[name], name);
  }
  return { TableKit: true, TextStyleKit: true, vueBindings: true };
});

check('source extension list duplicates horizontalRule', () => {
  const warnings = [];
  const originalWarn = console.warn;
  let editor;
  try {
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
    editor = makeEditor({ extensions: [StarterKit, HorizontalRule] });
  } finally {
    console.warn = originalWarn;
  }
  const count = editor.extensionManager.extensions.filter(extension => extension.name === 'horizontalRule').length;
  assert.equal(count, 2);
  assert.ok(warnings.some(text => text.includes('horizontalRule')));
  return { extensionCount: count, warnings };
});

check('setContent update emission is explicitly controllable', () => {
  let updates = 0;
  const editor = makeEditor({ extensions: [StarterKit], onUpdate: () => { updates += 1; } });
  editor.commands.setContent('<p>first load</p>');
  assert.equal(updates, 1);
  editor.commands.setContent('<p>second load</p>', { emitUpdate: false, errorOnInvalidContent: true });
  assert.equal(updates, 1);
  return { defaultEmits: true, explicitFalseSuppresses: true };
});

check('readonly editor still accepts programmatic mutation', () => {
  const editor = makeEditor({ extensions: [StarterKit] });
  editor.setEditable(false, false);
  const before = editor.getText();
  editor.commands.insertContent('changed by command ');
  assert.equal(editor.isEditable, false);
  assert.notEqual(editor.getText(), before);
  return { editable: editor.isEditable, commandChangedContent: true };
});

check('official FontSize writes a textStyle mark', () => {
  const editor = makeEditor({ extensions: [StarterKit, TextStyleKit] });
  editor.commands.setTextSelection({ from: 1, to: 4 });
  assert.equal(editor.commands.setFontSize('18px'), true);
  const mark = editor.getJSON().content[0].content[0].marks.find(mark => mark.type === 'textStyle');
  assert.equal(mark.attrs.fontSize, '18px');
  return { markType: mark.type, fontSize: mark.attrs.fontSize };
});

check('official LineHeight defaults differ from legacy paragraph attrs', () => {
  const editor = makeEditor({ extensions: [StarterKit, TextStyleKit] });
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph', attrs: { lineHeight: '2' }, content: [{ type: 'text', text: 'legacy' }] }],
  }, { emitUpdate: false });
  const legacyAttrAfterLoad = editor.getJSON().content[0].attrs?.lineHeight ?? null;
  assert.equal(legacyAttrAfterLoad, null);
  editor.commands.setTextSelection({ from: 1, to: 4 });
  editor.commands.setLineHeight('2');
  const mark = editor.getJSON().content[0].content[0].marks.find(mark => mark.type === 'textStyle');
  assert.equal(mark.attrs.lineHeight, '2');
  return { legacyParagraphAttrRetained: false, officialMarkType: mark.type, officialMarkLineHeight: mark.attrs.lineHeight };
});

check('legacy paragraph schema can preserve existing lineHeight JSON', () => {
  const LegacyParagraphLineHeight = Extension.create({
    name: 'legacyParagraphLineHeight',
    addGlobalAttributes() {
      return [{ types: ['paragraph', 'heading', 'listItem'], attributes: {
        lineHeight: {
          default: 0,
          parseHTML: element => element.style.lineHeight,
          renderHTML: attributes => attributes.lineHeight ? { style: `line-height: ${attributes.lineHeight}` } : {},
        },
      } }];
    },
  });
  const editor = makeEditor({ extensions: [StarterKit, LegacyParagraphLineHeight] });
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph', attrs: { lineHeight: '2' }, content: [{ type: 'text', text: 'legacy' }] }],
  }, { emitUpdate: false, errorOnInvalidContent: true });
  assert.equal(editor.getJSON().content[0].attrs.lineHeight, '2');
  assert.match(editor.getHTML(), /line-height: 2/);
  return { legacyParagraphAttrRetained: true };
});

check('TableKit still supports insertion and JSON table schema', () => {
  const editor = makeEditor({ extensions: [StarterKit, TableKit.configure({ table: { resizable: true, handleWidth: 5 } })] });
  assert.equal(editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true }), true);
  const table = editor.getJSON().content.find(node => node.type === 'table');
  assert.equal(table.content.length, 2);
  assert.equal(table.content[0].content[0].type, 'tableHeader');
  return { rows: table.content.length, firstCell: table.content[0].content[0].type };
});

check('beta.7 already exports TableKit and official text style helpers', () => {
  const beta = createRequire(new URL('./beta/package.json', import.meta.url));
  const styles = beta('@tiptap/extension-text-style');
  const tables = beta('@tiptap/extension-table');
  for (const name of ['TextStyleKit', 'FontSize', 'LineHeight']) assert.ok(styles[name]);
  assert.ok(tables.TableKit);
  return { baseline: '3.0.0-beta.7', alreadyPresent: ['TableKit', 'TextStyleKit', 'FontSize', 'LineHeight'] };
});

const { Editor: BetaEditor } = await import(new URL('./beta/node_modules/@tiptap/core/dist/index.js', import.meta.url));
const { StarterKit: BetaStarterKit } = await import(new URL('./beta/node_modules/@tiptap/starter-kit/dist/index.js', import.meta.url));
check('beta.7 already emits updates by default and contains HorizontalRule', () => {
  let updates = 0;
  const editor = new BetaEditor({
    element: document.createElement('div'),
    extensions: [BetaStarterKit],
    content: '<p>baseline</p>',
    onUpdate: () => { updates += 1; },
  });
  created.push(editor);
  editor.commands.setContent('<p>changed</p>');
  assert.equal(updates, 1);
  editor.commands.setContent('<p>silent</p>', { emitUpdate: false });
  assert.equal(updates, 1);
  assert.equal(editor.extensionManager.extensions.filter(extension => extension.name === 'horizontalRule').length, 1);
  return { baseline: '3.0.0-beta.7', defaultEmits: true, explicitFalseSuppresses: true, StarterKitIncludesHorizontalRule: true };
});

for (const editor of created) editor.destroy();
dom.window.close();
console.log(JSON.stringify({ node: process.version, tiptap: '3.32.0', environment: 'isolated jsdom API probes, not Vue app/browser acceptance', results }, null, 2));
if (results.some(result => result.status === 'failed')) process.exitCode = 1;
