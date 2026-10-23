import { createApp, h } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import '../../src/style.css';
import TrainingStatistics from '../../src/views/admin/TrainingStatistics.vue';
import http from '../../src/api/http';
import { useAuthStore } from '../../src/stores/auth';
import type { ExamDifficulty, RankRow, TrainingExamOverviewRow, TrainingExamSummary } from '../../src/api/training-types';

// Browser-only fixture: no backend requests, credentials or persistent identity changes.
const papers: TrainingExamOverviewRow[] = [
  { paper_id: '101', title: '2026 年安全生产培训考试', category_id: '1', category_name: '安全生产', status: 'published', release_id: 'release-101', total_score: 100, duration_minutes: 45, pass_score: 60, participant_count: 48, finalized_users: 42, average_score: 78.25 },
  { paper_id: '102', title: '消防安全基础知识考核', category_id: '2', category_name: '消防安全', status: 'published', release_id: 'release-102', total_score: 100, duration_minutes: 30, pass_score: 60, participant_count: 26, finalized_users: 24, average_score: 82.5 },
  { paper_id: '103', title: '应急处置专项培训考试', category_id: '1', category_name: '安全生产', status: 'draft', release_id: null, total_score: null, duration_minutes: null, pass_score: null, participant_count: 0, finalized_users: 0, average_score: null },
];
const categories = [{ id: '1', name: '安全生产' }, { id: '2', name: '消防安全' }];
const difficultyNames: ExamDifficulty[] = ['easy', 'medium', 'hard'];
const allRanks: RankRow[] = Array.from({ length: 48 }, (_, index) => ({
  rank: index < 2 ? 1 : index + 1,
  user_id: String(index + 1), name: ['张明', '李晓梅', '陈志强', '王敏', '赵立新', '刘芳'][index % 6] + (index >= 6 ? ` ${index + 1}` : ''),
  gender: index % 5 === 0 ? null : index % 2 ? 'female' : 'male',
  source: index % 3 ? 'institution' : 'external', difficulty: 'easy',
  score: index < 2 ? 98 : Math.max(0, 96 - index),
  duration_seconds: 120 + ((index * 137) % 1200), record_id: String(1000 + index),
}));
function getSummary(paper: TrainingExamOverviewRow): TrainingExamSummary {
  const { paper_id, title, category_id, total_score, duration_minutes, pass_score } = paper;
  return {
    exam: { paper_id, title, category_id, total_score, duration_minutes, pass_score, excellent_score: null },
    release_id: paper.release_id, eligible_count: 50, eligible_started_count: paper.participant_count,
    historical_started_count: paper.participant_count, historical_only_started_count: 0,
    submitted_attempts: paper.finalized_users + 3, submitted_users: paper.finalized_users,
    finalized_users: paper.finalized_users, participation_rate: paper.participant_count / 50,
    score_groups: paper.release_id ? difficultyNames.map((difficulty, index) => ({
      difficulty, finalized_users: [18, 16, 8][index], average_score: [83.5, 77.25, 68.5][index],
      highest_score: [98, 95, 88][index], lowest_score: [54, 40, 35][index],
      passed_users: [17, 14, 5][index], average_duration_seconds: [678, 824, 1126][index],
      excellent_users: null, pass_rate: [17 / 18, 14 / 16, 5 / 8][index],
      distribution: [0, 20, 40, 60, 80].map((lower, bucket) => ({ lower, upper: lower + 20, count: [0, 1, 2, 5, 10][bucket] })),
    })) : [],
    difficulty_composition: paper.release_id ? difficultyNames.map((difficulty, index) => ({ difficulty, users: [20, 18, 10][index] })) : [],
    course_completion: { eligible_users: 36, required_lessons: 4, completed_users: 30, completion_rate: 30 / 36 },
    uncompleted_reasons: [{ reason: 'learning_incomplete', users: 6 }, { reason: 'not_started', users: 2 }, { reason: 'not_passed', users: 6 }],
    as_of: '2026-10-23T08:30:00Z',
  };
}
const parameters = new URLSearchParams(window.location.search);
const fixtureCalls: Array<{ path: string; params: Record<string, unknown> }> = [];
Object.assign(window, { trainingStatisticsFixtureCalls: fixtureCalls });
http.defaults.adapter = async (config) => {
  const path = String(config.url);
  const params = config.params || {};
  fixtureCalls.push({ path, params: { ...params } });
  let data: unknown;
  if (path.endsWith('/options')) {
    data = { papers: papers.map(({ paper_id, ...paper }) => ({ ...paper, id: paper_id })), categories };
  } else if (path.endsWith('/overview')) {
    const filtered = papers.filter((paper) => (!params.keyword || paper.title.includes(params.keyword)) && (!params.category_id || paper.category_id === params.category_id));
    const page = Number(params.page) || 1;
    const pageSize = Number(params.page_size) || 20;
    data = { items: parameters.has('empty') ? [] : filtered.slice((page - 1) * pageSize, page * pageSize), total: parameters.has('empty') ? 0 : filtered.length, page, page_size: pageSize };
  } else if (path.endsWith('/summary')) {
    if (parameters.has('error')) throw new Error('视觉夹具：模拟场次读取失败');
    data = getSummary(papers.find((paper) => paper.paper_id === params.paper_id) || papers[0]);
  } else if (path.endsWith('/ranking')) {
    const rows = allRanks.filter((row) => !params.source || row.source === params.source).map((row) => ({ ...row, difficulty: params.difficulty }));
    if (params.sort_by) {
      const key = params.sort_by === 'duration' ? 'duration_seconds' : 'score';
      const direction = params.sort_order === 'asc' ? 1 : -1;
      rows.sort((a, b) => direction * (a[key] - b[key]));
    }
    const page = Number(params.page) || 1;
    const pageSize = Number(params.page_size) || 20;
    data = { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, page_size: pageSize };
  } else if (path.endsWith('/export')) {
    // The fixture checks the query only; it does not manufacture a fake Excel file.
    throw new Error('视觉夹具：导出参数已记录，真实 Excel 需后端验收');
  } else throw new Error(`视觉夹具不允许请求 ${path}`);
  return { config, data: { code: 0, message: 'ok', data }, status: 200, statusText: 'OK', headers: {} };
};
const pinia = createPinia();
const auth = useAuthStore(pinia);
auth.$patch({ accessToken: '', user: { id: 0, username: 'visual-fixture', real_name: '视觉夹具', employee_no: null, department_id: null, role: 'regulation_admin', permissions: parameters.has('no-export') ? ['statistics:read'] : ['statistics:read', 'statistics:export'] } });
createApp({ render: () => h('div', { style: 'padding:24px;min-width:900px' }, [h(TrainingStatistics)]) }).use(pinia).use(ElementPlus, { locale: zhCn }).mount('#app');
