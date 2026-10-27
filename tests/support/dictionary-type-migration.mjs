import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { applyMigrations, listMigrations } from '../../database/migrate.mjs';
import { createEphemeralServices } from './ephemeral-services.mjs';
import { validateTestTarget } from './test-target.mjs';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');
const MIGRATION_ID = '037_dictionary_types';
const FIXED_TYPES = [
  ['question_type', '试题类型', 0, 1], ['difficulty', '题目难度', 1, 1],
  ['learner_source', '学员来源', 2, 1], ['paper_status', '试卷状态', 3, 1],
  ['exam_status', '考试状态', 4, 1], ['question_status', '题目状态', 5, 1],
  ['regulation_status', '制度状态', 6, 1],
];

async function assertProbes(connection, migration) {
  for (const step of migration.steps) {
    const [[result]] = await connection.query(step.checkSql);
    assert.equal(Number(result.complete), 1, `${step.id} must verify the resulting database`);
  }
}

/** Owns temporary MySQL/Redis processes; never reads environment files or host DB credentials. */
export async function verifyDictionaryTypeMigration() {
  const migration = (await listMigrations()).find((item) => item.id === MIGRATION_ID);
  assert.ok(migration, '037 must provide the dictionary category upgrade');
  assert.equal(migration.steps.length, 3, '037 must separate DDL, built-in categories and legacy backfill');
  const initSql = await readFile(new URL('../../database/init.sql', import.meta.url), 'utf8');
  const categoryDdl = initSql.match(/CREATE TABLE IF NOT EXISTS `sys_dictionary_type` \([\s\S]*?;\n/);
  const categorySeed = initSql.match(/INSERT INTO `sys_dictionary_type` [\s\S]*?;\n/);
  assert.ok(categoryDdl && categorySeed, 'fresh schema must include category DDL and seeds');
  const legacySql = initSql.replace(categoryDdl[0], '').replace(categorySeed[0], '');
  assert.ok(!legacySql.includes('`sys_dictionary_type`'), 'upgrade fixture must start without the new category table');
  const services = await createEphemeralServices();
  const databases = ['fresh', 'upgrade'].map((kind) => `ruleexam_test_dict_${kind}_${randomBytes(6).toString('hex')}`);
  let admin;
  let fresh;
  let upgrade;
  try {
    admin = await mysql.createConnection({ ...services.mysql, multipleStatements: true });
    for (const [index, sql] of [initSql, legacySql].entries()) {
      await admin.query(validateTestTarget({ database: databases[index], sql }).sql);
    }
    fresh = await mysql.createConnection({ ...services.mysql, database: databases[0], timezone: 'Z' });
    upgrade = await mysql.createConnection({ ...services.mysql, database: databases[1], timezone: 'Z' });
    await assertProbes(fresh, migration);
    const [initial] = await fresh.query('SELECT type,label,sort,is_system FROM sys_dictionary_type ORDER BY sort,type');
    assert.deepEqual(initial.map((row) => [row.type, row.label, row.sort, row.is_system]), FIXED_TYPES);
    await fresh.execute("UPDATE sys_dictionary_type SET label='管理员名称',description='管理员描述' WHERE type='question_type'");
    const [renamed] = await fresh.query('SELECT * FROM sys_dictionary_type ORDER BY type');
    await fresh.query(categorySeed[0]);
    const [reseeded] = await fresh.query('SELECT * FROM sys_dictionary_type ORDER BY type');
    assert.deepEqual(reseeded, renamed, 'fresh-schema category seeds must preserve administrator edits and timestamps');

    await upgrade.execute(
      'INSERT INTO sys_dictionary (type,code,label,sort,status,is_system,remark,created_at,updated_at) VALUES (?,?,?,27,1,0,?,?,?),(?,?,?,39,0,0,?,?,?),(?,?,?,51,1,0,NULL,?,?)',
      ['legacy_custom_one', 'original', '原字典值', '保留备注', new Date('2020-01-02T03:04:05.006Z'), new Date('2021-02-03T04:05:06.007Z'),
        'legacy_custom_one', 'disabled', '停用字典值', '停用备注', new Date('2020-01-02T03:04:05.006Z'), new Date('2021-02-03T04:05:06.007Z'),
        'legacy_custom_two', 'other', '另一分类', new Date('2020-01-02T03:04:05.006Z'), new Date('2021-02-03T04:05:06.007Z')],
    );
    const [dictionaryBefore] = await upgrade.query('SELECT * FROM sys_dictionary ORDER BY id');
    const simulatedCrash = 'dictionary DDL committed before checkpoint';
    await assert.rejects(applyMigrations({
      connection: upgrade, database: databases[1], migrations: [migration],
      onCheckpoint({ event, stepId }) {
        if (event === 'after-step-sql' && stepId === migration.steps[0].id) throw new Error(simulatedCrash);
      },
    }), { message: simulatedCrash });
    const [[interrupted]] = await upgrade.execute('SELECT status,progress FROM schema_migration WHERE migration_id=?', [MIGRATION_ID]);
    assert.equal(interrupted.status, 'failed');
    assert.deepEqual(typeof interrupted.progress === 'string' ? JSON.parse(interrupted.progress) : interrupted.progress, []);
    const resumedSql = [];
    const applied = await applyMigrations({
      connection: upgrade, database: databases[1], migrations: [migration],
      onCheckpoint({ event, stepId }) { if (event === 'before-step') resumedSql.push(stepId); },
    });
    assert.deepEqual(applied.applied, [MIGRATION_ID]);
    assert.ok(!resumedSql.includes(migration.steps[0].id), 'resume must probe committed DDL instead of replaying it');
    await assertProbes(upgrade, migration);
    const [categories] = await upgrade.query('SELECT type,label,sort,is_system FROM sys_dictionary_type ORDER BY sort,type');
    assert.deepEqual(categories.map((row) => [row.type, row.label, row.sort, row.is_system]), [
      ...FIXED_TYPES, ['legacy_custom_one', 'legacy_custom_one', 1000, 0], ['legacy_custom_two', 'legacy_custom_two', 1000, 0],
    ]);
    const [dictionaryAfter] = await upgrade.query('SELECT * FROM sys_dictionary ORDER BY id');
    assert.deepEqual(dictionaryAfter, dictionaryBefore, '037 must preserve every original dictionary field, including disabled items and timestamps');
    await upgrade.execute("UPDATE sys_dictionary_type SET label='内置新名称',description='内置新描述' WHERE type='question_type'");
    await upgrade.execute("UPDATE sys_dictionary_type SET label='自定义新名称',description='自定义新描述' WHERE type='legacy_custom_one'");
    const [metadataBeforeReplay] = await upgrade.query('SELECT * FROM sys_dictionary_type ORDER BY type');
    await assertProbes(upgrade, migration);
    const repeated = await applyMigrations({ connection: upgrade, database: databases[1], migrations: [migration] });
    assert.deepEqual(repeated.applied, [], 'valid completed migration must not execute again after a category rename');
    const [metadataAfterReplay] = await upgrade.query('SELECT * FROM sys_dictionary_type ORDER BY type');
    assert.deepEqual(metadataAfterReplay, metadataBeforeReplay, 'replay must preserve editable metadata and timestamps');

    await upgrade.query('ALTER TABLE sys_dictionary_type ALTER COLUMN sort SET DEFAULT 0');
    const [[wrongDefault]] = await upgrade.query(migration.steps[0].checkSql);
    assert.equal(Number(wrongDefault.complete), 0, 'DDL probe must reject a wrong column default');
    await assert.rejects(applyMigrations({ connection: upgrade, database: databases[1], migrations: [migration] }), /recorded complete but its invariant is false/);
    await upgrade.query('ALTER TABLE sys_dictionary_type ALTER COLUMN sort SET DEFAULT 1000');
    await upgrade.query('ALTER TABLE sys_dictionary_type DROP INDEX idx_sys_dictionary_type_sort, ADD INDEX idx_sys_dictionary_type_sort (type,sort)');
    const [[wrongOrder]] = await upgrade.query(migration.steps[0].checkSql);
    assert.equal(Number(wrongOrder.complete), 0, 'DDL probe must reject a same-name index with the wrong column order');
    await upgrade.query('ALTER TABLE sys_dictionary_type DROP INDEX idx_sys_dictionary_type_sort, ADD INDEX idx_sys_dictionary_type_sort (sort,type)');
    await upgrade.query('ALTER TABLE sys_dictionary_type DROP INDEX uk_sys_dictionary_type_label, ADD INDEX uk_sys_dictionary_type_label (label)');
    const [[notUnique]] = await upgrade.query(migration.steps[0].checkSql);
    assert.equal(Number(notUnique.complete), 0, 'DDL probe must require a unique category label');
    await upgrade.query('ALTER TABLE sys_dictionary_type DROP INDEX uk_sys_dictionary_type_label, ADD UNIQUE INDEX uk_sys_dictionary_type_label (label)');
    await upgrade.query('CREATE TABLE dictionary_type_fk_fixture (type VARCHAR(64) NOT NULL PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci');
    await upgrade.query('INSERT INTO dictionary_type_fk_fixture (type) SELECT type FROM sys_dictionary_type');
    await upgrade.query('ALTER TABLE sys_dictionary_type ADD CONSTRAINT fk_test_dictionary_type FOREIGN KEY (type) REFERENCES dictionary_type_fk_fixture (type)');
    const [[foreignKey]] = await upgrade.query(migration.steps[0].checkSql);
    assert.equal(Number(foreignKey.complete), 0, 'DDL probe must reject foreign keys');
    await upgrade.query('ALTER TABLE sys_dictionary_type DROP FOREIGN KEY fk_test_dictionary_type');
    await assertProbes(upgrade, migration);
    return { verified_steps: 3, built_in_categories: 7, legacy_categories: 2, preserved_items: dictionaryBefore.length, ddl_drift_checks: 4, ddl_resume: true, rename_replay: true, fresh_seed_preserves_edits: true };
  } finally {
    try {
      await fresh?.end();
      await upgrade?.end();
      if (admin) {
        for (const database of databases) await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      }
    } finally {
      await admin?.end();
      await services.cleanup();
    }
  }
}
