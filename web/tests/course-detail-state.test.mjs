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
const editorStubId = '\0course-editor-list-test';
const coverStubId = '\0course-cover-list-test';

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

const initialCoursePage = Object.freeze({ items: [], total: 0, page: 1, page_size: 20 });

const testContext = {
  course: structuredClone(initialCourse),
  coursePage: structuredClone(initialCoursePage),
  calls: [],
  messages: [],
  failRequests: new Set(),
  permissions: new Set(['courses:read', 'courses:write', 'courses:publish', 'media:write']),
  routerPushes: [],
  unsavedSources: [],
  deferredRequests: new Map(),
  deferredResponses: new Map(),
  discardAllowed: true,
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
    error(message) { context.messages.push({ type: 'error', message }); },
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
  const waitConfiguredResponse = async (method, path) => {
    const key = method + ' ' + path;
    const queue = context.deferredResponses.get(key);
    if (!queue?.length) return;
    const deferred = queue.shift();
    deferred.blocked = true;
    await deferred.promise;
  };
  const findLesson = (lessonId) => {
    for (const chapter of context.course.chapters || []) {
      const lesson = chapter.lessons.find((item) => item.id === lessonId);
      if (lesson) return { chapter, lesson };
    }
    return null;
  };
  const recomputeMissingLessons = () => {
    context.course.missing_required_lesson_ids = (context.course.chapters || [])
      .flatMap((chapter) => chapter.lessons)
      .filter((lesson) => lesson.required && !lesson.current_version)
      .map((lesson) => lesson.id);
  };
  const lessonResponse = (entry, fallback) => ({
    id: entry?.lesson.id || fallback.id,
    course_id: context.course.id,
    chapter_id: entry?.chapter.id || fallback.chapter_id,
    title: entry?.lesson.title || fallback.title,
    lesson_type: 'video',
    required: entry?.lesson.required ?? fallback.required,
    sort_order: entry?.lesson.sort_order ?? fallback.sort_order,
    current_version_id: entry?.lesson.current_version?.version_id || null,
  });
  export default {
    async get(path, config) {
      context.calls.push({ method: 'GET', path, params: clone(config?.params) });
      rejectConfigured('GET', path);
      let response;
      if (path === '/admin/courses/course-1') response = context.course;
      else if (path === '/admin/courses') response = context.coursePage;
      if (path === '/admin/courses/category-options') {
        response = { items: [{ id: 'category-1', name: '默认类别' }], total: 1, page: 1, page_size: 100 };
      } else if (path === '/regulations') {
        response = { list: [
          { id: 11, title: '制度十一', category: 'legacy-a', category_id: null, description: null, status: 'published', current_version_id: 1 },
          { id: 12, title: '制度十二', category: 'legacy-b', category_id: 'category-1', description: null, status: 'published', current_version_id: 2 },
        ], total: 2, page: 1, page_size: 100 };
      }
      if (response === undefined) throw new Error('unexpected GET ' + path);
      const captured = clone(response);
      await waitConfigured('GET', path);
      return captured;
    },
    async put(path, body) {
      context.calls.push({ method: 'PUT', path, body: clone(body) });
      rejectConfigured('PUT', path);
      await waitConfigured('PUT', path);
      if (path === '/admin/courses/course-1') Object.assign(context.course, clone(body));
      const lessonPrefix = '/admin/courses/course-1/lessons/';
      const lessonId = path.startsWith(lessonPrefix) && !path.endsWith('/versions') ? path.slice(lessonPrefix.length) : '';
      if (lessonId) {
        const entry = findLesson(lessonId);
        if (entry) Object.assign(entry.lesson, {
          title: body.title,
          lesson_type: body.lesson_type,
          required: Boolean(body.required),
          sort_order: body.sort_order,
        });
        recomputeMissingLessons();
        const response = lessonResponse(entry, {
          id: lessonId, chapter_id: 'chapter-unknown', title: body.title,
          required: Boolean(body.required), sort_order: body.sort_order,
        });
        await waitConfiguredResponse('PUT', path);
        return response;
      }
      return {};
    },
    async post(path, body) {
      context.calls.push({ method: 'POST', path, body: clone(body) });
      rejectConfigured('POST', path);
      await waitConfigured('POST', path);
      if (path === '/admin/courses') return { id: 'course-created' };
      if (path === '/admin/courses/course-1/chapters') return { id: 'chapter-created' };
      if (path === '/admin/courses/course-1/lessons') {
        const chapter = context.course.chapters.find((item) => item.id === body.chapter_id);
        const lesson = {
          id: 'lesson-created', title: body.title, lesson_type: 'video', required: Boolean(body.required),
          sort_order: body.sort_order,
          current_version: body.asset_id ? { version_id: 'version-created', asset_id: body.asset_id, duration_ms: 60_000 } : null,
        };
        if (chapter) chapter.lessons.push(lesson);
        recomputeMissingLessons();
        return lessonResponse(chapter ? { chapter, lesson } : null, {
          id: lesson.id, chapter_id: body.chapter_id, title: lesson.title,
          required: lesson.required, sort_order: lesson.sort_order,
        });
      }
      const versionPrefix = '/admin/courses/course-1/lessons/';
      const versionSuffix = '/versions';
      const versionLessonId = path.startsWith(versionPrefix) && path.endsWith(versionSuffix)
        ? path.slice(versionPrefix.length, -versionSuffix.length) : '';
      if (versionLessonId) {
        const saved = { version_id: 'version-next', asset_id: body.asset_id, duration_ms: 90_000, version_no: 2 };
        const entry = findLesson(versionLessonId);
        if (entry) entry.lesson.current_version = {
          version_id: saved.version_id, asset_id: saved.asset_id, duration_ms: saved.duration_ms,
        };
        recomputeMissingLessons();
        return saved;
      }
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
        if (!context.discardAllowed) return false;
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
      const courseView = importer?.includes('/src/views/admin/CourseEditor.vue') || importer?.includes('/src/views/admin/Courses.vue');
      if (source === 'vue-router' && courseView) return routeStubId;
      if (source === 'element-plus' && courseView) return elementStubId;
      if (source === '@element-plus/icons-vue' && courseView) return iconsStubId;
      if (source === '../../api/http' && courseView) return httpStubId;
      if (source === '../../stores/auth' && courseView) return authStubId;
      if (source === '../../components/MediaUpload.vue' && courseView) return mediaStubId;
      if (source === '../../components/CourseCover.vue' && courseView) return coverStubId;
      if (source === './CourseEditor.vue' && importer?.includes('/src/views/admin/Courses.vue')) return editorStubId;
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
      if (id === editorStubId) return `export default { props: ['courseId', 'mode'], setup(_props, { expose }) { expose({ confirmClose: async () => true }); return () => null; } };`;
      if (id === coverStubId) return `export default { props: ['assetId', 'alt'], render() { return null; } };`;
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

async function mountCourseDetail(mode = 'info') {
  const host = createHost();
  const root = { type: 'root', props: {}, children: [], parent: null, text: '' };
  const changedEvents = [];
  const app = host.createApp(CourseDetail, { courseId: 'course-1', mode, onChanged: () => changedEvents.push('changed') });
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
    'el-skeleton': passthrough('skeleton'),
    'el-switch': passthrough('switch'),
    'el-radio': passthrough('radio'),
    'el-radio-group': passthrough('radio-group'),
    'el-table': passthrough('table'),
    'el-table-column': passthrough('table-column'),
    'el-tag': passthrough('tag'),
  };
  for (const [name, component] of Object.entries(components)) app.component(name, component);
  app.mount(root);
  const state = app._instance.setupState;
  await waitFor(() => state.course && (mode === 'chapters' || state.categories.length === 1), 1800, 'course editor load');
  await nextTick();
  return { app, root, state, changedEvents, unmount: () => app.unmount() };
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
    'el-radio': passthrough('radio'),
    'el-radio-group': passthrough('radio-group'),
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
  return { app, instance: app._instance, root, state, unmount: () => app.unmount() };
}

async function activate(instance) {
  const hooks = instance.a || [];
  assert.ok(hooks.length > 0, 'cached view should register an activated hook');
  await Promise.all(hooks.map((hook) => hook()));
  await nextTick();
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

function deferResponse(method, path) {
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  const deferred = { promise, resolve: resolvePromise, blocked: false };
  const key = `${method} ${path}`;
  const queue = testContext.deferredResponses.get(key) || [];
  queue.push(deferred);
  testContext.deferredResponses.set(key, queue);
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
  const transformed = await vite.transformRequest('/src/views/admin/CourseEditor.vue');
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
  testContext.discardAllowed = true;
  testContext.course = structuredClone(initialCourse);
  testContext.coursePage = structuredClone(initialCoursePage);
  testContext.calls = [];
  testContext.messages = [];
  testContext.failRequests = new Set();
  testContext.permissions = new Set(['courses:read', 'courses:write', 'courses:publish', 'media:write']);
  testContext.routerPushes = [];
  testContext.unsavedSources = [];
  testContext.deferredRequests = new Map();
  testContext.deferredResponses = new Map();
});

test('outer editor closure protects unsaved information and a pending video-version save', async () => {
  const mounted = await mountCourseDetail('chapters');
  mounted.state.form.description = '尚未保存';
  await nextTick();
  testContext.discardAllowed = false;
  assert.equal(await mounted.state.confirmClose(), false);
  assert.equal(mounted.state.form.description, '尚未保存');
  testContext.discardAllowed = true;
  assert.equal(await mounted.state.confirmClose(), true);
  assert.equal(mounted.state.form.description, initialCourse.description);
  mounted.state.openLesson('chapter-1', { id: 'lesson-1', title: '视频课时', required: true, lesson_type: 'video', sort_order: 0, current_version: null });
  mounted.state.lessonForm.asset_id = 'video-new';
  const receipt = deferRequest('POST', '/admin/courses/course-1/lessons/lesson-1/versions');
  const pending = mounted.state.saveLesson();
  await waitFor(() => testContext.calls.some(call => call.path.endsWith('/lesson-1/versions')));
  try {
    assert.equal(await mounted.state.confirmClose(), false, 'a version write must settle before the entire editor closes');
  } finally {
    receipt.resolve();
    await pending;
    mounted.unmount();
  }
});

test('does not expose removed regulation management data or overwrite legacy course associations', async () => {
  const mounted = await mountCourseDetail();
  assert.equal(testContext.calls.some((call) => call.method === 'GET' && call.path === '/regulations'), false);
  assert.equal(findNodes(mounted.root, (node) => node.props.label === '制度关联').length, 0);
  mounted.state.form.description = '更新简介';
  await mounted.state.saveCourse();
  assert.equal(Object.hasOwn(coursePutCalls().at(-1).body, 'regulation_ids'), false);
  assert.deepEqual(testContext.course.regulation_ids, ['11']);
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

test('refreshes the server missing-video summary after confirmed lesson metadata without resetting a course draft', async () => {
  testContext.course.missing_required_lesson_ids = ['lesson-1'];
  testContext.course.chapters = [{
    id: 'chapter-1',
    title: '第一章',
    sort_order: 1,
    lessons: [{
      id: 'lesson-1', title: '第一课', lesson_type: 'video', required: true, sort_order: 1, current_version: null,
    }],
  }];
  const mounted = await mountCourseDetail();
  mounted.state.form.description = '未保存的课程简介';
  const lesson = mounted.state.course.chapters[0].lessons[0];
  mounted.state.openLesson('chapter-1', lesson);
  mounted.state.lessonForm.required = false;
  await nextTick();

  await mounted.state.saveLesson();
  await nextTick();

  assert.deepEqual(mounted.state.course.missing_required_lesson_ids, []);
  assert.equal(findNodes(mounted.root, (node) => node.type === 'alert' && String(node.props.title).includes('缺少可用视频')).length, 0);
  assert.equal(mounted.state.form.description, '未保存的课程简介');
  mounted.unmount();
});

test('clears the missing-video summary only after the lesson version is confirmed ready by the catalog', async () => {
  testContext.course.missing_required_lesson_ids = ['lesson-1'];
  testContext.course.chapters = [{
    id: 'chapter-1',
    title: '第一章',
    sort_order: 1,
    lessons: [{
      id: 'lesson-1', title: '第一课', lesson_type: 'video', required: true, sort_order: 1, current_version: null,
    }],
  }];
  const mounted = await mountCourseDetail('chapters');
  mounted.state.form.description = '另一份未保存简介';
  const lesson = mounted.state.course.chapters[0].lessons[0];
  mounted.state.openLesson('chapter-1', lesson);
  mounted.state.lessonForm.asset_id = 'video-ready';
  const version = deferRequest('POST', '/admin/courses/course-1/lessons/lesson-1/versions');
  const pending = mounted.state.saveLesson();
  await waitFor(() => testContext.calls.some((call) => call.method === 'POST' && call.path.endsWith('/lessons/lesson-1/versions')), 1800, 'lesson version save');

  assert.deepEqual(mounted.state.course.missing_required_lesson_ids, ['lesson-1']);
  assert.equal(findNodes(mounted.root, (node) => node.type === 'alert' && String(node.props.title).includes('缺少可用视频')).length, 1);
  version.resolve();
  await pending;
  await nextTick();

  assert.deepEqual(mounted.state.course.missing_required_lesson_ids, []);
  assert.equal(findNodes(mounted.root, (node) => node.type === 'alert' && String(node.props.title).includes('缺少可用视频')).length, 0);
  assert.equal(mounted.state.form.description, '另一份未保存简介');
  mounted.unmount();
});

test('an older metadata snapshot cannot restore a missing-video warning after a newer confirmed version', async () => {
  testContext.course.missing_required_lesson_ids = ['lesson-1'];
  testContext.course.chapters = [{
    id: 'chapter-1',
    title: '第一章',
    sort_order: 1,
    lessons: [{
      id: 'lesson-1', title: '原课时', lesson_type: 'video', required: true, sort_order: 1, current_version: null,
    }],
  }];
  const mounted = await mountCourseDetail();
  const lessonSource = testContext.unsavedSources[2];
  const metadataPath = '/admin/courses/course-1/lessons/lesson-1';
  const versionPath = `${metadataPath}/versions`;

  mounted.state.openLesson('chapter-1', mounted.state.course.chapters[0].lessons[0]);
  mounted.state.lessonForm.title = '已确认资料 A';
  const metadataResponse = deferResponse('PUT', metadataPath);
  const metadataSave = mounted.state.saveLesson();
  await waitFor(() => metadataResponse.blocked, 1800, 'metadata A response snapshot');

  await mounted.state.closeLesson();
  mounted.state.openLesson('chapter-1', mounted.state.course.chapters[0].lessons[0]);
  mounted.state.lessonForm.asset_id = 'video-b';
  const videoRequest = deferRequest('POST', versionPath);
  const videoSave = mounted.state.saveLesson();
  await waitFor(() => testContext.calls.some((call) => call.method === 'POST' && call.path === versionPath), 1800, 'video B request');
  mounted.state.lessonForm.title = '重开后的未保存草稿 C';
  await nextTick();
  videoRequest.resolve();
  await videoSave;

  assert.deepEqual(mounted.state.course.missing_required_lesson_ids, []);
  assert.equal(mounted.state.course.chapters[0].lessons[0].current_version.asset_id, 'video-b');
  assert.equal(mounted.state.lessonForm.title, '重开后的未保存草稿 C');
  assert.equal(mounted.state.lessonVisible, true);
  assert.equal(lessonSource.dirty.value, true);

  metadataResponse.resolve();
  await metadataSave;
  await nextTick();

  const persistedRow = mounted.state.course.chapters[0].lessons[0];
  assert.deepEqual(mounted.state.course.missing_required_lesson_ids, []);
  assert.equal(findNodes(mounted.root, (node) => node.type === 'alert' && String(node.props.title).includes('缺少可用视频')).length, 0);
  assert.equal(persistedRow.title, '已确认资料 A', 'the confirmed metadata receipt must still update the parent row');
  assert.equal(persistedRow.current_version.asset_id, 'video-b');
  assert.equal(mounted.state.lessonForm.title, '重开后的未保存草稿 C');
  assert.equal(mounted.state.lessonVisible, true);
  assert.equal(lessonSource.dirty.value, true);
  mounted.unmount();
});

test('keeps unsaved course metadata while video replacement and catalog reload refresh server state', async () => {
  const mounted = await mountCourseDetail();
  mounted.state.form.description = '待保存元数据';
  mounted.state.form.cover_asset_id = 'cover-pending';

  mounted.state.openLesson('chapter-1', {
    id: 'lesson-1', title: '第一课', lesson_type: 'video', required: true, sort_order: 1,
    current_version: { version_id: 'version-1', asset_id: 'video-1', duration_ms: 60_000 },
  });
  mounted.state.lessonForm.asset_id = 'video-2';
  await mounted.state.saveLesson();
  assert.equal(mounted.state.form.description, '待保存元数据');
  assert.equal(mounted.state.form.cover_asset_id, 'cover-pending');

  testContext.course.status = 'published';
  await mounted.state.load(false);
  assert.equal(mounted.state.course.status, 'published');
  assert.equal(mounted.state.form.description, '待保存元数据');
  assert.equal(mounted.state.form.cover_asset_id, 'cover-pending');

  testContext.course.status = 'offline';
  await mounted.state.load(false);
  assert.equal(mounted.state.course.status, 'offline');
  assert.equal(mounted.state.form.description, '待保存元数据');
  assert.equal(mounted.state.form.cover_asset_id, 'cover-pending');
  mounted.unmount();
});

test('retrying a failed catalog refresh preserves newer unsaved course input', async () => {
  const mounted = await mountCourseDetail();
  mounted.state.form.description = '提交的 B';
  const receipt = deferRequest('PUT', '/admin/courses/course-1');
  const saving = mounted.state.saveCourse();
  mounted.state.form.description = '继续编辑的 C';
  testContext.failRequests.add('GET /admin/courses/course-1');
  receipt.resolve();
  await assert.rejects(() => saving, /configured failure/);
  testContext.failRequests.delete('GET /admin/courses/course-1');
  const retry = findNodes(mounted.root, node => node.type === 'button' && node.props.onClick)[0];
  await retry.props.onClick();
  await nextTick();
  assert.equal(mounted.state.form.description, '继续编辑的 C');
  assert.equal(testContext.unsavedSources[0].dirty.value, true);
  mounted.unmount();
});

test('a pending write blocks route and tab departure even when the form matches its old baseline', async () => {
  const mounted = await mountCourseDetail();
  mounted.state.form.description = '提交的 B';
  const receipt = deferRequest('PUT', '/admin/courses/course-1');
  const saving = mounted.state.saveCourse();
  mounted.state.form.description = initialCourse.description;
  await nextTick();
  assert.equal(testContext.unsavedSources[0].dirty.value, false);
  assert.ok(testContext.unsavedSources.some(source => source.dirty.value && source.options.canDiscard?.() === false));
  receipt.resolve();
  await saving;
  mounted.unmount();
});

test('confirmed existing lesson metadata refreshes list counts even if the subsequent video save fails', async () => {
  testContext.course.chapters = [{ id: 'chapter-1', title: '第一章', sort_order: 1, lessons: [{
    id: 'lesson-1', title: '第一课', lesson_type: 'video', required: true, sort_order: 1, current_version: null,
  }] }];
  const mounted = await mountCourseDetail('chapters');
  mounted.state.openLesson('chapter-1', mounted.state.course.chapters[0].lessons[0]);
  mounted.state.lessonForm.required = false;
  await mounted.state.saveLesson();
  assert.equal(mounted.changedEvents.length, 1);
  mounted.state.openLesson('chapter-1', mounted.state.course.chapters[0].lessons[0]);
  mounted.state.lessonForm.required = true;
  mounted.state.lessonForm.asset_id = 'video-failed';
  testContext.failRequests.add('POST /admin/courses/course-1/lessons/lesson-1/versions');
  await assert.rejects(() => mounted.state.saveLesson(), /configured failure/);
  assert.equal(mounted.changedEvents.length, 2);
  mounted.unmount();
});

test('keeps CourseDetail persisted sections independent and retains failed-save drafts', async () => {
  const mounted = await mountCourseDetail();
  assert.equal(testContext.unsavedSources.length, 4, 'metadata, chapter and unified lesson/video drafts plus a pending-write route blocker');
  const [metadataSource, chapterSource, lessonSource] = testContext.unsavedSources;

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

  mounted.state.openLesson('chapter-1', {
    id: 'lesson-1', title: '第一课', lesson_type: 'video', required: true, sort_order: 1,
    current_version: { version_id: 'version-1', asset_id: 'video-1', duration_ms: 60_000 },
  });
  mounted.state.lessonForm.asset_id = 'video-failed';
  await nextTick();
  testContext.failRequests.add('POST /admin/courses/course-1/lessons/lesson-1/versions');
  await assert.rejects(() => mounted.state.saveLesson(), /configured failure/);
  assert.equal(lessonSource.dirty.value, true);
  assert.equal(mounted.state.lessonVisible, true);
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

test('refreshes a cached course list on reactivation without resetting its query or create draft', async () => {
  const mounted = await mountCourses();
  await waitFor(() => testContext.calls.some((call) => call.method === 'GET' && call.path === '/admin/courses'), 1800, 'initial course list');
  await activate(mounted.instance);

  mounted.state.query.page = 2;
  mounted.state.query.keyword = '安全';
  mounted.state.query.category_id = 'category-1';
  mounted.state.query.status = 'draft';
  mounted.state.openCreate();
  mounted.state.form.title = '未保存的新课程';
  testContext.coursePage = {
    items: [{
      id: 'course-created', title: '已保存课程', category_id: 'category-1', required_lesson_count: 0,
      is_recommended: false, sort_order: 0, status: 'draft',
    }],
    total: 21,
    page: 2,
    page_size: 20,
  };

  await activate(mounted.instance);
  await waitFor(() => mounted.state.total === 21, 1800, 'reactivated course list');
  const lastListCall = testContext.calls.filter((call) => call.method === 'GET' && call.path === '/admin/courses').at(-1);
  assert.deepEqual(lastListCall.params, {
    page: 2,
    page_size: 20,
    keyword: '安全',
    category_id: 'category-1',
    status: 'draft',
  });
  assert.equal(mounted.state.items[0].id, 'course-created');
  assert.equal(mounted.state.query.page, 2);
  assert.equal(mounted.state.form.title, '未保存的新课程');
  assert.equal(mounted.state.createVisible, true);
  mounted.unmount();
});

test('ignores an older course list response after a newer query has completed', async () => {
  const mounted = await mountCourses();
  await waitFor(() => testContext.calls.some((call) => call.method === 'GET' && call.path === '/admin/courses'), 1800, 'initial course list');

  mounted.state.query.keyword = '旧查询';
  testContext.coursePage = {
    items: [{
      id: 'course-old', title: '旧结果', category_id: 'category-1', required_lesson_count: 0,
      is_recommended: false, sort_order: 0, status: 'draft',
    }],
    total: 1,
    page: 1,
    page_size: 20,
  };
  const older = deferRequest('GET', '/admin/courses');
  const olderLoad = mounted.state.load();
  await waitFor(() => testContext.calls.some((call) => call.method === 'GET' && call.params?.keyword === '旧查询'), 1800, 'older course query');

  mounted.state.query.keyword = '新查询';
  testContext.coursePage = {
    items: [{
      id: 'course-new', title: '新结果', category_id: 'category-1', required_lesson_count: 0,
      is_recommended: false, sort_order: 0, status: 'draft',
    }],
    total: 1,
    page: 1,
    page_size: 20,
  };
  await mounted.state.load();
  assert.equal(mounted.state.items[0].id, 'course-new');

  older.resolve();
  await olderLoad;
  assert.equal(mounted.state.items[0].id, 'course-new');
  assert.equal(mounted.state.query.keyword, '新查询');
  mounted.unmount();
});

test('a retained course create binds its returned id and saves the next draft with PUT', async () => {
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
  assert.equal(mounted.state.createCourseId, 'course-created');
  assert.equal(mounted.state.createVisible, true);
  assert.equal(mounted.state.form.title, '响应前草稿 B');
  assert.equal(createSource.dirty.value, true);
  assert.deepEqual(testContext.routerPushes, []);

  const second = deferRequest('PUT', '/admin/courses/course-created');
  const secondSave = mounted.state.create();
  await waitFor(() => testContext.calls.some((call) => call.method === 'PUT' && call.path === '/admin/courses/course-created'), 1800, 'retained course update');
  await nextTick();
  assert.equal(mounted.state.saving, true);
  assert.equal(findNodes(mounted.root, (node) => node.type === 'button' && node.props.loading === true && node.props.disabled === true).length, 1);
  await mounted.state.create();
  const courseCreates = testContext.calls.filter((call) => call.method === 'POST' && call.path === '/admin/courses');
  const courseUpdates = testContext.calls.filter((call) => call.method === 'PUT' && call.path === '/admin/courses/course-created');
  assert.equal(courseCreates.length, 1);
  assert.equal(courseUpdates.length, 1);
  assert.equal(courseUpdates[0]?.body?.title, '响应前草稿 B');
  second.resolve();
  await secondSave;
  assert.equal(mounted.state.createVisible, false);
  assert.equal(createSource.dirty.value, false);
  assert.deepEqual(testContext.routerPushes, []);
  assert.equal(mounted.state.editorVisible, true);
  assert.equal(mounted.state.editorCourseId, 'course-created');

  testContext.routerPushes = [];
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

test('a retained chapter create binds its returned id while stale saves cannot touch a reopened draft', async () => {
  const mounted = await mountCourseDetail();
  const chapterSource = testContext.unsavedSources[1];

  mounted.state.openChapter();
  mounted.state.chapterForm.title = '章节请求 A';
  const sameContext = deferRequest('POST', '/admin/courses/course-1/chapters');
  const sameContextSave = mounted.state.saveChapter();
  await waitFor(() => testContext.calls.some((call) => call.method === 'POST' && call.path === '/admin/courses/course-1/chapters'), 1800, 'chapter create');
  mounted.state.chapterForm.title = '响应前章节草稿 B';
  await nextTick();
  assert.equal(testContext.calls.find((call) => call.method === 'POST' && call.path === '/admin/courses/course-1/chapters')?.body?.title, '章节请求 A');
  sameContext.resolve();
  await sameContextSave;
  assert.equal(mounted.state.editingChapterId, 'chapter-created');
  assert.equal(mounted.state.chapterForm.title, '响应前章节草稿 B');
  assert.equal(mounted.state.chapterVisible, true);
  assert.equal(chapterSource.dirty.value, true);

  const second = deferRequest('PUT', '/admin/courses/course-1/chapters/chapter-created');
  const secondSave = mounted.state.saveChapter();
  await waitFor(() => testContext.calls.some((call) => call.method === 'PUT' && call.path.endsWith('/chapters/chapter-created')), 1800, 'retained chapter update');
  await nextTick();
  assert.equal(mounted.state.chapterSaving, true);
  assert.equal(findNodes(mounted.root, (node) => node.type === 'button' && node.props.loading === true && node.props.disabled === true).length, 1);
  await mounted.state.saveChapter();
  const chapterCreates = testContext.calls.filter((call) => call.method === 'POST' && call.path === '/admin/courses/course-1/chapters');
  const chapterUpdates = testContext.calls.filter((call) => call.method === 'PUT' && call.path.endsWith('/chapters/chapter-created'));
  assert.equal(chapterCreates.length, 1);
  assert.equal(chapterUpdates.length, 1);
  assert.equal(chapterUpdates[0]?.body?.title, '响应前章节草稿 B');
  second.resolve();
  await secondSave;
  assert.equal(mounted.state.chapterVisible, false);
  assert.equal(chapterSource.dirty.value, false);

  mounted.state.openChapter();
  mounted.state.chapterForm.title = '章节 A 提交值';
  const deferred = deferRequest('POST', '/admin/courses/course-1/chapters');
  const pending = mounted.state.saveChapter();
  await waitFor(() => testContext.calls.filter((call) => call.method === 'POST' && call.path === '/admin/courses/course-1/chapters').length === 2, 1800, 'stale chapter create');
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

test('a retained lesson create saves metadata and its later asset through distinct contracts', async () => {
  const mounted = await mountCourseDetail();
  const lessonSource = testContext.unsavedSources[2];

  mounted.state.openLesson('chapter-same');
  mounted.state.lessonForm.title = '课时请求 A';
  mounted.state.lessonForm.asset_id = 'video-request-a';
  const sameContext = deferRequest('POST', '/admin/courses/course-1/lessons');
  const sameContextSave = mounted.state.saveLesson();
  await waitFor(() => testContext.calls.some((call) => call.method === 'POST' && call.path === '/admin/courses/course-1/lessons'), 1800, 'lesson create');
  mounted.state.lessonForm.title = '响应前课时草稿 B';
  mounted.state.lessonForm.asset_id = 'video-draft-b';
  await nextTick();
  const lessonCreate = testContext.calls.find((call) => call.method === 'POST' && call.path === '/admin/courses/course-1/lessons');
  assert.equal(lessonCreate?.body?.title, '课时请求 A');
  assert.equal(lessonCreate?.body?.asset_id, 'video-request-a');
  sameContext.resolve();
  await sameContextSave;
  assert.equal(mounted.state.editingLessonId, 'lesson-created');
  assert.equal(mounted.state.lessonForm.title, '响应前课时草稿 B');
  assert.equal(mounted.state.lessonForm.asset_id, 'video-draft-b');
  assert.equal(mounted.state.lessonAssetDraftVisible, true);
  assert.equal(findNodes(mounted.root, (node) => String(node.text || '').includes('历史视频和学习记录保留')).length, 1);
  assert.equal(mounted.state.lessonVisible, true);
  assert.equal(lessonSource.dirty.value, true);

  const metadata = deferRequest('PUT', '/admin/courses/course-1/lessons/lesson-created');
  const version = deferRequest('POST', '/admin/courses/course-1/lessons/lesson-created/versions');
  const secondSave = mounted.state.saveLesson();
  await waitFor(() => testContext.calls.some((call) => call.method === 'PUT' && call.path.endsWith('/lessons/lesson-created')), 1800, 'retained lesson metadata update');
  await nextTick();
  assert.equal(mounted.state.lessonSaving, true);
  assert.equal(findNodes(mounted.root, (node) => node.type === 'button' && node.props.loading === true && node.props.disabled === true).length, 1);
  await mounted.state.saveLesson();
  assert.equal(testContext.calls.filter((call) => call.method === 'PUT' && call.path.endsWith('/lessons/lesson-created')).length, 1);
  const metadataUpdate = testContext.calls.find((call) => call.method === 'PUT' && call.path.endsWith('/lessons/lesson-created'));
  assert.equal(metadataUpdate?.body?.title, '响应前课时草稿 B');
  assert.equal(Object.hasOwn(metadataUpdate?.body || {}, 'asset_id'), false);
  metadata.resolve();
  await waitFor(() => testContext.calls.some((call) => call.method === 'POST' && call.path.endsWith('/lessons/lesson-created/versions')), 1800, 'retained lesson video version');
  const versionCreate = testContext.calls.find((call) => call.method === 'POST' && call.path.endsWith('/lessons/lesson-created/versions'));
  assert.equal(versionCreate?.body?.asset_id, 'video-draft-b');
  assert.equal(testContext.calls.filter((call) => call.method === 'POST' && call.path === '/admin/courses/course-1/lessons').length, 1);
  version.resolve();
  await secondSave;
  assert.equal(mounted.state.lessonVisible, false);
  assert.equal(lessonSource.dirty.value, false);

  mounted.state.openLesson('chapter-a');
  mounted.state.lessonForm.title = '课时 A 提交值';
  const deferred = deferRequest('POST', '/admin/courses/course-1/lessons');
  const pending = mounted.state.saveLesson();
  await waitFor(() => testContext.calls.filter((call) => call.method === 'POST' && call.path === '/admin/courses/course-1/lessons').length === 2, 1800, 'stale lesson create');
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

test('a failed retained lesson version keeps confirmed metadata in the baseline and parent row', async () => {
  testContext.course.chapters = [{ id: 'chapter-same', title: '第一章', sort_order: 1, lessons: [] }];
  const mounted = await mountCourseDetail();
  const lessonSource = testContext.unsavedSources[2];
  const versionPath = '/admin/courses/course-1/lessons/lesson-created/versions';

  mounted.state.openLesson('chapter-same');
  mounted.state.lessonForm.title = '课时 metadata A';
  mounted.state.lessonForm.asset_id = 'video-a';
  const create = deferRequest('POST', '/admin/courses/course-1/lessons');
  const createSave = mounted.state.saveLesson();
  await waitFor(() => testContext.calls.some((call) => call.method === 'POST' && call.path === '/admin/courses/course-1/lessons'), 1800, 'partial lesson create');
  mounted.state.lessonForm.title = '课时 metadata B';
  mounted.state.lessonForm.asset_id = 'video-b';
  await nextTick();
  create.resolve();
  await createSave;
  assert.equal(mounted.state.editingLessonId, 'lesson-created');
  assert.equal(lessonSource.dirty.value, true);
  assert.equal(mounted.state.course.chapters[0].lessons[0].title, '课时 metadata A');

  const metadata = deferRequest('PUT', '/admin/courses/course-1/lessons/lesson-created');
  testContext.failRequests.add(`POST ${versionPath}`);
  const pending = mounted.state.saveLesson();
  await waitFor(() => testContext.calls.some((call) => call.method === 'PUT' && call.path.endsWith('/lessons/lesson-created')), 1800, 'partial lesson metadata update');
  metadata.resolve();
  await assert.rejects(() => pending, /configured failure/);
  assert.equal(testContext.calls.filter((call) => call.method === 'POST' && call.path === versionPath).length, 1);
  assert.equal(mounted.state.lessonForm.title, '课时 metadata B');
  assert.equal(mounted.state.lessonForm.asset_id, 'video-b');
  assert.equal(mounted.state.lessonAssetDraftVisible, true);
  assert.equal(mounted.state.lessonVisible, true);
  assert.equal(mounted.state.lessonSaving, false);
  assert.equal(lessonSource.dirty.value, true);
  assert.equal(testContext.messages.some((item) => item.type === 'error' && item.message.includes('视频版本保存失败')), true);
  assert.equal(mounted.state.course.chapters[0].lessons[0].title, '课时 metadata B');
  assert.equal(mounted.state.course.chapters[0].lessons[0].current_version.asset_id, 'video-a');

  testContext.failRequests.delete(`POST ${versionPath}`);
  mounted.state.lessonForm.sort_order = 9;
  mounted.state.lessonForm.asset_id = null;
  await nextTick();
  await mounted.state.saveLesson();
  assert.equal(testContext.calls.filter((call) => call.method === 'POST' && call.path === versionPath).length, 1);
  assert.equal(mounted.state.lessonAssetDraftVisible, true);
  assert.equal(mounted.state.lessonVisible, true);
  assert.equal(lessonSource.dirty.value, true);
  assert.equal(testContext.messages.some((item) => item.type === 'warning' && item.message.includes('不能删除')), true);
  assert.equal(mounted.state.course.chapters[0].lessons[0].title, '课时 metadata B');
  assert.equal(mounted.state.course.chapters[0].lessons[0].sort_order, 9);
  assert.equal(mounted.state.course.chapters[0].lessons[0].current_version.asset_id, 'video-a');

  await lessonSource.confirmDiscard();
  assert.equal(mounted.state.editingLessonId, 'lesson-created');
  assert.equal(mounted.state.lessonForm.title, '课时 metadata B');
  assert.equal(mounted.state.lessonForm.sort_order, 9);
  assert.equal(mounted.state.lessonForm.asset_id, 'video-a');
  assert.equal(mounted.state.lessonVisible, false);
  assert.equal(lessonSource.dirty.value, false);

  const persistedRow = mounted.state.course.chapters[0].lessons[0];
  mounted.state.openLesson('chapter-same', persistedRow);
  assert.equal(mounted.state.lessonForm.title, '课时 metadata B');
  assert.equal(mounted.state.lessonForm.sort_order, 9);
  mounted.state.lessonForm.required = false;
  await mounted.state.saveLesson();
  const lastMetadataPut = testContext.calls.filter((call) => call.method === 'PUT' && call.path.endsWith('/lessons/lesson-created')).at(-1);
  assert.equal(lastMetadataPut.body.title, '课时 metadata B');
  assert.equal(lastMetadataPut.body.sort_order, 9);
  assert.equal(lastMetadataPut.body.required, false);
  assert.equal(mounted.state.course.chapters[0].lessons[0].title, '课时 metadata B');
  assert.equal(mounted.state.course.chapters[0].lessons[0].required, false);
  mounted.unmount();
});

test('a stale video save cannot clean or close a reopened unified lesson draft', async () => {
  const mounted = await mountCourseDetail();
  const lessonSource = testContext.unsavedSources[2];

  mounted.state.openLesson('chapter-1', {
    id: 'lesson-same', title: '课时', lesson_type: 'video', required: true, sort_order: 1, current_version: null,
  });
  mounted.state.lessonForm.asset_id = 'video-request-a';
  const sameContext = deferRequest('POST', '/admin/courses/course-1/lessons/lesson-same/versions');
  const sameContextSave = mounted.state.saveLesson();
  await waitFor(() => testContext.calls.some((call) => call.path?.endsWith('/lessons/lesson-same/versions')), 1800, 'same-context video save');
  mounted.state.lessonForm.asset_id = 'video-draft-b';
  await nextTick();
  assert.equal(testContext.calls.find((call) => call.path?.endsWith('/lessons/lesson-same/versions'))?.body?.asset_id, 'video-request-a');
  sameContext.resolve();
  await sameContextSave;
  assert.equal(mounted.state.lessonForm.asset_id, 'video-draft-b');
  assert.equal(mounted.state.lessonVisible, true);
  assert.equal(lessonSource.dirty.value, true);
  await mounted.state.closeLesson();

  mounted.state.openLesson('chapter-1', {
    id: 'lesson-a', title: '课时 A', lesson_type: 'video', required: true, sort_order: 1, current_version: null,
  });
  mounted.state.lessonForm.asset_id = 'video-a';
  const deferred = deferRequest('POST', '/admin/courses/course-1/lessons/lesson-a/versions');
  const pending = mounted.state.saveLesson();
  await waitFor(() => testContext.calls.some((call) => call.path?.endsWith('/lessons/lesson-a/versions')), 1800, 'video A save');
  await mounted.state.closeLesson();
  mounted.state.openLesson('chapter-1', {
    id: 'lesson-b', title: '课时 B', lesson_type: 'video', required: true, sort_order: 2, current_version: null,
  });
  mounted.state.lessonForm.asset_id = 'video-b';
  await nextTick();
  deferred.resolve();
  await pending;
  assert.equal(mounted.state.editingLessonId, 'lesson-b');
  assert.equal(mounted.state.lessonForm.asset_id, 'video-b');
  assert.equal(mounted.state.lessonVisible, true);
  assert.equal(lessonSource.dirty.value, true);
  mounted.unmount();
});

test('a version save cannot close a newer video upload that has not produced an asset id yet', async () => {
  const mounted = await mountCourseDetail('chapters');
  mounted.state.openLesson('chapter-1', { id: 'lesson-1', title: '安全教育', lesson_type: 'video', required: true, sort_order: 1, current_version: null });
  mounted.state.lessonForm.asset_id = 'video-a';
  const receipt = deferRequest('POST', '/admin/courses/course-1/lessons/lesson-1/versions');
  const saving = mounted.state.saveLesson();
  mounted.state.lessonMediaPending = true;
  await nextTick();
  receipt.resolve();
  await saving;
  assert.equal(mounted.state.lessonVisible, true);
  assert.equal(testContext.unsavedSources[2].dirty.value, true);
  mounted.state.lessonMediaPending = false;
  mounted.state.lessonForm.asset_id = 'video-b';
  await nextTick();
  await mounted.state.saveLesson();
  assert.equal(mounted.state.lessonVisible, false);
  assert.equal(testContext.calls.filter(call => call.path.endsWith('/lesson-1/versions')).at(-1).body.asset_id, 'video-b');
  mounted.unmount();
});
