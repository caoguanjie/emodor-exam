import { createRequire } from 'node:module';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { SiteSetting } = require('./dist/entities/site-setting.entity.js');
const { SysDictionary } = require('./dist/entities/sys-dictionary.entity.js');
const { SysMenu } = require('./dist/entities/sys-menu.entity.js');
const { SysPermission } = require('./dist/entities/sys-permission.entity.js');
const { SysRolePermission } = require('./dist/entities/sys-role-permission.entity.js');
const { SystemService } = require('./dist/modules/system/system.service.js');

const ACTOR = { id: '1', name: 'a5-concurrency-check' };
const UPDATE_TRIGGER = 'a5_menu_update_delay';
const INSERT_TRIGGER = 'a5_menu_insert_delay';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function dataSourceOptions(ctx) {
  return {
    type: 'mysql',
    host: ctx.env.DB_HOST,
    port: Number(ctx.env.DB_PORT),
    username: ctx.env.DB_USERNAME,
    password: ctx.env.DB_PASSWORD,
    database: ctx.env.DB_DATABASE,
    charset: 'utf8mb4_0900_ai_ci',
    timezone: 'Z',
    entities: [SiteSetting, SysDictionary, SysMenu, SysPermission, SysRolePermission],
    synchronize: false,
    logging: false,
    // One connection per independent pool makes the observed CONNECTION_ID
    // the exact connection used by each service transaction.
    extra: { connectionLimit: 1 },
  };
}

function serviceFor(dataSource) {
  const media = { registerOwnerPolicy() {} };
  const access = { permissions: async () => [], catalog: async () => [] };
  const audit = { log() {} };
  return new SystemService(
    dataSource.getRepository(SysMenu),
    dataSource.getRepository(SysDictionary),
    dataSource.getRepository(SiteSetting),
    dataSource.getRepository(SysPermission),
    dataSource.getRepository(SysRolePermission),
    dataSource,
    media,
    access,
    audit,
  );
}

function directory(name, sort = 1, parentId = null) {
  return {
    parent_id: parentId,
    name,
    type: 'directory',
    route_path: null,
    permission_code: null,
    icon: null,
    sort,
    status: 1,
  };
}

function capture(promise) {
  return promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  );
}

function assertBusinessConflict(outcome, expectedCode, label) {
  assert(outcome.status === 'rejected', `${label} unexpectedly succeeded`);
  assert(
    outcome.reason?.code === expectedCode && outcome.reason?.httpStatus === (expectedCode === 40001 ? 400 : 409),
    `${label} returned ${outcome.reason?.code || outcome.reason?.code === 0 ? outcome.reason.code : outcome.reason?.message || outcome.reason}; expected ${expectedCode}`,
  );
}

