import { createRequire } from 'node:module';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { ExamPaper } = require('./dist/entities/exam-paper.entity.js');
const { PaperQuestion } = require('./dist/entities/paper-question.entity.js');
const { PaperRelease } = require('./dist/entities/paper-release.entity.js');
const { PaperReleaseQuestion } = require('./dist/entities/paper-release-question.entity.js');
const { Question } = require('./dist/entities/question.entity.js');
const { QuestionVersion } = require('./dist/entities/question-version.entity.js');
const { Regulation } = require('./dist/entities/regulation.entity.js');
const { RegulationVersion } = require('./dist/entities/regulation-version.entity.js');
const { MediaAsset } = require('./dist/entities/media-asset.entity.js');
const { MediaReference } = require('./dist/entities/media-reference.entity.js');
const { TrainingCategory } = require('./dist/entities/training-category.entity.js');
const { TrainingCourse } = require('./dist/entities/training-course.entity.js');
const { CategoryService } = require('./dist/modules/training/category.service.js');
const { QuestionVersionService } = require('./dist/modules/questions/question-version.service.js');
const { PaperReleaseService } = require('./dist/modules/exams/paper-release.service.js');
const { SamplingService } = require('./dist/modules/exams/sampling.service.js');
const { PaperService } = require('./dist/modules/ai/paper.service.js');
const { QuestionBankService } = require('./dist/modules/questions/question-bank.service.js');
const { AuditService } = require('./dist/common/audit.service.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function dataSourceOptions(ctx) {
  const database = String(ctx.env.DB_DATABASE || '');
  assert(/^ruleexam_test_[A-Za-z0-9_]+$/.test(database), 'paper release concurrency requires an isolated ruleexam_test_* database');
  assert(ctx.env.DB_HOST && ctx.env.DB_PORT && ctx.env.DB_USERNAME && ctx.env.DB_PASSWORD !== undefined,
    'paper release concurrency requires explicit DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD');
  return {
    type: 'mysql',
    host: ctx.env.DB_HOST,
    port: Number(ctx.env.DB_PORT),
    username: ctx.env.DB_USERNAME,
    password: ctx.env.DB_PASSWORD,
    database,
    charset: 'utf8mb4_0900_ai_ci',
    timezone: 'Z',
    entities: [
      TrainingCategory, TrainingCourse, Regulation, ExamPaper, PaperQuestion,
      PaperRelease, PaperReleaseQuestion, Question, QuestionVersion,
      RegulationVersion, MediaAsset, MediaReference,
    ],
    synchronize: false,
    logging: false,
    // The publication transaction owns this sole connection. Any accidental
    // global-repository borrow from enabledCandidates would stall here.
    extra: { connectionLimit: 1 },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

async function withTimeout(promise, timeoutMs, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function capture(promise) {
  return promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  );
}

function serviceFor(dataSource) {
  const categories = Object.create(CategoryService.prototype);
  categories.categoryRepo = dataSource.getRepository(TrainingCategory);

  const questions = Object.create(QuestionVersionService.prototype);
  questions.versionRepo = dataSource.getRepository(QuestionVersion);
  questions.categories = categories;

  const service = Object.create(PaperReleaseService.prototype);
  Object.assign(service, {
    paperRepo: dataSource.getRepository(ExamPaper),
    releaseRepo: dataSource.getRepository(PaperRelease),
    releaseQuestionRepo: dataSource.getRepository(PaperReleaseQuestion),
    dataSource,
    categories,
    questions,
    sampling: new SamplingService(),
    audit: { log() {} },
  });
  return service;
}

function paperServiceFor(dataSource, delayedPreRead) {
  const categories = Object.create(CategoryService.prototype);
  categories.categoryRepo = dataSource.getRepository(TrainingCategory);
  const realPaperRepo = dataSource.getRepository(ExamPaper);
  const paperRepo = delayedPreRead ? {
    async findOne(options) {
      const paper = await realPaperRepo.findOne(options);
      if (paper && String(paper.id) === String(delayedPreRead.paperId)) {
        delayedPreRead.entered.resolve();
        await delayedPreRead.release.promise;
      }
      return paper;
    },
  } : realPaperRepo;
  const service = Object.create(PaperService.prototype);
  Object.assign(service, {
    paperRepo,
    pqRepo: dataSource.getRepository(PaperQuestion),
    questionRepo: dataSource.getRepository(Question),
    versionRepo: dataSource.getRepository(QuestionVersion),
    regulationRepo: dataSource.getRepository(Regulation),
    courseRepo: dataSource.getRepository(TrainingCourse),
    releaseRepo: dataSource.getRepository(PaperRelease),
    categories,
    dataSource,
    audit: { log() {} },
  });
  return service;
}

async function createPair(ctx) {
  const dataSourceA = new DataSource(dataSourceOptions(ctx));
  const dataSourceB = new DataSource(dataSourceOptions(ctx));
  try {
    await dataSourceA.initialize();
    await dataSourceB.initialize();
    const [rowA] = await dataSourceA.query('SELECT CONNECTION_ID() AS id');
    const [rowB] = await dataSourceB.query('SELECT CONNECTION_ID() AS id');
    assert(Number(rowA.id) !== Number(rowB.id), 'paper release concurrency did not receive independent connections');
    return {
      dataSourceA,
      dataSourceB,
      serviceA: serviceFor(dataSourceA),
      serviceB: serviceFor(dataSourceB),
      connectionIds: [Number(rowA.id), Number(rowB.id)],
    };
  } catch (error) {
    if (dataSourceA.isInitialized) await dataSourceA.destroy().catch(() => undefined);
    if (dataSourceB.isInitialized) await dataSourceB.destroy().catch(() => undefined);
    throw error;
  }
}

export async function provePaperReleaseSingleConnectionPools(ctx, paperIds, actorId) {
  assert(Array.isArray(paperIds) && paperIds.length === 2, 'two draft paper ids are required');
  const pair = await createPair(ctx);
  try {
    const results = await withTimeout(
      Promise.all([
        pair.serviceA.publish(String(paperIds[0]), String(actorId)),
        pair.serviceB.publish(String(paperIds[1]), String(actorId)),
      ]),
      10_000,
      'single-connection paper publications stalled',
    );
    assert(results.every((item) => /^\d+$/.test(String(item.releaseId))), 'concurrent publications did not return release ids');
    assert(new Set(results.map((item) => String(item.releaseId))).size === 2, 'concurrent publications reused one release');
    return { connection_ids: pair.connectionIds, release_ids: results.map((item) => String(item.releaseId)) };
  } finally {
    const failures = [];
    for (const dataSource of [pair.dataSourceA, pair.dataSourceB]) {
      if (!dataSource.isInitialized) continue;
      try { await dataSource.destroy(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'paper release concurrency DataSource cleanup failed');
  }
}

/** Disable commits after publication has begun, but before its identity lock. */
export async function proveDisableWinsPublication(ctx, paperId, questionId, actorId) {
  const pair = await createPair(ctx);
  const disabled = deferred();
  const allowCommit = deferred();
  const publishLockEntered = deferred();
  let disabling;
  let publishing;
  try {
    disabling = capture(pair.dataSourceB.transaction(async (manager) => {
      const repo = manager.getRepository(Question);
      const question = await repo.findOne({ where: { id: String(questionId) }, lock: { mode: 'pessimistic_write' } });
      assert(question?.isEnabled, 'concurrent fixture must initially be enabled');
      question.isEnabled = false;
      await repo.save(question);
      disabled.resolve();
      await allowCommit.promise;
    }));
    await withTimeout(disabled.promise, 10_000, 'disable did not acquire its identity lock');
    pair.serviceA.dataSource = {
      transaction: (work) => pair.dataSourceA.transaction((manager) => work(new Proxy(manager, {
        get(target, property) {
          if (property !== 'getRepository') return Reflect.get(target, property);
          return (entity) => {
            const repo = target.getRepository(entity);
            if (entity !== Question) return repo;
            return new Proxy(repo, {
              get(repository, method) {
                if (method !== 'findOne') return Reflect.get(repository, method);
                return (options) => { publishLockEntered.resolve(); return repository.findOne(options); };
              },
            });
          };
        },
      }))),
    };
    publishing = capture(pair.serviceA.publish(String(paperId), String(actorId)));
    await withTimeout(publishLockEntered.promise, 10_000, 'publication did not re-lock the selected identity');
    allowCommit.resolve();
    const [disableResult, publishResult] = await withTimeout(Promise.all([disabling, publishing]), 10_000, 'disable/publication race stalled');
    assert(disableResult.status === 'fulfilled', 'disable transaction did not commit');
    assert(publishResult.status === 'rejected' && publishResult.reason?.code === 40970, 'publication did not reject the concurrently disabled identity');
    const [row] = await pair.dataSourceA.query('SELECT status,(SELECT COUNT(*) FROM paper_release WHERE paper_id=?) AS releases FROM exam_paper WHERE id=?', [String(paperId), String(paperId)]);
    assert(row.status === 'draft' && Number(row.releases) === 0, 'conflicting publication left partial release facts');
    return { connection_ids: pair.connectionIds, conflict_code: publishResult.reason.code };
  } finally {
    allowCommit.resolve();
    await Promise.allSettled([disabling, publishing].filter(Boolean));
    for (const source of [pair.dataSourceA, pair.dataSourceB]) if (source.isInitialized) await source.destroy();
  }
}

function bankServiceFor(ctx, dataSource) {
  const versions = serviceFor(dataSource).questions;
  return new QuestionBankService(dataSource.getRepository(Question), versions,
    new AuditService({ logDir: ctx.env.LOG_DIR }), dataSource);
}

function observeIdentityLock(dataSource, entered) {
  return {
    transaction: (work) => dataSource.transaction((manager) => work(new Proxy(manager, {
      get(target, property) {
        if (property !== 'getRepository') return Reflect.get(target, property);
        return (entity) => {
          const repo = target.getRepository(entity);
          if (entity !== Question) return repo;
          return new Proxy(repo, {
            get(repository, method) {
              if (method !== 'findOne') return Reflect.get(repository, method);
              return (options) => {
                if (options?.lock?.mode === 'pessimistic_write') entered.resolve();
                return repository.findOne(options);
              };
            },
          });
        };
      },
    }))),
  };
}

/** Both contestants execute real services; only the transaction commit is gated. */
export async function proveDeletePublicationOrdering(ctx, input, actorId) {
  const pair = await createPair(ctx);
  const staged = deferred();
  const competingLock = deferred();
  const allowCommit = deferred();
  const bank = bankServiceFor(ctx, pair.dataSourceB);
  const actor = { id: Number(actorId), name: 'question-delete-concurrency' };
  let publishing;
  let deleting;
  let frozenBeforeDelete;
  try {
    const { paperId, questionId, versionId, deleteFirst } = input;
    if (deleteFirst) {
      bank.dataSource = {
        transaction: (work) => pair.dataSourceB.transaction(async (manager) => {
          const result = await work(manager);
          staged.resolve();
          await allowCommit.promise;
          return result;
        }),
      };
      deleting = capture(bank.softDelete(String(questionId), String(versionId), true, actor, null));
      await withTimeout(staged.promise, 10_000, 'softDelete did not stage its real transaction');
      pair.serviceA.dataSource = observeIdentityLock(pair.dataSourceA, competingLock);
      publishing = capture(pair.serviceA.publish(String(paperId), String(actorId)));
    } else {
      pair.serviceA.dataSource = {
        transaction: (work) => pair.dataSourceA.transaction(async (manager) => {
          const result = await work(manager);
          frozenBeforeDelete = await manager.query(
            'SELECT rq.* FROM paper_release_question rq JOIN paper_release r ON r.id=rq.release_id WHERE r.paper_id=? ORDER BY rq.position',
            [String(paperId)],
          );
          staged.resolve();
          await allowCommit.promise;
          return result;
        }),
      };
      publishing = capture(pair.serviceA.publish(String(paperId), String(actorId)));
      await withTimeout(staged.promise, 10_000, 'publication did not stage its real release');
      bank.dataSource = observeIdentityLock(pair.dataSourceB, competingLock);
      deleting = capture(bank.softDelete(String(questionId), String(versionId), true, actor, null));
    }
    await withTimeout(competingLock.promise, 10_000, 'competing service did not attempt the shared identity lock');
    allowCommit.resolve();
    const [deleteResult, publishResult] = await withTimeout(Promise.all([deleting, publishing]), 10_000, 'delete/publication ordering stalled');
    assert(deleteResult.status === 'fulfilled' && deleteResult.value.deleted === true, 'real softDelete did not commit');
    const [state] = await pair.dataSourceA.query(
      'SELECT p.status,(SELECT COUNT(*) FROM paper_release WHERE paper_id=p.id) AS releases,(SELECT COUNT(*) FROM paper_release_question rq JOIN paper_release r ON r.id=rq.release_id WHERE r.paper_id=p.id) AS release_questions FROM exam_paper p WHERE p.id=?',
      [String(paperId)],
    );
    if (deleteFirst) {
      assert(publishResult.status === 'rejected' && publishResult.reason?.code === 40970, 'publication accepted the deleted identity');
      assert(state.status === 'draft' && Number(state.releases) === 0 && Number(state.release_questions) === 0, 'delete conflict left a partial release');
    } else {
      assert(publishResult.status === 'fulfilled', 'publication that locked first was rejected');
      assert(state.status === 'published' && Number(state.releases) === 1 && Number(state.release_questions) === 1, 'publication did not preserve its complete release');
      const frozenAfterDelete = await pair.dataSourceA.query(
        'SELECT rq.* FROM paper_release_question rq JOIN paper_release r ON r.id=rq.release_id WHERE r.paper_id=? ORDER BY rq.position',
        [String(paperId)],
      );
      assert(JSON.stringify(frozenAfterDelete) === JSON.stringify(frozenBeforeDelete), 'deletion changed a committed publication snapshot');
      const frozen = await pair.serviceA.get(publishResult.value.releaseId);
      assert(String(frozen.pool[0].questionId) === String(questionId), 'published snapshot became unreadable after deletion');
    }
    return { order: deleteFirst ? 'delete-first' : 'publish-first', connection_ids: pair.connectionIds,
      publication: publishResult.status === 'fulfilled' ? publishResult.value.releaseId : publishResult.reason.code };
  } finally {
    allowCommit.resolve();
    await Promise.allSettled([deleting, publishing].filter(Boolean));
    for (const source of [pair.dataSourceA, pair.dataSourceB]) if (source.isInitialized) await source.destroy();
  }
}

async function paperState(ctx, paperId) {
  const rows = await ctx.queryTestDb(
    `SELECT p.category_id, p.title,
      (SELECT COUNT(*) FROM paper_question pq WHERE pq.paper_id = p.id) AS question_count,
      (SELECT COUNT(*) FROM exam_paper all_papers WHERE all_papers.business_scope = 'training') AS training_paper_count
     FROM exam_paper p WHERE p.id = ?`,
    [String(paperId)],
  );
  assert(rows.length === 1, `category-change paper ${paperId} disappeared`);
  return {
    category_id: String(rows[0].category_id),
    title: String(rows[0].title),
    question_count: Number(rows[0].question_count),
    training_paper_count: Number(rows[0].training_paper_count),
  };
}

export async function proveTrainingCategoryChangeConflicts(ctx, input, actorId) {
  const { categoryAId, categoryBId, questionVersionId, papers } = input || {};
  assert(/^\d+$/.test(String(categoryAId)) && /^\d+$/.test(String(categoryBId)), 'two category ids are required');
  assert(/^\d+$/.test(String(questionVersionId)), 'one fixed question version id is required');
  assert(papers && /^\d+$/.test(String(papers.update)) && /^\d+$/.test(String(papers.questions))
    && /^\d+$/.test(String(papers.copy)), 'three category-change paper ids are required');

  const pair = await createPair(ctx);
  const actor = { id: String(actorId), name: 'c1-category-change-check' };
  const serviceB = paperServiceFor(pair.dataSourceB);
  const scenarios = [
    {
      name: 'updateTraining', paperId: String(papers.update),
      invoke: (service) => service.updateTraining(String(papers.update), { title: 'stale category A overwrite' }, actor, null),
    },
    {
      name: 'setTrainingQuestions', paperId: String(papers.questions),
      invoke: (service) => service.setTrainingQuestions(String(papers.questions), [
        { question_version_id: String(questionVersionId), score_cents: 10000 },
      ], actor, null),
    },
    {
      name: 'copyTraining', paperId: String(papers.copy),
      invoke: (service) => service.copyTraining(String(papers.copy), actor, null),
    },
  ];
  const evidence = [];
  try {
    for (const scenario of scenarios) {
      const before = await paperState(ctx, scenario.paperId);
      assert(before.category_id === String(categoryAId), `${scenario.name} fixture did not start in category A`);
      assert(before.question_count === 1, `${scenario.name} fixture must start with one real fixed question`);

      const entered = deferred();
      const release = deferred();
      const serviceA = paperServiceFor(pair.dataSourceA, { paperId: scenario.paperId, entered, release });
      const stale = capture(scenario.invoke(serviceA));
      let switchError;
      let baseline;
      try {
        await withTimeout(entered.promise, 5_000, `${scenario.name} did not reach the delayed category A pre-read`);
        await serviceB.updateTraining(scenario.paperId, { category_id: String(categoryBId) }, actor, null);
        baseline = await paperState(ctx, scenario.paperId);
        assert(baseline.category_id === String(categoryBId), `${scenario.name} category B transaction did not commit`);
        assert(baseline.question_count === 0, `${scenario.name} category B transaction did not clear the old fixed list`);
      } catch (error) {
        switchError = error;
      } finally {
        // Always release the stale request before awaiting it or destroying
        // either one-connection pool.
        release.resolve();
      }

      const outcome = await withTimeout(stale, 5_000, `${scenario.name} did not finish after releasing its pre-read latch`);
      if (switchError) throw switchError;
      assert(outcome.status === 'rejected' && outcome.reason?.code === 40970,
        `${scenario.name} stale category A request returned ${outcome.status === 'rejected' ? outcome.reason?.code || outcome.reason?.message : 'success'} instead of 40970`);
      const after = await paperState(ctx, scenario.paperId);
      assert(JSON.stringify(after) === JSON.stringify(baseline),
        `${scenario.name} stale request changed committed category B state: before=${JSON.stringify(baseline)} after=${JSON.stringify(after)}`);
      evidence.push({ name: scenario.name, before, after_switch: baseline, after_stale: after, conflict_code: 40970 });
    }
    return { connection_ids: pair.connectionIds, scenarios: evidence };
  } finally {
    const failures = [];
    for (const dataSource of [pair.dataSourceA, pair.dataSourceB]) {
      if (!dataSource.isInitialized) continue;
      try { await dataSource.destroy(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'paper category-change DataSource cleanup failed');
  }
}
