// Run npm --prefix server run build before this real-MySQL service regression.
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createEphemeralServices } from './support/ephemeral-services.mjs';
import { renderSchemaForDatabase } from './support/test-target.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
require('reflect-metadata');
const mysql = require('mysql2/promise');
const { DataSource } = require('typeorm');
const names = ['ExamPaper', 'PaperQuestion', 'PaperRelease', 'PaperReleaseQuestion', 'Question', 'QuestionVersion', 'TrainingCategory', 'TrainingCourse', 'Regulation', 'RegulationVersion', 'MediaAsset', 'MediaReference'];
const entity = Object.fromEntries(names.map(name => [name, require(`./dist/entities/${name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}.entity.js`)[name]]));
const { CategoryService } = require('./dist/modules/training/category.service.js');
const { QuestionVersionService } = require('./dist/modules/questions/question-version.service.js');
const { PaperReleaseService } = require('./dist/modules/exams/paper-release.service.js');
const { SamplingService } = require('./dist/modules/exams/sampling.service.js');
let services, admin;
const databases = new Set();

before(async () => {
  services = await createEphemeralServices();
  admin = await mysql.createConnection({ ...services.mysql, multipleStatements: true });
});
after(async () => {
  try {
    for (const database of databases) await admin?.query(`DROP DATABASE IF EXISTS \`${database}\``);
  } finally {
    await admin?.end();
    await services?.stopProcesses();
    await services?.cleanup();
  }
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 8000); })]);
  } finally { clearTimeout(timer); }
}

// Repository wrappers only control scheduling. Every lock, read, write and
// transaction is executed by the real TypeORM manager on its real connection.
function observeQuestionLocks(source, hook) {
  const create = source.createQueryRunner.bind(source);
  source.createQueryRunner = (...args) => {
    const runner = create(...args), getRepository = runner.manager.getRepository.bind(runner.manager);
    runner.manager.getRepository = target => {
      const repo = getRepository(target);
      if (target !== entity.Question) return repo;
      return new Proxy(repo, { get(object, key) {
        if (key !== 'findOne') return Reflect.get(object, key);
        return async options => {
          const row = await object.findOne(options);
          if (options.lock?.mode === 'pessimistic_write') await hook(String(options.where.id), row);
          return row;
        };
      } });
    };
    return runner;
  };
}

function publisher(source) {
  const categories = Object.create(CategoryService.prototype);
  categories.categoryRepo = source.getRepository(entity.TrainingCategory);
  const questions = Object.create(QuestionVersionService.prototype);
  Object.assign(questions, { versionRepo: source.getRepository(entity.QuestionVersion), categories, dataSource: source });
  const service = Object.create(PaperReleaseService.prototype);
  Object.assign(service, {
    dataSource: source, categories, questions, sampling: new SamplingService(), audit: { log() {} },
    paperRepo: source.getRepository(entity.ExamPaper), releaseRepo: source.getRepository(entity.PaperRelease),
    releaseQuestionRepo: source.getRepository(entity.PaperReleaseQuestion),
  });
  return service;
}

