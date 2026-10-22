import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { computed, createRenderer, h, inject, nextTick, provide, watch } from '@vue/runtime-core';
import TreeStore from '../node_modules/element-plus/es/components/tree/src/model/tree-store.mjs';

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
const unsavedStubId = '\0question-unsaved-test';
const routeStubId = '\0question-route-test';
const iconsStubId = '\0question-icons-test';
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
  ['virtual:question-unsaved-test', unsavedStubId],
  ['virtual:question-route-test', routeStubId],
  ['virtual:question-icons-test', iconsStubId],
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
  unsavedSources: [],
  confirmDecisions: [],
  materials: [],
  materialDetail: null,
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
    export function upload(url, file, field, fields) { return context.http('upload', url, { file, field, fields }); }
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
      props: ['modelValue', 'categories', 'concepts', 'canUploadMedia', 'conceptLoading'],
      emits: ['update:modelValue', 'scope-change', 'concept-search'],
      setup(props, { emit }) {
        return () => {
          context.editorModels.push(JSON.parse(JSON.stringify(props.modelValue)));
          return h('question-editor-stub', { difficulty: props.modelValue.difficulty }, [
            h('button', { onClick: () => emit('update:modelValue', { ...props.modelValue, difficulty: 'easy' }) }, 'choose-easy'),
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
  [unsavedStubId, `
    const context = globalThis.__questionBankUiTest;
    export function useUnsavedChanges(dirty, options = {}) {
      const source = {
        dirty,
        options,
        markClean() { dirty.value = false; },
        async confirmDiscard() {
          if (!dirty.value) return true;
          const decision = context.confirmDecisions.shift();
          if (!decision) return false;
          await options.onDiscard?.();
          return true;
        },
      };
      context.unsavedSources.push(source);
      return { markClean: source.markClean, confirmDiscard: source.confirmDiscard };
    }
  `],
  [routeStubId, `export function useRouter() { return { push() {} }; }`],
  [iconsStubId, `
    import { h } from 'vue';
    export const Filter = { setup() { return () => h('filter-icon'); } };
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
      if (owner.includes('/src/views/admin/Questions.vue')) {
        if (source === 'vue-router') return routeStubId;
        if (source === '@element-plus/icons-vue') return iconsStubId;
      }
      if ((source === '../api/media' || source === '/src/api/media.ts') && owner.includes('question-preview')) return mediaStubId;
      if ((source === './MediaUpload.vue' || source === '/src/components/MediaUpload.vue') && owner.includes('question-editor-client-test')) return mediaUploadStubId;
      if (owner.includes('questions-client-test')) {
        if (source === 'element-plus') return elementStubId;
        if (source === '../../api/http' || source === '/src/api/http.ts') return httpStubId;
        if (source === '../../stores/auth' || source === '/src/stores/auth.ts') return authStubId;
        if (source === '../../utils/format' || source === '/src/utils/format.ts') return formatStubId;
        if (source === '../../components/QuestionEditor.vue' || source === '/src/components/QuestionEditor.vue') return editorStubId;
        if (source === '../../components/QuestionPreview.vue' || source === '/src/components/QuestionPreview.vue') return previewStubId;
        if (source === '../../composables/useUnsavedChanges' || source === '/src/composables/useUnsavedChanges.ts') return unsavedStubId;
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
      .replace(/from "\/src\/components\/QuestionPreview\.vue"/g, 'from "virtual:question-preview-child-test"')
      .replace(/from "\/src\/composables\/useUnsavedChanges\.ts"/g, 'from "virtual:question-unsaved-test"')
      .replace(/from "\/node_modules\/\.vite\/deps\/vue-router\.js[^"]*"/g, 'from "virtual:question-route-test"')
      .replace(/from "\/node_modules\/\.vite\/deps\/@element-plus_icons-vue\.js[^"]*"/g, 'from "virtual:question-icons-test"');
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
  props: { modelValue: Boolean, beforeClose: Function },
  setup(props, { attrs, slots }) {
    return () => props.modelValue
      ? h('dialog', { ...attrs, beforeClose: props.beforeClose }, [...(slots.default?.() || []), ...(slots.footer?.() || [])])
      : null;
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
const Tree = {
  inheritAttrs: false,
  props: {
    data: { type: Array, default: () => [] },
    nodeKey: { type: String, default: 'id' },
    props: { type: Object, default: () => ({}) },
  },
  setup(props, { attrs, expose }) {
    let store;
    let requestedKeys = [];
    const rebuild = () => {
      store = new TreeStore({
        data: props.data,
        key: props.nodeKey,
        props: props.props,
        checkStrictly: false,
      });
      store.initialize();
      store.setCheckedKeys(requestedKeys);
    };
    watch(() => props.data, rebuild, { deep: true, immediate: true });
    const setCheckedKeys = (keys) => {
      requestedKeys = [...keys].map(String);
      store.setCheckedKeys(requestedKeys);
    };
    const getCheckedKeys = () => store.getCheckedKeys().map(String);
    const getHalfCheckedKeys = () => store.getHalfCheckedKeys().map(String);
    expose({
      setCheckedKeys,
      getCheckedKeys,
      getHalfCheckedKeys,
    });
    return () => h('tree', {
      ...attrs,
      getCheckedKeys,
      getHalfCheckedKeys,
      triggerCheck(nextChecked) {
        setCheckedKeys(nextChecked);
        attrs.onCheck?.({}, { checkedKeys: getCheckedKeys(), halfCheckedKeys: getHalfCheckedKeys() });
      },
    });
  },
};

function registerUi(app) {
  const wrappers = [
    'el-alert', 'el-empty', 'el-tag', 'el-input', 'el-form', 'el-form-item', 'el-select', 'el-option',
    'el-input-number', 'el-checkbox', 'el-radio-group', 'el-radio', 'el-text', 'el-divider', 'el-timeline',
    'el-timeline-item', 'el-result', 'el-tabs', 'el-tab-pane', 'el-upload', 'el-icon',
  ];
  for (const name of wrappers) app.component(name, Wrapper);
  app.component('el-button', Button);
  app.component('el-dialog', Dialog);
  app.component('el-table', Table);
  app.component('el-table-column', TableColumn);
  app.component('el-pagination', Pagination);
  app.component('el-tree', Tree);
}

function mount(Component, props = {}) {
  const host = renderer();
  const root = { type: 'root', props: {}, children: [], parent: null, text: '' };
  const app = host.createApp(Component, props);
  registerUi(app);
  app.directive('loading', {});
  const instance = app.mount(root);
  return { root, instance, unmount: () => app.unmount() };
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

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
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
    if (method === 'get' && url === '/admin/question-materials') return { items: JSON.parse(JSON.stringify(context.materials)), total: context.materials.length, page: 1, page_size: 100 };
    if (method === 'get' && /^\/admin\/question-materials\/[^/]+$/.test(url)) return JSON.parse(JSON.stringify(context.materialDetail));
    if (method === 'get' && /\/admin\/question-materials\/[^/]+\/versions\/[^/]+\/status$/.test(url)) {
      const versionId = url.split('/').at(-2);
      return JSON.parse(JSON.stringify(context.materialDetail.versions.find((item) => item.id === versionId)));
    }
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
    if (method === 'post' && url === '/admin/question-materials') {
      return { id: 'material-created', title: body.title, description: body.description || null };
    }
    if (method === 'post' && url === '/ai/questions') {
      return { ...(context.row || {}), ...body, question_id: '7001', current_version_id: '7101', saved_version_id: '7101' };
    }
    if (method === 'post' && url === '/ai/generate-questions') return { task_id: 'task-1', status: 'running' };
    if (method === 'put' && /^\/ai\/questions\/[^/]+$/.test(url)) {
      return { ...(context.row || {}), ...body, current_version_id: '7102', saved_version_id: '7102' };
    }
    if (method === 'upload') return { version_id: '502', duplicate_hint: null };
    return {};
  };
}

before(async () => {
  globalThis.__questionBankUiTest = context;
  vite = await createServer({
    root: webRoot,
    configFile: resolve(webRoot, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: false, ws: false },
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
  context.unsavedSources = [];
  context.confirmDecisions = [];
  context.materials = [{ id: 'material-1', title: '安全资料', description: 'AI 出题依据' }];
  context.materialDetail = {
    id: 'material-1', title: '安全资料', description: 'AI 出题依据',
    versions: [
      { id: 'version-pending', version_no: 2, file_type: 'pdf', parse_status: 'pending', failure_reason: null },
      { id: 'version-parsed', version_no: 1, file_type: 'pdf', parse_status: 'parsed', failure_reason: null },
    ],
  };
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
  });
  await nextTick();
  const selects = walk(mounted.root, (node) => node.type === 'el-wrapper');
  assert.ok(selects.some((node) => node.props.modelValue === ''), 'difficulty select should stay blank for a legacy row');
  mounted.unmount();
});

test('limits the real question editor to three objective types while retaining controlled stem images', async () => {
  const mounted = mount(QuestionEditor, {
    modelValue: trainingTypes.questionDraftFromView(legacyRow({ difficulty: 'easy' })),
    categories: [{ id: '7', name: '安全培训' }],
    concepts: [],
    canUploadMedia: true,
  });
  await nextTick();
  const typeValues = walk(mounted.root, (node) => (
    node.type === 'el-wrapper' && ['single', 'multiple', 'judgment', 'image'].includes(node.props.value)
  )).map((node) => node.props.value);
  assert.deepEqual(typeValues, ['single', 'multiple', 'judgment']);
  assert.equal(walk(mounted.root, (node) => node.type === 'media-upload-stub').length, 1);
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

  const legacyCanceled = mount(QuestionPreview, {
    question: { type: 'image', difficulty: 'easy', stem: '草稿', options: [], answer: [], analysis: null, rubric: '<img src="https://attacker.invalid/rubric"><script>alert(4)</script><b>评分参考</b>' },
  });
  await nextTick();
  assert.doesNotMatch(nodeText(legacyCanceled.root), /图片作答题|评分参考/);
  assert.deepEqual(context.mediaCalls, []);
  legacyCanceled.unmount();
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

test('AI generation selects a parsed question-material version and sends the new source contract', async () => {
  context.permissions = new Set(['questions:read', 'questions:write', 'questions:review', 'ai:read', 'ai:write']);
  context.row = null;
  const mounted = mount(Questions);
  await waitFor(() => context.calls.some((call) => call.method === 'get' && call.url === '/admin/question-materials'), 'question materials');
  await click(button(mounted.root, 'AI 出题'));

  const materialSelect = walk(mounted.root, (node) => node.type === 'el-wrapper' && node.props.placeholder === '选择出题资料')[0];
  assert.ok(materialSelect);
  materialSelect.props['onUpdate:modelValue']?.('material-1');
  await materialSelect.props.onChange?.('material-1');
  await nextTick();

  const versionSelect = walk(mounted.root, (node) => node.type === 'el-wrapper' && node.props.placeholder === '选择已解析版本')[0];
  assert.ok(versionSelect);
  const versionOptions = walk(mounted.root, (node) => node.type === 'el-wrapper' && String(node.props.value || '').startsWith('version-'));
  assert.equal(versionOptions.find((node) => node.props.value === 'version-pending')?.props.disabled, true);
  assert.notEqual(versionOptions.find((node) => node.props.value === 'version-parsed')?.props.disabled, true);
  versionSelect.props['onUpdate:modelValue']?.('version-parsed');
  await nextTick();
  await click(button(mounted.root, '发起'));

  const generation = context.calls.find((call) => call.method === 'post' && call.url === '/ai/generate-questions');
  assert.equal(generation.body.material_id, 'material-1');
  assert.equal(generation.body.material_version_id, 'version-parsed');
  assert.equal(Object.hasOwn(generation.body, 'regulation_id'), false);
  mounted.unmount();
});

test('question-material manager creates a source and uploads an immutable version through the frozen API', async () => {
  context.permissions = new Set(['questions:read', 'questions:write', 'ai:read', 'ai:write']);
  const mounted = mount(Questions);
  await waitFor(() => context.calls.some((call) => call.method === 'get' && call.url === '/admin/question-materials'), 'question materials');
  await click(button(mounted.root, 'AI 出题'));
  await click(button(mounted.root, '管理资料'));

  const title = walk(mounted.root, (node) => node.type === 'el-wrapper' && node.props.placeholder === '资料标题')[0];
  const description = walk(mounted.root, (node) => node.type === 'el-wrapper' && node.props.placeholder === '资料说明（可选）')[0];
  title.props['onUpdate:modelValue']?.('新安全资料');
  description.props['onUpdate:modelValue']?.('仅用于 AI 出题');
  await nextTick();
  await click(button(mounted.root, '创建资料'));
  await waitFor(() => context.calls.some((call) => call.method === 'post' && call.url === '/admin/question-materials'), 'material create');

  const created = context.calls.find((call) => call.method === 'post' && call.url === '/admin/question-materials');
  assert.deepEqual(created.body, { title: '新安全资料', description: '仅用于 AI 出题' });
  assert.equal(mounted.instance.$.setupState.genForm.material_id, 'material-created');

  const uploader = walk(mounted.root, (node) => node.type === 'el-wrapper' && node.props.accept === '.pdf,.docx')[0];
  assert.ok(uploader);
  await mounted.instance.$.setupState.onMaterialUpload({ raw: { name: 'source.pdf', type: 'application/pdf', size: 12 } });
  await waitFor(() => context.calls.some((call) => call.method === 'upload'), 'material version upload');
  const uploaded = context.calls.find((call) => call.method === 'upload');
  assert.equal(uploaded.url, '/admin/question-materials/material-created/versions');
  assert.equal(uploaded.body.field, 'file');
  mounted.unmount();
});

test('question workflow teleports dialogs, avoids stacking the material manager, and closes the whole flow', async () => {
  context.permissions = new Set(['questions:read', 'questions:write', 'ai:read', 'ai:write']);
  const mounted = mount(Questions);
  await waitFor(() => context.calls.some((call) => call.url === '/admin/question-materials'), 'question materials');
  await click(button(mounted.root, 'AI 出题'));
  const generationDialog = walk(mounted.root, (node) => node.type === 'dialog' && node.props.title === '发起 AI 出题')[0];
  assert.equal(Object.hasOwn(generationDialog?.props || {}, 'appendToBody') || Object.hasOwn(generationDialog?.props || {}, 'append-to-body'), true);

  await click(button(mounted.root, '管理资料'));
  assert.equal(mounted.instance.$.setupState.genVisible, false);
  assert.equal(mounted.instance.$.setupState.materialVisible, true);
  const materialDialog = walk(mounted.root, (node) => node.type === 'dialog' && node.props.title === '出题资料管理')[0];
  assert.equal(Object.hasOwn(materialDialog?.props || {}, 'appendToBody') || Object.hasOwn(materialDialog?.props || {}, 'append-to-body'), true);

  mounted.instance.$.setupState.genVisible = true;
  mounted.instance.$.setupState.materialVisible = true;
  mounted.instance.$.setupState.taskStatus = 'completed';
  mounted.instance.$.setupState.taskVisible = true;
  await nextTick();
  await click(button(mounted.root, '查看题库'));
  assert.equal(mounted.instance.$.setupState.genVisible, false);
  assert.equal(mounted.instance.$.setupState.materialVisible, false);
  assert.equal(mounted.instance.$.setupState.taskVisible, false);
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

test('protects the real question edit draft across cancel, stale failure, discard, and save', async () => {
  context.row = legacyRow({ current_version_id: '900719925474099312345', revision: 3, difficulty: 'medium' });
  const mounted = mount(Questions);
  await waitFor(() => context.calls.some((call) => call.method === 'get' && call.url === '/ai/questions'), 'question list');
  await click(button(mounted.root, '修订'));
  await click(button(mounted.root, 'choose-hard'));
  await nextTick();

  assert.equal(context.unsavedSources.length, 1, 'question page should register one editor draft source');
  const source = context.unsavedSources[0];
  assert.equal(source.dirty.value, true);

  const normalHttp = context.http;
  context.http = async (method, url, body, config) => {
    if (method === 'put' && url === `/ai/questions/${context.row.question_id}`) {
      throw Object.assign(new Error('题目版本已变化'), { code: 40940 });
    }
    return normalHttp(method, url, body, config);
  };
  await assert.rejects(
    () => button(mounted.root, '保存为待审核版本').props.onClick(),
    (error) => error?.code === 40940,
  );
  await nextTick();
  assert.equal(source.dirty.value, true, 'stale save must keep the draft dirty');
  assert.ok(button(mounted.root, '保存为待审核版本'), 'stale save must keep the editor open');

  context.confirmDecisions.push(false);
  await click(button(mounted.root, '取消'));
  assert.equal(source.dirty.value, true);
  assert.ok(button(mounted.root, '保存为待审核版本'), 'cancelled discard must retain the editor');
  assert.equal(mounted.instance.$.setupState.editorForm.difficulty, 'hard');

  context.confirmDecisions.push(true);
  await click(button(mounted.root, '取消'));
  assert.equal(source.dirty.value, false);
  assert.equal(mounted.instance.$.setupState.editorForm.difficulty, 'medium');
  assert.equal(mounted.instance.$.setupState.editingExpectedVersionId, '900719925474099312345');
  assert.equal(mounted.instance.$.setupState.editorVisible, false);

  context.http = normalHttp;
  await click(button(mounted.root, '修订'));
  await click(button(mounted.root, 'choose-hard'));
  await click(button(mounted.root, '保存为待审核版本'));
  assert.equal(source.dirty.value, false, 'successful save must clean only the editor source');
  assert.equal(mounted.instance.$.setupState.editorVisible, false);
  const saved = context.calls.findLast((call) => call.method === 'put' && call.url === `/ai/questions/${context.row.question_id}`);
  assert.equal(saved.body.expected_version_id, '900719925474099312345');
  mounted.unmount();
});

test('tracks a new manual question draft but not list filters or preview state', async () => {
  const mounted = mount(Questions);
  await waitFor(() => context.calls.some((call) => call.method === 'get' && call.url === '/ai/questions'), 'question list');
  assert.equal(context.unsavedSources.length, 1);
  const source = context.unsavedSources[0];

  const keyword = walk(mounted.root, (node) => node.type === 'el-wrapper' && node.props.placeholder === '搜索题干')[0];
  keyword.props['onUpdate:modelValue']?.('只改筛选');
  await nextTick();
  assert.equal(source.dirty.value, false, 'filters are not persisted drafts');

  await click(button(mounted.root, '人工录题'));
  assert.equal(source.dirty.value, false, 'opening a new baseline is clean');
  await click(button(mounted.root, 'choose-hard'));
  assert.equal(source.dirty.value, true);

  const dialog = walk(mounted.root, (node) => node.type === 'dialog')[0];
  assert.equal(typeof dialog.props.beforeClose, 'function', 'the real dialog template must wire its close hook');
  let closed = 0;
  context.confirmDecisions.push(false);
  await dialog.props.beforeClose(() => { closed += 1; });
  assert.equal(closed, 0, 'cancelled title-bar close must keep the editor open');
  assert.equal(source.dirty.value, true);
  assert.equal(mounted.instance.$.setupState.editorForm.difficulty, 'hard');

  context.confirmDecisions.push(true);
  await dialog.props.beforeClose(() => {
    closed += 1;
    mounted.instance.$.setupState.editorVisible = false;
  });
  await nextTick();
  assert.equal(closed, 1, 'confirmed title-bar close should finish the dialog close');
  assert.equal(source.dirty.value, false);
  assert.equal(mounted.instance.$.setupState.editorForm.difficulty, 'easy');
  assert.equal(mounted.instance.$.setupState.editorVisible, false);
  mounted.unmount();
});


test('keeps edits made after a delayed question submit and ignores that response after opening another draft', async () => {
  context.row = legacyRow({ current_version_id: '900719925474099312345', revision: 3, difficulty: 'medium' });
  const mounted = mount(Questions);
  await waitFor(() => context.calls.some((call) => call.method === 'get' && call.url === '/ai/questions'), 'question list');
  await click(button(mounted.root, '修订'));
  const source = context.unsavedSources[0];
  const normalHttp = context.http;
  const pending = [];
  context.http = async (method, url, body, config) => {
    if (method === 'put' && url === `/ai/questions/${context.row.question_id}`) {
      context.calls.push({ method, url, body, config });
      const gate = deferred();
      pending.push(gate);
      return gate.promise;
    }
    return normalHttp(method, url, body, config);
  };

  await click(button(mounted.root, 'choose-hard'));
  const firstSave = button(mounted.root, '保存为待审核版本').props.onClick();
  await waitFor(() => pending.length === 1, 'first delayed question save');
  await click(button(mounted.root, 'choose-easy'));
  pending[0].resolve({
    ...context.row,
    difficulty: 'hard',
    current_version_id: '900719925474099312346',
    saved_version_id: '900719925474099312346',
  });
  await firstSave;
  await nextTick();

  assert.equal(mounted.instance.$.setupState.editorVisible, true, 'later edits must keep the same editor open');
  assert.equal(mounted.instance.$.setupState.editorForm.difficulty, 'easy');
  assert.equal(mounted.instance.$.setupState.editingExpectedVersionId, '900719925474099312346');
  assert.equal(source.dirty.value, true, 'later edits must remain dirty against the submitted snapshot');
  context.confirmDecisions.push(true);
  await click(button(mounted.root, '取消'));
  assert.equal(mounted.instance.$.setupState.editorForm.difficulty, 'hard', 'discard restores the confirmed submitted form');

  await click(button(mounted.root, '修订'));
  await click(button(mounted.root, 'choose-hard'));
  const secondSave = button(mounted.root, '保存为待审核版本').props.onClick();
  await waitFor(() => pending.length === 2, 'second delayed question save');
  context.confirmDecisions.push(true);
  await click(button(mounted.root, '取消'));
  await click(button(mounted.root, '人工录题'));
  await click(button(mounted.root, 'choose-hard'));
  assert.equal(mounted.instance.$.setupState.editorMode, 'create');
  assert.equal(source.dirty.value, true);

  pending[1].resolve({
    ...context.row,
    difficulty: 'hard',
    current_version_id: '900719925474099312347',
    saved_version_id: '900719925474099312347',
  });
  await secondSave;
  await nextTick();
  assert.equal(mounted.instance.$.setupState.editorVisible, true, 'late A response must not close reopened B');
  assert.equal(mounted.instance.$.setupState.editorMode, 'create');
  assert.equal(mounted.instance.$.setupState.editorForm.difficulty, 'hard');
  assert.equal(mounted.instance.$.setupState.editingExpectedVersionId, null);
  assert.equal(source.dirty.value, true, 'late A response must not clean reopened B');
  mounted.unmount();
});

test('uses the mutation receipt instead of a later view pointer for the next question edit', async () => {
  context.row = legacyRow({ current_version_id: '101', revision: 1, difficulty: 'medium' });
  const mounted = mount(Questions);
  await waitFor(() => context.calls.some((call) => call.method === 'get' && call.url === '/ai/questions'), 'question list');
  await click(button(mounted.root, '修订'));
  const source = context.unsavedSources[0];
  const normalHttp = context.http;
  const firstGate = deferred();
  let edits = 0;
  context.http = async (method, url, body, config) => {
    if (method === 'put' && url === `/ai/questions/${context.row.question_id}`) {
      context.calls.push({ method, url, body, config });
      edits += 1;
      if (edits === 1) return firstGate.promise;
      if (body.expected_version_id === '102') throw Object.assign(new Error('题目版本已变化'), { code: 40940 });
      return { ...context.row, ...body, current_version_id: '104', saved_version_id: '104' };
    }
    return normalHttp(method, url, body, config);
  };

  await click(button(mounted.root, 'choose-hard'));
  const firstSave = button(mounted.root, '保存为待审核版本').props.onClick();
  await waitFor(() => edits === 1, 'v2 edit request');
  await click(button(mounted.root, 'choose-easy'));
  firstGate.resolve({
    ...context.row,
    difficulty: 'medium',
    current_version_id: '103',
    saved_version_id: '102',
  });
  await firstSave;
  await nextTick();

  assert.equal(mounted.instance.$.setupState.editingExpectedVersionId, '102');
  assert.equal(mounted.instance.$.setupState.editorForm.difficulty, 'easy');
  assert.equal(source.dirty.value, true);
  await assert.rejects(
    () => button(mounted.root, '保存为待审核版本').props.onClick(),
    (error) => error?.code === 40940,
  );
  const secondRequest = context.calls.filter((call) => call.method === 'put' && call.url === `/ai/questions/${context.row.question_id}`).at(-1);
  assert.equal(secondRequest.body.expected_version_id, '102', 'next edit must use the mutation receipt, not view current v3');
  assert.equal(mounted.instance.$.setupState.editorVisible, true);
  assert.equal(mounted.instance.$.setupState.editorForm.difficulty, 'easy');
  assert.equal(source.dirty.value, true);
  mounted.unmount();
});

test('keeps a question draft when a successful mutation response has no valid receipt', async () => {
  context.row = legacyRow({ current_version_id: '101', revision: 1, difficulty: 'medium' });
  const mounted = mount(Questions);
  await waitFor(() => context.calls.some((call) => call.method === 'get' && call.url === '/ai/questions'), 'question list');
  await click(button(mounted.root, '修订'));
  await click(button(mounted.root, 'choose-hard'));
  const source = context.unsavedSources[0];
  const normalHttp = context.http;
  context.http = async (method, url, body, config) => {
    if (method === 'put' && url === `/ai/questions/${context.row.question_id}`) {
      context.calls.push({ method, url, body, config });
      return { ...context.row, ...body, current_version_id: '102' };
    }
    return normalHttp(method, url, body, config);
  };

  await button(mounted.root, '保存为待审核版本').props.onClick();
  await nextTick();
  assert.equal(mounted.instance.$.setupState.editorVisible, true);
  assert.equal(mounted.instance.$.setupState.editingExpectedVersionId, '101');
  assert.equal(mounted.instance.$.setupState.editorForm.difficulty, 'hard');
  assert.equal(source.dirty.value, true);
  mounted.unmount();
});
