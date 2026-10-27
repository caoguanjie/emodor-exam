import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createRenderer, h, inject, nextTick, provide, reactive } from '@vue/runtime-core';
import ElPagination from '../node_modules/element-plus/es/components/pagination/src/pagination.mjs';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const clientId = '\0training-statistics-overview-client';
const httpId = '\0training-statistics-overview-http';
const authId = '\0training-statistics-overview-auth';
const routeId = '\0training-statistics-overview-route';
const recordDetailId = '\0training-statistics-overview-record-detail';
const context = { calls: [], downloads: [], canExport: true, canReadExamRecords: true };
let clientCode = '';
let vite;
let TrainingStatistics;

const paper = (id = 'paper-1') => ({
  paper_id: id, title: id === 'paper-1' ? '安全培训考试' : '新场次考试',
  category_id: 'category-1', category_name: '安全培训', status: 'published', release_id: `release-${id}`,
  total_score: 100, duration_minutes: 45, pass_score: 60,
  participant_count: 12, finalized_users: 10, average_score: 72.5,
});
const summary = (id = 'paper-1') => ({
  exam: { ...paper(id), mode: 'random', excellent_score: null }, release_id: `release-${id}`,
  eligible_count: 12, eligible_started_count: 12, historical_started_count: 12,
  historical_only_started_count: 0, submitted_attempts: 10, submitted_users: 10, finalized_users: 10,
  participation_rate: 1,
  score_groups: [{
    difficulty: 'easy', finalized_users: 10, average_score: 72.5, pass_rate: 0.8,
    highest_score: 98, lowest_score: 35, passed_users: 8, average_duration_seconds: 125.5,
    excellent_users: null, distribution: [{ lower: 0, upper: 20, count: 0 }],
  }],
  difficulty_composition: [{ difficulty: 'easy', users: 12 }],
  course_completion: { eligible_users: 12, required_lessons: 1, completed_users: 10, completion_rate: 10 / 12 },
  uncompleted_reasons: [{ reason: 'not_started', users: 0 }], as_of: '2026-10-23T00:00:00Z',
});
const ranks = (id = 'paper-1', page = 1) => ({
  items: [
    { rank: 3, user_id: `${id}-user-3`, name: '张三', gender: 'male', source: 'institution', difficulty: 'easy', score: 70, duration_seconds: 60, record_id: `${id}-record-${page}` },
    { rank: 1, user_id: `${id}-user-1`, name: '李四', gender: 'female', source: 'external', difficulty: 'easy', score: 98, duration_seconds: 180, record_id: `${id}-record-top` },
    { rank: 1, user_id: `${id}-user-2`, name: '王五', gender: null, source: null, difficulty: 'easy', score: 98, duration_seconds: 200, record_id: `${id}-record-tie` },
  ], total: 60, page, page_size: 20,
});
function defaultGet(path, params = {}) {
  if (path.endsWith('/options')) return {
    papers: [paper('paper-1'), paper('paper-2')].map(({ paper_id, title, category_id, status }) => ({ id: paper_id, title, category_id, status })),
    categories: [{ id: 'category-1', name: '安全培训' }],
  };
  if (path.endsWith('/overview')) return { items: [paper()], total: 60, page: params.page || 1, page_size: 20 };
  if (path.endsWith('/summary')) return summary(params.paper_id);
  if (path.endsWith('/ranking')) return ranks(params.paper_id, params.page);
  throw new Error(`unexpected GET ${path}`);
}
function deferred() {
  let resolvePromise;
  let reject;
  const promise = new Promise((resolve, rejectPromise) => { resolvePromise = resolve; reject = rejectPromise; });
  return { promise, resolve: resolvePromise, reject };
}
function testPlugin() {
  return {
    name: 'training-statistics-overview-boundaries', enforce: 'pre',
    resolveId(source, importer) {
      if (importer?.includes('/src/views/admin/TrainingStatistics.vue')) {
        if (source === 'vue-router') return routeId;
        if (source === '../../api/http') return httpId;
        if (source === '../../stores/auth') return authId;
        if (source === './ExamRecordDetail.vue') return recordDetailId;
      }
      if (source === clientId) return clientId;
    },
    load(id) {
      if (id === clientId) return clientCode;
      if (id === routeId) return `
        const context = globalThis.__trainingStatisticsOverviewTest;
        export function useRoute() { return context.route; }
        export function useRouter() { return { async replace(value) { context.route.query = value.query; context.route.fullPath = context.route.path + '?' + new URLSearchParams(value.query); } }; }
      `;
      if (id === authId) return `export function useAuthStore() { return { can(permission) {
        const context = globalThis.__trainingStatisticsOverviewTest;
        return permission === 'statistics:export' ? context.canExport
          : permission === 'exam_records:read' ? context.canReadExamRecords
          : true;
      } }; }`;
      if (id === recordDetailId) return `
        import { h } from 'vue';
        export default { props: ['recordId'], emits: ['close'], setup(props) { return () => h('exam-record-detail-stub', { recordId: props.recordId }, props.recordId); } };
      `;
      if (id === httpId) return `
        const context = globalThis.__trainingStatisticsOverviewTest;
        export default { async get(path, config) {
          const params = JSON.parse(JSON.stringify(config?.params || {}));
          context.calls.push({ path, params });
          return context.get(path, params);
        } };
        export async function download(path, filename, params) {
          context.downloads.push({ path, filename, params: JSON.parse(JSON.stringify(params)) });
        }
      `;
    },
  };
}
function createHost() {
  return createRenderer({
    patchProp(node, key, _previous, value) { node.props[key] = value; },
    insert(node, parent, anchor = null) {
      if (node.parent) this.remove(node);
      node.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index >= 0) parent.children.splice(index, 0, node);
      else parent.children.push(node);
    },
    remove(node) { const index = node.parent?.children.indexOf(node) ?? -1; if (index >= 0) node.parent.children.splice(index, 1); node.parent = null; },
    createElement(type) { return { type, props: {}, children: [], parent: null, text: '' }; },
    createText(text) { return { type: '#text', props: {}, children: [], parent: null, text }; },
    createComment(text) { return { type: '#comment', props: {}, children: [], parent: null, text }; },
    setText(node, text) { node.text = text; },
    setElementText(node, text) { node.text = text; node.children = []; },
    parentNode(node) { return node.parent; },
    nextSibling(node) { const index = node.parent?.children.indexOf(node) ?? -1; return index >= 0 ? node.parent.children[index + 1] || null : null; },
    querySelector() { return null; }, setScopeId() {},
    cloneNode(node) { return { ...node, props: { ...node.props }, children: [...node.children] }; },
    insertStaticContent(content, parent, anchor) { const node = { type: '#static', props: {}, children: [], parent: null, text: content }; this.insert(node, parent, anchor); return [node, node]; },
  });
}
const Table = {
  props: ['data'], inheritAttrs: false,
  setup(props, { attrs, slots }) { provide('statistics-test-table', props); return () => h('el-table', attrs, [slots.default?.(), !props.data?.length ? slots.empty?.() : null]); },
};
const Column = {
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    const table = inject('statistics-test-table');
    return () => h('el-table-column', attrs, [
      h('label', {}, slots.header?.() || attrs.label || ''),
      ...(table.data || []).map((row) => h('cell', {}, slots.default?.({ row }) || String(row[attrs.prop] ?? ''))),
    ]);
  },
};
function findNodes(root, predicate, found = []) {
  if (!root) return found;
  if (predicate(root)) found.push(root);
  for (const child of root.children || []) findNodes(child, predicate, found);
  return found;
}
function textContent(root) { return `${root.text || ''}${(root.children || []).map(textContent).join('')}`; }
async function settle() { await new Promise((resolvePromise) => setTimeout(resolvePromise, 20)); await nextTick(); }
async function mount({ realPagination = false } = {}) {
  const host = createHost();
  const root = { type: 'root', props: {}, children: [], parent: null, text: '' };
  const app = host.createApp(TrainingStatistics);
  for (const name of ['el-tooltip', 'el-icon', 'el-alert', 'el-button', 'el-col', 'el-collapse', 'el-collapse-item', 'el-descriptions', 'el-descriptions-item', 'el-dialog', 'el-empty', 'el-form', 'el-form-item', 'el-input', 'el-option', 'el-pagination', 'el-progress', 'el-row', 'el-select', 'el-skeleton', 'el-tag']) {
    if (realPagination && name === 'el-pagination') {
      // Keep the real page-count watcher and pager; omit only the DOM-dependent size select.
      app.component(name, { inheritAttrs: false, setup(_props, { attrs }) { return () => h(ElPagination, { ...attrs, layout: 'total, prev, pager, next' }); } });
      continue;
    }
    app.component(name, { inheritAttrs: false, setup(_props, { attrs, slots }) { return () => h(name, attrs, [typeof attrs.title === 'string' ? attrs.title : '', name === 'el-descriptions-item' ? attrs.label : '', slots.default?.(), slots.title?.(), slots.footer?.()]); } });
  }
  app.component('el-table', Table);
  app.component('el-table-column', Column);
  app.directive('loading', {});
  app.mount(root);
  await settle();
  return { root, state: app._instance.setupState, unmount: () => app.unmount() };
}
before(async () => {
  globalThis.__trainingStatisticsOverviewTest = context;
  vite = await createServer({ root: webRoot, configFile: resolve(webRoot, 'vite.config.ts'), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true }, plugins: [testPlugin()] });
  const transformed = await vite.transformRequest('/src/views/admin/TrainingStatistics.vue');
  clientCode = transformed.code
    .replace(/^import \{ createHotContext[\s\S]*?import\.meta\.hot = [^;]+;\s*/, '')
    .replace(/typeof __VUE_HMR_RUNTIME__[\s\S]*?(?=import _export_sfc)/, '')
    .replace(/from "\/node_modules\/\.vite\/deps\/vue\.js[^"]*"/g, 'from "vue"');
  TrainingStatistics = (await vite.ssrLoadModule(clientId)).default;
});
beforeEach(() => { context.route = reactive({ path: '/admin/training-statistics', fullPath: '/admin/training-statistics', query: {} }); context.calls = []; context.downloads = []; context.get = defaultGet; context.canExport = true; context.canReadExamRecords = true; });
after(async () => { delete globalThis.__trainingStatisticsOverviewTest; await vite?.close(); });