async function fixture(mixedTypes = false) {
  const database = `ruleexam_test_public_publish_${randomBytes(5).toString('hex')}`;
  databases.add(database);
  await admin.query(renderSchemaForDatabase(await readFile(new URL('../database/init.sql', import.meta.url), 'utf8'), database));
  const options = { type: 'mysql', host: services.mysql.host, port: services.mysql.port,
    username: services.mysql.user, password: services.mysql.password, database,
    charset: 'utf8mb4_0900_ai_ci', timezone: 'Z', entities: Object.values(entity), synchronize: false,
    logging: false, extra: { connectionLimit: 1 } };
  const a = new DataSource(options), b = new DataSource(options);
  try {
    await a.initialize(); await b.initialize();
    await a.query('SET SESSION innodb_lock_wait_timeout = 5');
    await b.query('SET SESSION innodb_lock_wait_timeout = 5');
    const [ca] = await a.query('SELECT CONNECTION_ID() id'), [cb] = await b.query('SELECT CONNECTION_ID() id');
    assert.notEqual(ca.id, cb.id);
    await a.getRepository(entity.TrainingCategory).save({ id: '7', name: '并发题库', status: 1, createdBy: '9' });
    const questionFacts = mixedTypes
      ? [['1', 'hard', 'single'], ['2', 'hard', 'multiple'], ['3', 'easy', 'single'], ['4', 'easy', 'multiple']]
      : [['1', 'hard', 'single'], ['2', 'easy', 'single']];
    for (const [id, difficulty, type] of questionFacts) {
      const facts = { categoryId: '7', difficulty, type, stem: `题目${id}`,
        options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: type === 'multiple' ? [0, 1] : [0], analysis: null,
        source: 'manual', status: 'approved', createdBy: '9', contentSchemaVersion: 1 };
      await a.getRepository(entity.Question).save({ id, ...facts, isEnabled: true, currentVersionId: null });
      const version = await a.getRepository(entity.QuestionVersion).save({ ...facts, questionId: id, revision: 1 });
      await a.getRepository(entity.Question).update(id, { currentVersionId: version.id });
      await a.getRepository(entity.PaperQuestion).save({ paperId: '12', questionId: id, questionVersionId: version.id, score: mixedTypes ? '25.00' : '50.00', sort: Number(id) });
    }
    const strategy = { totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5, rules: [{ type: 'single', count: 1, scoreCents: 10000 }] };
    if (mixedTypes) strategy.rules = [{ type: 'multiple', count: 1, scoreCents: 5000 }, { type: 'single', count: 1, scoreCents: 5000 }];
    for (const [id, mode, poolScope, categoryId] of [['11', 'random', 'public', null], ['12', 'fixed', 'category', '7']]) {
      await a.getRepository(entity.ExamPaper).save({ id, title: `并发发布${id}`, businessScope: 'training', mode, poolScope, categoryId,
        status: 'draft', totalScore: '100.00', passScore: '60.00', durationMinutes: 30, maxAttempts: 3,
        partialCreditRatio: '0.50', requiresLearning: 0, ruleConfig: strategy, createdBy: '9' });
    }
    return { a, b, database, aId: ca.id, bId: cb.id, random: publisher(a), fixed: publisher(b),
      close: async () => { await a.destroy(); await b.destroy(); } };
  } catch (error) {
    if (a.isInitialized) await a.destroy();
    if (b.isInitialized) await b.destroy();
    throw error;
  }
}

async function waitForBlockedQuestion(f, requesterId, blockerId) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const [rows] = await admin.query(`SELECT requested.LOCK_DATA FROM performance_schema.data_lock_waits waits
      JOIN performance_schema.threads requester ON requester.THREAD_ID=waits.REQUESTING_THREAD_ID
      JOIN performance_schema.threads blocker ON blocker.THREAD_ID=waits.BLOCKING_THREAD_ID
      JOIN performance_schema.data_locks requested ON requested.ENGINE_LOCK_ID=waits.REQUESTING_ENGINE_LOCK_ID
      WHERE requester.PROCESSLIST_ID=? AND blocker.PROCESSLIST_ID=?
        AND requested.OBJECT_SCHEMA=? AND requested.OBJECT_NAME='question'`, [requesterId, blockerId, f.database]);
    if (rows.length) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('did not observe the intended real question-lock wait');
}

