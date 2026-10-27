import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { KeepAlive, createRenderer, h, nextTick, ref as vueRef } from '@vue/runtime-core';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const papersClientId = '\0paper-management-papers-client-test';
const detailClientId = '\0paper-management-detail-client-test';
const editClientId = '\0paper-management-edit-client-test';
const previewClientId = '\0paper-management-preview-client-test';
const routeStubId = '\0paper-management-route-test';
const elementStubId = '\0paper-management-element-test';
const iconsStubId = '\0paper-management-icons-test';
const httpStubId = '\0paper-management-http-test';
const authStubId = '\0paper-management-auth-test';
const unsavedStubId = '\0paper-management-unsaved-test';
const mediaStubId = '\0paper-management-media-test';
const exportHelperStubId = '\0paper-management-export-helper-test';
const designerStubId = '\0paper-management-designer-test';

const clientCode = new Map();
const context = {
  route: { params: { id: 'paper-1' }, query: { scope: 'training' } },
  calls: [],
  messages: [],
  routerPushes: [],
  permissions: new Set(),
  unsavedSources: [],
  deferredRequests: new Map(),
  trainingPaper: null,
  previewOrdinary: null,
  previewAnswers: null,
  media: async () => ({content_url:'/api/v1/media/preview-tickets/test.sig/content',expires_at:'2099-01-01T00:00:00Z'}),
  mediaInvalidations: [],
  mediaCalls: [],
};

const routeStubCode = `
  const context = globalThis.__paperManagementStateTest;
  export function useRoute() { return context.route; }
  export function useRouter() {
    return { async push(value) { context.routerPushes.push(JSON.parse(JSON.stringify(value))); } };
  }
`;
const elementStubCode = `
  const context = globalThis.__paperManagementStateTest;
  export const ElMessage = {
    success(message) { context.messages.push({ type: 'success', message }); },
    warning(message) { context.messages.push({ type: 'warning', message }); },
    info(message) { context.messages.push({ type: 'info', message }); },
    error(message) { context.messages.push({ type: 'error', message }); },
  };
  export const ElMessageBox = { async confirm() {} };
`;
const iconsStubCode = `export const ArrowLeft = { name: 'ArrowLeftStub', render() { return null; } };`;
const authStubCode = `
  const context = globalThis.__paperManagementStateTest;
  export function useAuthStore() { return { can(permission) { return context.permissions.has(permission); } }; }
`;
const unsavedStubCode = `
  const context = globalThis.__paperManagementStateTest;
  export function useUnsavedChanges(dirty, options = {}) {
    const source = {
      dirty,
      options,
      markClean() { dirty.value = false; },
      async confirmDiscard() {
        if (dirty.value) await options.onDiscard?.();
        return true;
      },
    };
    context.unsavedSources.push(source);
    return { markClean: source.markClean, confirmDiscard: source.confirmDiscard };
  }
`;
const mediaStubCode = `
  const context = globalThis.__paperManagementStateTest;
  export async function resolvePcMedia(assetId) {
    context.mediaCalls.push(assetId);
    return context.media(assetId);
  }
  export function invalidatePcMedia(assetId) { context.mediaInvalidations.push(assetId); }
`;
const httpStubCode = `
  const context = globalThis.__paperManagementStateTest;
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  async function request(method, path, body, config) {
    context.calls.push({ method, path, body: clone(body), config: clone(config) });
    const key = method + ' ' + path;
    const queue = context.deferredRequests.get(key);
    if (queue?.length) return clone(await queue.shift().promise);
    return clone(await context.respond(method, path, body, config));
  }
  export default {
    get(path, config) { return request('GET', path, undefined, config); },
    post(path, body, config) { return request('POST', path, body, config); },
    put(path, body, config) { return request('PUT', path, body, config); },
    delete(path, config) { return request('DELETE', path, undefined, config); },
  };
`;

