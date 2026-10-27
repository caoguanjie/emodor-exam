import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createRenderer, h, nextTick, reactive } from '@vue/runtime-core';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const clientComponentId = '\0student-avatar-save-client-test';
const routeStubId = '\0student-avatar-save-route-test';
const elementStubId = '\0student-avatar-save-element-test';
const httpStubId = '\0student-avatar-save-http-test';
const authStubId = '\0student-avatar-save-auth-test';
const formatStubId = '\0student-avatar-save-format-test';
const mediaStubId = '\0student-avatar-save-media-test';
const importPreviewStubId = '\0student-avatar-save-import-preview-test';
const unsavedStubId = '\0student-avatar-save-unsaved-test';

const testContext = {
  post: async () => ({}),
  put: async () => ({}),
  messages: [],
  calls: [],
  route: null,
};
let clientComponentCode = '';
let vite;
let Users;

const routeStubCode = `
  const context = globalThis.__studentAvatarSaveTest;
  export function useRoute() { return context.route; }
  export function useRouter() { return {
    async push() {},
    async replace(value) {
      context.route.query = value.query;
      context.route.fullPath = context.route.path + (Object.keys(value.query).length ? '?' + new URLSearchParams(value.query) : '');
    },
  }; }
`;
const elementStubCode = `
  const context = globalThis.__studentAvatarSaveTest;
  export const ElMessage = {
    success(message) { context.messages.push({ type: 'success', message }); },
    warning(message) { context.messages.push({ type: 'warning', message }); },
  };
  export const ElMessageBox = {
    async confirm() {},
    async prompt() { return { value: '' }; },
  };
`;
const httpStubCode = `
  const context = globalThis.__studentAvatarSaveTest;
  export default {
    async get(path, config) {
      context.calls.push({ path, params: config?.params });
      if (path === '/departments/tree') return { list: [] };
      if (path === '/admin/training-categories') return { items: [{ id: 'category-1', name: '默认类别' }] };
      if (path === '/admin/students') return { items: [], total: 0 };
      return { avatar_id: null };
    },
    async post(path, body) { return context.post(path, body); },
    async put(path, body) { return context.put(path, body); },
  };
  export function download() {}
  export async function upload() { return {}; }
`;
const authStubCode = `export function useAuthStore() { return { can: () => true, isSuperAdmin: true }; }`;
const formatStubCode = `export function formatDateTime(value) { return String(value || ''); }`;
const mediaStubCode = `
  import { h } from 'vue';
  export default {
    name: 'MediaUploadStub',
    props: { modelValue: null, purpose: String, ownerId: String, disabled: Boolean },
    setup(props) { return () => h('media-upload', { disabled: props.disabled }); },
  };
`;
const importPreviewStubCode = `export default { name: 'ImportPreviewStub', render() { return null; } };`;
const unsavedStubCode = `
  export function useUnsavedChanges(dirty, options = {}) {
    return {
      markClean() { dirty.value = false; },
      async confirmDiscard() {
        if (dirty.value) await options.onDiscard?.();
        return true;
      },
    };
  }
`;

function testPlugin() {
  return {
    name: 'student-avatar-save-test-stubs',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'vue-router' && importer?.includes('/src/views/admin/Users.vue')) return routeStubId;
      if (source === 'element-plus' && importer?.includes('/src/views/admin/Users.vue')) return elementStubId;
      if (source === '../../api/http' && importer?.includes('/src/views/admin/Users.vue')) return httpStubId;
      if (source === '../../stores/auth' && importer?.includes('/src/views/admin/Users.vue')) return authStubId;
      if (source === '../../utils/format' && importer?.includes('/src/views/admin/Users.vue')) return formatStubId;
      if (source === '../../components/MediaUpload.vue' && importer?.includes('/src/views/admin/Users.vue')) return mediaStubId;
      if (source === '../../components/ImportPreview.vue' && importer?.includes('/src/views/admin/Users.vue')) return importPreviewStubId;
      // This suite exercises form-save locking. The avatar display is covered
      // by the real URL composable/component suites, not the SSR-only loader.
      if (source === '../../components/StudentAvatar.vue' && importer?.includes('/src/views/admin/Users.vue')) return importPreviewStubId;
      if (source === '../../composables/useUnsavedChanges' && importer?.includes('/src/views/admin/Users.vue')) return unsavedStubId;
      if (source === clientComponentId) return clientComponentId;
      return undefined;
    },
    load(id) {
      if (id === routeStubId) return routeStubCode;
      if (id === elementStubId) return elementStubCode;
      if (id === httpStubId) return httpStubCode;
      if (id === authStubId) return authStubCode;
      if (id === formatStubId) return formatStubCode;
      if (id === mediaStubId) return mediaStubCode;
      if (id === importPreviewStubId) return importPreviewStubCode;
      if (id === unsavedStubId) return unsavedStubCode;
      if (id === clientComponentId) return clientComponentCode;
      return undefined;
    },
  };
}

function createHost() {
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
      return () => h(type, attrs, slotNames.flatMap((name) => slots[name]?.({ row: {} }) || []));
    },
  };
}

