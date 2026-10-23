import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { computed, createRenderer, h, inject, nextTick, provide, ref, watch } from '@vue/runtime-core';
import TreeStore from '../node_modules/element-plus/es/components/tree/src/model/tree-store.mjs';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const previewClientId = '\0question-preview-client-test';
const editorClientId = '\0question-editor-client-test';
const questionsClientId = '\0questions-client-test';
const importClientId = '\0question-import-client-test';
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
  navigations: [],
  downloads: [],
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
      patch(url, body, config) { return context.http('patch', url, body, config); },
    };
    export class ApiError extends Error { constructor(code, message) { super(message); this.code = code; } }
    export function upload(url, file, field, fields) { return context.http('upload', url, { file, field, fields }); }
    export async function download(url, filename, params) { context.downloads.push({ url, filename, params }); }
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
    export default { props: ['question'], setup(props) { return () => h('question-preview-stub', { stem: props.question?.stem || '', score: props.question?.score }); } };
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
  [routeStubId, `export function useRouter() { return { push(path) { globalThis.__questionBankUiTest.navigations.push(path); } }; }`],
  [iconsStubId, `
    import { h } from 'vue';
    export const Filter = { setup() { return () => h('filter-icon'); } };
  `],
]);

let vite;
let QuestionPreview;
let QuestionEditor;
let Questions;
let QuestionImport;
let importWorkflow;
let trainingTypes;

function plugin() {
  return {
    name: 'question-bank-ui-test-stubs',
    enforce: 'pre',
    resolveId(source, importer) {
      if (virtualStubs.has(source)) return virtualStubs.get(source);
      if (clientCode.has(source) || stubs.has(source)) return source;
      const owner = String(importer || '');
      if (owner.includes('/src/views/admin/Questions.vue') || owner.includes('/src/views/admin/QuestionImport.vue')) {
        if (source === 'vue-router') return routeStubId;
        if (source === '@element-plus/icons-vue') return iconsStubId;
      }
      if ((source === '../api/media' || source === '/src/api/media.ts') && owner.includes('question-preview')) return mediaStubId;
      if ((source === './MediaUpload.vue' || source === '/src/components/MediaUpload.vue') && owner.includes('question-editor-client-test')) return mediaUploadStubId;
      if (owner.includes('/utils/question-import-workflow') && (source === '../api/http' || source === '/src/api/http.ts')) return httpStubId;
      if (owner.includes('questions-client-test') || owner.includes('question-import-client-test')) {
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
  } else if (path.endsWith('/Questions.vue') || path.endsWith('/QuestionImport.vue')) {
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
      ? h('dialog', { ...attrs, beforeClose: props.beforeClose }, [
        h('dialog-content', {}, slots.default?.()),
        h('dialog-footer', {}, slots.footer?.()),
      ])
      : null;
  },
};
const Table = {
  inheritAttrs: false,
  props: { data: { type: Array, default: () => [] } },
  setup(props, { attrs, slots }) {
    provide('question-table-row', computed(() => props.data[0] || null));
    return () => h('table', { ...attrs, data: props.data }, slots.default?.());
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
    'el-timeline-item', 'el-result', 'el-tabs', 'el-tab-pane', 'el-upload', 'el-icon', 'el-radio-button',
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
    if (method === 'get' && url === '/admin/questions/authoring-options') return { difficulties: [
      { code: 'easy', label: '简单', enabled: true, sort: 10 },
      { code: 'medium', label: '中级', enabled: false, sort: 20 },
      { code: 'hard', label: '困难', enabled: true, sort: 30 },
    ] };
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
  trainingTypes = await vite.ssrLoadModule('/src/api/training-types.ts');
  QuestionPreview = await loadClientSfc('/src/components/QuestionPreview.vue', previewClientId);
  QuestionEditor = await loadClientSfc('/src/components/QuestionEditor.vue', editorClientId);
  Questions = await loadClientSfc('/src/views/admin/Questions.vue', questionsClientId);
  QuestionImport = await loadClientSfc('/src/views/admin/QuestionImport.vue', importClientId);
  importWorkflow = await vite.ssrLoadModule('/src/utils/question-import-workflow.ts');
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
  context.navigations = [];
  context.downloads = [];
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

function tiptap(text) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

test('option IDs remain available outside a secure context when randomUUID is absent', () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const secureDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } });
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false });
  try {
    const keys = [];
    for (let index = 0; index < 1000; index += 1) {
      const id = trainingTypes.newQuestionOptionId(keys.map((key) => ({ key, text: '' })));
      assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
      keys.push(id);
    }
    assert.equal(new Set(keys).size, 1000);
  } finally {
    Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    if (secureDescriptor) Object.defineProperty(globalThis, 'isSecureContext', secureDescriptor);
    else delete globalThis.isSecureContext;
  }
});

test('option ID fallback cannot collide within a page even without Web Crypto or changing clock/random values', () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const originalNow = Date.now;
  const originalRandom = Math.random;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  Date.now = () => 1792656000000;
  Math.random = () => 0;
  try {
    const keys = [];
    for (let index = 0; index < 1000; index += 1) {
      const id = trainingTypes.newQuestionOptionId(keys.map((key) => ({ key, text: '' })));
      assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
      keys.push(id);
    }
    assert.equal(new Set(keys).size, 1000);
  } finally {
    Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    Date.now = originalNow;
    Math.random = originalRandom;
  }
});

for (const [name, html, expected] of [
  ['nested div/p', '<div><p>12</p><p>34</p></div>', '<p>12</p><p>34</p>'],
  ['list items', '<ul><li>12</li><li>34</li></ul>', '<p>12</p><p>34</p>'],
  ['nested lists and inline breaks', '<div>开头<ul><li>12<br>34<ul><li>56</li></ul>78</li></ul>结尾</div>', '<p>开头</p><p>12<br>34</p><p>56</p><p>78</p><p>结尾</p>'],
]) {
  test(`restricted question content preserves ${name} boundaries through repeated edit/save roundtrips`, () => {
    const originalDocument = globalThis.document;
    globalThis.document = controlledMediaDocument();
    try {
      const first = trainingTypes.questionHtmlToReadonlyDoc(html);
      const output = trainingTypes.readonlyQuestionDocToHtml(first);
      assert.equal(output, expected);
      assert.deepEqual(trainingTypes.questionHtmlToReadonlyDoc(output), first);
    } finally {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
    }
  });
}

