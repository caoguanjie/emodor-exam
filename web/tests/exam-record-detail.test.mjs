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
  requestOptions: [],
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
    async get(path, options) {
      context.calls.push(path);
      context.requestOptions.push(options || null);
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
    status, grading_state: status === 'in_progress' ? 'not_submitted' : 'finalized',
    submission_method: status === 'in_progress' ? null : 'manual', score: status === 'in_progress' ? null : 90,
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
  testContext.requestOptions = [];
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

test('loads an objective terminal result without monitoring or manual-grading residue', async () => {
  testContext.record = record('passed');
  testContext.result = {
    record_id: '42', grading_state: 'finalized', submission_method: 'manual', legacy: false,
    submitted_at: '2026-10-22T01:20:00.000Z', graded_at: '2026-10-22T01:21:00.000Z', score: 90,
    passed: true, correct_rate: 1,
    items: [
      { item_id: '101', type: 'single', stem: '<p>单选题</p>', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], score: 50,
        answer: { item_id: '101', selected: [1] }, correct_answer: [0], analysis: '<p>解析</p>', gained_score: 40 },
      { item_id: '102', type: 'judgment', stem: '<p>判断题</p>', options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], score: 50,
        answer: { item_id: '102', selected: [0] }, correct_answer: [0], analysis: null, gained_score: 50 },
    ],
  };

  const mounted = await mountDetail();
  assert.deepEqual(testContext.calls, ['/admin/exam-records/42', '/admin/exam-records/42/result']);
  assert.equal(testContext.previews.length, 2);
  assert.match(textContent(mounted.root), /学员作答.*B/s);
  const text = textContent(mounted.root);
  for (const retired of ['批改状态', '连接提示', '切屏次数', '剩余时间', '最后心跳', '设备摘要', '待批改', '评分版本', '评语', '人工阅卷']) {
    assert.doesNotMatch(text, new RegExp(retired));
  }
  mounted.unmount();
});

test('admin readonly v2 result maps stable selected IDs separately from correct IDs', async () => {
  const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  testContext.record = record('failed');
  testContext.result = {
    record_id: '42', status: 'failed', grading_state: 'finalized', submission_method: 'manual', legacy: false,
    submitted_at: '2026-10-22T01:20:00.000Z', graded_at: '2026-10-22T01:20:00.000Z', score: 0, passed: false, correct_rate: 0,
    items: [{ item_id: '101', type: 'single', stem: doc('稳定ID题干'), score: 100,
      options: [{ id: 'stable-right', content: doc('正确选项') }, { id: 'stable-wrong', content: doc('学员所选') }],
      selected_option_ids: ['stable-wrong'], correct_option_ids: ['stable-right'], analysis: doc('解析'), gained_score: 0 }],
  };
  const mounted = await mountDetail();
  assert.match(textContent(mounted.root), /学员作答.*B/s);
  assert.deepEqual(testContext.previews[0].content_json.answer_option_ids, ['stable-right']);
  assert.equal('selected_option_ids' in testContext.previews[0], false);
  mounted.unmount();
});

test('admin result advertises schema 3 and preserves rich result content', async () => {
  const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  testContext.record = record('passed');
  testContext.result = {
    record_id: '42', status: 'passed', grading_state: 'finalized', submission_method: 'manual', legacy: false,
    submitted_at: '2026-10-22T01:20:00.000Z', graded_at: '2026-10-22T01:20:00.000Z', score: 100, passed: true, correct_rate: 1,
    items: [{ item_id: '101', type: 'single', content_schema_version: 3, stem: doc('富文本题干'), score: 100,
      options: [{ id: 'rich-right', content: doc('正确选项') }, { id: 'rich-wrong', content: doc('错误选项') }],
      selected_option_ids: ['rich-right'], correct_option_ids: ['rich-right'], analysis: doc('富文本解析'), gained_score: 100 }],
  };
  const mounted = await mountDetail();
  assert.equal(testContext.requestOptions[1].headers['X-Question-Content-Version'], '3');
  assert.equal(testContext.previews[0].content_schema_version, 3);
  assert.deepEqual(testContext.previews[0].content_json.answer_option_ids, ['rich-right']);
  mounted.unmount();
});

test('admin pure timeout shows no submission and no question review', async () => {
  testContext.record = { ...record('timeout'), submitted_at: null, submission_method: null, grading_state: 'not_submitted', score: 0 };
  testContext.result = {
    record_id: '42', status: 'timeout', grading_state: 'not_submitted', submission_method: null, legacy: false,
    submitted_at: null, graded_at: null, score: 0, passed: false, correct_rate: null, items: [],
  };
  const mounted = await mountDetail();
  assert.match(textContent(mounted.root), /超时未交卷/);
  assert.equal(testContext.previews.length, 0);
  assert.doesNotMatch(textContent(mounted.root), /历史未知/);
  mounted.unmount();
});