test('dashboard archived paper deep link bypasses current options and overview entry clears cached analysis', async (t) => {
  context.route.query = { entry: 'dashboard', paper_id: '888' };
  const { state, unmount } = await mount(); t.after(unmount);
  assert.equal(state.filters.paper_id, '888');
  assert.equal(state.summary.exam.paper_id, '888');
  assert.equal(context.calls.filter(call => call.path.endsWith('/summary')).length, 1);
  assert.equal(context.calls.filter(call => call.path.endsWith('/overview')).length, 1, 'deep links still populate the list behind the dialog');
  assert.equal(state.overview.items.length, 1);
  assert.deepEqual(context.route.query, { paper_id: '888' });
  Object.assign(state.overviewFilters, { keyword: '旧关键词', category_id: '旧类别', page: 3 });
  Object.assign(state.filters, { difficulty: 'hard', source: 'external', page: 4 });
  context.calls = [];
  context.route.query = { entry: 'dashboard' };
  await settle();
  assert.equal(state.filters.paper_id, '');
  assert.equal(state.summary, null);
  assert.equal(context.calls.some(call => call.path.endsWith('/summary')), false);
  assert.deepEqual(context.calls.find(call => call.path.endsWith('/overview')).params, { page: 1, page_size: 20 });
});

test('a consumed paper link preserves local analysis filters when the same paper URL is updated', async (t) => {
  context.get = (path, params) => path.endsWith('/summary') ? {
    ...summary(params.paper_id),
    score_groups: [summary(params.paper_id).score_groups[0], { ...summary(params.paper_id).score_groups[0], difficulty: 'hard' }],
  } : defaultGet(path, params);
  context.route.query = { paper_id: '888' };
  const { state, unmount } = await mount(); t.after(unmount);
  Object.assign(state.filters, { source: 'external', category_id: 'category-1', difficulty: 'hard' });
  context.calls = [];
  context.route.query = { paper_id: '888', view: 'analysis' };
  await settle();
  const request = context.calls.find(call => call.path.endsWith('/summary'));
  assert.deepEqual(request.params, { paper_id: '888', category_id: 'category-1', source: 'external', page: 1, page_size: 20 });
  assert.equal(context.calls.find(call => call.path.endsWith('/ranking')).params.difficulty, 'hard');
});