test('v2 editing derives editable content and correctness from stable IDs instead of stale legacy projections', async () => {
  const draft = trainingTypes.questionDraftFromView(legacyRow({
    stem: '过期投影', answer: [0],
    content_schema_version: 2,
    content_json: {
      stem: tiptap('冻结题干'),
      options: [{ id: 'stable_B', content: tiptap('乙') }, { id: 'stable_A', content: tiptap('甲') }],
      answer_option_ids: ['stable_A'], analysis: tiptap('解析'),
    },
  }));
  assert.equal(draft.stem, '<p>冻结题干</p>');
  assert.deepEqual(draft.options, [{ key: 'stable_B', text: '<p>乙</p>' }, { key: 'stable_A', text: '<p>甲</p>' }]);
  assert.deepEqual(draft.answer, [1]);
  const mounted = mount(QuestionEditor, { modelValue: draft });
  await nextTick();
  await click(button(mounted.root, '下移'));
  const moved = mounted.instance.$.setupState.local;
  assert.deepEqual(moved.options.map((option) => option.key), ['stable_A', 'stable_B']);
  assert.deepEqual(moved.answer, [0]);
  await click(button(mounted.root, '添加选项'));
  const addedKey = moved.options[2].key;
  assert.match(addedKey, /^opt_[A-Za-z0-9_-]+$/);
  assert.equal(new Set(moved.options.map((option) => option.key)).size, 3);
  await click(walk(mounted.root, (node) => node.type === 'button' && nodeText(node).trim() === '上移' && !node.props.disabled)[0]);
  assert.deepEqual(moved.options.map((option) => option.key), ['stable_B', 'stable_A', addedKey]);
  assert.deepEqual(moved.answer, [1]);
  const payload = trainingTypes.questionDraftWithContent(moved);
  assert.equal(payload.content_schema_version, 2);
  assert.deepEqual(payload.content_json.answer_option_ids, ['stable_A']);
  assert.deepEqual(payload.content_json.options.map((option) => option.id), ['stable_B', 'stable_A', addedKey]);
  assert.equal(JSON.stringify(payload).includes('checked'), false);
  mounted.unmount();
});

test('v2 preview labels only authoritative correct IDs and never treats learner selections or checked as correctness', async () => {
  const mounted = mount(QuestionPreview, { question: {
    type: 'single', stem: '旧投影', options: [{ key: 'A', text: '旧选项' }], answer: [0],
    selected_option_ids: ['wrong'], checked: true,
    content_schema_version: 2,
    content_json: {
      stem: tiptap('v2题干'), options: [{ id: 'wrong', content: tiptap('错误选项') }, { id: 'right', content: tiptap('正确选项') }],
      answer_option_ids: ['right'], analysis: tiptap('v2解析'),
    },
  } });
  await waitFor(() => walk(mounted.root, (node) => String(node.props.innerHTML || '').includes('v2题干')).length > 0, 'v2 preview');
  const options = walk(mounted.root, (node) => node.props.class === 'question-preview__option');
  assert.equal(options.length, 2);
  assert.doesNotMatch(nodeText(options[0]), /正确答案/);
  assert.match(nodeText(options[1]), /正确答案/);
  const html = walk(mounted.root, (node) => Object.hasOwn(node.props, 'innerHTML')).map((node) => node.props.innerHTML);
  assert.ok(html.some((value) => value === '<p>v2题干</p>'));
  assert.ok(html.some((value) => value === '<p>v2解析</p>'));
  mounted.unmount();
});

test('v2 readonly rendering rejects forbidden nested properties instead of falling back to HTML', () => {
  assert.throws(() => trainingTypes.readonlyQuestionDocToHtml({
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '题干', marks: [{ type: 'bold' }] }] }],
  }), /题目内容/);
  assert.throws(() => trainingTypes.readonlyQuestionDocToHtml({
    type: 'doc', content: [{ type: 'image', attrs: { asset_id: '42', src: 'https://outside.invalid/x' } }],
  }), /题目内容/);
});

test('manual question save sends restricted v2 content with unchanged option IDs and a numeric compatibility projection', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = controlledMediaDocument();
  try {
    const mounted = mount(Questions);
    await waitFor(() => button(mounted.root, '人工录题'), 'question list');
    await click(button(mounted.root, '人工录题'));
    const state = mounted.instance.$.setupState;
    state.editorForm.stem = '<p onclick="steal()">安全<strong>题干</strong><br><img data-media-id="42" src="https://outside.invalid/x"></p>';
    state.editorForm.options = [{ key: 'keep_b', text: '乙' }, { key: 'keep_a', text: '甲' }];
    state.editorForm.answer = [1];
    await click(button(mounted.root, '保存并确认可用'));
    const call = context.calls.find((item) => item.method === 'post' && item.url === '/ai/questions');
    assert.ok(call);
    assert.equal(call.body.content_schema_version, 2);
    assert.deepEqual(call.body.content_json.stem, {
      type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: '安全' }, { type: 'text', text: '题干' }, { type: 'hardBreak' }, { type: 'image', attrs: { asset_id: '42' } },
      ] }],
    });
    assert.deepEqual(call.body.content_json.options, [
      { id: 'keep_b', content: tiptap('乙') }, { id: 'keep_a', content: tiptap('甲') },
    ]);
    assert.deepEqual(call.body.content_json.answer_option_ids, ['keep_a']);
    assert.deepEqual(call.body.answer, [1]);
    assert.deepEqual(call.body.options, [{ key: 'keep_b', text: '乙' }, { key: 'keep_a', text: '甲' }]);
    assert.equal(JSON.stringify(call.body.content_json).includes('checked'), false);
    mounted.unmount();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('invalid stable option IDs retain the editable question and show an error without sending a write', async () => {
  const mounted = mount(Questions);
  await waitFor(() => button(mounted.root, '人工录题'), 'question list');
  await click(button(mounted.root, '人工录题'));
  const state = mounted.instance.$.setupState;
  state.editorForm.options = [{ key: 'duplicate', text: '甲' }, { key: 'duplicate', text: '乙' }];
  await state.saveQuestion();
  assert.equal(context.calls.some((item) => item.method === 'post' && item.url === '/ai/questions'), false);
  assert.equal(state.editorVisible, true);
  assert.ok(context.messages.some((item) => /题目内容/.test(item.message)));
  mounted.unmount();
});

