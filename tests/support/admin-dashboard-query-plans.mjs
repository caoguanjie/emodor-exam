import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
require('reflect-metadata');
const { DataSource } = require('typeorm');
const compiled = relative => require(fileURLToPath(new URL(`../../server/dist/${relative}`, import.meta.url)));
const { AdminDashboardService } = compiled('modules/statistics/admin-dashboard.service.js');
const { ExamRecord } = compiled('entities/exam-record.entity.js');
const { ExamPaper } = compiled('entities/exam-paper.entity.js');
const { SysUser } = compiled('entities/sys-user.entity.js');

/** Capture production SELECTs against this runner's database, then explain those exact statements. */
export async function captureDashboardQueryPlans(ctx, fixture, { releaseId = fixture.learningPaper.releaseId, scenario = 'normal' } = {}) {
  assert.match(ctx.env.DB_DATABASE, /^ruleexam_test_[A-Za-z0-9_]+$/);
  assert.ok(['normal', 'perf'].includes(scenario));
  let captured = [];
  const logger = {
    logQuery(sql, parameters) {
      if (/^\s*SELECT\b/i.test(sql)) captured.push({ sql, parameters: structuredClone(parameters || []) });
    },
    logQueryError() {}, logQuerySlow() {}, logSchemaBuild() {}, logMigration() {}, log() {},
  };
  const source = new DataSource({
    type: 'mysql', host: ctx.env.DB_HOST, port: Number(ctx.env.DB_PORT), username: ctx.env.DB_USERNAME,
    password: ctx.env.DB_PASSWORD, database: ctx.env.DB_DATABASE, timezone: 'Z',
    supportBigNumbers: true, bigNumberStrings: true,
    entities: [ExamRecord, ExamPaper, SysUser], logging: ['query'], logger,
  });
  try {
    await source.initialize();
    const [version] = await source.query('SELECT VERSION() AS version');
    // Only this diagnostic instance substitutes authorization. HTTP checks use the real guard and roles.
    const service = new AdminDashboardService(source, { permissions: async () => ['statistics:read'] });
    const calls = [
      ['exam-trend-30', () => service.examTrend(fixture.admin.userId, 30)],
      ['learning-options', () => service.learningOptions(fixture.admin.userId, {})],
      ['learning-summary', () => service.learningSummary(fixture.admin.userId, fixture.learningPaper.id, String(releaseId))],
      ['recent-exams', () => service.recentExams(fixture.admin.userId)],
    ];
    const queries = [];
    for (const [endpoint, call] of calls) {
      captured = [];
      await call();
      const statements = captured;
      assert.ok(statements.length > 0, `${endpoint}: production SELECT capture must not be empty`);
      for (const [index, entry] of statements.entries()) {
        assert.doesNotMatch(entry.sql, /\b(?:exam_answer|exam_record_question|password_hash|access_token|refresh_token)\b/i);
        const plan = await source.query(`EXPLAIN ${entry.sql}`, entry.parameters);
        const name = `${endpoint}.${index + 1}`;
        queries.push({ name, ...entry, plan });
        console.log(`[admin-dashboard:explain:${scenario}] ${name} ${JSON.stringify(plan.map(row => ({
          table: row.table, access: row.type, key: row.key, rows: Number(row.rows || 0), extra: row.Extra,
        })))}`);
      }
    }
    const reportPath = path.join(tmpdir(), `ruleexam-dashboard-query-plans-${scenario}-${ctx.env.DB_DATABASE}.json`);
    await writeFile(reportPath, JSON.stringify({
      captured_at: new Date().toISOString(), scenario, database: ctx.env.DB_DATABASE,
      node: process.version, mysql: version.version, queries,
    }, null, 2));
    console.log(`[admin-dashboard:explain:${scenario}] node=${process.version} mysql=${version.version} report=${reportPath}`);
    return { reportPath, queries };
  } finally {
    if (source.isInitialized) await source.destroy();
  }
}
