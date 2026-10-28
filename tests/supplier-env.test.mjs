import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { exportSupplier, mergeSupplier, checkDeployment } from '../scripts/supplier-env.mjs';
const fixture = () => Object.fromEntries(['YUNXIN_SMS_APP_KEY','YUNXIN_SMS_APP_SECRET','YUNXIN_SMS_LOGIN_CODE_TEMPLATE_ID','TENCENT_ID_CARD_OCR_SECRET_ID','TENCENT_ID_CARD_OCR_SECRET_KEY','TENCENT_FACEID_SECRET_ID','TENCENT_FACEID_SECRET_KEY'].map(k=>[k,randomBytes(18).toString('hex')]));
const body = v => Object.entries(v).map(([k,v])=>`${k}='${v}'`).join('\n')+'\n';
async function setup(t) { const d=await mkdtemp(join(tmpdir(),'supplier-test-')); t.after(()=>rm(d,{recursive:true,force:true})); return {src:join(d,'source'),out:join(d,'out'),dst:join(d,'target')}; }
test('exports only supplier values privately and never overwrites output',async t=>{const p=await setup(t),v=fixture();v.YUNXIN_SMS_APP_SECRET += '$ # \\';await writeFile(p.src,body({...v,JWT_SECRET:randomBytes(32).toString('hex')}));await exportSupplier(p.src,p.out);const parsed=parseEnv(await readFile(p.out,'utf8'));assert.equal(parsed.JWT_SECRET,undefined);assert.equal(parsed.YUNXIN_SMS_APP_SECRET,v.YUNXIN_SMS_APP_SECRET);assert.equal(parsed.SMS_PROVIDER,'yunxin');assert.equal((await stat(p.out)).mode&0o777,0o600);await assert.rejects(exportSupplier(p.src,p.out));});
test('merge fills blanks and enables services while preserving unrelated bytes, repeat is unchanged',async t=>{const p=await setup(t);await writeFile(p.src,body(fixture()));await exportSupplier(p.src,p.out);const prefix='# retain\nDB_PASSWORD="unchanged"\nJWT_SECRET="existing"\n';await writeFile(p.dst,prefix+'SMS_PROVIDER=disabled\nYUNXIN_SMS_APP_KEY=\n');await mergeSupplier(p.out,p.dst);const after=await readFile(p.dst,'utf8');assert.ok(after.startsWith(prefix));assert.equal(parseEnv(after).SMS_PROVIDER,'yunxin');assert.equal((after.match(/^YUNXIN_SMS_APP_KEY=/gm)||[]).length,1);await mergeSupplier(p.out,p.dst);assert.equal(await readFile(p.dst,'utf8'),after);});
test('conflict, duplicate, incomplete and multiline inputs fail without modifying destination',async t=>{const p=await setup(t);await writeFile(p.src,body(fixture()));await exportSupplier(p.src,p.out);for(const initial of ['YUNXIN_SMS_APP_KEY=different\n','A=1\nA=2\n','A="line\nline"\n']){await writeFile(p.dst,initial);await assert.rejects(mergeSupplier(p.out,p.dst));assert.equal(await readFile(p.dst,'utf8'),initial);}await writeFile(p.src,'SMS_PROVIDER=yunxin\n');await assert.rejects(exportSupplier(p.src,p.src+'.new'));});
test('rejects symlink destination and never exports system keys',async t=>{const p=await setup(t);await writeFile(p.src,body(fixture()));await exportSupplier(p.src,p.out);await symlink(p.src,p.dst);await assert.rejects(mergeSupplier(p.out,p.dst));});
test('deployment check reports missing real providers and invalid database without values',async t=>{const p=await setup(t);await writeFile(p.dst,'DB_USERNAME=root\nDB_PASSWORD=\n');const rows=await checkDeployment(p.dst);assert.ok(rows.some(r=>r.name==='DB_USERNAME'&&!r.ok));assert.ok(rows.some(r=>r.name==='SMS_PROVIDER'&&!r.ok));});

test('CLI reports conflict by field without leaking credentials', async t => {
  const { spawnSync } = await import('node:child_process');
  const p = await setup(t), v = fixture();
  await writeFile(p.src, body(v));
  await exportSupplier(p.src, p.out);
  const existing = randomBytes(20).toString('hex');
  await writeFile(p.dst, `YUNXIN_SMS_APP_KEY='${existing}'\n`);
  const result = spawnSync(process.execPath, ['scripts/supplier-env.mjs', 'merge', '--from', p.out, '--to', p.dst], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.match(output, /YUNXIN_SMS_APP_KEY/);
  for (const secret of [...Object.values(v), existing]) assert.ok(!output.includes(secret));
});
test('rejects garbage after first closing quote', async t => {
  const p = await setup(t);
  await writeFile(p.src, body(fixture()) + "EXTRA='first' trailing 'second'\n");
  await assert.rejects(exportSupplier(p.src, p.out), /格式不支持/);
});
test('check rejects Compose interpolation and conflicting shell overrides without values', async t => {
  const p = await setup(t);
  for (const line of ['EXTRA=$VALUE\n', 'EXTRA="${VALUE}"\n']) {
    await writeFile(p.dst, line);
    await assert.rejects(checkDeployment(p.dst, {}), /单引号/);
  }
  await writeFile(p.dst, "EXTRA='$VALUE'\n");
  await checkDeployment(p.dst, {});
  const rows = await checkDeployment(p.dst, { EXTRA: 'different' });
  assert.ok(rows.some(r => r.name === 'EXTRA' && !r.ok));
  assert.ok(!JSON.stringify(rows).includes('different'));
});
