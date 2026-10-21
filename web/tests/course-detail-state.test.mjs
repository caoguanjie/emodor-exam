import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createRenderer, h, nextTick } from '@vue/runtime-core';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const clientComponentId = '\0course-detail-state-client-test';
const courseListClientId = '\0course-list-state-client-test';
const routeStubId = '\0course-detail-state-route-test';
const elementStubId = '\0course-detail-state-element-test';
const iconsStubId = '\0course-detail-state-icons-test';
const httpStubId = '\0course-detail-state-http-test';
const authStubId = '\0course-detail-state-auth-test';
const mediaStubId = '\0course-detail-state-media-test';
const unsavedStubId = '\0course-detail-state-unsaved-test';

const initialCourse = Object.freeze({
  id: 'course-1',
  title: '安全课程',
  category_id: 'category-1',
  cover_asset_id: 'cover-saved',
  status: 'draft',
  required_lesson_count: 1,
  description: '已保存简介',
  regulation_ids: ['11'],
  is_recommended: false,
  sort_order: 1,
  missing_required_lesson_ids: [],
  chapters: [],
});

const testContext = {
  course: structuredClone(initialCourse),
  calls: [],
  messages: [],
  failRequests: new Set(),
  permissions: new Set(['courses:read', 'courses:write', 'courses:publish', 'media:write', 'regulations:read']),
  routerPushes: [],
  unsavedSources: [],
  deferredRequests: new Map(),
};
let clientComponentCode = '';
let courseListClientCode = '';
let vite;
let CourseDetail;
let Courses;

const routeStubCode = `
  const context = globalThis.__courseDetailStateTest;
  export function useRoute() { return { params: { id: 'course-1' } }; }
  export function useRouter() { return { async push(path) { context.routerPushes.push(path); } }; }
`;
const elementStubCode = `
  const context = globalThis.__courseDetailStateTest;
  export const ElMessage = {
    success(message) { context.messages.push({ type: 'success', message }); },
    warning(message) { context.messages.push({ type: 'warning', message }); },
    info(message) { context.messages.push({ type: 'info', message }); },
  };
  export const ElMessageBox = { async confirm() {} };
`;
const iconsStubCode = `export const ArrowLeft = { name: 'ArrowLeftStub', render() { return null; } };`;
const httpStubCode = `
  const context = globalThis.__courseDetailStateTest;
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const rejectConfigured = (method, path) => {
    const key = method + ' ' + path;
    if (context.failRequests.has(key)) throw new Error('configured failure: ' + key);
  };
  const waitConfigured = async (method, path) => {
    const key = method + ' ' + path;
    const queue = context.deferredRequests.get(key);
    if (queue?.length) await queue.shift().promise;
  };
  export default {
    async get(path) {
      context.calls.push({ method: 'GET', path });
      rejectConfigured('GET', path);
      if (path === '/admin/courses/course-1') return clone(context.course);
      if (path === '/admin/courses') return { items: [], total: 0, page: 1, page_size: 20 };
      if (path === '/admin/courses/category-options') {
        return { items: [{ id: 'category-1', name: '默认类别' }], total: 1, page: 1, page_size: 100 };
      }
      if (path === '/regulations') {
        return { list: [
          { id: 11, title: '制度十一', category: 'legacy-a', category_id: null, description: null, status: 'published', current_version_id: 1 },
          { id: 12, title: '制度十二', category: 'legacy-b', category_id: 'category-1', description: null, status: 'published', current_version_id: 2 },
        ], total: 2, page: 1, page_size: 100 };
      }
      throw new Error('unexpected GET ' + path);
    },
    async put(path, body) {
      context.calls.push({ method: 'PUT', path, body: clone(body) });
      rejectConfigured('PUT', path);
      await waitConfigured('PUT', path);
      if (path === '/admin/courses/course-1') Object.assign(context.course, clone(body));
      return {};
    },
    async post(path, body) {
      context.calls.push({ method: 'POST', path, body: clone(body) });
      rejectConfigured('POST', path);
      await waitConfigured('POST', path);
      if (path === '/admin/courses') return { id: 'course-created' };
      if (path.endsWith('/publish')) context.course.status = 'published';
      if (path.endsWith('/offline')) context.course.status = 'offline';
      return {};
    },
  };
`;
const authStubCode = `
  const context = globalThis.__courseDetailStateTest;
  export function useAuthStore() { return { can: (permission) => context.permissions.has(permission) }; }
`;
const mediaStubCode = `
  import { h } from 'vue';
  export default {
    name: 'MediaUploadStub',
    inheritAttrs: false,
    props: { modelValue: null, purpose: String, disabled: Boolean },
    setup(props, { attrs }) {
      return () => h('media-upload', { ...attrs, modelValue: props.modelValue, purpose: props.purpose, disabled: props.disabled });
    },
  };
`;
const unsavedStubCode = `
  const context = globalThis.__courseDetailStateTest;
  export function useUnsavedChanges(dirty, options = {}) {
    const source = {
      dirty,
      options,
      markClean() { dirty.value = false; },
      async confirmDiscard() {
        if (!dirty.value) return true;
        await options.onDiscard?.();
        return true;
      },
    };
    context.unsavedSources.push(source);
    return { markClean: source.markClean, confirmDiscard: source.confirmDiscard };
  }
`;

