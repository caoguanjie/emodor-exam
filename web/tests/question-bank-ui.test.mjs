import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { computed, createRenderer, h, inject, nextTick, provide } from '@vue/runtime-core';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const previewClientId = '\0question-preview-client-test';
const editorClientId = '\0question-editor-client-test';
const questionsClientId = '\0questions-client-test';
const mediaStubId = '\0question-media-test';
const httpStubId = '\0question-http-test';
const authStubId = '\0question-auth-test';
const formatStubId = '\0question-format-test';
const elementStubId = '\0question-element-test';
const editorStubId = '\0question-editor-child-test';
const previewStubId = '\0question-preview-child-test';
const mediaUploadStubId = '\0question-media-upload-test';
const clientCode = new Map();
const virtualStubs = new Map([
  ['virtual:question-media-test', mediaStubId],
  ['virtual:question-http-test', httpStubId],
  ['virtual:question-auth-test', authStubId],
  ['virtual:question-format-test', formatStubId],
  ['virtual:question-element-test', elementStubId],
  ['virtual:question-editor-child-test', editorStubId],
  ['virtual:question-preview-child-test', previewStubId],
  ['virtual:question-media-upload-test', mediaUploadStubId],
]);

const context = {
  permissions: new Set(),
  row: null,
  calls: [],
  messages: [],
  editorModels: [],
  mediaCalls: [],
  conceptTotal: 41,
  historyTotal: 41,
  http: null,
};

const stubs = new Map([
  [mediaStubId, `
    const context = globalThis.__questionBankUiTest;
    export async function getMediaImageContent(assetId) {
      context.mediaCalls.push(assetId);
      return new Blob(['image'], { type: 'image/png' });
    }
  `],
  [httpStubId, `
    const context = globalThis.__questionBankUiTest;
    export default {
      get(url, config) { return context.http('get', url, undefined, config); },
      post(url, body, config) { return context.http('post', url, body, config); },
      put(url, body, config) { return context.http('put', url, body, config); },
    };
  `],
  [authStubId, `
    const context = globalThis.__questionBankUiTest;
    export function useAuthStore() {
      return { can(permission) { return context.permissions.has(permission); } };
    }
  `],
  [formatStubId, `export function formatDateTime(value) { return String(value || ''); }`],
  [elementStubId, `
    const context = globalThis.__questionBankUiTest;
    export const ElMessage = {
      success(message) { context.messages.push({ type: 'success', message }); },
      warning(message) { context.messages.push({ type: 'warning', message }); },
      error(message) { context.messages.push({ type: 'error', message }); },
    };
    export const ElMessageBox = {
      async confirm() { return true; },
      async prompt() { return { value: 'test reason' }; },
    };
  `],
  [editorStubId, `
    import { h } from 'vue';
    const context = globalThis.__questionBankUiTest;
    export default {
      props: ['modelValue', 'categories', 'concepts', 'regulations', 'canUploadMedia', 'conceptLoading'],
      emits: ['update:modelValue', 'scope-change', 'concept-search'],
      setup(props, { emit }) {
        return () => {
          context.editorModels.push(JSON.parse(JSON.stringify(props.modelValue)));
          return h('question-editor-stub', { difficulty: props.modelValue.difficulty }, [
            h('button', { onClick: () => emit('update:modelValue', { ...props.modelValue, difficulty: 'hard' }) }, 'choose-hard'),
          ]);
        };
      },
    };
  `],
  [previewStubId, `
    import { h } from 'vue';
    export default { props: ['question'], setup(props) { return () => h('question-preview-stub', { stem: props.question?.stem || '' }); } };
  `],
  [mediaUploadStubId, `
    import { h } from 'vue';
    export default { props: ['modelValue'], setup() { return () => h('media-upload-stub'); } };
  `],
]);

let vite;
let QuestionPreview;
let QuestionEditor;
let Questions;
let trainingTypes;