test('默认展示有筛选分页的考试总览，返回列表保留查询和页码', async (t) => {
  const { root, state, unmount } = await mount(); t.after(unmount);
  assert.ok(context.calls.some(({ path }) => path.endsWith('/overview')), 'default view must request the paginated overview');
  assert.equal(context.calls.some(({ path }) => path.endsWith('/summary')), false);
  assert.match(textContent(root), /安全培训考试/);
  assert.match(textContent(root), /参考人数/);
  const columns = findNodes(root, node => node.type === 'el-table-column');
  assert.deepEqual(columns.map(node => node.props.label), ['考试名称','培训类别','试卷总分','参考人数','平均分','操作']);
  assert.equal(columns[0].props['header-align'], 'left');
  assert.equal(columns[0].props.align, 'left');
  assert.ok(columns.slice(1).every(node => node.props['header-align'] === 'center'));
  assert.ok(columns.slice(1).every(node => node.props.align === 'center'));
  assert.ok(findNodes(root, node => node.type === 'el-tooltip' && String(node.props.content).includes('仅展示已发布试卷')).length);
  state.overviewFilters.keyword = '安全'; state.overviewFilters.category_id = 'category-1'; state.overviewFilters.page = 3;
  await state.loadOverview();
  assert.deepEqual(context.calls.at(-1).params, { keyword: '安全', category_id: 'category-1', page: 3, page_size: 20 });
  await state.openAnalysis(paper());
  await state.backToOverview();
  assert.equal(state.filters.paper_id, '');
  assert.equal(state.overviewFilters.keyword, '安全');
  assert.equal(state.overviewFilters.category_id, 'category-1');
  assert.equal(state.overviewFilters.page, 3);
  assert.match(textContent(root), /安全培训考试/);
});