function plugin() {
  return {
    name: 'paper-management-state-test-stubs',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source.startsWith('/@id/__x00__paper-management-')) return source.replace('/@id/__x00__', '\0');
      const owner = String(importer || '');
      const isPaperView = owner.includes('/src/views/admin/Papers.vue')
        || owner.includes('/src/components/PaperPreviewDialog.vue')
        || owner.includes('/src/components/PaperEditDialog.vue')
        || owner === papersClientId || owner === detailClientId || owner === editClientId;
      const isPreview = owner.includes('/src/components/QuestionPreview.vue') || owner === previewClientId;
      const isAuthoringApi = owner.includes('/src/api/question-authoring.ts');
      if (source === 'vue-router' && isPaperView) return routeStubId;
      if (source === 'element-plus' && (isPaperView || isPreview)) return elementStubId;
      if (source === '@element-plus/icons-vue' && isPaperView) return iconsStubId;
      if ((source === '../../api/http' || source === '../api/http' || source === '/src/api/http.ts') && isPaperView) return httpStubId;
      if ((source === './http' || source === '/src/api/http.ts') && isAuthoringApi) return httpStubId;
      if ((source === '../../stores/auth' || source === '../stores/auth' || source === '/src/stores/auth.ts') && isPaperView) return authStubId;
      if ((source === '../../composables/useUnsavedChanges' || source === '../composables/useUnsavedChanges' || source === '/src/composables/useUnsavedChanges.ts') && isPaperView) return unsavedStubId;
      if ((source === '../services/media-content' || source === '/src/services/media-content.ts') && isPreview) return mediaStubId;
      if (source.includes('__x00__paper-management-media-test')) return mediaStubId;
      if (source.includes('__x00__plugin-vue:export-helper')) return exportHelperStubId;
      if ((source === '../../components/QuestionPreview.vue' || source === './QuestionPreview.vue' || source === '/src/components/QuestionPreview.vue') && isPaperView) return previewClientId;
      if ((source === '../../components/PaperPreviewDialog.vue' || source === '/src/components/PaperPreviewDialog.vue') && isPaperView) return detailClientId;
      if ((source === '../../components/PaperEditDialog.vue' || source === '/src/components/PaperEditDialog.vue') && isPaperView) return editClientId;
      // This Node renderer exercises page state without a DOM. The real designer
      // and Tiptap integration is mounted in paper-host-main.spec.ts (jsdom).
      if ((source === '../../components/question-designers/PaperDesigner.vue' || source === '/src/components/question-designers/PaperDesigner.vue') && isPaperView) return designerStubId;
      if ([papersClientId, detailClientId, editClientId, previewClientId].includes(source)) return source;
      return undefined;
    },
    load(id) {
      if (id === routeStubId) return routeStubCode;
      if (id === elementStubId) return elementStubCode;
      if (id === iconsStubId) return iconsStubCode;
      if (id === httpStubId) return httpStubCode;
      if (id === authStubId) return authStubCode;
      if (id === unsavedStubId) return unsavedStubCode;
      if (id === mediaStubId) return mediaStubCode;
      if (id === designerStubId) return `export default { name: 'PaperDesigner', render() { return null; } };`;
      if (id === exportHelperStubId) return `export default (sfc, props) => { for (const [key, value] of props) sfc[key] = value; return sfc; };`;
      return clientCode.get(id);
    },
  };
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
      this.insert(node, parent, anchor);
      return [node, node];
    },
  });
}

function passthrough(type, slotNames = ['default']) {
  return {
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      const row = { rules: [], mode: 'fixed', category_id: '', regulation_id: '', status: '' };
      return () => h(type, attrs, slotNames.flatMap((name) => slots[name]?.({ row }) || []));
    },
  };
}

function registerUi(app) {
  const wrappers = [
    'el-alert', 'el-button', 'el-card', 'el-descriptions', 'el-descriptions-item', 'el-dialog', 'el-divider',
    'el-form', 'el-form-item', 'el-icon', 'el-input', 'el-input-number', 'el-option', 'el-pagination',
    'el-radio-button', 'el-radio-group', 'el-select', 'el-switch', 'el-tab-pane', 'el-tabs', 'el-tag',
    'el-table', 'el-table-column', 'el-dropdown', 'el-dropdown-menu', 'el-dropdown-item',
  ];
  for (const name of wrappers) {
    const slots = name === 'el-dialog' ? ['default', 'footer'] : name === 'el-dropdown' ? ['default', 'dropdown'] : name === 'el-card' ? ['default', 'header'] : ['default'];
    app.component(name, passthrough(name.slice(3), slots));
  }
  app.directive('loading', {});
}

function mount(Component) {
  const host = renderer();
  const root = { type: 'root', props: {}, children: [], parent: null, text: '' };
  const app = host.createApp(Component);
  registerUi(app);
  app.mount(root);
  return { app, root, state: app._instance.setupState, unmount: () => app.unmount() };
}