test('readonly preview loads analysis only after the answer toggle is explicitly enabled', async () => {
  const reveal = ref(false);
  const question = {
    type: 'single', content_schema_version: 2,
    content_json: { stem: tiptap('题干'), options: [{ id: 'a', content: tiptap('甲') }, { id: 'b', content: tiptap('乙') }],
      answer_option_ids: ['b'], analysis: tiptap('仅答案预览可见的解析') },
  };
  const parent = { setup() { return () => h(QuestionPreview, { question, revealAnswer: reveal.value }); } };
  const mounted = mount(parent);
  await waitFor(() => walk(mounted.root, (node) => String(node.props.innerHTML || '').includes('题干')).length > 0, 'ordinary preview');
  assert.doesNotMatch(nodeText(mounted.root), /正确答案|解析/);
  reveal.value = true;
  await nextTick();
  await waitFor(() => walk(mounted.root, (node) => String(node.props.innerHTML || '').includes('仅答案预览可见的解析')).length > 0, 'answer preview');
  assert.match(nodeText(mounted.root), /正确答案/);
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

test('question management exposes manual editing and single-question regeneration without bulk import workflows', async () => {
  context.permissions = new Set(['questions:read', 'questions:write', 'questions:review', 'ai:read', 'ai:write']);
  const mounted = mount(Questions);
  await waitFor(() => context.calls.some((call) => call.method === 'get' && call.url === '/ai/questions'), 'question list');
  await nextTick();
  try {
    assert.ok(button(mounted.root, '人工录题'));
    assert.ok(button(mounted.root, '修订'));
    assert.ok(button(mounted.root, '重生成'));
    assert.equal(!!button(mounted.root, 'AI 出题'), false, 'bulk AI generation belongs in the import page');
    assert.equal(!!button(mounted.root, 'Excel / TXT 导题'), false, 'file import belongs in its standalone menu');
    assert.equal(walk(mounted.root, (node) => node.type === 'dialog' && /AI 出题|出题资料管理/.test(node.props.title || '')).length, 0);
    assert.equal(context.calls.some((call) => /question-materials|generate-questions|import-preview/.test(call.url)), false);
  } finally { mounted.unmount(); }
});

test('question create and preview dialogs keep their overlays inside the content area', async () => {
  for (const label of ['人工录题', '预览']) {
    context.calls = [];
    const mounted = mount(Questions);
    try {
      await waitFor(() => context.calls.some((call) => call.method === 'get' && call.url === '/ai/questions'), 'question list');
      await nextTick();
      await click(button(mounted.root, label));
      const dialog = walk(mounted.root, (node) => node.type === 'dialog')[0];
      assert.ok(dialog);
      assert.equal(Object.hasOwn(dialog.props, 'appendToBody') || Object.hasOwn(dialog.props, 'append-to-body'), false, `${label} overlay must stay inside content`);
      if (label === '人工录题') assert.match(dialog.props.class || '', /re-form-dialog/);
    } finally { mounted.unmount(); }
  }
});

test('AI questions from transient reference imports do not expose source-material regeneration', async () => {
  context.row = legacyRow({ regulation_id: null, regulation_version_id: null, difficulty: 'easy' });
  const mounted = mount(Questions);
  try {
    await waitFor(() => context.calls.some((call) => call.method === 'get' && call.url === '/ai/questions'), 'question list');
    await nextTick();
    assert.equal(!!button(mounted.root, '重生成'), false, 'the legacy regenerate API requires permanent source material');
    assert.ok(button(mounted.root, '修订'));
  } finally { mounted.unmount(); }
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

test('a historic medium stays visible but cannot save until an enabled difficulty is selected', async () => {
  context.row = legacyRow({ difficulty: 'medium' });
  const mounted = mount(Questions);
  try {
    await waitFor(() => button(mounted.root, '修订'), 'question list');
    await click(button(mounted.root, '修订'));
    assert.equal(mounted.instance.$.setupState.editorForm.difficulty, 'medium');
    assert.equal(button(mounted.root, '保存为待审核版本').props.disabled, true);
    await button(mounted.root, '保存为待审核版本').props.onClick();
    assert.equal(context.calls.some((call) => call.method === 'put'), false);
    await click(button(mounted.root, 'choose-hard'));
    assert.equal(button(mounted.root, '保存为待审核版本').props.disabled, false);
  } finally { mounted.unmount(); }
});

test('write-only question authors load the shared difficulty catalog and save without reading question content', async () => {
  context.permissions = new Set(['questions:write']);
  const mounted = mount(Questions);
  try {
    await waitFor(() => button(mounted.root, '人工录题'), 'manual action');
    await click(button(mounted.root, '人工录题'));
    const state = mounted.instance.$.setupState;
    state.editorForm.stem = '人工新题';
    state.editorForm.options = [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }];
    await button(mounted.root, '保存并确认可用').props.onClick();
    assert.ok(context.calls.some((call) => call.method === 'get' && call.url === '/admin/questions/authoring-options'));
    assert.ok(context.calls.some((call) => call.method === 'post' && call.url === '/ai/questions'));
    assert.equal(context.calls.some((call) => call.method === 'get' && call.url === '/ai/questions'), false);
    assert.equal(context.calls.some((call) => call.method === 'get' && call.url === '/ai/question-concepts'), false);
  } finally { mounted.unmount(); }
});

test('a failed difficulty catalog blocks manual writes and can be retried without losing the draft', async () => {
  const normalHttp = context.http;
  let reads = 0;
  context.http = async (method, url, body, config) => {
    if (url === '/admin/questions/authoring-options' && ++reads === 1) throw new Error('难度目录暂不可用');
    return normalHttp(method, url, body, config);
  };
  const mounted = mount(Questions);
  try {
    await waitFor(() => button(mounted.root, '人工录题'), 'question list');
    await click(button(mounted.root, '人工录题'));
    mounted.instance.$.setupState.editorForm.stem = '待保存草稿';
    await nextTick();
    assert.equal(button(mounted.root, '保存并确认可用').props.disabled, true);
    await button(mounted.root, '保存并确认可用').props.onClick();
    assert.equal(context.calls.some((call) => call.method === 'post' && call.url === '/ai/questions'), false);
    await click(button(mounted.root, '重试加载难度'));
    assert.equal(mounted.instance.$.setupState.editorForm.stem, '待保存草稿');
    assert.equal(button(mounted.root, '保存并确认可用').props.disabled, false);
  } finally { mounted.unmount(); }
});

test('the existing form saves schema 3 answers with exact revision identity and refuses destructive rich rewrites', async () => {
  const content = { stem: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '富题干', marks: [{ type: 'bold' }] }] }] },
    options: [{ id: 'A', content: tiptap('甲') }, { id: 'B', content: tiptap('乙') }], analysis: null, answer_option_ids: ['A'] };
  context.row = legacyRow({ difficulty: 'easy', current_version_id: '101', content_schema_version: 3, content_json: content });
  const mounted = mount(Questions);
  try {
    await waitFor(() => button(mounted.root, '修订'), 'question list');
    await click(button(mounted.root, '修订'));
    const state = mounted.instance.$.setupState;
    state.editorForm.stem = '<p>无法定位的替换</p>';
    await button(mounted.root, '保存为待审核版本').props.onClick();
    assert.equal(context.calls.some((call) => call.method === 'put'), false);
    assert.equal(state.editorForm.stem, '<p>无法定位的替换</p>');
    assert.ok(context.messages.some((item) => item.type === 'warning' && item.message.includes('题干')));
    state.editorForm.stem = '<h2><strong>富题干</strong></h2>';
    state.editorForm.answer = [1];
    await button(mounted.root, '保存为待审核版本').props.onClick();
    const write = context.calls.find((call) => call.method === 'put');
    assert.equal(write.body.content_schema_version, 3);
    assert.equal(write.body.expected_version_id, '101');
    assert.deepEqual(write.body.content_json, { ...content, answer_option_ids: ['B'] });
    assert.equal(Object.hasOwn(write.body, 'source'), false);
  } finally { mounted.unmount(); }
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