function plugin() {
  return {
    name: 'question-bank-ui-test-stubs',
    enforce: 'pre',
    resolveId(source, importer) {
      if (virtualStubs.has(source)) return virtualStubs.get(source);
      if (clientCode.has(source) || stubs.has(source)) return source;
      const owner = String(importer || '');
      if ((source === '../api/media' || source === '/src/api/media.ts') && owner.includes('question-preview')) return mediaStubId;
      if ((source === './MediaUpload.vue' || source === '/src/components/MediaUpload.vue') && owner.includes('question-editor-client-test')) return mediaUploadStubId;
      if (owner.includes('questions-client-test')) {
        if (source === 'element-plus') return elementStubId;
        if (source === '../../api/http' || source === '/src/api/http.ts') return httpStubId;
        if (source === '../../stores/auth' || source === '/src/stores/auth.ts') return authStubId;
        if (source === '../../utils/format' || source === '/src/utils/format.ts') return formatStubId;
        if (source === '../../components/QuestionEditor.vue' || source === '/src/components/QuestionEditor.vue') return editorStubId;
        if (source === '../../components/QuestionPreview.vue' || source === '/src/components/QuestionPreview.vue') return previewStubId;
      }
      return undefined;
    },
    load(id) {
      return clientCode.get(id) || stubs.get(id) || undefined;
    },
  };
}

function stripViteClientGlue(code, path) {
  let output = code
    .replace(/^import \{ createHotContext[\s\S]*?import\.meta\.hot = [^;]+;\s*/, '')
    .replace(/typeof __VUE_HMR_RUNTIME__[\s\S]*?(?=import _export_sfc)/, '')
    .replace(/from "\/node_modules\/\.vite\/deps\/vue\.js[^"]*"/g, 'from "vue"');
  if (path.endsWith('/QuestionPreview.vue')) {
    output = output.replace(/from "\/src\/api\/media\.ts"/g, 'from "virtual:question-media-test"');
  } else if (path.endsWith('/QuestionEditor.vue')) {
    output = output.replace(/from "\/src\/components\/MediaUpload\.vue"/g, 'from "virtual:question-media-upload-test"');
  } else if (path.endsWith('/Questions.vue')) {
    output = output
      .replace(/from "\/node_modules\/\.vite\/deps\/element-plus\.js[^"]*"/g, 'from "virtual:question-element-test"')
      .replace(/from "\/src\/api\/http\.ts"/g, 'from "virtual:question-http-test"')
      .replace(/from "\/src\/stores\/auth\.ts"/g, 'from "virtual:question-auth-test"')
      .replace(/from "\/src\/utils\/format\.ts"/g, 'from "virtual:question-format-test"')
      .replace(/from "\/src\/components\/QuestionEditor\.vue"/g, 'from "virtual:question-editor-child-test"')
      .replace(/from "\/src\/components\/QuestionPreview\.vue"/g, 'from "virtual:question-preview-child-test"');
  }
  return output;
}

async function loadClientSfc(path, id) {
  const transformed = await vite.transformRequest(path);
  assert.ok(transformed?.code, `Vite should compile ${path}`);
  clientCode.set(id, stripViteClientGlue(transformed.code, path));
  return (await vite.ssrLoadModule(id)).default;
}

function renderer() {
  return createRenderer({
    patchProp(node, key, _previous, value) { node.props[key] = value; },
    insert(node, parent, anchor = null) {
      node.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index >= 0) parent.children.splice(index, 0, node);
      else parent.children.push(node);
    },
    remove(node) {
      const index = node.parent?.children.indexOf(node) ?? -1;
      if (index >= 0) node.parent.children.splice(index, 1);
      node.parent = null;
    },
    createElement(type) { return { type, props: {}, children: [], parent: null, text: '' }; },
    createText(text) { return { type: '#text', props: {}, children: [], parent: null, text }; },
    createComment(text) { return { type: '#comment', props: {}, children: [], parent: null, text }; },
    setText(node, text) { node.text = text; },
    setElementText(node, text) { node.text = text; node.children = []; },
    parentNode(node) { return node.parent; },
    nextSibling(node) {
      const index = node.parent?.children.indexOf(node) ?? -1;
      return index >= 0 ? node.parent.children[index + 1] || null : null;
    },
    querySelector() { return null; },
    setScopeId() {},
    cloneNode(node) { return { ...node, props: { ...node.props }, children: [...node.children] }; },
    insertStaticContent(content, parent, anchor) {
      const node = { type: '#static', props: {}, children: [], parent: null, text: content };
      node.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index >= 0) parent.children.splice(index, 0, node);
      else parent.children.push(node);
      return [node, node];
    },
  });
}