test('固定卷成绩分析在内容区弹窗展示描述列表并直接加载整场排名', async (t) => {
  context.get = (path, params) => path.endsWith('/summary')
    ? { ...summary(params.paper_id), exam: { ...summary(params.paper_id).exam, mode: 'fixed' } }
    : defaultGet(path, params);
  const { root, state, unmount } = await mount(); t.after(unmount);
  await state.openAnalysis(paper()); await nextTick();

  assert.match(textContent(root), /考试名称.*培训类别.*试卷总分.*参考人数/s, 'the overview list must remain mounted behind the dialog');
  const dialog = findNodes(root, node => node.type === 'el-dialog')[0];
  assert.ok(dialog); assert.equal(state.filters.paper_id, 'paper-1');
  assert.match(String(dialog.props.class), /training-score-analysis-dialog/);
  const descriptions = findNodes(dialog, node => node.type === 'el-descriptions')[0];
  assert.ok(descriptions); assert.equal(descriptions.props.column, 4);
  const descriptionItems = findNodes(descriptions, node => node.type === 'el-descriptions-item');
  assert.deepEqual(descriptionItems.map(node => node.props.label), [
    '考试名称', '培训类别',
    '试卷总分', '考试时长', '及格分', '优秀分',
    '当前应考', '参考人数', '已交卷人数', '参考率',
    '平均分', '最高分', '最低分', '平均用时',
    '及格人数', '及格率', '优秀人数',
  ]);
  assert.equal(descriptionItems[0].props.span, 2);
  assert.equal(descriptionItems[1].props.span, 2);
  assert.equal(descriptionItems.at(-1).props.span, 2);
  const rankingRequest = context.calls.find(call => call.path.endsWith('/ranking'));
  assert.ok(rankingRequest); assert.equal(rankingRequest.params.difficulty, undefined);
  assert.equal(findNodes(dialog, node => node.type === 'el-select' && node.props.placeholder === '选择卷面难度').length, 0);
  const rankingColumns = findNodes(dialog, node => node.type === 'el-table-column').map(node => node.props.label);
  assert.equal(rankingColumns.includes('答卷 ID'), false); assert.ok(rankingColumns.includes('操作'));
  assert.match(textContent(dialog), /查看答卷/);

  await dialog.props.onClose(); await settle();
  assert.equal(state.filters.paper_id, ''); assert.match(textContent(root), /安全培训考试/);
});