function aiImportBatch() {
  const question = {
    category: '7', type: 'single', concept: '9',
    options: [{ key: 'A', text: '先确认风险' }, { key: 'B', text: '直接作业' }],
    answer: [0], analysis: '应先完成风险确认。', score: '5', errors: [],
  };
  return {
    batch_id: '301', valid_rows: [2, 3], duplicates: [], errors: [{ row: 4, message: '答案无效' }],
    rows: [
      { ...question, row_number: 2, difficulty: 'easy', stem: '简单生成题' },
      { ...question, row_number: 3, difficulty: 'hard', stem: '困难生成题' },
      { ...question, row_number: 4, difficulty: 'easy', stem: '异常生成题', answer: [], errors: ['答案无效'] },
    ],
  };
}

function aiTask(status = 'running', overrides = {}) {
  return {
    task_id: 'ai-task-1', status, total_count: 2, completed_count: status === 'completed' ? 2 : 0,
    generated_count: status === 'completed' ? 3 : 0, failed_count: status === 'completed' ? 1 : 0,
    ...(status === 'completed' ? { batch_id: '301' } : {}), ...overrides,
  };
}

async function switchImportTab(mounted, value) {
  const tabs = walk(mounted.root, (node) => node.type === 'el-wrapper' && (node.props.modelValue ?? node.props['model-value']) === 'file')[0];
  assert.ok(tabs, 'file/AI import tabs should be available');
  await (tabs.props['onUpdate:modelValue'] || tabs.props['onUpdate:model-value'])?.(value);
  await nextTick();
}

test('file import offers enabled server difficulties and retains the server labels', async () => {
  const mounted = mount(QuestionImport);
  try {
    await waitFor(() => context.calls.some((call) => call.url === '/admin/questions/authoring-options'), 'difficulty catalog');
    await nextTick();
    const choices = walk(mounted.root, (node) => ['easy', 'medium', 'hard'].includes(node.props?.value) && node.props?.label)
      .map((node) => [node.props.value, node.props.label]);
    assert.deepEqual(choices, [['easy', '简单'], ['hard', '困难']]);
  } finally { mounted.unmount(); }
});

test('a failed authoring catalog offers a retry and recovers enabled import choices', async () => {
  const normalHttp = context.http;
  let reads = 0;
  context.http = async (method, url, body, config) => {
    if (url === '/admin/questions/authoring-options' && ++reads === 1) throw new Error('难度目录暂不可用');
    return normalHttp(method, url, body, config);
  };
  const mounted = mount(QuestionImport);
  try {
    await waitFor(() => walk(mounted.root, (node) => node.props?.title === '难度目录暂不可用').length > 0, 'catalog error');
    await click(button(mounted.root, '重试加载难度'));
    await waitFor(() => walk(mounted.root, (node) => node.props?.label === '困难').length > 0, 'reloaded choices');
    assert.equal(reads, 2);
  } finally { mounted.unmount(); }
});

test('AI preview accepts medium only when the runtime catalog enables it', async () => {
  const batch = aiImportBatch();
  batch.rows[0].difficulty = 'medium';
  const commits = [];
  const workflow = importWorkflow.useAiQuestionImportWorkflow({
    enabledDifficulties: () => ['easy', 'medium', 'hard'],
    readTask: async () => aiTask('completed'), readBatch: async () => batch,
    commitBatch: async (id, rows) => { commits.push({ id, rows }); return { batch_id: id, committed_rows: rows, created_ids: ['800', '801'] }; },
    onCommitted() {}, onWarning() {},
  });
  try {
    await workflow.startTask(async () => aiTask('completed'));
    assert.ok(workflow.preview.value, 'enabled medium preview should be accepted');
    workflow.difficulty.value = 'medium';
    assert.deepEqual(workflow.visibleRows.value.map((row) => row.row_number), [2]);
    await workflow.commitImport();
    assert.deepEqual(commits, [{ id: '301', rows: [2, 3] }]);
  } finally { workflow.discard(); }
});

