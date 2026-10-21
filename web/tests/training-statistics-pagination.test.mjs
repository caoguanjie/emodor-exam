import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createRenderer, h, nextTick } from '@vue/runtime-core';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const clientComponentId = '\0training-statistics-pagination-client-test';
const routeStubId = '\0training-statistics-pagination-route-test';
const httpStubId = '\0training-statistics-pagination-http-test';
const authStubId = '\0training-statistics-pagination-auth-test';

const testContext = { calls: [] };
let clientComponentCode = '';
let vite;
let TrainingStatistics;

const summary = {
  paper_id: 'paper-1',
  release_id: 'release-1',
  eligible_count: 2,
  eligible_started_count: 2,
  participation_rate: 1,
  historical_started_count: 2,
  historical_only_started_count: 0,
  submitted_attempts: 2,
  submitted_users: 2,
  pending_attempts: 0,
  pending_users: 0,
  course_completion: { completed_users: 2, eligible_users: 2, required_lessons: 1, completion_rate: 1 },
  uncompleted_reasons: [],
  difficulty_composition: [{ difficulty: 'easy', users: 2 }],
  score_groups: [],
  as_of: '2026-10-22T00:00:00.000Z',
};

function rankRow(page) {
  return {
    rank: page,
    record_id: `record-${page}`,
    user_id: `user-${page}`,
    name: `学员${page}`,
    source: 'institution',
    difficulty: 'easy',
    score: 100 - page,
    duration_seconds: 60,
    graded_at: '2026-10-22T00:00:00.000Z',
  };
}

const routeStubCode = `
  export function useRouter() { return { async push() {} }; }
`;
const authStubCode = `
  export function useAuthStore() { return { can() { return true; } }; }
`;
const httpStubCode = `
  const context = globalThis.__trainingStatisticsPaginationTest;
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  export default {
    async get(path, config) {
      const params = clone(config?.params);
      context.calls.push({ path, params });
      if (path === '/statistics/training/options') return { papers: [], categories: [] };
      if (path === '/statistics/training/summary') return clone(context.summary);
      if (path === '/statistics/training/ranking') {
        const page = params.page;
        return { items: [context.rankRow(page)], total: 2, page, page_size: 1 };
      }
      throw new Error('unexpected GET ' + path);
    },
  };
  export async function download() {}
`;

function testPlugin() {
  return {
    name: 'training-statistics-pagination-test-stubs',
    enforce: 'pre',
    resolveId(source, importer) {
      const statisticsView = importer?.includes('/src/views/admin/TrainingStatistics.vue');
      if (source === 'vue-router' && statisticsView) return routeStubId;
      if (source === '../../api/http' && statisticsView) return httpStubId;
      if (source === '../../stores/auth' && statisticsView) return authStubId;
      if (source === clientComponentId) return source;
      return undefined;
    },
    load(id) {
      if (id === routeStubId) return routeStubCode;
      if (id === httpStubId) return httpStubCode;
      if (id === authStubId) return authStubCode;
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

before(async () => {
  Object.assign(testContext, { summary, rankRow });
  globalThis.__trainingStatisticsPaginationTest = testContext;
  vite = await createServer({
    root: webRoot,
    configFile: resolve(webRoot, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    plugins: [testPlugin()],
  });
  const transformed = await vite.transformRequest('/src/views/admin/TrainingStatistics.vue');
  assert.ok(transformed?.code, 'Vite should compile the real TrainingStatistics SFC');
  clientComponentCode = transformed.code
    .replace(/^import \{ createHotContext[\s\S]*?import\.meta\.hot = [^;]+;\s*/, '')
    .replace(/typeof __VUE_HMR_RUNTIME__[\s\S]*?(?=import _export_sfc)/, '')
    .replace(/from "\/node_modules\/\.vite\/deps\/vue\.js[^"]*"/g, 'from "vue"');
  TrainingStatistics = (await vite.ssrLoadModule(clientComponentId)).default;
});

after(async () => {
  delete globalThis.__trainingStatisticsPaginationTest;
  await vite?.close();
});

test('uses the emitted pagination page only through v-model and applies the page response', async () => {
  testContext.calls = [];
  const host = createHost();
  const root = { type: 'root', props: {}, children: [], parent: null, text: '' };
  const app = host.createApp(TrainingStatistics);
  for (const name of [
    'el-alert', 'el-button', 'el-col', 'el-empty', 'el-option', 'el-pagination', 'el-progress',
    'el-row', 'el-select', 'el-table', 'el-table-column', 'el-tag',
  ]) {
    app.component(name, passthrough(name === 'el-pagination' ? 'pagination' : name, ['default', 'title']));
  }
  app.directive('loading', {});
  app.mount(root);
  const state = app._instance.setupState;
  await waitFor(
    () => testContext.calls.some((call) => call.path === '/statistics/training/options'),
    1800,
    'training statistics options load',
  );

  state.filters.paper_id = 'paper-1';
  state.filters.difficulty = 'easy';
  state.filters.page_size = 1;
  await state.reload();
  await nextTick();
  assert.equal(state.ranking.items[0].record_id, 'record-1');

  const pagination = findNodes(root, (node) => node.type === 'pagination')[0];
  assert.ok(pagination, 'ranking pagination should be rendered');
  assert.equal(typeof pagination.props['onUpdate:currentPage'], 'function');
  assert.equal(typeof pagination.props.onCurrentChange, 'function');

  pagination.props['onUpdate:currentPage'](2);
  await pagination.props.onCurrentChange(2);
  await nextTick();

  assert.equal(testContext.calls.at(-1).params.page, 2, 'the page-two query should be sent');
  assert.equal(state.ranking.page, 2, 'the page-two response should not be discarded as an epoch mismatch');
  assert.equal(state.ranking.items[0].record_id, 'record-2');
  app.unmount();
});