test('历史随机卷自动选择已有卷面难度并保留难度切换', async (t) => {
  context.get = (path, params) => path.endsWith('/summary') ? {
    ...summary(params.paper_id),
    score_groups: [summary(params.paper_id).score_groups[0], { ...summary(params.paper_id).score_groups[0], difficulty: 'hard' }],
  } : defaultGet(path, params);
  const { root, state, unmount } = await mount(); t.after(unmount);
  await state.openAnalysis(paper()); await nextTick();

  assert.equal(state.filters.difficulty, 'easy');
  assert.ok(findNodes(root, node => node.type === 'el-select' && node.props.placeholder === '选择卷面难度').length);
  assert.equal(context.calls.find(call => call.path.endsWith('/ranking')).params.difficulty, 'easy');
});

test('历史随机卷优先选择已有最终成绩的难度，而不是只有开考记录的难度', async (t) => {
  context.get = (path, params) => path.endsWith('/summary') ? {
    ...summary(params.paper_id),
    score_groups: [{ ...summary(params.paper_id).score_groups[0], difficulty: 'hard' }],
    difficulty_composition: [{ difficulty: 'easy', users: 5 }, { difficulty: 'hard', users: 7 }],
  } : defaultGet(path, params);
  const { state, unmount } = await mount(); t.after(unmount);
  await state.openAnalysis(paper()); await nextTick();

  assert.equal(state.filters.difficulty, 'hard');
  assert.equal(context.calls.find(call => call.path.endsWith('/ranking')).params.difficulty, 'hard');
});

test('查看答卷按独立权限展示并在处理函数再次守卫', async (t) => {
  context.canReadExamRecords = false;
  const { root, state, unmount } = await mount(); t.after(unmount);
  await state.openAnalysis(paper()); await nextTick();

  assert.doesNotMatch(textContent(root), /查看答卷/);
  state.openRecord('record-forbidden'); await nextTick();
  assert.equal(state.detailRecordId, '');
  assert.equal(findNodes(root, node => node.type === 'exam-record-detail-stub').length, 0);
});

test('页面失活时隐藏内容区弹窗、关闭答卷并使迟到详情失效，激活后保留场次', async (t) => {
  const { root, state, unmount } = await mount(); t.after(unmount);
  await state.openAnalysis(paper()); state.openRecord('record-1'); await nextTick();
  assert.equal(state.analysisVisible, true);
  assert.equal(state.detailRecordId, 'record-1');

  const pending = deferred();
  context.get = (path, params) => path.endsWith('/summary') ? pending.promise : defaultGet(path, params);
  const reload = state.reload(); await settle();
  state.deactivateView(); await nextTick();
  assert.equal(state.analysisVisible, false);
  assert.equal(state.detailRecordId, '');
  pending.resolve(summary('paper-1')); await reload; await nextTick();
  assert.equal(state.summary, null, 'response completed after deactivation must be ignored');

  state.activateView(); await nextTick();
  assert.equal(state.filters.paper_id, 'paper-1');
  assert.equal(state.analysisVisible, true);
});

test('深链切换场次或返回总览时关闭上一场答卷详情', async (t) => {
  const { state, unmount } = await mount(); t.after(unmount);
  await state.openAnalysis(paper('paper-1')); state.openRecord('paper-1-record'); await nextTick();
  assert.equal(state.detailRecordId, 'paper-1-record');

  context.route.query = { paper_id: '2' }; await settle();
  assert.equal(state.filters.paper_id, '2');
  assert.equal(state.detailRecordId, '');
  state.openRecord('paper-2-record');
  context.route.query = { entry: 'dashboard' }; await settle();
  assert.equal(state.filters.paper_id, '');
  assert.equal(state.detailRecordId, '');
});