test('AI preview refuses disabled medium instead of relabeling it', async () => {
  const batch = aiImportBatch(); batch.rows[0].difficulty = 'medium';
  const workflow = importWorkflow.useAiQuestionImportWorkflow({
    enabledDifficulties: () => ['easy', 'hard'], readTask: async () => aiTask('completed'), readBatch: async () => batch,
    commitBatch: async () => { throw new Error('disabled batch must not commit'); }, onCommitted() {}, onWarning() {},
  });
  try {
    await workflow.startTask(async () => aiTask('completed'));
    assert.equal(workflow.preview.value, null);
    assert.equal(batch.rows[0].difficulty, 'medium');
  } finally { workflow.discard(); }
});

test('AI import cannot commit while the authoritative catalog is unavailable', async () => {
  let enabled = ['easy', 'hard'];
  const commits = [];
  const workflow = importWorkflow.useAiQuestionImportWorkflow({
    enabledDifficulties: () => enabled, readTask: async () => aiTask('completed'), readBatch: async () => aiImportBatch(),
    commitBatch: async (id, rows) => { commits.push({ id, rows }); return { batch_id: id, committed_rows: rows, created_ids: ['800', '801'] }; },
    onCommitted() {}, onWarning() {},
  });
  try {
    await workflow.startTask(async () => aiTask('completed'));
    enabled = [];
    await workflow.commitImport();
    assert.deepEqual(commits, []);
  } finally { workflow.discard(); }
});

test('AI import uploads a transient reference file, polls its task and renders only generated easy/hard rows', async () => {
  context.permissions = new Set(['questions:write', 'ai:read', 'ai:write']);
  const normalHttp = context.http;
  context.http = async (method, url, body, config) => {
    if (url.includes('/ai-import-')) {
      context.calls.push({ method, url, body, config });
      if (method === 'upload') return aiTask();
      if (url.includes('/ai-import-tasks/')) return aiTask('completed');
      return aiImportBatch();
    }
    return normalHttp(method, url, body, config);
  };
  const mounted = mount(QuestionImport);
  try {
    await switchImportTab(mounted, 'ai');
    const uploader = walk(mounted.root, (node) => node.type === 'el-wrapper' && (node.props['on-change'] || node.props.onChange))[0];
    assert.ok(uploader);
    const reference = new File(['原始参考题不得进入预览'], 'reference.xlsx');
    await (uploader.props['on-change'] || uploader.props.onChange)({ raw: reference });
    await waitFor(() => walk(mounted.root, (node) => node.type === 'table' && node.props.data?.length === 3).length > 0, 'AI generated preview');
    const uploadCall = context.calls.find((call) => call.method === 'upload');
    assert.equal(uploadCall.url, '/admin/questions/ai-import-tasks');
    assert.deepEqual(uploadCall.body.fields, { format: 'xlsx' });
    assert.ok(context.calls.some((call) => call.method === 'get' && call.url === '/admin/questions/ai-import-tasks/ai-task-1'));
    const rows = walk(mounted.root, (node) => node.type === 'table').at(-1).props.data;
    assert.deepEqual(rows.map((row) => row.difficulty), ['easy', 'hard', 'easy']);
    assert.equal(rows.some((row) => row.stem.includes('原始参考题')), false);
    assert.ok(button(mounted.root, '确认导入 2 道待审核题目'));
    const stateValues = Object.values(mounted.instance.$.setupState);
    assert.equal(stateValues.some((value) => value instanceof File), false, 'the page must not retain reference files');
  } finally { mounted.unmount(); }
});

test('AI preview filters by difficulty and commits only selected valid server row numbers', async () => {
  const calls = [];
  const workflow = importWorkflow.useAiQuestionImportWorkflow({
    enabledDifficulties: () => ['easy', 'hard'],
    readTask: async () => aiTask('completed'),
    readBatch: async () => aiImportBatch(),
    commitBatch: async (id, rows) => {
      calls.push({ id, rows });
      return { batch_id: id, created_ids: ['701'], committed_rows: rows };
    },
    onCommitted: (result) => calls.push({ result }), onWarning() {},
  });
  await workflow.startTask(async () => aiTask('completed'));
  assert.deepEqual(workflow.selectedRows.value, [2, 3], 'invalid rows must not be selected by default');
  workflow.difficulty.value = 'hard';
  assert.deepEqual(workflow.visibleRows.value.map((row) => row.row_number), [3]);
  workflow.setSelected(2, false);
  workflow.setSelected(4, true);
  await workflow.commitImport();
  assert.deepEqual(calls[0], { id: '301', rows: [3] });
  assert.equal(calls[1].result.created_ids[0], '701');
  workflow.deactivate();
});

test('AI import clears polling on departure and ignores a late task result', async () => {
  const gate = deferred();
  let reads = 0;
  let batchReads = 0;
  const workflow = importWorkflow.useAiQuestionImportWorkflow({
    enabledDifficulties: () => ['easy', 'hard'],
    readTask: async () => { reads += 1; return gate.promise; },
    readBatch: async () => { batchReads += 1; return aiImportBatch(); },
    commitBatch: async () => ({}), onCommitted() {}, onWarning() {},
  });
  await workflow.startTask(async () => aiTask());
  await waitFor(() => reads === 1, 'first task status');
  workflow.deactivate();
  gate.resolve(aiTask('completed'));
  await nextTick();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  assert.equal(batchReads, 0);
  assert.equal(workflow.preview.value, null);
});

