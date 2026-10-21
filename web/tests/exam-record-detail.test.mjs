import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createRenderer, h, nextTick } from '@vue/runtime-core';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const clientComponentId = '\0exam-record-detail-client-test';
const routeStubId = '\0exam-record-detail-route-test';
const httpStubId = '\0exam-record-detail-http-test';
const previewStubId = '\0exam-record-detail-preview-test';

const testContext = {
  calls: [],
  previews: [],
  record: null,
  result: null,
};
let clientComponentCode = '';
let vite;
let ExamRecordDetail;

const routeStubCode = `
  export function useRoute() { return { params: { id: '42' } }; }
  export function useRouter() { return { back() {} }; }
`;
const httpStubCode = `
  const context = globalThis.__examRecordDetailTest;
  export default {
    async get(path) {
      context.calls.push(path);
      if (path.endsWith('/result')) return context.result;
      return context.record;
    },
  };
`;
const previewStubCode = `
  import { h } from 'vue';
  const context = globalThis.__examRecordDetailTest;
  export default {
    name: 'QuestionPreviewStub',
    props: { question: Object, revealAnswer: Boolean },
    setup(props) {
      context.previews.push(props.question);
      return () => h('question-preview', {}, props.question?.stem || '');
    },
  };
`;

function testPlugin() {
  return {
    name: 'exam-record-detail-test-stubs',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'vue-router' && importer?.includes('/src/views/admin/ExamRecordDetail.vue')) return routeStubId;
      if (source === '../../api/http' && importer?.includes('/src/views/admin/ExamRecordDetail.vue')) return httpStubId;
      if (source === '../../components/QuestionPreview.vue' && importer?.includes('/src/views/admin/ExamRecordDetail.vue')) return previewStubId;
      if (source === clientComponentId) return clientComponentId;
      return undefined;
    },
    load(id) {
      if (id === routeStubId) return routeStubCode;
      if (id === httpStubId) return httpStubCode;
      if (id === previewStubId) return previewStubCode;
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
      return () => h(type, attrs, slotNames.flatMap((name) => slots[name]?.() || []));
    },
  };
}

function findNodes(root, type, found = []) {
  if (!root) return found;
  if (root.type === type) found.push(root);
  for (const child of root.children || []) findNodes(child, type, found);
  return found;
}

function textContent(root) {
  if (!root) return '';
  return `${root.text || ''}${(root.children || []).map(textContent).join('')}`;
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

async function mountDetail() {
  const host = createHost();
  const root = { type: 'root', props: {}, children: [], parent: null, text: '' };
  const app = host.createApp(ExamRecordDetail);
  for (const [name, component] of Object.entries({
    'el-button': passthrough('button'),
    'el-alert': passthrough('alert'),
    'el-skeleton': passthrough('skeleton'),
    'el-descriptions': passthrough('descriptions'),
    'el-descriptions-item': passthrough('description-item'),
    'el-tag': passthrough('tag'),
  })) app.component(name, component);
  app.mount(root);
  await nextTick();
  await waitFor(() => app._instance.setupState.loading === false && app._instance.setupState.record, 1800, 'record detail load');
  await nextTick();
  return { app, root, state: app._instance.setupState, unmount: () => app.unmount() };
}

function record(status) {
  return {
    record_id: '42', paper_id: '7', paper_title: '安全考试', user_id: '9', username: 'learner9', name: '学员甲',
    source: 'institution', category_id: '3', difficulty: 'easy', release_id: '5', attempt_no: 1,
    started_at: '2026-10-22T01:00:00.000Z', deadline_at: '2026-10-22T01:30:00.000Z',
    submitted_at: status === 'in_progress' ? null : '2026-10-22T01:20:00.000Z', answered_count: 2, total_count: 2,
    switch_count: 0, status, grading_state: status === 'in_progress' ? 'not_submitted' : 'finalized',
    submission_method: status === 'in_progress' ? null : 'manual', score: status === 'in_progress' ? null : 90,
    server_now: '2026-10-22T01:10:00.000Z', remaining_seconds: 1200, last_heartbeat_at: null,
    connection_state: status === 'in_progress' ? 'uncertain' : 'ended', device_summary: null,
  };
}

before(async () => {
  globalThis.__examRecordDetailTest = testContext;
  vite = await createServer({
    root: webRoot,
    configFile: resolve(webRoot, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    plugins: [testPlugin()],
  });
  const transformed = await vite.transformRequest('/src/views/admin/ExamRecordDetail.vue');
  assert.ok(transformed?.code, 'Vite should compile the real ExamRecordDetail SFC');
  clientComponentCode = transformed.code
    .replace(/^import \{ createHotContext[\s\S]*?import\.meta\.hot = [^;]+;\s*/, '')
    .replace(/typeof __VUE_HMR_RUNTIME__[\s\S]*?(?=import _export_sfc)/, '')
    .replace(/from "\/node_modules\/\.vite\/deps\/vue\.js[^"]*"/g, 'from "vue"');
  const loaded = await vite.ssrLoadModule(clientComponentId);
  ExamRecordDetail = loaded.default;
});

after(async () => {
  delete globalThis.__examRecordDetailTest;
  await vite?.close();
});

beforeEach(() => {
  testContext.calls = [];
  testContext.previews = [];
  testContext.record = record('in_progress');
  testContext.result = null;
});

test('keeps an in-progress record metadata-only and does not request result', async () => {
  const mounted = await mountDetail();
  assert.deepEqual(testContext.calls, ['/admin/exam-records/42']);
  assert.equal(testContext.previews.length, 0);
  mounted.unmount();
});

test('loads terminal result read-only without requesting uploaded answer images', async () => {
  testContext.record = record('passed');
  testContext.result = {
    record_id: '42', grading_state: 'finalized', grading_revision: 1, submission_method: 'manual', legacy: false,
    submitted_at: '2026-10-22T01:20:00.000Z', graded_at: '2026-10-22T01:21:00.000Z', score: 90,
    passed: true, correct_rate: 0.5,
    items: [
      { item_id: '101', type: 'single', stem: '<p>单选题</p>', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], score: 50,
        answer: { item_id: '101', selected: [1] }, correct_answer: [0], analysis: '<p>解析</p>', rubric: null,
        gained_score: 40, comment: '需复习', grading_version: 1 },
      { item_id: '102', type: 'image', stem: '<p>图片题</p>', options: [], score: 50,
        answer: { item_id: '102', asset_ids: ['9001'] }, correct_answer: null, analysis: null, rubric: '<p>评分参考</p>',
        gained_score: 50, comment: '完整', grading_version: 1 },
    ],
  };

  const mounted = await mountDetail();
  assert.deepEqual(testContext.calls, ['/admin/exam-records/42', '/admin/exam-records/42/result']);
  assert.equal(testContext.calls.some((path) => path.includes('/media/9001')), false);
  assert.equal(testContext.previews.length, 2);
  assert.match(textContent(mounted.root), /学员作答.*B/s);
  assert.match(textContent(mounted.root), /需复习/);
  assert(findNodes(mounted.root, 'alert').some((node) => String(node.props.title).includes('exam_records:review')));
  mounted.unmount();
});