test('缓存页从其他页面进入无 paper_id 的统计总览时不恢复旧弹窗', async (t) => {
  const { state, unmount } = await mount(); t.after(unmount);
  await state.openAnalysis(paper('888')); state.openRecord('record-888'); await nextTick();
  state.deactivateView();
  context.route.query = {};
  context.route.fullPath = '/admin/training-statistics';
  state.activateView();
  context.calls = [];
  await state.initialize(); await nextTick();

  assert.equal(state.filters.paper_id, '');
  assert.equal(state.detailRecordId, '');
  assert.equal(state.analysisVisible, false);
  assert.equal(context.calls.some(call => call.path.endsWith('/summary')), false);
  assert.equal(context.route.query.paper_id, undefined);
});

test('详情使用发布规则并展示统计补充值，未配置优秀线不补造', async (t) => {
  const { root, state, unmount } = await mount(); t.after(unmount);
  await state.openAnalysis(paper()); await nextTick();
  const text = textContent(root);
  assert.match(text, /安全培训考试/); assert.match(text, /45\s*分钟/);
  assert.match(text, /及格分.*60/); assert.match(text, /优秀分.*未设置/);
  for (const label of ['最高分', '最低分', '及格人数', '平均用时', '优秀人数']) assert.match(text, new RegExp(label));
  assert.match(text, /98/); assert.match(text, /35/); assert.match(text, /2分6秒/);
  const excellent = findNodes(root, (node) => node.type === 'el-descriptions-item' && node.props.label === '优秀人数')[0];
  assert.match(textContent(excellent), /—/);
});

test('排名交由服务端排序，分页与导出采用相同参数且保留原始分数名次', async (t) => {
  const { root, state, unmount } = await mount(); t.after(unmount);
  await state.openAnalysis(paper());
  state.filters.source = 'external'; state.filters.difficulty = 'easy'; await state.reload(); await nextTick();
  const rankTable = findNodes(root, (node) => node.type === 'el-table' && typeof node.props.onSortChange === 'function')[0];
  assert.ok(rankTable, 'ranking table must offer server sort');
  await rankTable.props.onSortChange({ prop: 'duration_seconds', order: 'ascending' }); await nextTick();
  assert.equal(context.calls.at(-1).params.sort_by, 'duration'); assert.equal(context.calls.at(-1).params.sort_order, 'asc');
  assert.deepEqual(state.ranking.items.map(({ rank }) => rank), [3, 1, 1]);
  assert.match(textContent(root), /性别.*男女未填写/);
  state.filters.page = 2; await state.onRankingPageChange();
  await state.exportRanking();
  assert.deepEqual(context.downloads[0].params, context.calls.at(-1).params);
  assert.equal(context.downloads[0].params.page, 2);
  await rankTable.props.onSortChange({ prop: 'score', order: 'descending' });
  assert.equal(context.calls.at(-1).params.sort_by, 'score'); assert.equal(context.calls.at(-1).params.sort_order, 'desc');
  assert.equal(context.calls.at(-1).params.page, 1);
  await rankTable.props.onSortChange({ prop: 'score', order: 'ascending' });
  assert.equal(context.calls.at(-1).params.sort_order, 'asc');
  await rankTable.props.onSortChange({ prop: 'duration_seconds', order: 'descending' });
  assert.equal(context.calls.at(-1).params.sort_by, 'duration'); assert.equal(context.calls.at(-1).params.sort_order, 'desc');
  await state.reload(); await nextTick();
  const restoredTable = findNodes(root, (node) => node.type === 'el-table' && typeof node.props.onSortChange === 'function')[0];
  assert.deepEqual(restoredTable.props['default-sort'], { prop: 'duration_seconds', order: 'descending' }, 'remounted table must keep the visible sort consistent with the server query');
  await rankTable.props.onSortChange({ prop: 'duration_seconds', order: null });
  assert.equal(context.calls.at(-1).params.sort_by, undefined); assert.equal(context.calls.at(-1).params.sort_order, undefined);
});

