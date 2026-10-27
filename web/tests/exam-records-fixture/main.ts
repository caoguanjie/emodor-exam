import { createApp, h } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHashHistory, RouterView } from 'vue-router';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import '../../src/style.css';
import ExamRecords from '../../src/views/admin/ExamRecords.vue';
import ExamRecordDetail from '../../src/views/admin/ExamRecordDetail.vue';
import http from '../../src/api/http';

// Static synthetic records for visual acceptance; all HTTP stays in this adapter.
const papers = [{ id: '101', title: '安全生产培训考试' }, { id: '102', title: '消防安全知识考核' }];
const categories = [{ id: '1', name: '建筑工人' }, { id: '2', name: '产业工人' }];
const base = {
  paper_id: '101', paper_title: papers[0].title, category_id: '1', category_name: categories[0].name,
  source: 'institution', difficulty: 'easy', release_id: '201', attempt_no: 1,
  started_at: '2026-10-27T01:00:00Z', deadline_at: '2026-10-27T01:30:00Z',
  submitted_at: '2026-10-27T01:18:00Z', answered_count: 20, total_count: 20,
  grading_state: 'finalized', submission_method: 'manual', score: 86, total_score: 100,
};
const records = [
  { ...base, record_id: '301', user_id: '11', name: '示例学员甲', username: 'demo-a', status: 'passed', result_status: 'passed', attempt_no: 2 },
  { ...base, record_id: '302', user_id: '12', name: '示例学员乙', username: 'demo-b', status: 'timeout', result_status: 'timeout', score: 0, grading_state: 'not_submitted', submitted_at: null, submission_method: null, answered_count: 0 },
  { ...base, record_id: '303', user_id: '13', name: '示例学员丙', username: 'demo-c', status: 'in_progress', result_status: 'in_progress', score: null, grading_state: 'not_submitted', submitted_at: null, submission_method: null, answered_count: 0 },
  { ...base, record_id: '304', user_id: '14', name: '示例学员丁', username: 'demo-d', status: 'failed', result_status: 'failed', score: 0 },
];
http.defaults.adapter = async (config) => {
  const path = String(config.url);
  const params = config.params || {};
  let data: unknown;
  if (path === '/admin/exam-records/options') data = { papers, categories };
  else if (path === '/admin/exam-records') {
    const rows = records.filter(row => (!params.paper_id || row.paper_id === params.paper_id)
      && (!params.user_id || row.user_id === params.user_id)
      && (!params.category_id || row.category_id === params.category_id)
      && (!params.result_status || row.result_status === params.result_status)
      && (!params.difficulty || row.difficulty === params.difficulty)
      && (!params.keyword || `${row.name} ${row.username} ${row.paper_title}`.includes(params.keyword)));
    data = { items: rows, total: rows.length, page: 1, page_size: 20 };
  } else {
    const match = path.match(/^\/admin\/exam-records\/(\d+)(\/result)?$/);
    const row = records.find(record => record.record_id === match?.[1]);
    if (!row) throw new Error(`视觉验收不允许请求 ${path}`);
    data = match?.[2] ? {
      record_id: row.record_id, status: row.status, grading_state: row.grading_state,
      submission_method: row.submission_method, legacy: false,
      submitted_at: row.submitted_at, graded_at: row.submitted_at, score: row.score,
      passed: row.status === 'passed', correct_rate: row.score === null ? null : row.score / 100,
      items: row.result_status === 'passed' ? [{
        item_id: '401', type: 'single', score: 5, content_schema_version: 2,
        stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '进入施工现场时，应当如何佩戴安全帽？' }] }] },
        options: [
          { id: 'A', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '正确佩戴并系好帽带' }] }] } },
          { id: 'B', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '拿在手中即可' }] }] } },
        ],
        selected_option_ids: ['A'], correct_option_ids: ['A'], gained_score: 5,
        analysis: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '安全帽应正确佩戴并系紧帽带。' }] }] },
      }] : [],
    } : row;
  }
  return { config, data: { code: 0, message: 'ok', data }, status: 200, statusText: 'OK', headers: {} };
};
const router = createRouter({ history: createWebHashHistory(), routes: [
  { path: '/', redirect: '/admin/exam-records' },
  { path: '/admin/exam-records', component: ExamRecords },
  { path: '/admin/exam-records/:id', component: ExamRecordDetail },
] });
createApp({ render: () => h('main', { style: 'padding:24px;min-height:100vh;background:#f5f7fb' }, [
  h('p', { style: 'margin:0 0 16px;color:#64748b;font-size:13px' }, '考试记录布局验收 · 以下均为虚构测试数据'),
  h(RouterView),
]) }).use(createPinia()).use(router).use(ElementPlus, { locale: zhCn }).mount('#app');