for (const mixedTypes of [false, true]) test(`public random and fixed publication share global question order without reversing category locks (mixed types: ${mixedTypes})`, async () => {
  const f = await fixture(mixedTypes), randomLocked = deferred(), resumeRandom = deferred();
  const randomOrder = [], fixedOrder = [];
  let randomRun, fixedRun;
  observeQuestionLocks(f.a, async id => {
    randomOrder.push(id);
    if (randomOrder.length === 1) { randomLocked.resolve(); await bounded(resumeRandom.promise, 'random publication was not resumed'); }
  });
  observeQuestionLocks(f.b, async id => { fixedOrder.push(id); });
  try {
    randomRun = f.random.publish('11', '9').then(value => ({ value }), error => ({ error }));
    await bounded(randomLocked.promise, 'random publication did not acquire its first question');
    fixedRun = f.fixed.publish('12', '9').then(value => ({ value }), error => ({ error }));
    await waitForBlockedQuestion(f, f.bId, f.aId);
    // Fixed publication holds its category before waiting on the public pool.
    // If public publication adds a category lock after a question, this cycles.
    const [categoryLocks] = await admin.query(`SELECT thread.PROCESSLIST_ID AS connection_id
      FROM performance_schema.data_locks locks JOIN performance_schema.threads thread ON thread.THREAD_ID=locks.THREAD_ID
      WHERE locks.OBJECT_SCHEMA=? AND locks.OBJECT_NAME='training_category' AND locks.LOCK_STATUS='GRANTED'
        AND locks.LOCK_TYPE='RECORD'`, [f.database]);
    assert.ok(categoryLocks.some(row => Number(row.connection_id) === Number(f.bId)));
    assert.ok(categoryLocks.every(row => Number(row.connection_id) !== Number(f.aId)));
    resumeRandom.resolve();
    const results = await bounded(Promise.all([randomRun, fixedRun]), 'concurrent publications stalled');
    assert.deepEqual(results.filter(row => row.error).map(row => ({ code: row.error.driverError?.code, message: row.error.message })), [], 'both real transactions must publish without a deadlock or retry');
    const expectedOrder = mixedTypes ? ['1', '2', '3', '4'] : ['1', '2'];
    assert.deepEqual([...new Set(randomOrder)], expectedOrder);
    assert.deepEqual([...new Set(fixedOrder)], expectedOrder);
    const releases = await f.a.getRepository(entity.PaperRelease).find({ order: { paperId: 'ASC' } });
    assert.deepEqual(releases.map(row => [row.paperId, row.poolScope, row.versionNo]), [['11', 'public', 1], ['12', 'category', 1]]);
    const frozen = await f.a.getRepository(entity.PaperReleaseQuestion).find();
    assert.equal(frozen.length, mixedTypes ? 8 : 4);
    assert.deepEqual((await f.a.getRepository(entity.ExamPaper).find({ order: { id: 'ASC' } })).map(row => row.status), ['published', 'published']);
  } finally {
    resumeRandom.resolve();
    await Promise.allSettled([randomRun, fixedRun].filter(Boolean));
    await f.close();
  }
});

for (const change of ['disable', 'delete', 'revise']) test(`public publication rechecks a candidate changed after collection: ${change}`, async () => {
  const f = await fixture(), firstLocked = deferred(), resume = deferred();
  let publishing;
  observeQuestionLocks(f.a, async id => {
    if (id === '1') { firstLocked.resolve(); await bounded(resume.promise, 'candidate publication was not resumed'); }
  });
  try {
    publishing = f.random.publish('11', '9').then(value => ({ value }), error => ({ error }));
    await bounded(firstLocked.promise, 'publication did not finish collecting its candidate groups');
    // A real category -> question lifecycle transaction changes Q2 while the
    // public publication holds Q1. It must complete, not wait on a reverse lock.
    await bounded(f.b.transaction(async manager => {
      await manager.findOne(entity.TrainingCategory, { where: { id: '7' }, lock: { mode: 'pessimistic_write' } });
      const repo = manager.getRepository(entity.Question);
      const question = await repo.findOne({ where: { id: '2' }, lock: { mode: 'pessimistic_write' } });
      if (change === 'disable') question.isEnabled = false;
      if (change === 'delete') question.deletedAt = new Date();
      if (change === 'revise') {
        const versions = manager.getRepository(entity.QuestionVersion);
        const previous = await versions.findOneByOrFail({ id: question.currentVersionId });
        const revised = await versions.save({ ...previous, id: undefined, revision: 2, stem: '并发修订题面' });
        question.currentVersionId = revised.id;
        question.stem = revised.stem;
      }
      await repo.save(question);
    }), 'category-before-question lifecycle transaction was blocked by public publication');
    resume.resolve();
    const result = await bounded(publishing, 'candidate recheck stalled');
    assert.equal(result.error?.code, 40971);
    assert.deepEqual(result.error.data.deficits, [{ difficulty: 'easy', type: 'single', required: 1, available: 0 }]);
    assert.equal(await f.a.getRepository(entity.PaperRelease).countBy({ paperId: '11' }), 0);
    assert.equal(await f.a.getRepository(entity.PaperReleaseQuestion).count(), 0);
    assert.equal((await f.a.getRepository(entity.ExamPaper).findOneByOrFail({ id: '11' })).status, 'draft');
  } finally {
    resume.resolve();
    await Promise.allSettled([publishing].filter(Boolean));
    await f.close();
  }
});
