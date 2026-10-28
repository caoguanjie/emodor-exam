import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { ExamPaper } = require('./dist/entities/exam-paper.entity.js');
const { ExamAssignment } = require('./dist/entities/exam-assignment.entity.js');
const { ExamRecord } = require('./dist/entities/exam-record.entity.js');
const { ExamAnswer } = require('./dist/entities/exam-answer.entity.js');
const { ExamRecordQuestion } = require('./dist/entities/exam-record-question.entity.js');
const { PaperRelease } = require('./dist/entities/paper-release.entity.js');
const { PaperReleaseQuestion } = require('./dist/entities/paper-release-question.entity.js');
const { Question } = require('./dist/entities/question.entity.js');
const { QuestionVersion } = require('./dist/entities/question-version.entity.js');
const { TrainingCategory } = require('./dist/entities/training-category.entity.js');
const { SysUser } = require('./dist/entities/sys-user.entity.js');
const { LearnerIdentity } = require('./dist/entities/learner-identity.entity.js');
const { CategoryService } = require('./dist/modules/training/category.service.js');
const { QuestionVersionService } = require('./dist/modules/questions/question-version.service.js');
const { PaperReleaseService } = require('./dist/modules/exams/paper-release.service.js');
const { SamplingService } = require('./dist/modules/exams/sampling.service.js');
const { ShuffleService } = require('./dist/modules/exams/shuffle.service.js');
const { AttemptReaderService } = require('./dist/modules/exams/attempt-reader.service.js');
const { AttemptService } = require('./dist/modules/exams/attempt.service.js');
const { SubmissionService } = require('./dist/modules/exams/submission.service.js');
const { ExamHistoryService } = require('./dist/modules/exams/exam-history.service.js');

function deferred() {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return { promise, resolve };
}

async function bounded(promise, label, milliseconds = 10000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

const capture = promise => promise.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));

function servicesFor(source) {
  const repo = entity => source.getRepository(entity);
  const audit = { log() {} }, media = { async bind() {} }, access = { async permissions() { return []; } };
  const categories = Object.assign(Object.create(CategoryService.prototype), { categoryRepo: repo(TrainingCategory) });
  const questions = Object.assign(Object.create(QuestionVersionService.prototype), { versionRepo: repo(QuestionVersion), categories });
  const sampling = new SamplingService();
  const releases = Object.assign(Object.create(PaperReleaseService.prototype), {
    paperRepo: repo(ExamPaper), releaseRepo: repo(PaperRelease), releaseQuestionRepo: repo(PaperReleaseQuestion),
    dataSource: source, categories, questions, sampling, audit,
  });
  const reader = new AttemptReaderService(repo(ExamRecord), repo(ExamRecordQuestion), repo(ExamAnswer), media, source, access);
  const attempts = new AttemptService(repo(ExamAssignment), repo(ExamRecord), repo(ExamRecordQuestion), repo(ExamPaper), repo(SysUser),
    source, releases, sampling, new ShuffleService({ examShuffleSecret: randomBytes(32).toString('hex') }), questions, {}, reader,
    media, { async set() {} }, audit);
  const history = new ExamHistoryService(repo(ExamRecord), repo(ExamAnswer), repo(ExamRecordQuestion), repo(ExamPaper), reader, access, media, source);
  const submissions = new SubmissionService(source, {}, reader, history, {}, audit);
  return { releases, attempts, submissions };
}

async function seed(source, services, retake) {
  const repo = entity => source.getRepository(entity);
  const user = await repo(SysUser).save(repo(SysUser).create({
    username: `race_${randomBytes(6).toString('hex')}`, passwordHash: 'unusable-test-fixture', realName: '并发测试',
    role: 'employee', source: 'institution', status: 1,
  }));
  await repo(LearnerIdentity).save(repo(LearnerIdentity).create({ userId: String(user.id),
    idFingerprint: randomBytes(32).toString('hex'), identityEncrypted: 'isolated-fixture-only',
    sessionId: randomUUID(), providerRequestId: 'isolated-fixture-only' }));
  const category = await repo(TrainingCategory).save(repo(TrainingCategory).create({ name: `race_${user.id}`, createdBy: user.id }));
  for (const difficulty of ['easy', 'hard']) for (let index = 0; index < 2; index++) {
    const facts = { categoryId: String(category.id), difficulty, type: 'single', stem: `并发题${difficulty}${index}`,
      options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [0], analysis: '冻结解析',
      source: 'manual', status: 'approved', createdBy: String(user.id) };
    const question = await repo(Question).save(repo(Question).create({ ...facts, isEnabled: true }));
    const version = await repo(QuestionVersion).save(repo(QuestionVersion).create({ ...facts, questionId: String(question.id), revision: 1 }));
    await repo(Question).update(question.id, { currentVersionId: String(version.id) });
  }
  const firstRule = { totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: null,
    partialCreditRatio: 0.5, rules: [{ type: 'single', count: 1, scoreCents: 10000 }] };
  const paper = await repo(ExamPaper).save(repo(ExamPaper).create({
    title: `模拟并发${user.id}`, businessScope: 'training', examPurpose: 'practice', mode: 'random', poolScope: 'public',
    categoryId: null, requiresLearning: 0, ruleConfig: firstRule, courseIds: [], regulationIds: [],
    totalScore: '100.00', passScore: '60.00', durationMinutes: 30, maxAttempts: null, partialCreditRatio: '0.50',
    status: 'draft', createdBy: String(user.id),
  }));
  const first = await services.releases.publish(String(paper.id), String(user.id));
  if (retake) {
    const attempt = await services.attempts.start(String(user.id), String(paper.id), true, 2, first.releaseId);
    await services.submissions.submit(String(user.id), attempt.record_id,
      { record_id: attempt.record_id, answers: attempt.questions.map(item => ({ item_id: item.item_id, option_ids: [] })) });
    // Subsequent retakes must retain the first assignment's source and difficulty.
    await repo(SysUser).update(user.id, { source: 'external' });
  }
  await services.releases.withdraw(String(paper.id), String(user.id));
  const nextRule = { ...firstRule, totalCents: 12000, passCents: 7200, durationMinutes: 45,
    rules: [{ type: 'single', count: 2, scoreCents: 6000 }] };
  await repo(ExamPaper).update(paper.id, { ruleConfig: nextRule, totalScore: '120.00', passScore: '72.00', durationMinutes: 45 });
  return { userId: String(user.id), paperId: String(paper.id), firstReleaseId: first.releaseId, nextRule };
}