async function waitForActiveInsert(ctx, connectionId, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await ctx.queryTestDb(
      'SELECT ID, INFO, STATE FROM INFORMATION_SCHEMA.PROCESSLIST WHERE ID = ?',
      [Number(connectionId)],
    );
    const info = String(rows[0]?.INFO || '');
    if (/INSERT\s+INTO\s+`?sys_menu`?/i.test(info)) return { id: Number(rows[0].ID), info, state: rows[0].STATE };
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${label} did not reach its delayed sys_menu INSERT`);
}

async function createPair(ctx) {
  const dataSourceA = new DataSource(dataSourceOptions(ctx));
  const dataSourceB = new DataSource(dataSourceOptions(ctx));
  try {
    await dataSourceA.initialize();
    await dataSourceB.initialize();
    const [rowA] = await dataSourceA.query('SELECT CONNECTION_ID() AS id');
    const [rowB] = await dataSourceB.query('SELECT CONNECTION_ID() AS id');
    const connectionIds = [Number(rowA.id), Number(rowB.id)];
    assert(connectionIds.every(Number.isInteger), 'menu concurrency connection IDs unavailable');
    assert(connectionIds[0] !== connectionIds[1], 'menu concurrency services did not use distinct MySQL connections');
    return {
      dataSourceA,
      dataSourceB,
      serviceA: serviceFor(dataSourceA),
      serviceB: serviceFor(dataSourceB),
      connectionIds,
      async close() {
        const failures = [];
        for (const dataSource of [dataSourceA, dataSourceB]) {
          if (!dataSource.isInitialized) continue;
          try { await dataSource.destroy(); } catch (error) { failures.push(error); }
        }
        if (failures.length) throw new AggregateError(failures, 'menu concurrency DataSource cleanup failed');
      },
    };
  } catch (error) {
    if (dataSourceA.isInitialized) await dataSourceA.destroy().catch(() => undefined);
    if (dataSourceB.isInitialized) await dataSourceB.destroy().catch(() => undefined);
    throw error;
  }
}

async function installDelayTriggers(dataSource) {
  // MySQL does not allow CREATE TRIGGER through the prepared-statement
  // protocol used by ctx.queryTestDb, so fixed test-only DDL uses query().
  await dataSource.query(`DROP TRIGGER IF EXISTS ${UPDATE_TRIGGER}`);
  await dataSource.query(`DROP TRIGGER IF EXISTS ${INSERT_TRIGGER}`);
  await dataSource.query(
    `CREATE TRIGGER ${UPDATE_TRIGGER} BEFORE UPDATE ON sys_menu FOR EACH ROW `
      + "SET NEW.sort = NEW.sort + IF(NEW.name LIKE 'A5 race cycle%', SLEEP(1), 0)",
  );
  await dataSource.query(
    `CREATE TRIGGER ${INSERT_TRIGGER} BEFORE INSERT ON sys_menu FOR EACH ROW `
      + "SET NEW.sort = NEW.sort + IF(NEW.name LIKE 'A5 race child%', SLEEP(1), 0)",
  );
}

async function dropDelayTriggers(dataSource) {
  await dataSource.query(`DROP TRIGGER IF EXISTS ${UPDATE_TRIGGER}`);
  await dataSource.query(`DROP TRIGGER IF EXISTS ${INSERT_TRIGGER}`);
}

export async function proveMenuStructureSerialization(ctx) {
  const pair = await createPair(ctx);
  const evidence = { connection_ids: pair.connectionIds };
  let cleanupError;
  try {
    await ctx.queryTestDb('DELETE FROM sys_menu');
    await installDelayTriggers(pair.dataSourceA);

    // An empty menu table must not turn the shared mutex into two compatible
    // gap locks. Both unrelated root creates have to commit without deadlock.
    const emptyCreates = await Promise.all([
      capture(pair.serviceA.createMenu(directory('A5 concurrency empty A', 1), ACTOR, null)),
      capture(pair.serviceB.createMenu(directory('A5 concurrency empty B', 2), ACTOR, null)),
    ]);
    assert(emptyCreates.every((item) => item.status === 'fulfilled'), `empty-tree creates failed: ${JSON.stringify(emptyCreates.map((item) => item.reason?.code || item.reason?.message || 'ok'))}`);
    const emptyIds = emptyCreates.map((item) => String(item.value.id));
    assert(new Set(emptyIds).size === 2, 'empty-tree creates did not persist two distinct roots');
    evidence.empty_tree_ids = emptyIds;

    const cycleA = await pair.serviceA.createMenu(directory('A5 race cycle A', 10), ACTOR, null);
    const cycleB = await pair.serviceA.createMenu(directory('A5 race cycle B', 11), ACTOR, null);
    const cycleResults = await Promise.all([
      capture(pair.serviceA.updateMenu(cycleA.id, directory('A5 race cycle A', 10, cycleB.id), ACTOR, null)),
      capture(pair.serviceB.updateMenu(cycleB.id, directory('A5 race cycle B', 11, cycleA.id), ACTOR, null)),
    ]);
    const cycleSuccesses = cycleResults.filter((item) => item.status === 'fulfilled');
    const cycleFailures = cycleResults.filter((item) => item.status === 'rejected');
    assert(cycleSuccesses.length === 1 && cycleFailures.length === 1, `reciprocal-parent race outcomes invalid: ${JSON.stringify(cycleResults.map((item) => item.reason?.code || 'ok'))}`);
    assertBusinessConflict(cycleFailures[0], 40001, 'reciprocal-parent race loser');
    const cycleRows = await ctx.queryTestDb('SELECT id, parent_id FROM sys_menu WHERE id IN (?, ?) ORDER BY id', [cycleA.id, cycleB.id]);
    assert(cycleRows.length === 2, 'reciprocal-parent fixtures disappeared');
    assert(!cycleRows.every((row) => row.parent_id !== null), 'reciprocal-parent race committed a cycle');
    evidence.reciprocal_parent = cycleResults.map((item) => item.status === 'fulfilled' ? 'success' : item.reason.code);

    const deleteParent = await pair.serviceA.createMenu(directory('A5 concurrency delete parent', 20), ACTOR, null);
    const childDelete = capture(pair.serviceA.createMenu(directory('A5 race child delete', 21, deleteParent.id), ACTOR, null));
    const deleteInsert = await waitForActiveInsert(ctx, pair.connectionIds[0], 'child-create/delete-parent race');
    const parentDelete = capture(pair.serviceB.removeMenu(deleteParent.id, ACTOR, null));
    const [childDeleteResult, parentDeleteResult] = await Promise.all([childDelete, parentDelete]);
    assert(childDeleteResult.status === 'fulfilled', `child-create/delete-parent child failed: ${childDeleteResult.reason?.code || childDeleteResult.reason?.message}`);
    assertBusinessConflict(parentDeleteResult, 40920, 'child-create/delete-parent delete');
    const deleteRows = await ctx.queryTestDb('SELECT id, parent_id FROM sys_menu WHERE id IN (?, ?)', [deleteParent.id, childDeleteResult.value.id]);
    assert(deleteRows.length === 2 && deleteRows.some((row) => String(row.parent_id) === String(deleteParent.id)), 'child-create/delete-parent left an orphan or lost a row');
    evidence.child_vs_delete = { insert_connection_id: deleteInsert.id, outcomes: ['success', 40920] };

    const typeParent = await pair.serviceA.createMenu(directory('A5 concurrency type parent', 30), ACTOR, null);
    const childType = capture(pair.serviceA.createMenu(directory('A5 race child type', 31, typeParent.id), ACTOR, null));
    const typeInsert = await waitForActiveInsert(ctx, pair.connectionIds[0], 'child-create/parent-type race');
    const parentType = capture(pair.serviceB.updateMenu(typeParent.id, {
      parent_id: null,
      name: 'A5 concurrency type parent',
      type: 'button',
      route_path: null,
      permission_code: 'system_settings:write',
      icon: null,
      sort: 30,
      status: 1,
    }, ACTOR, null));
    const [childTypeResult, parentTypeResult] = await Promise.all([childType, parentType]);
    assert(childTypeResult.status === 'fulfilled', `child-create/parent-type child failed: ${childTypeResult.reason?.code || childTypeResult.reason?.message}`);
    assertBusinessConflict(parentTypeResult, 40920, 'child-create/parent-type conversion');
    const typeRows = await ctx.queryTestDb('SELECT id, parent_id, type FROM sys_menu WHERE id IN (?, ?)', [typeParent.id, childTypeResult.value.id]);
    const retainedParent = typeRows.find((row) => String(row.id) === String(typeParent.id));
    assert(typeRows.length === 2 && retainedParent?.type === 'directory', 'child-create/parent-type left a button parent or lost a row');
    evidence.child_vs_type = { insert_connection_id: typeInsert.id, outcomes: ['success', 40920] };

    return evidence;
  } finally {
    try { await dropDelayTriggers(pair.dataSourceA); } catch (error) { cleanupError = error; }
    try { await pair.close(); } catch (error) { cleanupError ||= error; }
    if (cleanupError) throw cleanupError;
  }
}