test('AI preview edits only generated content, regenerates one row, downloads and lands in question management', async () => {
  context.permissions = new Set(['questions:write', 'ai:read', 'ai:write']);
  const batch = aiImportBatch();
  const normalHttp = context.http;
  context.http = async (method, url, body, config) => {
    if (url.includes('/ai-import-')) {
      context.calls.push({ method, url, body, config });
      if (method === 'upload') return aiTask('completed');
      if (method === 'patch') { Object.assign(batch.rows[0], body); return structuredClone(batch); }
      if (url.endsWith('/regenerate')) { batch.rows[0].stem = '重新生成的简单题'; return structuredClone(batch); }
      if (url.endsWith('/commit')) return { batch_id: '301', created_ids: ['701', '702'], committed_rows: body.row_numbers };
      return structuredClone(batch);
    }
    return normalHttp(method, url, body, config);
  };
  const mounted = mount(QuestionImport);
  try {
    await switchImportTab(mounted, 'ai');
    const uploader = walk(mounted.root, (node) => node.type === 'el-wrapper' && (node.props['on-change'] || node.props.onChange))[0];
    await (uploader.props['on-change'] || uploader.props.onChange)({ raw: new File(['reference'], 'reference.xlsx') });
    await nextTick();
    await click(button(mounted.root, '预览'));
    let dialog = walk(mounted.root, (node) => node.type === 'dialog')[0];
    assert.equal(Object.hasOwn(dialog.props, 'appendToBody') || Object.hasOwn(dialog.props, 'append-to-body'), false);
    assert.equal(walk(mounted.root, (node) => node.type === 'question-preview-stub')[0]?.props.score, 5);
    await click(button(mounted.root, '修改'));
    dialog = walk(mounted.root, (node) => node.type === 'dialog' && node.props.title === '修改生成题')[0];
    assert.equal(Object.hasOwn(dialog.props, 'appendToBody') || Object.hasOwn(dialog.props, 'append-to-body'), false);
    assert.match(dialog.props.class || '', /re-form-dialog/);
    const stem = walk(mounted.root, (node) => node.type === 'el-wrapper' && node.props.placeholder === '修改生成题题干')[0];
    assert.ok(stem);
    stem.props['onUpdate:modelValue']('人工校对的简单题');
    await nextTick();
    await click(button(mounted.root, '保存修改'));
    const patch = context.calls.find((call) => call.method === 'patch');
    assert.deepEqual(Object.keys(patch.body).sort(), ['analysis', 'answer', 'options', 'stem']);
    assert.equal(patch.body.stem, '人工校对的简单题');
    await click(button(mounted.root, '重新生成'));
    assert.ok(context.calls.some((call) => call.url === '/admin/questions/ai-import-batches/301/rows/2/regenerate'));
    await click(button(mounted.root, '下载 Excel'));
    await click(button(mounted.root, '下载 TXT'));
    assert.deepEqual(context.downloads.map((item) => item.params.format), ['xlsx', 'txt']);
    await click(button(mounted.root, '确认导入 2 道待审核题目'));
    assert.deepEqual(context.calls.find((call) => call.url.endsWith('/commit')).body, { row_numbers: [2, 3] });
    assert.deepEqual(context.navigations, ['/admin/questions']);
  } finally { mounted.unmount(); }
});

test('ordinary file import keeps template defaults and commits its original valid rows', async () => {
  context.permissions = new Set(['questions:write']);
  const normalHttp = context.http;
  context.http = async (method, url, body, config) => {
    if (url.includes('/admin/questions/import-')) {
      context.calls.push({ method, url, body, config });
      if (method === 'upload') return { batch_id: '401', valid_rows: [2, 5], duplicates: [3], errors: [{ row: 4, message: '选项格式错误' }] };
      return { batch_id: '401', created_ids: ['801', '802'], committed_rows: body.row_numbers };
    }
    return normalHttp(method, url, body, config);
  };
  const mounted = mount(QuestionImport);
  try {
    await nextTick();
    const category = walk(mounted.root, (node) => node.type === 'el-wrapper' && node.props.placeholder === '文件 category 为空时使用')[0];
    category.props['onUpdate:modelValue']('7');
    const difficulty = walk(mounted.root, (node) => node.type === 'el-wrapper' && node.props.placeholder === '文件 difficulty 为空时使用')[0];
    difficulty.props['onUpdate:modelValue']('medium');
    await click(button(mounted.root, '下载 XLSX 模板'));
    const uploader = walk(mounted.root, (node) => node.type === 'el-wrapper' && (node.props['on-change'] || node.props.onChange))[0];
    await (uploader.props['on-change'] || uploader.props.onChange)({ raw: new File(['ordinary'], 'ordinary.xlsx') });
    await nextTick();
    assert.deepEqual(context.calls.find((call) => call.method === 'upload').body.fields, { format: 'xlsx', category_id: '7', difficulty: 'medium' });
    await click(button(mounted.root, '确认导入 2 行'));
    assert.deepEqual(context.calls.find((call) => call.url.endsWith('/commit')).body, { row_numbers: [2, 5] });
    assert.equal(context.downloads[0].url, '/admin/questions/import-template');
    assert.deepEqual(context.navigations, ['/admin/questions']);
  } finally { mounted.unmount(); }
});

test('AI confirmation with an unknown result queries the original batch without resending a write', async () => {
  let commits = 0;
  let reads = 0;
  const receipts = [];
  const workflow = importWorkflow.useAiQuestionImportWorkflow({
    enabledDifficulties: () => ['easy', 'hard'],
    readTask: async () => aiTask('completed'),
    readBatch: async (id) => {
      reads += 1;
      return reads === 1 ? aiImportBatch() : { batch_id: id, created_ids: ['701'], committed_rows: [3] };
    },
    commitBatch: async () => { commits += 1; throw new Error('response lost'); },
    onCommitted: (receipt) => receipts.push(receipt), onWarning() {},
  });
  await workflow.startTask(async () => aiTask('completed'));
  workflow.setSelected(2, false);
  await workflow.commitImport();
  assert.equal(workflow.commitUnknown.value, true);
  await workflow.commitImport();
  assert.equal(commits, 1, 'a response loss must not silently resubmit the selection');
  await workflow.queryBatchStatus();
  assert.equal(reads, 2);
  assert.deepEqual(receipts, [{ batch_id: '301', created_ids: ['701'], committed_rows: [3] }]);
  assert.equal(workflow.preview.value, null);
  workflow.deactivate();
});