async function counts(source, fixture) {
  const [row] = await source.query(`SELECT
    (SELECT COUNT(*) FROM exam_assignment WHERE paper_id=? AND user_id=?) AS assignments,
    (SELECT COUNT(*) FROM exam_record WHERE paper_id=? AND user_id=?) AS records,
    (SELECT COUNT(*) FROM exam_record_question item INNER JOIN exam_record record ON record.id=item.record_id WHERE record.paper_id=? AND record.user_id=?) AS items`,
  [fixture.paperId, fixture.userId, fixture.paperId, fixture.userId, fixture.paperId, fixture.userId]);
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

/** Both real services use independent single-connection pools; only publication's commit is gated. */
export async function practiceStartPublishRace(mysql, database, query, { retake = false } = {}) {
  assert.match(database, /^ruleexam_test_[a-z0-9_]+$/);
  const options = { type: 'mysql', host: mysql.host, port: mysql.port, username: mysql.user, password: mysql.password,
    database, charset: 'utf8mb4_0900_ai_ci', timezone: 'Z',
    entities: [fileURLToPath(new URL('../../server/dist/entities/*.entity.js', import.meta.url))],
    synchronize: false, logging: false, extra: { connectionLimit: 1 } };
  const publisherSource = new DataSource(options), starterSource = new DataSource(options);
  const staged = deferred(), allowCommit = deferred();
  let publishing, starting;
  try {
    await publisherSource.initialize(); await starterSource.initialize();
    for (const source of [publisherSource, starterSource]) {
      await source.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await source.query('SET SESSION innodb_lock_wait_timeout=10');
    }
    const [publisher] = await publisherSource.query('SELECT CONNECTION_ID() AS id, @@transaction_isolation AS isolation');
    const [starter] = await starterSource.query('SELECT CONNECTION_ID() AS id, @@transaction_isolation AS isolation');
    assert.notEqual(publisher.id, starter.id);
    assert.equal(publisher.isolation, 'REPEATABLE-READ'); assert.equal(starter.isolation, 'REPEATABLE-READ');
    const publishService = servicesFor(publisherSource), startService = servicesFor(starterSource);
    const fixture = await seed(publisherSource, publishService, retake);
    const before = await counts(publisherSource, fixture);
    const assignmentBefore = await publisherSource.getRepository(ExamAssignment).findOne({ where: { paperId: fixture.paperId, userId: fixture.userId } });
    publishService.releases.dataSource = { transaction: work => publisherSource.transaction(async manager => {
      const result = await work(manager);
      staged.resolve();
      await allowCommit.promise;
      return result;
    }) };
    publishing = capture(publishService.releases.publish(fixture.paperId, fixture.userId));
    await bounded(staged.promise, 'publication did not stage v2 while holding the paper lock');
    starting = capture(startService.attempts.start(fixture.userId, fixture.paperId, true, 2, fixture.firstReleaseId));
    const deadline = Date.now() + 8000;
    let paperLockWaits = 0;
    while (Date.now() < deadline) {
      const [row] = await query(`SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits wait_row
        INNER JOIN performance_schema.threads thread_row ON thread_row.THREAD_ID=wait_row.REQUESTING_THREAD_ID
        INNER JOIN performance_schema.data_locks lock_row ON lock_row.ENGINE_LOCK_ID=wait_row.REQUESTING_ENGINE_LOCK_ID
        WHERE thread_row.PROCESSLIST_ID=? AND lock_row.OBJECT_SCHEMA=? AND lock_row.OBJECT_NAME='exam_paper'`, [starter.id, database]);
      paperLockWaits = Number(row.count);
      if (paperLockWaits > 0) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(paperLockWaits > 0, 'start must block on the exact paper lock before publication commits');
    allowCommit.resolve();
    const [publication, staleStart] = await bounded(Promise.all([publishing, starting]), 'start/publication race stalled after commit');
    assert.equal(publication.status, 'fulfilled', 'real v2 publication must commit');
    const afterStale = await counts(publisherSource, fixture);
    const nextStart = await capture(startService.attempts.start(fixture.userId, fixture.paperId, true, 2, publication.value.releaseId));
    const afterLatest = await counts(publisherSource, fixture);
    const latestRecord = nextStart.status === 'fulfilled' ? await publisherSource.getRepository(ExamRecord).findOne({ where: { id: nextStart.value.record_id } }) : null;
    const assignmentAfter = await publisherSource.getRepository(ExamAssignment).findOne({ where: { paperId: fixture.paperId, userId: fixture.userId } });
    return { connectionIds: [publisher.id, starter.id], isolation: starter.isolation, paperLockWaits,
      fixture, before, afterStale, afterLatest, staleStart, nextStart, nextReleaseId: publication.value.releaseId,
      latestRecord, assignmentBefore, assignmentAfter };
  } finally {
    allowCommit.resolve();
    await Promise.allSettled([publishing, starting].filter(Boolean));
    for (const source of [starterSource, publisherSource]) if (source.isInitialized) await source.destroy();
  }
}