test('迟到的总览响应不能覆盖后发查询', async (t) => {
  const old = deferred(); const current = deferred();
  const { state, unmount } = await mount(); t.after(unmount);
  context.get = (path, params) => path.endsWith('/overview') ? (params.keyword === '旧' ? old.promise : current.promise) : defaultGet(path, params);
  state.overviewFilters.keyword = '旧'; const first = state.loadOverview();
  state.overviewFilters.keyword = '新'; const second = state.loadOverview();
  current.resolve({ items: [paper('paper-2')], total: 1, page: 1, page_size: 20 }); await second;
  old.resolve({ items: [paper('paper-1')], total: 1, page: 1, page_size: 20 }); await first;
  assert.equal(state.overview.items[0].paper_id, 'paper-2');
});

test('场次切换后迟到的详情和排名不串场次，当前异常清空旧数据', async (t) => {
  const { state, root, unmount } = await mount(); t.after(unmount);
  const old = deferred();
  context.get = (path, params) => path.endsWith('/summary') && params.paper_id === 'paper-1' ? old.promise : defaultGet(path, params);
  const first = state.openAnalysis(paper('paper-1'));
  await state.openAnalysis(paper('paper-2'));
  old.resolve(summary('paper-1')); await first;
  assert.equal(state.summary.exam.paper_id, 'paper-2');
  state.filters.difficulty = 'easy'; await state.reload();
  const oldRanking = deferred();
  context.get = (path, params) => path.endsWith('/ranking') ? oldRanking.promise : defaultGet(path, params);
  const rankingRequest = state.onRankingPageChange();
  await state.backToOverview();
  oldRanking.resolve(ranks('paper-2')); await rankingRequest;
  assert.equal(state.ranking.items.length, 0);
  context.get = (path, params) => path.endsWith('/summary') ? Promise.reject(new Error('本场次读取失败')) : defaultGet(path, params);
  await state.openAnalysis(paper('paper-1')); await nextTick();
  assert.equal(state.summary, null); assert.equal(state.ranking.items.length, 0);
  assert.match(textContent(root), /本场次读取失败/); assert.doesNotMatch(textContent(root), /新场次考试/);
});

test('空总览与空成绩可展示，缺少导出权限不提供导出入口', async (t) => {
  context.canExport = false;
  context.get = (path, params) => path.endsWith('/overview') ? { items: [], total: 0, page: 1, page_size: 20 } : defaultGet(path, params);
  const { root, state, unmount } = await mount(); t.after(unmount);
  assert.equal(state.overview.items.length, 0);
  context.get = (path, params) => path.endsWith('/summary') ? { ...summary(), score_groups: [], difficulty_composition: [] } : defaultGet(path, params);
  await state.openAnalysis(paper()); state.filters.difficulty = 'easy'; await state.reload(); await nextTick();
  assert.equal(state.summary.score_groups.length, 0); assert.doesNotMatch(textContent(root), /导出当前页排名/);
});

test('统计空状态在表格内部展示插图提示，加载和失败不冒充无数据', async (t) => {
  const { root, state, unmount } = await mount(); t.after(unmount);
  context.get = (path, params) => path.endsWith('/overview') ? { items: [], total: 0, page: 1, page_size: 20 } : defaultGet(path, params);
  await state.loadOverview(); await nextTick();
  const table = findNodes(root, (node) => node.type === 'el-table')[0];
  assert.equal(findNodes(table, (node) => node.type === 'el-empty' && node.props.description === '暂无考试统计').length, 1);
  const pending = deferred(); context.get = () => pending.promise;
  const loading = state.loadOverview(); await nextTick();
  assert.equal(findNodes(table, (node) => node.type === 'el-empty').length, 0);
  pending.reject(new Error('服务器内部错误')); await loading; await nextTick();
  assert.equal(findNodes(table, (node) => node.type === 'el-empty').length, 0);
  assert.match(textContent(root), /服务器内部错误/);
  context.get = (path, params) => path.endsWith('/ranking') ? { items: [], total: 0, page: 1, page_size: 20 }
    : path.endsWith('/summary') ? { ...summary(params.paper_id), score_groups: [] } : defaultGet(path, params);
  await state.openAnalysis(paper()); state.filters.difficulty = 'easy'; await state.reload(); await nextTick();
  const tables = findNodes(root, (node) => node.type === 'el-table');
  assert.equal(tables.flatMap((node) => findNodes(node, (child) => child.type === 'el-empty' && child.props.description === '暂无最终成绩')).length, 1);
  assert.equal(tables.flatMap((node) => findNodes(node, (child) => child.type === 'el-empty' && child.props.description === '该难度暂无最终成绩')).length, 0);
});