const Wrapper = {
  inheritAttrs: false,
  setup(_props, { attrs, slots }) { return () => h('el-wrapper', attrs, slots.default?.()); },
};
const Button = {
  inheritAttrs: false,
  setup(_props, { attrs, slots }) { return () => h('button', attrs, slots.default?.()); },
};
const Dialog = {
  inheritAttrs: false,
  props: { modelValue: Boolean },
  setup(props, { attrs, slots }) {
    return () => props.modelValue ? h('dialog', attrs, [...(slots.default?.() || []), ...(slots.footer?.() || [])]) : null;
  },
};
const Table = {
  inheritAttrs: false,
  props: { data: { type: Array, default: () => [] } },
  setup(props, { attrs, slots }) {
    provide('question-table-row', computed(() => props.data[0] || null));
    return () => h('table', attrs, slots.default?.());
  },
};
const TableColumn = {
  setup(_props, { slots }) {
    const row = inject('question-table-row');
    return () => h('table-column', {}, row?.value && slots.default ? slots.default({ row: row.value }) : []);
  },
};
const Pagination = {
  inheritAttrs: false,
  props: { total: { type: Number, default: 0 }, currentPage: { type: Number, default: 1 }, pageSize: { type: Number, default: 20 } },
  setup(props, { attrs }) {
    return () => h('pagination', { total: props.total, page: props.currentPage, pageSize: props.pageSize }, [
      h('button', {
        onClick: () => {
          attrs['onUpdate:currentPage']?.(2);
          attrs.onCurrentChange?.(2);
        },
      }, `page-${props.total}-2`),
    ]);
  },
};

function registerUi(app) {
  const wrappers = [
    'el-alert', 'el-empty', 'el-tag', 'el-input', 'el-form', 'el-form-item', 'el-select', 'el-option',
    'el-input-number', 'el-checkbox', 'el-radio-group', 'el-radio', 'el-text', 'el-divider', 'el-timeline',
    'el-timeline-item', 'el-result',
  ];
  for (const name of wrappers) app.component(name, Wrapper);
  app.component('el-button', Button);
  app.component('el-dialog', Dialog);
  app.component('el-table', Table);
  app.component('el-table-column', TableColumn);
  app.component('el-pagination', Pagination);
}

function mount(Component, props = {}) {
  const host = renderer();
  const root = { type: 'root', props: {}, children: [], parent: null, text: '' };
  const app = host.createApp(Component, props);
  registerUi(app);
  app.directive('loading', {});
  app.mount(root);
  return { root, unmount: () => app.unmount() };
}

function walk(node, predicate, output = []) {
  if (!node) return output;
  if (predicate(node)) output.push(node);
  for (const child of node.children || []) walk(child, predicate, output);
  return output;
}

function nodeText(node) {
  return `${node.text || ''}${(node.children || []).map(nodeText).join('')}`;
}

function button(root, label) {
  return walk(root, (node) => node.type === 'button' && nodeText(node).trim() === label)[0] || null;
}