function findNode(root, type) {
  if (!root) return null;
  if (root.type === type) return root;
  for (const child of root.children || []) {
    const found = findNode(child, type);
    if (found) return found;
  }
  return null;
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolveValue) => { resolvePromise = resolveValue; });
  return { promise, resolve: resolvePromise };
}

async function mountUsers() {
  const host = createHost();
  const root = { type: 'root', props: {}, children: [], parent: null, text: '' };
  const app = host.createApp(Users);
  const components = {
    'el-input': passthrough('input'),
    'el-input-number': passthrough('input-number'),
    'el-switch': passthrough('switch'),
    'el-radio': passthrough('radio'),
    'el-radio-group': passthrough('radio-group'),
    'el-select': passthrough('select'),
    'el-option': passthrough('option'),
    'el-button': passthrough('button'),
    'el-upload': passthrough('upload'),
    'el-table': passthrough('table'),
    'el-table-column': passthrough('table-column'),
    'el-tag': passthrough('tag'),
    'el-empty': passthrough('empty'),
    'el-pagination': passthrough('pagination'),
    'el-dialog': passthrough('dialog', ['default', 'footer']),
    'el-form': passthrough('form'),
    'el-form-item': passthrough('form-item'),
    'el-tree-select': passthrough('tree-select'),
    'el-alert': passthrough('alert', ['default']),
    'el-result': passthrough('result', ['default', 'sub-title']),
  };
  for (const [name, component] of Object.entries(components)) app.component(name, component);
  app.directive('loading', {});
  app.mount(root);
  await nextTick();
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  return {
    app,
    root,
    state: app._instance.setupState,
    unmount: () => app.unmount(),
  };
}

before(async () => {
  globalThis.__studentAvatarSaveTest = testContext;
  vite = await createServer({
    root: webRoot,
    configFile: resolve(webRoot, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    plugins: [testPlugin()],
  });
  const transformed = await vite.transformRequest('/src/views/admin/Users.vue');
  assert.ok(transformed?.code, 'Vite should compile the real Users SFC');
  clientComponentCode = transformed.code
    .replace(/^import \{ createHotContext[\s\S]*?import\.meta\.hot = [^;]+;\s*/, '')
    .replace(/typeof __VUE_HMR_RUNTIME__[\s\S]*?(?=import _export_sfc)/, '')
    .replace(/from "\/node_modules\/\.vite\/deps\/vue\.js[^"]*"/g, 'from "vue"');
  const loaded = await vite.ssrLoadModule(clientComponentId);
  Users = loaded.default;
});

after(async () => {
  delete globalThis.__studentAvatarSaveTest;
  await vite?.close();
});

beforeEach(() => {
  testContext.post = async () => ({});
  testContext.put = async () => ({});
  testContext.messages = [];
  testContext.calls = [];
  testContext.route = reactive({ path: '/admin/students', fullPath: '/admin/students', query: {} });
});

test('dashboard student entries clear old filters, restore source and status, and consume without a second request', async () => {
  const mounted = await mountUsers();
  try {
    Object.assign(mounted.state.studentQuery, { keyword: '旧关键词', category_id: 'category-old', source: 'institution', page: 5 });
    testContext.calls = [];
    testContext.route.query = { entry: 'dashboard', source: 'external', status: '1' };
    await nextTick();
    await new Promise(resolvePromise => setImmediate(resolvePromise));
    const requests = testContext.calls.filter(call => call.path === '/admin/students');
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].params, { page: 1, page_size: 20, source: 'external', status: 1 });
    assert.deepEqual(testContext.route.query, { source: 'external', status: '1' });
    mounted.state.studentQuery.source = 'institution';
    await mounted.state.searchStudents();
    await nextTick();
    assert.equal(testContext.route.query.source, 'institution');
  } finally { mounted.unmount(); }
});

test('disables the create form while its POST result is in flight', async () => {
  const pending = deferred();
  testContext.post = async () => pending.promise;
  const mounted = await mountUsers();
  mounted.state.openStudentCreate();
  Object.assign(mounted.state.studentForm, {
    username: 'new-student',
    password: 'Password1',
    real_name: '新学员',
    phone: '13900000000',
    source: 'institution',
    category_id: 'category-1',
  });
  const save = mounted.state.saveStudent();
  await nextTick();

  const dialog = findNode(mounted.root, 'dialog');
  assert.ok(dialog, 'student editor dialog should be mounted');
  assert.equal(findNode(dialog, 'form')?.props.disabled, true);

  pending.resolve({ id: 'created-student' });
  await save;
  mounted.unmount();
});

test('disables the custom avatar control while an edit save is in flight', async () => {
  const pending = deferred();
  testContext.put = async () => pending.promise;
  const mounted = await mountUsers();
  mounted.state.openStudentEdit({
    id: '42',
    username: 'student-42',
    real_name: '学员 42',
    source: 'institution',
    category_id: 'category-1',
    department_id: '',
    employee_no: '',
    phone: '13900000000',
    email: '',
    status: 1,
    avatar_id: null,
  });
  const save = mounted.state.saveStudent();
  await nextTick();

  assert.equal(findNode(mounted.root, 'media-upload')?.props.disabled, true);

  pending.resolve({});
  await save;
  mounted.unmount();
});