test('返回了其他场次的异常详情时显示错误并保持当前场次为空', async (t) => {
  const { root, state, unmount } = await mount(); t.after(unmount);
  context.get = (path, params) => path.endsWith('/summary') ? summary('paper-2') : defaultGet(path, params);
  await state.openAnalysis(paper('paper-1')); await nextTick();
  assert.equal(state.summary, null);
  assert.match(textContent(root), /统计响应与当前场次不一致/);
  assert.doesNotMatch(textContent(root), /新场次考试/);
});

test('真实 ElPagination 在总览翻页加载及详情返回期间保持第三页', async (t) => {
  const { root, state, unmount } = await mount({ realPagination: true }); t.after(unmount);
  const pending = deferred();
  context.get = (path, params) => path.endsWith('/overview') ? pending.promise : defaultGet(path, params);
  const pager = findNodes(root, (node) => node.type === 'ul' && typeof node.props.onClick === 'function')[0];
  assert.ok(pager, 'must mount the real Element Plus pager');
  pager.props.onClick({ target: { tagName: 'LI', textContent: '3', className: 'number' } });
  await nextTick(); await nextTick();
  assert.equal(state.overviewFilters.page, 3, 'loading must not lower total and clamp the active page');
  assert.equal(context.calls.at(-1).params.page, 3);
  pending.resolve({ items: [paper()], total: 60, page: 3, page_size: 20 }); await settle();
  assert.equal(state.overviewFilters.page, 3);
  await state.openAnalysis(paper());
  await state.backToOverview(); await nextTick();
  assert.equal(state.overviewFilters.page, 3, 'returning from analysis must keep the same overview page');
});

test('从列表切换考试使用总览冻结类别并清理上一场局部筛选', async (t) => {
  context.get = (path, params) => {
    if (path.endsWith('/options')) return {
      ...defaultGet(path, params),
      papers: [
        { id: 'paper-1', title: '安全培训考试', category_id: 'category-1', status: 'published' },
        { id: 'paper-2', title: '草稿已换类别的考试', category_id: 'draft-category', status: 'published' },
      ],
    };
    return defaultGet(path, params);
  };
  const { root, state, unmount } = await mount(); t.after(unmount);
  await state.openAnalysis(paper());
  state.filters.source = 'external';
  state.filters.difficulty = 'easy';
  await state.openAnalysis(paper('paper-2')); await settle();
  const query = context.calls.filter(({ path }) => path.endsWith('/summary')).at(-1).params;
  assert.equal(query.paper_id, 'paper-2');
  assert.equal(query.category_id, 'category-1', 'the overview row carries the latest frozen release category');
  assert.equal(query.source, undefined); assert.equal(state.filters.difficulty, 'easy');
  state.filters.category_id = 'category-1'; await state.reload();
  assert.equal(context.calls.filter(({ path }) => path.endsWith('/summary')).at(-1).params.category_id, 'category-1');
});

test('筛选选项首次失败后可在详情重试恢复，保留场次和来源筛选', async (t) => {
  let optionReads = 0;
  context.get = (path, params) => {
    if (path.endsWith('/options') && ++optionReads === 1) throw new Error('筛选选项读取失败');
    return defaultGet(path, params);
  };
  const { root, state, unmount } = await mount(); t.after(unmount);
  await state.openAnalysis(paper());
  state.filters.source = 'external'; await nextTick();
  const alert = findNodes(root, (node) => node.type === 'el-alert' && node.props.title === '筛选选项读取失败')[0];
  assert.ok(alert);
  const retry = findNodes(alert, (node) => node.type === 'el-button')[0];
  await retry.props.onClick(); await nextTick();
  assert.equal(optionReads, 2, 'retry must reload the failed options endpoint as well as summary');
  assert.equal(state.optionsError, ''); assert.equal(state.options.categories[0].id, 'category-1');
  assert.equal(state.filters.paper_id, 'paper-1'); assert.equal(state.filters.source, 'external');
});