async function click(node) {
  assert.ok(node, 'expected clickable node');
  assert.notEqual(node.props.disabled, true, `button ${nodeText(node)} should be enabled`);
  await node.props.onClick?.();
  await nextTick();
}

function waitFor(predicate, label, timeoutMs = 2500) {
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const check = () => {
      if (predicate()) return resolvePromise();
      if (Date.now() - started >= timeoutMs) return reject(new Error(`timed out waiting for ${label}`));
      setTimeout(check, 10);
    };
    check();
  });
}

function controlledMediaDocument() {
  const escapeText = (value) => String(value).replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]);
  const escapeAttribute = (value) => escapeText(value).replace(/"/g, '&quot;');

  class TestNode {
    constructor(nodeType) {
      this.nodeType = nodeType;
      this.nodeValue = null;
      this.childNodes = [];
      this.parentNode = null;
    }
    appendChild(node) {
      node.parentNode = this;
      this.childNodes.push(node);
      return node;
    }
    remove() {
      const index = this.parentNode?.childNodes.indexOf(this) ?? -1;
      if (index >= 0) this.parentNode.childNodes.splice(index, 1);
      this.parentNode = null;
    }
    replaceWith(node) {
      const index = this.parentNode?.childNodes.indexOf(this) ?? -1;
      if (index < 0) return;
      node.parentNode = this.parentNode;
      this.parentNode.childNodes.splice(index, 1, node);
      this.parentNode = null;
    }
    querySelectorAll(selector) {
      const output = [];
      for (const child of this.childNodes) {
        if (child.nodeType === 1 && selector === 'img[data-media-id]' && child.tagName === 'IMG' && child.getAttribute('data-media-id')) output.push(child);
        output.push(...child.querySelectorAll(selector));
      }
      return output;
    }
  }

  class TestText extends TestNode {
    constructor(value) {
      super(3);
      this.nodeValue = value;
    }
  }

  class TestElement extends TestNode {
    constructor(tag) {
      super(1);
      this.tagName = tag.toUpperCase();
      this.namespaceURI = 'http://www.w3.org/1999/xhtml';
      this.attributes = new Map();
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    get dataset() { return { mediaId: this.getAttribute('data-media-id') || '' }; }
    set src(value) { this.setAttribute('src', value); }
    set loading(value) { this.setAttribute('loading', value); }
    set className(value) { this.setAttribute('class', value); }
    set textContent(value) {
      this.childNodes = [];
      this.appendChild(new TestText(String(value)));
    }
  }

  class TestFragment extends TestNode {
    constructor() { super(11); }
  }

  function parse(html, target) {
    const stack = [target];
    const tokens = String(html).matchAll(/<\/?([a-z][\w-]*)([^>]*)>|([^<]+)/gi);
    for (const token of tokens) {
      if (token[3] !== undefined) {
        stack.at(-1).appendChild(new TestText(token[3]));
        continue;
      }
      const raw = token[0];
      if (raw.startsWith('</')) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const element = new TestElement(token[1]);
      for (const attribute of String(token[2] || '').matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        element.setAttribute(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
      }
      stack.at(-1).appendChild(element);
      if (!['img', 'br'].includes(token[1].toLowerCase()) && !raw.endsWith('/>')) stack.push(element);
    }
  }

  function serialize(node) {
    if (node.nodeType === 3) return escapeText(node.nodeValue || '');
    const children = node.childNodes.map(serialize).join('');
    if (node.nodeType !== 1) return children;
    const tag = node.tagName.toLowerCase();
    const attributes = [...node.attributes].map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('');
    return ['img', 'br'].includes(tag) ? `<${tag}${attributes}>` : `<${tag}${attributes}>${children}</${tag}>`;
  }

  class TestTemplate extends TestElement {
    constructor() {
      super('template');
      this.content = new TestFragment();
    }
    set innerHTML(value) {
      this.content = new TestFragment();
      parse(value, this.content);
    }
    get innerHTML() { return this.content.childNodes.map(serialize).join(''); }
  }

  return {
    createElement(tag) { return tag.toLowerCase() === 'template' ? new TestTemplate() : new TestElement(tag); },
    createTextNode(value) { return new TestText(String(value)); },
  };
}

function legacyRow(overrides = {}) {
  return {
    id: 1,
    question_id: '9007199254740993',
    category_id: '7',
    difficulty: null,
    current_version_id: null,
    revision: null,
    status: 'pending',
    source: 'ai',
    type: 'single',
    stem: '<img src="https://attacker.invalid/a.png" onerror="globalThis.pwned=1"><script>globalThis.pwned=2</script><p>旧题</p>',
    options: [{ key: 'A', text: '<svg onload="globalThis.pwned=3"></svg>A' }, { key: 'B', text: 'B' }],
    answer: [0],
    analysis: '<a href="javascript:globalThis.pwned=4">解析</a>',
    rubric: null,
    score: 5,
    concept_id: null,
    regulation_id: '10',
    regulation_version_id: '11',
    approved_by: null,
    approved_at: null,
    reviewed_by: null,
    reviewed_at: null,
    review_reason: null,
    legacy_captured_at: null,
    ...overrides,
  };
}

function setHttp() {
  context.http = async (method, url, body, config) => {
    context.calls.push({ method, url, body, config });
    if (method === 'get' && url.includes('category-')) return { items: [{ id: '7', name: '安全培训' }], total: 1, page: 1, page_size: 20 };
    if (method === 'get' && url === '/regulations') return { list: [] };
    if (method === 'get' && url === '/ai/questions') return { list: context.row ? [context.row] : [], total: context.row ? 1 : 0 };
    if (method === 'get' && url === '/ai/question-concepts') {
      const page = Number(config?.params?.page || 1);
      return { items: [{ id: String(page), category_id: '7', type: 'single', name: `筛选考点${page}` }], total: context.conceptTotal, page, page_size: 20 };
    }
    if (method === 'get' && url === '/ai/question-concept-options') {
      const page = Number(config?.params?.page || 1);
      return { items: [{ id: String(page), name: `编辑考点${page}` }], total: context.conceptTotal, page, page_size: 20 };
    }
    if (method === 'get' && url.endsWith('/history')) {
      const page = Number(config?.params?.page || 1);
      return { items: [{ id: `v${page}`, revision: page, status: 'pending', created_at: '2026-10-21T00:00:00Z' }], total: context.historyTotal, page, page_size: 20 };
    }
    if (method === 'get' && url.includes('/versions')) return { items: [], total: 0, page: 1, page_size: 20 };
    return {};
  };
}

before(async () => {
  globalThis.__questionBankUiTest = context;
  vite = await createServer({
    root: webRoot,
    configFile: resolve(webRoot, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    plugins: [plugin()],
  });
  trainingTypes = await import('../src/api/training-types.ts');
  QuestionPreview = await loadClientSfc('/src/components/QuestionPreview.vue', previewClientId);
  QuestionEditor = await loadClientSfc('/src/components/QuestionEditor.vue', editorClientId);
  Questions = await loadClientSfc('/src/views/admin/Questions.vue', questionsClientId);
});

after(async () => {
  delete globalThis.__questionBankUiTest;
  await vite?.close();
});

beforeEach(() => {
  context.permissions = new Set(['questions:read', 'questions:write', 'questions:review']);
  context.row = legacyRow();
  context.calls = [];
  context.messages = [];
  context.editorModels = [];
  context.mediaCalls = [];
  context.conceptTotal = 41;
  context.historyTotal = 41;
  setHttp();
});

test('uses a conservative non-DOM fallback instead of regex-filtered HTML', () => {
  const payload = '<img src="https://attacker.invalid/x?a=1&b=2" onerror="steal(\'x\')"><b>"可见" & \'文本\'</b>';
  const rendered = trainingTypes.sanitizeQuestionHtmlForPreview(payload);
  assert.equal(
    rendered,
    '&lt;img src=&quot;https://attacker.invalid/x?a=1&amp;b=2&quot; onerror=&quot;steal(&#39;x&#39;)&quot;&gt;'
      + '&lt;b&gt;&quot;可见&quot; &amp; &#39;文本&#39;&lt;/b&gt;',
  );
  assert.equal(rendered.includes('<img'), false);
  assert.equal(rendered.includes('<b>'), false);
});

test('preserves unknown legacy difficulty in the real QuestionEditor SFC', async () => {
  const mounted = mount(QuestionEditor, {
    modelValue: trainingTypes.questionDraftFromView(context.row),
    categories: [{ id: '7', name: '安全培训' }],
    concepts: [],
    regulations: [],
  });
  await nextTick();
  const selects = walk(mounted.root, (node) => node.type === 'el-wrapper');
  assert.ok(selects.some((node) => node.props.modelValue === ''), 'difficulty select should stay blank for a legacy row');
  mounted.unmount();
});

test('sanitizes malicious legacy and unsaved fields before the real preview SFC v-html boundary', async () => {
  const question = legacyRow({
    stem: '<img src="https://attacker.invalid/stem" onerror="alert(1)"><p>题干</p>',
    options: [{ key: 'A', text: '<svg onload="alert(2)">x</svg>' }, { key: 'B', text: '<a href="javascript:alert(3)">B</a>' }],
    analysis: '<iframe src="https://attacker.invalid/frame"></iframe><b>解析</b>',
  });
  const mounted = mount(QuestionPreview, { question, revealAnswer: true });
  await waitFor(() => walk(mounted.root, (node) => Object.hasOwn(node.props, 'innerHTML')).length >= 3, 'preview html');
  const htmlValues = walk(mounted.root, (node) => Object.hasOwn(node.props, 'innerHTML')).map((node) => String(node.props.innerHTML));
  assert.ok(htmlValues.every((value) => !/<(?:script|iframe|svg|img\b[^>]*\bsrc=)/i.test(value)));
  assert.ok(htmlValues.every((value) => !/<[^>]+(?:\bon\w+\s*=|href\s*=\s*["']?javascript:)/i.test(value)));
  assert.deepEqual(context.mediaCalls, [], 'uncontrolled images must never call authenticated media content');
  mounted.unmount();

  const unsaved = mount(QuestionPreview, {
    question: { type: 'image', difficulty: 'easy', stem: '草稿', options: [], answer: [], analysis: null, rubric: '<img src="https://attacker.invalid/rubric"><script>alert(4)</script><b>评分参考</b>' },
  });
  await waitFor(() => walk(unsaved.root, (node) => Object.hasOwn(node.props, 'innerHTML')).length >= 2, 'unsaved rubric preview');
  const unsavedHtml = walk(unsaved.root, (node) => Object.hasOwn(node.props, 'innerHTML')).map((node) => String(node.props.innerHTML));
  assert.ok(unsavedHtml.every((value) => !/<(?:script|img\b[^>]*\bsrc=)/i.test(value)));
  assert.deepEqual(context.mediaCalls, []);
  unsaved.unmount();
});

test('hydrates only controlled media through the authenticated API and revokes its blob URL', async () => {
  const originalDocument = globalThis.document;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const revoked = [];
  globalThis.document = controlledMediaDocument();
  URL.createObjectURL = () => 'blob:question-preview-test';
  URL.revokeObjectURL = (value) => revoked.push(value);
  try {
    const mounted = mount(QuestionPreview, {
      question: {
        type: 'single', difficulty: 'easy', stem: '<p>受控图<img data-media-id="42" alt="题图"></p>',
        options: [{ key: 'A', text: 'A' }, { key: 'B', text: 'B' }], answer: [0], analysis: null, rubric: null,
      },
    });
    await waitFor(() => context.mediaCalls.includes('42'), 'controlled media fetch');
    await waitFor(() => walk(mounted.root, (node) => String(node.props.innerHTML || '').includes('blob:question-preview-test')).length > 0, 'blob preview');
    assert.deepEqual(context.mediaCalls, ['42']);
    const html = walk(mounted.root, (node) => String(node.props.innerHTML || '').includes('blob:question-preview-test'))[0].props.innerHTML;
    assert.match(html, /src="blob:question-preview-test"/);
    assert.doesNotMatch(html, /data-media-id/);
    mounted.unmount();
    assert.deepEqual(revoked, ['blob:question-preview-test']);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  }
});

test('rebuilds a common malicious payload through the allowlist in the simulated DOM branch', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = controlledMediaDocument();
  try {
    const mounted = mount(QuestionPreview, {
      question: {
        type: 'single', difficulty: 'easy',
        stem: '<img src="https://attacker.invalid/x" onerror="alert(1)"><script>alert(2)</script><p onclick="alert(3)">安全文本</p>',
        options: [{ key: 'A', text: '<a href="javascript:alert(4)" style="background:url(https://attacker.invalid/x)">A</a>' }, { key: 'B', text: 'B' }],
        answer: [0], analysis: '<iframe src="https://attacker.invalid/frame"></iframe><b>解析</b>', rubric: null,
      },
    });
    await waitFor(() => walk(mounted.root, (node) => Object.hasOwn(node.props, 'innerHTML')).length >= 4, 'simulated allowlist output');
    const values = walk(mounted.root, (node) => Object.hasOwn(node.props, 'innerHTML')).map((node) => String(node.props.innerHTML));
    assert.ok(values.every((value) => !/(?:<script|<iframe|<img|\bonerror=|\bonclick=|javascript:|background:)/i.test(value)));
    assert.ok(values.some((value) => value.includes('<p>安全文本</p>')));
    assert.deepEqual(context.mediaCalls, []);
    mounted.unmount();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('renders a malicious legacy stem as list text without an innerHTML sink', async () => {
  const mounted = mount(Questions);
  await waitFor(() => context.calls.some((call) => call.method === 'get' && call.url === '/ai/questions'), 'question list');
  await nextTick();
  const summary = walk(mounted.root, (node) => node.props.class === 'stem-summary')[0];
  assert.ok(summary);
  assert.match(nodeText(summary), /<img src="https:\/\/attacker\.invalid/);
  assert.equal(Object.hasOwn(summary.props, 'innerHTML'), false);
  mounted.unmount();
});

test('requires an explicit difficulty for a legacy edit and sends expected_version_id as an owned null key', async () => {
  const mounted = mount(Questions);
  await waitFor(() => context.calls.some((call) => call.method === 'get' && call.url === '/ai/questions'), 'question list');
  await nextTick();
  await click(button(mounted.root, '修订'));
  await waitFor(() => context.calls.some((call) => call.url === '/ai/question-concept-options'), 'editor concepts');
  const saveBeforeChoice = button(mounted.root, '保存为待审核版本');
  assert.equal(saveBeforeChoice?.props.disabled, true, 'legacy edit cannot save until difficulty is explicitly selected');

  await click(button(mounted.root, 'choose-hard'));
  await nextTick();
  await click(button(mounted.root, '保存为待审核版本'));
  await waitFor(() => context.calls.some((call) => call.method === 'put' && call.url === `/ai/questions/${context.row.question_id}`), 'question edit');
  const write = context.calls.find((call) => call.method === 'put' && call.url === `/ai/questions/${context.row.question_id}`);
  assert.equal(Object.hasOwn(write.body, 'expected_version_id'), true);
  assert.equal(write.body.expected_version_id, null);
  assert.equal(write.body.difficulty, 'hard');
  mounted.unmount();
});

test('sends the exact decimal expected version for review and regenerate', async () => {
  context.row = legacyRow({ current_version_id: '900719925474099312345', revision: 3, difficulty: 'medium' });
  const mounted = mount(Questions);
  await waitFor(() => context.calls.some((call) => call.method === 'get' && call.url === '/ai/questions'), 'question list');
  await nextTick();
  await click(button(mounted.root, '通过'));
  await click(button(mounted.root, '重生成'));
  const review = context.calls.find((call) => call.method === 'put' && call.url.endsWith('/review'));
  const regenerate = context.calls.find((call) => call.method === 'post' && call.url.endsWith('/regenerate'));
  assert.deepEqual(review.body, { expected_version_id: '900719925474099312345', status: 'approved', reason: undefined });
  assert.deepEqual(regenerate.body, { expected_version_id: '900719925474099312345' });
  mounted.unmount();
});

test('consumes and pages the questions:read concept Page without changing the legacy question list shape', async () => {
  const mounted = mount(Questions);
  await waitFor(() => context.calls.some((call) => call.method === 'get' && call.url === '/ai/questions'), 'question list');
  const categorySelect = walk(mounted.root, (node) => node.type === 'el-wrapper' && node.props.placeholder === '培训类别')[0];
  assert.ok(categorySelect);
  categorySelect.props['onUpdate:modelValue']?.('7');
  await categorySelect.props.onChange?.('7');
  await waitFor(() => context.calls.some((call) => call.url === '/ai/question-concepts'), 'filter concepts');
  const first = context.calls.find((call) => call.url === '/ai/question-concepts');
  assert.deepEqual(first.config.params, { category_id: '7', page: 1, page_size: 20 });
  await click(button(mounted.root, `page-${context.conceptTotal}-2`));
  await waitFor(() => context.calls.some((call) => call.url === '/ai/question-concepts' && call.config?.params?.page === 2), 'second filter concept page');
  assert.ok(context.calls.some((call) => call.url === '/ai/questions' && call.method === 'get'));
  mounted.unmount();
});

test('consumes and pages the narrow questions:write concept options without a read request', async () => {
  context.permissions = new Set(['questions:write']);
  context.row = null;
  const mounted = mount(Questions);
  await waitFor(() => context.calls.some((call) => call.url === '/ai/question-category-options'), 'write category options');
  await click(button(mounted.root, '人工录题'));
  await waitFor(() => context.calls.some((call) => call.url === '/ai/question-concept-options'), 'write concept options');
  const first = context.calls.find((call) => call.url === '/ai/question-concept-options');
  assert.deepEqual(first.config.params, { category_id: '7', type: 'single', page: 1, page_size: 20 });
  assert.equal(context.calls.some((call) => call.method === 'get' && call.url === '/ai/questions'), false);
  assert.equal(context.calls.some((call) => call.url === '/ai/question-concepts'), false);
  await click(button(mounted.root, `page-${context.conceptTotal}-2`));
  await waitFor(() => context.calls.some((call) => call.url === '/ai/question-concept-options' && call.config?.params?.page === 2), 'second write concept page');
  mounted.unmount();
});

test('uses the history Page endpoint and requests later history pages', async () => {
  const mounted = mount(Questions);
  await waitFor(() => context.calls.some((call) => call.method === 'get' && call.url === '/ai/questions'), 'question list');
  await click(button(mounted.root, '预览'));
  await waitFor(() => context.calls.some((call) => call.url.includes(`/ai/questions/${context.row.question_id}/`)), 'history request');
  const first = context.calls.find((call) => call.url.endsWith('/history'));
  assert.ok(first, 'preview should use the /history contract');
  assert.deepEqual(first.config.params, { page: 1, page_size: 20 });
  await click(button(mounted.root, `page-${context.historyTotal}-2`));
  await waitFor(() => context.calls.some((call) => call.url.endsWith('/history') && call.config?.params?.page === 2), 'second history page');
  mounted.unmount();
});