test('ordinary preview loading can restart after deactivation without a late response locking the cached page', async () => {
  const gate = deferred();
  const workflow = importWorkflow.useQuestionImportWorkflow({
    readBatch: async () => ({}), commitBatch: async () => ({}), onCommitted() {}, onWarning() {},
  });
  const firstLoad = workflow.loadPreview(() => gate.promise);
  assert.equal(workflow.previewBusy.value, true);
  assert.equal(workflow.dirty.value, false);
  workflow.deactivate();
  assert.equal(workflow.previewBusy.value, false);
  workflow.activate();
  assert.equal(workflow.interactionLocked.value, false);
  await workflow.loadPreview(async () => ({ batch_id: '402', valid_rows: [2], errors: [], duplicates: [] }));
  gate.resolve({ batch_id: '401', valid_rows: [3], errors: [], duplicates: [] });
  await firstLoad;
  assert.equal(workflow.preview.value.batch_id, '402');
  assert.equal(workflow.previewBusy.value, false);
  assert.equal(workflow.canReset.value, true);
  workflow.deactivate();
});

test('AI batch loading can restart after its completed task leaves the cached page', async () => {
  const gate = deferred();
  let reads = 0;
  const workflow = importWorkflow.useAiQuestionImportWorkflow({
    enabledDifficulties: () => ['easy', 'hard'],
    readTask: async () => aiTask('completed'),
    readBatch: async () => { reads += 1; return reads === 1 ? gate.promise : { ...aiImportBatch(), batch_id: '302' }; },
    commitBatch: async () => ({}), onCommitted() {}, onWarning() {},
  });
  const firstStart = workflow.startTask(async () => aiTask('completed'));
  await waitFor(() => reads === 1, 'pending generated batch read');
  assert.equal(workflow.previewBusy.value, true);
  workflow.deactivate();
  workflow.activate();
  assert.equal(workflow.interactionLocked.value, false);
  await workflow.startTask(async () => aiTask('completed', { task_id: 'ai-task-2', batch_id: '302' }));
  gate.resolve(aiImportBatch());
  await firstStart;
  assert.equal(workflow.preview.value.batch_id, '302');
  assert.equal(workflow.previewBusy.value, false);
  assert.equal(workflow.taskBusy.value, false);
  workflow.deactivate();
});

test('deactivating a pending confirmation clears busy state but keeps the original batch locked for reconciliation', async () => {
  const gate = deferred();
  let commits = 0;
  const preview = { batch_id: '401', valid_rows: [2], errors: [], duplicates: [] };
  const workflow = importWorkflow.useQuestionImportWorkflow({
    readBatch: async () => preview,
    commitBatch: async () => { commits += 1; return gate.promise; }, onCommitted() {}, onWarning() {},
  });
  await workflow.loadPreview(async () => preview);
  const pending = workflow.commitImport();
  workflow.deactivate();
  workflow.activate();
  assert.equal(workflow.commitBusy.value, false);
  assert.equal(workflow.commitUnknown.value, true);
  await workflow.commitImport();
  assert.equal(commits, 1);
  await workflow.queryBatchStatus();
  assert.equal(workflow.commitUnknown.value, false);
  gate.resolve({ batch_id: '401', created_ids: ['801'], committed_rows: [2] });
  await pending;
  assert.equal(workflow.preview.value.batch_id, '401', 'the invalidated response cannot clear the reconciled preview');
  workflow.deactivate();
});

for (const operation of ['editing', 'regenerating']) {
  test(`AI ${operation} with a lost response locks writes until the original batch is read`, async () => {
    let serverBatch = aiImportBatch();
    let commits = 0;
    let mutations = 0;
    let readMode = 'valid';
    const batchReads = [];
    const workflow = importWorkflow.useAiQuestionImportWorkflow({
      enabledDifficulties: () => ['easy', 'hard'],
      readTask: async () => aiTask('completed'),
      readBatch: async (id) => {
        batchReads.push(id);
        if (readMode === 'invalid') return { batch_id: '999', valid_rows: [], errors: [], duplicates: [] };
        if (readMode === 'unavailable') throw new Error('status unavailable');
        return structuredClone(serverBatch);
      },
      commitBatch: async (id, rows) => { commits += 1; return { batch_id: id, created_ids: ['701'], committed_rows: rows }; },
      onCommitted() {}, onWarning() {},
    });
    await workflow.startTask(async () => aiTask('completed'));
    const accepted = await workflow.updateRow(2, async () => {
      mutations += 1;
      serverBatch.rows[0].stem = `${operation} changed on server`;
      throw new Error('write response lost');
    });
    assert.equal(accepted, false);
    assert.equal(workflow.commitUnknown.value, true);
    assert.equal(workflow.canReset.value, false);
    await workflow.commitImport();
    await workflow.updateRow(2, async () => { mutations += 1; return aiImportBatch(); });
    assert.equal(commits, 0);
    assert.equal(mutations, 1);
    for (const unavailable of ['invalid', 'unavailable']) {
      readMode = unavailable;
      await workflow.queryBatchStatus();
      assert.equal(workflow.commitUnknown.value, true);
      await workflow.commitImport();
      assert.equal(commits, 0);
    }
    readMode = 'valid';
    await workflow.queryBatchStatus();
    assert.equal(workflow.commitUnknown.value, false);
    assert.equal(workflow.preview.value.rows[0].stem, `${operation} changed on server`);
    assert.deepEqual(batchReads, ['301', '301', '301', '301']);
    assert.equal(commits, 0, 'a status query never confirms import automatically');
    await workflow.commitImport();
    assert.equal(commits, 1);
    workflow.deactivate();
  });
}