function testPlugin() {
  return {
    name: 'course-detail-state-test-stubs',
    enforce: 'pre',
    resolveId(source, importer) {
      const courseView = importer?.includes('/src/views/admin/CourseDetail.vue') || importer?.includes('/src/views/admin/Courses.vue');
      if (source === 'vue-router' && courseView) return routeStubId;
      if (source === 'element-plus' && courseView) return elementStubId;
      if (source === '@element-plus/icons-vue' && courseView) return iconsStubId;
      if (source === '../../api/http' && courseView) return httpStubId;
      if (source === '../../stores/auth' && courseView) return authStubId;
      if (source === '../../components/MediaUpload.vue' && courseView) return mediaStubId;
      if (source === '../../composables/useUnsavedChanges' && courseView) return unsavedStubId;
      if (source === clientComponentId || source === courseListClientId) return source;
      return undefined;
    },
    load(id) {
      if (id === routeStubId) return routeStubCode;
      if (id === elementStubId) return elementStubCode;
      if (id === iconsStubId) return iconsStubCode;
      if (id === httpStubId) return httpStubCode;
      if (id === authStubId) return authStubCode;
      if (id === mediaStubId) return mediaStubCode;
      if (id === unsavedStubId) return unsavedStubCode;
      if (id === clientComponentId) return clientComponentCode;
      if (id === courseListClientId) return courseListClientCode;
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

function findNodes(root, predicate, found = []) {
  if (!root) return found;
  if (predicate(root)) found.push(root);
  for (const child of root.children || []) findNodes(child, predicate, found);
  return found;
}

function waitFor(predicate, timeoutMs = 1800, label = 'component state') {
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

async function mountCourseDetail() {
  const host = createHost();
  const root = { type: 'root', props: {}, children: [], parent: null, text: '' };
  const app = host.createApp(CourseDetail);
  const components = {
    'el-alert': passthrough('alert'),
    'el-button': passthrough('button'),
    'el-card': passthrough('card', ['default', 'header']),
    'el-collapse': passthrough('collapse'),
    'el-collapse-item': passthrough('collapse-item', ['default', 'title']),
    'el-dialog': passthrough('dialog', ['default', 'footer']),
    'el-divider': passthrough('divider'),
    'el-empty': passthrough('empty'),
    'el-form': passthrough('form'),
    'el-form-item': passthrough('form-item'),
    'el-icon': passthrough('icon'),
    'el-input': passthrough('input'),
    'el-input-number': passthrough('input-number'),
    'el-option': passthrough('option'),
    'el-select': passthrough('select'),
    'el-switch': passthrough('switch'),
    'el-table': passthrough('table'),
    'el-table-column': passthrough('table-column'),
    'el-tag': passthrough('tag'),
  };
  for (const [name, component] of Object.entries(components)) app.component(name, component);
  app.mount(root);
  const state = app._instance.setupState;
  await waitFor(() => state.course && state.regulations.length === 2, 1800, 'course detail load');
  await nextTick();
  return { app, root, state, unmount: () => app.unmount() };
}

async function mountCourses() {
  const host = createHost();
  const root = { type: 'root', props: {}, children: [], parent: null, text: '' };
  const app = host.createApp(Courses);
  const components = {
    'el-alert': passthrough('alert'),
    'el-button': passthrough('button'),
    'el-dialog': passthrough('dialog', ['default', 'footer']),
    'el-empty': passthrough('empty'),
    'el-form': passthrough('form'),
    'el-form-item': passthrough('form-item'),
    'el-input': passthrough('input'),
    'el-input-number': passthrough('input-number'),
    'el-option': passthrough('option'),
    'el-pagination': passthrough('pagination'),
    'el-select': passthrough('select'),
    'el-switch': passthrough('switch'),
    'el-table': passthrough('table'),
    'el-table-column': passthrough('table-column'),
    'el-tag': passthrough('tag'),
  };
  for (const [name, component] of Object.entries(components)) app.component(name, component);
  app.directive('loading', {});
  app.mount(root);
  const state = app._instance.setupState;
  await waitFor(() => state.categories.length === 1, 1800, 'course list category options');
  await nextTick();
  return { app, root, state, unmount: () => app.unmount() };
}

function updateBinding(node, value) {
  const handler = node?.props?.['onUpdate:modelValue'];
  assert.equal(typeof handler, 'function', 'rendered v-model should expose an update handler');
  handler(value);
}

function coursePutCalls() {
  return testContext.calls.filter((call) => call.method === 'PUT' && call.path === '/admin/courses/course-1');
}

function deferRequest(method, path) {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const deferred = { promise, resolve: resolvePromise, reject: rejectPromise };
  const key = `${method} ${path}`;
  const queue = testContext.deferredRequests.get(key) || [];
  queue.push(deferred);
  testContext.deferredRequests.set(key, queue);
  return deferred;
}

before(async () => {
  globalThis.__courseDetailStateTest = testContext;
  vite = await createServer({
    root: webRoot,
    configFile: resolve(webRoot, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    plugins: [testPlugin()],
  });
  const transformed = await vite.transformRequest('/src/views/admin/CourseDetail.vue');
  assert.ok(transformed?.code, 'Vite should compile the real CourseDetail SFC');
  clientComponentCode = transformed.code
    .replace(/^import \{ createHotContext[\s\S]*?import\.meta\.hot = [^;]+;\s*/, '')
    .replace(/typeof __VUE_HMR_RUNTIME__[\s\S]*?(?=import _export_sfc)/, '')
    .replace(/from "\/node_modules\/\.vite\/deps\/vue\.js[^"]*"/g, 'from "vue"');
  const loaded = await vite.ssrLoadModule(clientComponentId);
  CourseDetail = loaded.default;
  const courseListTransformed = await vite.transformRequest('/src/views/admin/Courses.vue');
  assert.ok(courseListTransformed?.code, 'Vite should compile the real Courses SFC');
  courseListClientCode = courseListTransformed.code
    .replace(/^import \{ createHotContext[\s\S]*?import\.meta\.hot = [^;]+;\s*/, '')
    .replace(/typeof __VUE_HMR_RUNTIME__[\s\S]*?(?=import _export_sfc)/, '')
    .replace(/from "\/node_modules\/\.vite\/deps\/vue\.js[^"]*"/g, 'from "vue"');
  Courses = (await vite.ssrLoadModule(courseListClientId)).default;
});

after(async () => {
  delete globalThis.__courseDetailStateTest;
  await vite?.close();
});

beforeEach(() => {
  testContext.course = structuredClone(initialCourse);
  testContext.calls = [];
  testContext.messages = [];
  testContext.failRequests = new Set();
  testContext.permissions = new Set(['courses:read', 'courses:write', 'courses:publish', 'media:write', 'regulations:read']);
  testContext.routerPushes = [];
  testContext.unsavedSources = [];
  testContext.deferredRequests = new Map();
});

test('normalizes legacy numeric regulation options and saves add, echo, and removal as string IDs', async () => {
  const mounted = await mountCourseDetail();
  assert.deepEqual(mounted.state.regulations.map((item) => item.id), ['11', '12']);
  assert.deepEqual(mounted.state.form.regulation_ids, ['11']);

  const relationSelect = findNodes(mounted.root, (node) => node.type === 'select' && Object.hasOwn(node.props, 'multiple'))[0];
  updateBinding(relationSelect, ['11', '12']);
  await mounted.state.saveCourse();
  assert.deepEqual(coursePutCalls().at(-1).body.regulation_ids, ['11', '12']);
  assert.deepEqual(mounted.state.form.regulation_ids, ['11', '12']);

  const refreshedSelect = findNodes(mounted.root, (node) => node.type === 'select' && Object.hasOwn(node.props, 'multiple'))[0];
  updateBinding(refreshedSelect, ['12']);
  await mounted.state.saveCourse();
  assert.deepEqual(coursePutCalls().at(-1).body.regulation_ids, ['12']);
  assert.deepEqual(mounted.state.form.regulation_ids, ['12']);
  mounted.unmount();
});

test('keeps unsaved description and uploaded cover while chapter and lesson saves refresh the catalog', async () => {
  const mounted = await mountCourseDetail();
  const description = findNodes(mounted.root, (node) => node.type === 'input' && node.props.type === 'textarea')[0];
  const cover = findNodes(mounted.root, (node) => node.type === 'media-upload' && node.props.purpose === 'course_cover')[0];
  updateBinding(description, '尚未保存的简介');
  updateBinding(cover, 'cover-draft');
  await nextTick();

  mounted.state.openChapter({ id: 'chapter-1', title: '第一章', sort_order: 1, lessons: [] });
  mounted.state.chapterForm.title = '第一章改名';
  await mounted.state.saveChapter();
  assert.equal(mounted.state.form.description, '尚未保存的简介');
  assert.equal(mounted.state.form.cover_asset_id, 'cover-draft');

  mounted.state.openLesson('chapter-1', {
    id: 'lesson-1', title: '第一课', lesson_type: 'video', required: true, sort_order: 1, current_version: null,
  });
  mounted.state.lessonForm.title = '第一课改名';
  await mounted.state.saveLesson();
  assert.equal(mounted.state.form.description, '尚未保存的简介');
  assert.equal(mounted.state.form.cover_asset_id, 'cover-draft');
  mounted.unmount();
});

test('keeps unsaved course metadata while video replacement and status actions refresh server state', async () => {
  const mounted = await mountCourseDetail();
  mounted.state.form.description = '待保存元数据';
  mounted.state.form.cover_asset_id = 'cover-pending';

  mounted.state.openVideo({
    id: 'lesson-1', title: '第一课', lesson_type: 'video', required: true, sort_order: 1,
    current_version: { version_id: 'version-1', asset_id: 'video-1', duration_ms: 60_000 },
  });
  mounted.state.replacementAssetId = 'video-2';
  await mounted.state.replaceVideo();
  assert.equal(mounted.state.form.description, '待保存元数据');
  assert.equal(mounted.state.form.cover_asset_id, 'cover-pending');

  await mounted.state.publish();
  assert.equal(mounted.state.course.status, 'published');
  assert.equal(mounted.state.form.description, '待保存元数据');
  assert.equal(mounted.state.form.cover_asset_id, 'cover-pending');

  await mounted.state.offline();
  assert.equal(mounted.state.course.status, 'offline');
  assert.equal(mounted.state.form.description, '待保存元数据');
  assert.equal(mounted.state.form.cover_asset_id, 'cover-pending');
  mounted.unmount();
});

test('keeps CourseDetail persisted sections independent and retains failed-save drafts', async () => {
  const mounted = await mountCourseDetail();
  assert.equal(testContext.unsavedSources.length, 4, 'metadata, chapter, lesson and video must register separately');
  const [metadataSource, chapterSource, lessonSource, videoSource] = testContext.unsavedSources;

  mounted.state.form.description = '元数据草稿';
  testContext.failRequests.add('PUT /admin/courses/course-1');
  await assert.rejects(() => mounted.state.saveCourse(), /configured failure/);
  assert.equal(metadataSource.dirty.value, true);
  assert.equal(mounted.state.form.description, '元数据草稿');
  testContext.failRequests.delete('PUT /admin/courses/course-1');

  mounted.state.openChapter({ id: 'chapter-1', title: '已保存章节', sort_order: 1, lessons: [] });
  mounted.state.chapterForm.title = '未保存章节';
  await nextTick();
  assert.equal(metadataSource.dirty.value, true);
  assert.equal(chapterSource.dirty.value, true);
  testContext.failRequests.add('PUT /admin/courses/course-1/chapters/chapter-1');
  await assert.rejects(() => mounted.state.saveChapter(), /configured failure/);
  assert.equal(chapterSource.dirty.value, true);
  assert.equal(mounted.state.chapterVisible, true);
  testContext.failRequests.delete('PUT /admin/courses/course-1/chapters/chapter-1');

  await mounted.state.closeChapter();
  assert.equal(mounted.state.form.description, '元数据草稿', 'discarding a chapter must not restore metadata');
  assert.equal(mounted.state.chapterForm.title, '已保存章节');
  assert.equal(mounted.state.chapterVisible, false);
  assert.equal(metadataSource.dirty.value, true);
  assert.equal(chapterSource.dirty.value, false);

  mounted.state.openLesson('chapter-1', {
    id: 'lesson-1', title: '已保存课时', lesson_type: 'video', required: true, sort_order: 1, current_version: null,
  });
  mounted.state.lessonForm.title = '已保存的新课时名';
  await nextTick();
  assert.equal(lessonSource.dirty.value, true);
  await mounted.state.saveLesson();
  assert.equal(lessonSource.dirty.value, false);
  assert.equal(metadataSource.dirty.value, true, 'saving a lesson must not clean metadata');

  mounted.state.openVideo({
    id: 'lesson-1', title: '第一课', lesson_type: 'video', required: true, sort_order: 1,
    current_version: { version_id: 'version-1', asset_id: 'video-1', duration_ms: 60_000 },
  });
  mounted.state.replacementAssetId = 'video-failed';
  await nextTick();
  testContext.failRequests.add('POST /admin/courses/course-1/lessons/lesson-1/versions');
  await assert.rejects(() => mounted.state.replaceVideo(), /configured failure/);
  assert.equal(videoSource.dirty.value, true);
  assert.equal(mounted.state.videoVisible, true);
  assert.equal(metadataSource.dirty.value, true);
  mounted.unmount();
});

test('protects the Courses create draft and never redirects a write-only creator to read-only detail', async () => {
  testContext.permissions = new Set(['courses:write', 'media:write']);
  const mounted = await mountCourses();
  assert.equal(testContext.unsavedSources.length, 1);
  const [createSource] = testContext.unsavedSources;

  mounted.state.openCreate();
  mounted.state.form.title = '仅写账号课程';
  await nextTick();
  assert.equal(createSource.dirty.value, true);
  testContext.failRequests.add('POST /admin/courses');
  await assert.rejects(() => mounted.state.create(), /configured failure/);
  assert.equal(mounted.state.createVisible, true);
  assert.equal(createSource.dirty.value, true);

  testContext.failRequests.delete('POST /admin/courses');
  await mounted.state.create();
  assert.equal(mounted.state.createVisible, false);
  assert.equal(createSource.dirty.value, false);
  assert.deepEqual(testContext.routerPushes, []);

  mounted.state.openCreate();
  mounted.state.form.title = '待放弃课程';
  await nextTick();
  await mounted.state.closeCreate();
  assert.equal(mounted.state.createVisible, false);
  assert.equal(mounted.state.form.title, '');
  assert.equal(createSource.dirty.value, false);
  mounted.unmount();
});

test('a completed create only closes and navigates the exact submitted draft context', async () => {
  const mounted = await mountCourses();
  const [createSource] = testContext.unsavedSources;

  mounted.state.openCreate();
  mounted.state.form.title = '创建请求 A';
  const first = deferRequest('POST', '/admin/courses');
  const firstSave = mounted.state.create();
  await waitFor(() => testContext.calls.some((call) => call.method === 'POST' && call.body?.title === '创建请求 A'), 1800, 'first create request');
  mounted.state.form.title = '响应前草稿 B';
  await nextTick();
  assert.equal(testContext.calls.find((call) => call.method === 'POST')?.body?.title, '创建请求 A');
  first.resolve();
  await firstSave;
  assert.equal(mounted.state.createVisible, true);
  assert.equal(mounted.state.form.title, '响应前草稿 B');
  assert.equal(createSource.dirty.value, true);
  assert.deepEqual(testContext.routerPushes, []);

  await mounted.state.closeCreate();
  mounted.state.openCreate();
  mounted.state.form.title = '旧弹窗请求 A';
  const stale = deferRequest('POST', '/admin/courses');
  const staleSave = mounted.state.create();
  await waitFor(() => testContext.calls.filter((call) => call.method === 'POST').length === 2, 1800, 'stale create request');
  await mounted.state.closeCreate();
  mounted.state.openCreate();
  mounted.state.form.title = '新弹窗草稿 B';
  await nextTick();
  stale.resolve();
  await staleSave;
  assert.equal(mounted.state.createVisible, true);
  assert.equal(mounted.state.form.title, '新弹窗草稿 B');
  assert.equal(createSource.dirty.value, true);
  assert.deepEqual(testContext.routerPushes, []);
  mounted.unmount();
});

test('course metadata success advances only its submitted snapshot and ignores an older response', async () => {
  const mounted = await mountCourseDetail();
  const [metadataSource] = testContext.unsavedSources;

  mounted.state.form.description = '元数据请求 A';
  const first = deferRequest('PUT', '/admin/courses/course-1');
  const firstSave = mounted.state.saveCourse();
  await waitFor(() => coursePutCalls().length === 1, 1800, 'first metadata save');
  mounted.state.form.description = '响应前草稿 B';
  await nextTick();
  assert.equal(coursePutCalls()[0].body.description, '元数据请求 A');
  first.resolve();
  await firstSave;
  assert.equal(mounted.state.form.description, '响应前草稿 B');
  assert.equal(metadataSource.dirty.value, true);
  await metadataSource.confirmDiscard();
  assert.equal(mounted.state.form.description, '元数据请求 A');

  mounted.state.form.description = '较旧请求 C';
  const older = deferRequest('PUT', '/admin/courses/course-1');
  const olderSave = mounted.state.saveCourse();
  await waitFor(() => coursePutCalls().length === 2, 1800, 'older metadata save');
  mounted.state.form.description = '较新请求 D';
  const newer = deferRequest('PUT', '/admin/courses/course-1');
  const newerSave = mounted.state.saveCourse();
  await waitFor(() => coursePutCalls().length === 3, 1800, 'newer metadata save');
  newer.resolve();
  await newerSave;
  mounted.state.form.description = 'D 成功后的草稿 E';
  await nextTick();
  older.resolve();
  await olderSave;
  assert.equal(mounted.state.form.description, 'D 成功后的草稿 E');
  assert.equal(metadataSource.dirty.value, true);
  await metadataSource.confirmDiscard();
  assert.equal(mounted.state.form.description, '较新请求 D');
  mounted.unmount();
});

test('a stale chapter save cannot clean or close a reopened chapter draft', async () => {
  const mounted = await mountCourseDetail();
  const chapterSource = testContext.unsavedSources[1];

  mounted.state.openChapter({ id: 'chapter-same', title: '章节原值', sort_order: 1, lessons: [] });
  mounted.state.chapterForm.title = '章节请求 A';
  const sameContext = deferRequest('PUT', '/admin/courses/course-1/chapters/chapter-same');
  const sameContextSave = mounted.state.saveChapter();
  await waitFor(() => testContext.calls.some((call) => call.path?.endsWith('/chapters/chapter-same')), 1800, 'same-context chapter save');
  mounted.state.chapterForm.title = '响应前章节草稿 B';
  await nextTick();
  assert.equal(testContext.calls.find((call) => call.path?.endsWith('/chapters/chapter-same'))?.body?.title, '章节请求 A');
  sameContext.resolve();
  await sameContextSave;
  assert.equal(mounted.state.chapterForm.title, '响应前章节草稿 B');
  assert.equal(mounted.state.chapterVisible, true);
  assert.equal(chapterSource.dirty.value, true);
  await mounted.state.closeChapter();

  mounted.state.openChapter({ id: 'chapter-a', title: '章节 A 原值', sort_order: 1, lessons: [] });
  mounted.state.chapterForm.title = '章节 A 提交值';
  const deferred = deferRequest('PUT', '/admin/courses/course-1/chapters/chapter-a');
  const pending = mounted.state.saveChapter();
  await waitFor(() => testContext.calls.some((call) => call.path?.endsWith('/chapters/chapter-a')), 1800, 'chapter A save');
  await mounted.state.closeChapter();
  mounted.state.openChapter({ id: 'chapter-b', title: '章节 B 原值', sort_order: 2, lessons: [] });
  mounted.state.chapterForm.title = '章节 B 草稿';
  await nextTick();
  deferred.resolve();
  await pending;
  assert.equal(mounted.state.editingChapterId, 'chapter-b');
  assert.equal(mounted.state.chapterForm.title, '章节 B 草稿');
  assert.equal(mounted.state.chapterVisible, true);
  assert.equal(chapterSource.dirty.value, true);
  mounted.unmount();
});

test('a stale lesson save cannot clean or close a reopened lesson draft', async () => {
  const mounted = await mountCourseDetail();
  const lessonSource = testContext.unsavedSources[2];

  mounted.state.openLesson('chapter-same', {
    id: 'lesson-same', title: '课时原值', lesson_type: 'video', required: true, sort_order: 1, current_version: null,
  });
  mounted.state.lessonForm.title = '课时请求 A';
  const sameContext = deferRequest('PUT', '/admin/courses/course-1/lessons/lesson-same');
  const sameContextSave = mounted.state.saveLesson();
  await waitFor(() => testContext.calls.some((call) => call.path?.endsWith('/lessons/lesson-same')), 1800, 'same-context lesson save');
  mounted.state.lessonForm.title = '响应前课时草稿 B';
  await nextTick();
  assert.equal(testContext.calls.find((call) => call.path?.endsWith('/lessons/lesson-same'))?.body?.title, '课时请求 A');
  sameContext.resolve();
  await sameContextSave;
  assert.equal(mounted.state.lessonForm.title, '响应前课时草稿 B');
  assert.equal(mounted.state.lessonVisible, true);
  assert.equal(lessonSource.dirty.value, true);
  await mounted.state.closeLesson();

  mounted.state.openLesson('chapter-a', {
    id: 'lesson-a', title: '课时 A 原值', lesson_type: 'video', required: true, sort_order: 1, current_version: null,
  });
  mounted.state.lessonForm.title = '课时 A 提交值';
  const deferred = deferRequest('PUT', '/admin/courses/course-1/lessons/lesson-a');
  const pending = mounted.state.saveLesson();
  await waitFor(() => testContext.calls.some((call) => call.path?.endsWith('/lessons/lesson-a')), 1800, 'lesson A save');
  await mounted.state.closeLesson();
  mounted.state.openLesson('chapter-b', {
    id: 'lesson-b', title: '课时 B 原值', lesson_type: 'video', required: false, sort_order: 2, current_version: null,
  });
  mounted.state.lessonForm.title = '课时 B 草稿';
  await nextTick();
  deferred.resolve();
  await pending;
  assert.equal(mounted.state.editingLessonId, 'lesson-b');
  assert.equal(mounted.state.lessonForm.title, '课时 B 草稿');
  assert.equal(mounted.state.lessonVisible, true);
  assert.equal(lessonSource.dirty.value, true);
  mounted.unmount();
});

test('a stale video save cannot clean or close a reopened replacement draft', async () => {
  const mounted = await mountCourseDetail();
  const videoSource = testContext.unsavedSources[3];

  mounted.state.openVideo({
    id: 'lesson-same', title: '课时', lesson_type: 'video', required: true, sort_order: 1, current_version: null,
  });
  mounted.state.replacementAssetId = 'video-request-a';
  const sameContext = deferRequest('POST', '/admin/courses/course-1/lessons/lesson-same/versions');
  const sameContextSave = mounted.state.replaceVideo();
  await waitFor(() => testContext.calls.some((call) => call.path?.endsWith('/lessons/lesson-same/versions')), 1800, 'same-context video save');
  mounted.state.replacementAssetId = 'video-draft-b';
  await nextTick();
  assert.equal(testContext.calls.find((call) => call.path?.endsWith('/lessons/lesson-same/versions'))?.body?.asset_id, 'video-request-a');
  sameContext.resolve();
  await sameContextSave;
  assert.equal(mounted.state.replacementAssetId, 'video-draft-b');
  assert.equal(mounted.state.videoVisible, true);
  assert.equal(videoSource.dirty.value, true);
  await mounted.state.closeVideo();

  mounted.state.openVideo({
    id: 'lesson-a', title: '课时 A', lesson_type: 'video', required: true, sort_order: 1, current_version: null,
  });
  mounted.state.replacementAssetId = 'video-a';
  const deferred = deferRequest('POST', '/admin/courses/course-1/lessons/lesson-a/versions');
  const pending = mounted.state.replaceVideo();
  await waitFor(() => testContext.calls.some((call) => call.path?.endsWith('/lessons/lesson-a/versions')), 1800, 'video A save');
  await mounted.state.closeVideo();
  mounted.state.openVideo({
    id: 'lesson-b', title: '课时 B', lesson_type: 'video', required: true, sort_order: 2, current_version: null,
  });
  mounted.state.replacementAssetId = 'video-b';
  await nextTick();
  deferred.resolve();
  await pending;
  assert.equal(mounted.state.replacementLessonId, 'lesson-b');
  assert.equal(mounted.state.replacementAssetId, 'video-b');
  assert.equal(mounted.state.videoVisible, true);
  assert.equal(videoSource.dirty.value, true);
  mounted.unmount();
});