function findComponentInstance(vnode, Component) {
  if (!vnode) return null;
  if (vnode.type === Component && vnode.component) return vnode.component;
  const fromSubTree = findComponentInstance(vnode.component?.subTree, Component);
  if (fromSubTree) return fromSubTree;
  const children = Array.isArray(vnode.children) ? vnode.children : [];
  for (const child of children) {
    const found = findComponentInstance(child, Component);
    if (found) return found;
  }
  return null;
}

async function mountCached(Component) {
  const active = vueRef(true);
  const Shell = { setup() { return () => h(KeepAlive, null, { default: () => active.value ? h(Component) : null }); } };
  const host = renderer();
  const root = { type: 'root', props: {}, children: [], parent: null, text: '' };
  const app = host.createApp(Shell);
  registerUi(app);
  app.mount(root);
  await nextTick();
  const instance = findComponentInstance(app._instance.subTree, Component);
  assert.ok(instance, 'expected cached SFC instance');
  return {
    app,
    root,
    active,
    state: instance.setupState,
    async deactivate() { active.value = false; await nextTick(); },
    async activate() { active.value = true; await nextTick(); },
    unmount: () => app.unmount(),
  };
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

function walk(node, predicate, output = []) {
  if (!node) return output;
  if (predicate(node)) output.push(node);
  for (const child of node.children || []) walk(child, predicate, output);
  return output;
}

function renderedText(node) {
  if (!node) return '';
  return `${node.text || ''}${(node.children || []).map(renderedText).join('')}`;
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function deferredRequest(method, path) {
  const pending = deferred();
  const key = `${method} ${path}`;
  const queue = context.deferredRequests.get(key) || [];
  queue.push(pending);
  context.deferredRequests.set(key, queue);
  return pending;
}

function question(index, scoreCents) {
  return {
    question_id: `question-${index}`,
    question_version_id: `version-${index}`,
    type: 'single',
    difficulty: 'easy',
    concept_id: null,
    regulation_id: null,
    stem: `<p>第 ${index} 题</p>`,
    options: [{ key: 'A', text: 'A' }, { key: 'B', text: 'B' }],
    score_cents: scoreCents,
    score: scoreCents / 100,
    sort: index - 1,
  };
}

function trainingPaper(overrides = {}) {
  const scores = [1000, 1500, 2000, 2500, 3000];
  return {
    id: 'paper-1',
    title: '五档固定卷',
    business_scope: 'training',
    mode: 'fixed',
    category_id: 'category-1',
    requires_learning: false,
    required_learning_minutes: null,
    remark: null,
    regulation_ids: [],
    course_ids: [],
    rules: scores.map((score_cents) => ({ type: 'single', count: 1, score_cents })),
    total_score: 100,
    pass_score: 60,
    duration_minutes: 30,
    max_attempts: 3,
    partial_credit_ratio: 0.5,
    status: 'draft',
    latest_release_id: null,
    sum_score_cents: 10000,
    questions: scores.map((score, index) => question(index + 1, score)),
    ...overrides,
  };
}

function previewFixture(note, withAnswers = false, stem = '<p>预览题</p>') {
  return {
    paper_id: 'paper-1',
    release_id: null,
    mode: 'fixed',
    sample_kind: 'fixed_paper',
    note,
    difficulty: 'easy',
    rule: { total_cents: 10000, pass_cents: 6000, duration_minutes: 30, max_attempts: 3, partial_credit_ratio: 0.5, rules: [] },
    capacities: [],
    questions: [{
      question_id: 'question-1', question_version_id: 'version-1', type: 'single', difficulty: 'easy',
      concept_id: null, regulation_id: null, stem, options: [{ key: 'A', text: 'A' }, { key: 'B', text: 'B' }],
      score: 100, ...(withAnswers ? { answer: [0], analysis: '答案解析', rubric: null } : {}),
    }],
  };
}

function setResponder() {
  context.respond = async (method, path, body, config) => {
    if (method === 'GET' && path === '/admin/questions/authoring-options') return { difficulties: [{ code: 'easy', label: '简单', enabled: true, sort: 1 }, { code: 'medium', label: '中级', enabled: false, sort: 2 }, { code: 'hard', label: '困难', enabled: true, sort: 3 }] };
    if (method === 'GET' && path === '/admin/papers') return { items: [context.trainingPaper], total: 1, page: 1, page_size: 20 };
    if (method === 'GET' && path === '/admin/papers/category-options') return { items: [{ id: 'category-1', name: '默认类别' }], total: 1, page: 1, page_size: 100 };
    if (method === 'GET' && path === '/admin/papers/regulation-options') return { items: [], total: 0, page: 1, page_size: 100 };
    if (method === 'GET' && path === '/admin/papers/course-options') return { items: [], total: 0, page: 1, page_size: 100 };
    if (method === 'GET' && path === '/admin/papers/paper-1') return context.trainingPaper;
    if (method === 'GET' && path === '/admin/papers/paper-1/candidates') return { items: [], total: 0, page: 1, page_size: 100 };
    if (method === 'GET' && path === '/admin/papers/paper-1/preview') return context.previewOrdinary;
    if (method === 'GET' && path === '/admin/papers/paper-1/preview/answers') return context.previewAnswers;
    if (method === 'GET' && path === '/regulations') return { list: [{ id: 11, title: '制度十一' }], total: 1 };
    if (method === 'POST' && path === '/admin/papers') return { ...context.trainingPaper, id: 'created-paper' };
    if (method === 'PUT' && path === '/admin/papers/paper-1') {
      context.trainingPaper = { ...context.trainingPaper, ...body, rules: body.rules ?? context.trainingPaper.rules };
      return context.trainingPaper;
    }
    if (method === 'PUT' && path === '/admin/papers/paper-1/questions') return {};
    if (method === 'POST' && path === '/admin/papers/paper-1/publish') {
      context.trainingPaper = { ...context.trainingPaper, status: 'published', latest_release_id: 'release-1' };
      return { release_id: 'release-1' };
    }
    return {};
  };
}

function respondWithTrainingOptions({ categories, regulations, courses }) {
  const fallback = context.respond;
  context.respond = async (method, path, body, config) => {
    if (method === 'GET' && path === '/admin/papers/category-options') return { items: categories, total: categories.length, page: 1, page_size: 100 };
    if (method === 'GET' && path === '/admin/papers/regulation-options') return { items: regulations, total: regulations.length, page: 1, page_size: 100 };
    if (method === 'GET' && path === '/admin/papers/course-options') return { items: courses, total: courses.length, page: 1, page_size: 100 };
    return fallback(method, path, body, config);
  };
}

function stripClientGlue(code) {
  return code
    .replace(/^import \{ createHotContext[\s\S]*?import\.meta\.hot = [^;]+;\s*/, '')
    .replace(/typeof __VUE_HMR_RUNTIME__[\s\S]*?(?=import _export_sfc)/, '')
    .replace(/from "\/node_modules\/\.vite\/deps\/vue\.js[^"]*"/g, 'from "vue"');
}

async function loadClientSfc(path, id) {
  const transformed = await vite.transformRequest(path);
  assert.ok(transformed?.code, `Vite should compile ${path}`);
  clientCode.set(id, stripClientGlue(transformed.code));
  return (await vite.ssrLoadModule(id)).default;
}

let vite;
let Papers;
let PaperDetail;

before(async () => {
  globalThis.__paperManagementStateTest = context;
  vite = await createServer({
    root: webRoot,
    configFile: resolve(webRoot, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    plugins: [plugin()],
  });
  await loadClientSfc('/src/components/QuestionPreview.vue', previewClientId);
  PaperDetail = await loadClientSfc('/src/components/PaperPreviewDialog.vue', detailClientId);
  await loadClientSfc('/src/components/PaperEditDialog.vue', editClientId);
  Papers = await loadClientSfc('/src/views/admin/Papers.vue', papersClientId);
});

after(async () => {
  delete globalThis.__paperManagementStateTest;
  await vite?.close();
});

beforeEach(() => {
  context.route = { params: { id: 'paper-1' }, query: { scope: 'training' } };
  context.calls = [];
  context.messages = [];
  context.routerPushes = [];
  context.permissions = new Set(['papers:read', 'papers:write', 'papers:publish', 'papers:export', 'questions:read', 'regulations:read']);
  context.unsavedSources = [];
  context.deferredRequests = new Map();
  context.trainingPaper = trainingPaper();
  context.previewOrdinary = previewFixture('普通预览');
  context.previewAnswers = previewFixture('答案预览', true);
  context.media = async () => ({content_url:'/api/v1/media/preview-tickets/test.sig/content',expires_at:'2099-01-01T00:00:00Z'});
  context.mediaInvalidations = [];
  context.mediaCalls = [];
  setResponder();
});

async function mountPapers() {
  const mounted = mount(Papers);
  await waitFor(() => context.calls.some((call) => call.method === 'GET' && call.path === '/admin/papers'), 'paper list');
  await nextTick();
  return mounted;
}

async function mountDetail() {
  context.route = { params: { id: 'paper-1' }, query: { scope: 'training' } };
  const mounted = mount(PaperDetail);
  mounted.state.openPreview = (withAnswers) => mounted.state.open({ id:'paper-1', title:'五档固定卷' }, withAnswers);
  await nextTick();
  return mounted;
}

test('mounts only the training paper list without legacy state or requests', async () => {
  const mounted = await mountPapers();
  assert.equal(context.calls.some((call) => call.path.startsWith('/ai/papers')), false);
  assert.equal(mounted.state.activeScope, undefined);
  assert.equal(mounted.state.legacyQuery, undefined);
  assert.equal(mounted.state.loadLegacy, undefined);
  mounted.unmount();
});

test('omits every blank list filter and ignores a stale create receipt after close and reopen', async () => {
  const mounted = await mountPapers();
  assert.equal(context.calls.some((call) => call.method === 'GET' && call.path === '/regulations'), false);
  const firstList = context.calls.find((call) => call.method === 'GET' && call.path === '/admin/papers');
  assert.deepEqual(firstList.config.params, { page: 1, page_size: 20 });

  mounted.state.trainingQuery.status = 'draft';
  mounted.state.trainingQuery.category_id = 'category-1';
  mounted.state.trainingQuery.keyword = '关键字';
  mounted.state.trainingQuery.status = '';
  mounted.state.trainingQuery.category_id = '';
  mounted.state.trainingQuery.keyword = '';
  const beforeSearch = context.calls.length;
  mounted.state.searchTraining();
  await waitFor(() => context.calls.length > beforeSearch, 'cleared filter request');
  assert.deepEqual(context.calls.filter((call) => call.method === 'GET' && call.path === '/admin/papers').at(-1).config.params, { page: 1, page_size: 20 });

  mounted.state.openTrainingCreate();
  mounted.state.trainingCreate.title = '旧创建请求';
  const pending = deferredRequest('POST', '/admin/papers');
  const create = mounted.state.createTraining();
  await waitFor(() => context.calls.some((call) => call.method === 'POST' && call.path === '/admin/papers'), 'create request');
  assert.equal(Object.hasOwn(context.calls.find((call) => call.method === 'POST' && call.path === '/admin/papers').body, 'rules'), false);
  await mounted.state.closeTrainingCreate();
  mounted.state.openTrainingCreate();
  mounted.state.trainingCreate.title = '新弹窗草稿';
  pending.resolve({ ...trainingPaper(), id: 'created-old', title: '旧创建请求' });
  await create;
  assert.equal(mounted.state.trainingCreateVisible, true);
  assert.equal(mounted.state.trainingCreate.title, '新弹窗草稿');
  assert.equal(context.calls.filter((call) => call.method === 'POST' && call.path === '/admin/papers').length, 1);
  assert.deepEqual(context.routerPushes, []);
  mounted.unmount();
});

test('forces fixed mode and omits rules when internal create state is tampered with', async () => {
  const mounted = await mountPapers();
  mounted.state.openTrainingCreate();
  mounted.state.trainingCreate.title = '被篡改的创建草稿';
  mounted.state.trainingCreate.mode = 'random';
  mounted.state.trainingCreate.rules = [{ type: 'single', count: 1, score_cents: 10000 }];
  await mounted.state.createTraining();
  const call = context.calls.find((item) => item.method === 'POST' && item.path === '/admin/papers');
  assert.equal(call.body.mode, 'fixed');
  assert.equal(Object.hasOwn(call.body, 'rules'), false);
  assert.deepEqual(context.routerPushes, [{ path: '/admin/papers/created-paper', query: { scope: 'training', designer: '1' } }]);
  mounted.unmount();
});

test('creates fixed once and opens its persisted draft in the complete designer entry', async () => {
  const mounted = await mountPapers();
  mounted.state.openTrainingCreate();
  mounted.state.trainingCreate.title = '完整固定卷';
  await Promise.all([mounted.state.createTraining(), mounted.state.createTraining()]);
  assert.equal(context.calls.filter((call) => call.method === 'POST' && call.path === '/admin/papers').length, 1);
  assert.deepEqual(context.routerPushes, [{ path: '/admin/papers/created-paper', query: { scope: 'training', designer: '1' } }]);
  mounted.unmount();
});

test('a create receipt arriving after the cached page leaves never redirects', async () => {
  const mounted = await mountPapers();
  mounted.state.openTrainingCreate();
  mounted.state.trainingCreate.title = '离页创建请求';
  const pending = deferredRequest('POST', '/admin/papers');
  const create = mounted.state.createTraining();
  await waitFor(() => context.calls.some((call) => call.method === 'POST' && call.path === '/admin/papers'), 'create before leave');
  mounted.unmount();
  pending.resolve({ ...trainingPaper(), id: 'created-after-leave' });
  await create;
  assert.deepEqual(context.routerPushes, []);
});

test('a create receipt arriving while the Papers SFC is deactivated cannot reclaim the cached page', async () => {
  const mounted = await mountCached(Papers);
  await waitFor(() => context.calls.some((call) => call.method === 'GET' && call.path === '/admin/papers'), 'cached paper list');
  mounted.state.openTrainingCreate();
  mounted.state.trainingCreate.title = '停用中的创建请求';
  const pending = deferredRequest('POST', '/admin/papers');
  const create = mounted.state.createTraining();
  await waitFor(() => context.calls.some((call) => call.method === 'POST' && call.path === '/admin/papers'), 'create before deactivate');
  const listReads = context.calls.filter((call) => call.method === 'GET' && call.path === '/admin/papers').length;
  await mounted.deactivate();
  pending.resolve({ ...trainingPaper(), id: 'created-while-deactivated' });
  await create;
  await mounted.activate();
  await waitFor(() => context.calls.filter((call) => call.method === 'GET' && call.path === '/admin/papers').length > listReads, 'reconcile completed create');
  assert.deepEqual(context.routerPushes, []);
  assert.equal(mounted.state.trainingCreateVisible, false);
  assert.ok(context.messages.some((message) => message.type === 'info' && message.message.includes('创建请求已完成')));
  mounted.unmount();
});

test('commits preview mode atomically, invalidates close, and keeps ordinary rendered output answer-free', async () => {
  const mounted = await mountDetail();
  const answers = deferredRequest('GET', '/admin/papers/paper-1/preview/answers');
  const ordinary = deferredRequest('GET', '/admin/papers/paper-1/preview');
  const answersOpen = mounted.state.openPreview(true);
  const ordinaryOpen = mounted.state.openPreview(false);
  await waitFor(() => context.calls.filter((call) => call.path.includes('/preview')).length === 2, 'parallel previews');
  ordinary.resolve(previewFixture('普通响应却含敏感字段', true));
  await ordinaryOpen;
  answers.resolve(previewFixture('迟到答案响应', true));
  await answersOpen;
  assert.equal(mounted.state.preview.note, '普通响应却含敏感字段');
  assert.equal(mounted.state.previewAnswers, false);

  await waitFor(() => mounted.state.previewResourcesReady, 'ordinary preview rendered');
  const html = walk(mounted.root, (node) => typeof node.props?.innerHTML === 'string')
    .map((node) => node.props.innerHTML).join('');
  assert.match(html, /预览题/);
  assert.equal(html.includes('答案解析'), false);
  assert.equal(renderedText(mounted.root).includes('正确答案'), false);
  assert.equal(renderedText(mounted.root).includes('导出 JSON'), false);
  assert.equal(renderedText(mounted.root).includes('五档固定卷'), true);

  const late = deferredRequest('GET', '/admin/papers/paper-1/preview');
  const reload = mounted.state.openPreview(false);
  await waitFor(() => context.calls.filter((call) => call.path === '/admin/papers/paper-1/preview').length === 2, 'late closed preview');
  mounted.state.previewVisible = false;
  await nextTick();
  late.resolve(previewFixture('关闭后的迟到响应'));
  await reload;
  assert.equal(mounted.state.previewVisible, false);
  assert.equal(mounted.state.preview, null);
  mounted.unmount();
});

test('a preview response arriving while PaperPreviewDialog is deactivated stays invalid after reactivation', async () => {
  const mounted = await mountCached(PaperDetail);
  mounted.state.openPreview = (withAnswers) => mounted.state.open({ id:'paper-1', title:'五档固定卷' }, withAnswers);
  const pending = deferredRequest('GET', '/admin/papers/paper-1/preview');
  const open = mounted.state.openPreview(false);
  await waitFor(() => context.calls.some((call) => call.path === '/admin/papers/paper-1/preview'), 'preview before deactivate');
  await mounted.deactivate();
  pending.resolve(previewFixture('停用后的迟到预览'));
  await open;
  await mounted.activate();
  assert.equal(mounted.state.preview, null);
  assert.equal(mounted.state.previewVisible, false);
  mounted.unmount();
});

test('uses controlled media readiness for printing and ignores a late decode after preview closes', async () => {
  const originalDocument = globalThis.document;
  const originalImage = globalThis.Image;
  const originalWindow = globalThis.window;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const revoked = [];
  let printCalls = 0;
  let decodeCalls = 0;
  const decode = deferred();
  globalThis.document = controlledMediaDocument();
  globalThis.window = { print() { printCalls += 1; } };
  URL.createObjectURL = () => 'blob:paper-preview-image';
  URL.revokeObjectURL = (value) => revoked.push(value);
  globalThis.Image = class {
    set src(value) { this.value = value; }
    decode() { decodeCalls += 1; return decode.promise; }
  };
  try {
    const mounted = await mountDetail();
    context.previewOrdinary = previewFixture('带图预览', false, '<p>题图<img data-media-id="42" alt="题图"></p>');
    const open = mounted.state.openPreview(false);
    await open;
    await waitFor(() => context.mediaCalls.includes('42'), 'controlled preview media');
    await waitFor(() => decodeCalls === 1, 'controlled preview decode');
    mounted.state.printPreview();
    assert.equal(printCalls, 0);
    assert.equal(mounted.state.previewResourcesReady, false);

    mounted.state.previewVisible = false;
    await nextTick();
    assert.deepEqual(revoked, [], 'signed media URLs are not object URLs owned by the preview');
    decode.resolve();
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    assert.equal(mounted.state.previewResourcesReady, false);
    assert.equal(printCalls, 0);
    mounted.unmount();

    const success = await mountDetail();
    context.previewOrdinary = previewFixture('无图预览');
    await success.state.openPreview(false);
    await waitFor(() => success.state.previewResourcesReady === true, 'no-media preview ready');
    success.state.printPreview();
    assert.equal(printCalls, 1);
    success.unmount();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  }
});

test('allows printing only after a controlled image finishes decoding', async () => {
  const originalDocument = globalThis.document;
  const originalImage = globalThis.Image;
  const originalWindow = globalThis.window;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const revoked = [];
  let printCalls = 0;
  let decodeCalls = 0;
  globalThis.document = controlledMediaDocument();
  globalThis.window = { print() { printCalls += 1; } };
  URL.createObjectURL = () => 'blob:decoded-paper-image';
  URL.revokeObjectURL = (value) => revoked.push(value);
  globalThis.Image = class {
    set src(value) { this.value = value; }
    async decode() { decodeCalls += 1; }
  };
  try {
    context.previewOrdinary = previewFixture('成功题图', false, '<p>题图<img data-media-id="43" alt="题图"></p>');
    const mounted = await mountDetail();
    await mounted.state.openPreview(false);
    await waitFor(() => mounted.state.previewResourcesReady === true, 'decoded media ready');
    assert.equal(decodeCalls, 1);
    mounted.state.printPreview();
    assert.equal(printCalls, 1);
    mounted.state.previewVisible = false;
    await nextTick();
    assert.deepEqual(revoked, [], 'signed media URLs are not revoked as blobs');
    mounted.unmount();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  }
});

test('treats a controlled image decode failure as a visible non-printable result', async () => {
  const originalDocument = globalThis.document;
  const originalImage = globalThis.Image;
  const originalWindow = globalThis.window;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const revoked = [];
  let printCalls = 0;
  globalThis.document = controlledMediaDocument();
  globalThis.window = { print() { printCalls += 1; } };
  URL.createObjectURL = () => 'blob:failed-decode-image';
  URL.revokeObjectURL = (value) => revoked.push(value);
  globalThis.Image = class {
    set src(value) { this.value = value; }
    async decode() { throw new Error('decode failed'); }
  };
  try {
    context.previewOrdinary = previewFixture('解码失败题图', false, '<p>题图<img data-media-id="44" alt="题图"></p>');
    const mounted = await mountDetail();
    await mounted.state.openPreview(false);
    await waitFor(() => mounted.state.previewResourcesFailed === true, 'decode failure state');
    mounted.state.printPreview();
    assert.equal(printCalls, 0);
    assert.deepEqual(context.mediaInvalidations, ['44']);
    assert.deepEqual(revoked, []);
    assert.ok(walk(mounted.root, (node) => String(node.props?.innerHTML || '').includes('图片 44 暂不可预览')).length > 0);
    mounted.unmount();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  }
});

test('marks failed controlled media as non-printable and can retry the visible fallback', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  let printCalls = 0;
  let mediaAttempts = 0;
  globalThis.document = controlledMediaDocument();
  globalThis.window = { print() { printCalls += 1; } };
  URL.createObjectURL = () => 'blob:retried-paper-image';
  URL.revokeObjectURL = () => {};
  try {
    context.media = async () => {
      mediaAttempts += 1;
      if (mediaAttempts === 1) throw new Error('media unavailable');
      return {content_url:'/api/v1/media/preview-tickets/test.sig/content',expires_at:'2099-01-01T00:00:00Z'};
    };
    context.previewOrdinary = previewFixture('失败题图', false, '<p>题图<img data-media-id="77" alt="题图"></p>');
    const mounted = await mountDetail();
    await mounted.state.openPreview(false);
    await waitFor(() => mounted.state.previewResourcesFailed === true, 'failed media state');
    assert.ok(walk(mounted.root, (node) => String(node.props?.innerHTML || '').includes('图片 77 暂不可预览')).length > 0);
    mounted.state.printPreview();
    assert.equal(printCalls, 0);
    assert.ok(context.messages.some((message) => message.type === 'warning'));
    mounted.state.retryPreviewMedia();
    await waitFor(() => context.mediaCalls.filter((id) => id === '77').length === 2, 'media retry request');
    await waitFor(() => mounted.state.previewResourcesReady === true, 'media retry ready');
    mounted.state.printPreview();
    assert.equal(printCalls, 1);
    mounted.unmount();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  }
});

function controlledMediaDocument() {
  const escapeText = (value) => String(value).replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]);
  const escapeAttribute = (value) => escapeText(value).replace(/"/g, '&quot;');
  class TestNode {
    constructor(nodeType) { this.nodeType = nodeType; this.nodeValue = null; this.childNodes = []; this.parentNode = null; }
    appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node; }
    remove() { const index = this.parentNode?.childNodes.indexOf(this) ?? -1; if (index >= 0) this.parentNode.childNodes.splice(index, 1); this.parentNode = null; }
    replaceWith(node) { const index = this.parentNode?.childNodes.indexOf(this) ?? -1; if (index < 0) return; node.parentNode = this.parentNode; this.parentNode.childNodes.splice(index, 1, node); this.parentNode = null; }
    querySelectorAll(selector) {
      const output = [];
      for (const child of this.childNodes) {
        if (child.nodeType === 1 && selector === 'img[data-media-id]' && child.tagName === 'IMG' && child.getAttribute('data-media-id')) output.push(child);
        output.push(...child.querySelectorAll(selector));
      }
      return output;
    }
  }
  class TestText extends TestNode { constructor(value) { super(3); this.nodeValue = value; } }
  class TestElement extends TestNode {
    constructor(tag) { super(1); this.tagName = tag.toUpperCase(); this.namespaceURI = 'http://www.w3.org/1999/xhtml'; this.attributes = new Map(); }
    get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    get dataset() { return { mediaId: this.getAttribute('data-media-id') || '' }; }
    set src(value) { this.setAttribute('src', value); }
    set loading(value) { this.setAttribute('loading', value); }
    set className(value) { this.setAttribute('class', value); }
    set textContent(value) { this.childNodes = []; this.appendChild(new TestText(String(value))); }
    set innerHTML(value) { this.childNodes = []; parse(value, this); }
    get innerHTML() { return this.childNodes.map(serialize).join(''); }
  }
  class TestFragment extends TestNode { constructor() { super(11); } }
  class TestTemplate extends TestElement {
    constructor() { super('template'); this.content = new TestFragment(); }
    set innerHTML(value) { this.content = new TestFragment(); parse(value, this.content); }
    get innerHTML() { return this.content.childNodes.map(serialize).join(''); }
  }
  function parse(html, target) {
    const stack = [target];
    for (const token of String(html).matchAll(/<\/?([a-z][\w-]*)([^>]*)>|([^<]+)/gi)) {
      if (token[3] !== undefined) { stack.at(-1).appendChild(new TestText(token[3])); continue; }
      const raw = token[0];
      if (raw.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
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
  return {
    createElement(tag) { return tag.toLowerCase() === 'template' ? new TestTemplate() : new TestElement(tag); },
    createTextNode(value) { return new TestText(String(value)); },
  };
}