test('an unverifiable AI row mutation response also requires original-batch reconciliation', async () => {
  const workflow = importWorkflow.useAiQuestionImportWorkflow({
    enabledDifficulties: () => ['easy', 'hard'],
    readTask: async () => aiTask('completed'), readBatch: async () => aiImportBatch(),
    commitBatch: async () => ({}), onCommitted() {}, onWarning() {},
  });
  await workflow.startTask(async () => aiTask('completed'));
  await workflow.updateRow(2, async () => ({}));
  assert.equal(workflow.commitUnknown.value, true);
  await workflow.queryBatchStatus();
  assert.equal(workflow.commitUnknown.value, false);
  workflow.deactivate();
});

test('an explicit business rejection of an AI row mutation preserves the confirmed preview without an unknown lock', async () => {
  const { ApiError } = await vite.ssrLoadModule(httpStubId);
  const workflow = importWorkflow.useAiQuestionImportWorkflow({
    enabledDifficulties: () => ['easy', 'hard'],
    readTask: async () => aiTask('completed'), readBatch: async () => aiImportBatch(),
    commitBatch: async () => ({}), onCommitted() {}, onWarning() {},
  });
  await workflow.startTask(async () => aiTask('completed'));
  const accepted = await workflow.updateRow(2, async () => { throw new ApiError(40001, 'invalid answer'); });
  assert.equal(accepted, false);
  assert.equal(workflow.commitUnknown.value, false);
  assert.equal(workflow.rowBusy.value, false);
  assert.equal(workflow.preview.value.rows[0].stem, '简单生成题');
  assert.equal(workflow.canReset.value, true);
  workflow.deactivate();
});

test('AI editing reconciles a lost write response from inside the dialog before enabling import', async () => {
  context.permissions = new Set(['questions:write', 'ai:read', 'ai:write']);
  const batch = aiImportBatch();
  const normalHttp = context.http;
  context.http = async (method, url, body, config) => {
    if (url.includes('/ai-import-')) {
      context.calls.push({ method, url, body, config });
      if (method === 'upload') return aiTask('completed');
      if (method === 'patch') {
        Object.assign(batch.rows[0], body);
        throw new Error('response lost after server applied the edit');
      }
      return structuredClone(batch);
    }
    return normalHttp(method, url, body, config);
  };
  const mounted = mount(QuestionImport);
  try {
    await switchImportTab(mounted, 'ai');
    const uploader = walk(mounted.root, (node) => node.type === 'el-wrapper' && (node.props['on-change'] || node.props.onChange))[0];
    await (uploader.props['on-change'] || uploader.props.onChange)({ raw: new File(['reference'], 'reference.xlsx') });
    await click(button(mounted.root, '修改'));
    const stem = walk(mounted.root, (node) => node.type === 'el-wrapper' && node.props.placeholder === '修改生成题题干')[0];
    stem.props['onUpdate:modelValue']('服务端已修改的新题干');
    await nextTick();
    await click(button(mounted.root, '保存修改'));
    const dialog = walk(mounted.root, (node) => node.type === 'dialog' && node.props.title === '修改生成题')[0];
    assert.ok(dialog);
    assert.equal(button(dialog, '保存修改').props.disabled, true);
    assert.equal(button(mounted.root, '确认导入 2 道待审核题目').props.disabled, true);
    assert.equal(button(mounted.root, '下载 Excel').props.disabled, true);
    assert.equal(button(mounted.root, '预览').props.disabled, true);
    await click(button(dialog, '查询原批次状态'));
    assert.equal(context.calls.filter((call) => call.method === 'patch').length, 1);
    assert.equal(context.calls.filter((call) => call.method === 'get' && call.url === '/admin/questions/ai-import-batches/301').length, 2);
    assert.equal(walk(mounted.root, (node) => node.type === 'dialog' && node.props.title === '修改生成题').length, 0);
    const rows = walk(mounted.root, (node) => node.type === 'table').at(-1).props.data;
    assert.equal(rows[0].stem, '服务端已修改的新题干');
    assert.equal(button(mounted.root, '确认导入 2 道待审核题目').props.disabled, false);
  } finally { mounted.unmount(); }
});

test('an interrupted batch reconciliation clears only busy state and remains locked until a new GET confirms it', async () => {
  const gate = deferred();
  let reads = 0;
  const preview = { batch_id: '401', valid_rows: [2], errors: [], duplicates: [] };
  const workflow = importWorkflow.useQuestionImportWorkflow({
    readBatch: async () => { reads += 1; return reads === 1 ? gate.promise : preview; },
    commitBatch: async () => { throw new Error('response lost'); }, onCommitted() {}, onWarning() {},
  });
  await workflow.loadPreview(async () => preview);
  await workflow.commitImport();
  const pendingRead = workflow.queryBatchStatus();
  workflow.deactivate();
  workflow.activate();
  assert.equal(workflow.statusBusy.value, false);
  assert.equal(workflow.commitUnknown.value, true);
  await workflow.queryBatchStatus();
  assert.equal(reads, 2);
  assert.equal(workflow.commitUnknown.value, false);
  gate.resolve({ batch_id: '401', created_ids: ['801'], committed_rows: [2] });
  await pendingRead;
  assert.equal(workflow.preview.value.batch_id, '401');
  workflow.deactivate();
});

test('deactivating an in-flight AI row edit retains its unknown lock when the cached page returns', async () => {
  const gate = deferred();
  const workflow = importWorkflow.useAiQuestionImportWorkflow({
    enabledDifficulties: () => ['easy', 'hard'],
    readTask: async () => aiTask('completed'), readBatch: async () => aiImportBatch(),
    commitBatch: async () => ({}), onCommitted() {}, onWarning() {},
  });
  await workflow.startTask(async () => aiTask('completed'));
  const pendingEdit = workflow.updateRow(2, () => gate.promise);
  workflow.deactivate();
  workflow.activate();
  assert.equal(workflow.rowBusy.value, false);
  assert.equal(workflow.commitUnknown.value, true);
  await workflow.queryBatchStatus();
  assert.equal(workflow.commitUnknown.value, false);
  gate.resolve({ ...aiImportBatch(), rows: aiImportBatch().rows.map((row) => ({ ...row, stem: '迟到响应' })) });
  await pendingEdit;
  assert.equal(workflow.preview.value.rows[0].stem, '简单生成题');
  workflow.deactivate();
});
