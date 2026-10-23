import assert from 'node:assert/strict';
import { debugLearner, syntheticImage, uploadIdentity } from './mobile-identity.mjs';

export async function run(ctx) {
  const learner = await debugLearner(ctx); const other = await debugLearner(ctx);
  const uploaded = await uploadIdentity(ctx, learner, 'id_card_portrait', await syntheticImage());
  assert.equal(uploaded.status, 200);
  const id = uploaded.data.asset_id;
  const owner = { owner_type: 'identity_verification_user', owner_id: learner.userId };
  const issue = await ctx.request(learner, 'POST', `/media/${id}/tickets`, owner);
  assert.equal(issue.status, 200); assert.ok(issue.data.expires_at);
  const path = issue.data.content_url.replace(/^\/api\/v1/, '');
  const range = await ctx.request(null, 'GET', path, undefined, { Range: 'bytes=0-15' });
  assert.equal(range.status, 206); assert.equal(range.body.length, 16); assert.match(range.headers['content-range'], /^bytes 0-15\//); assert.match(range.headers['cache-control'], /no-store/);
  assert.equal(range.headers['content-disposition'], 'inline');
  await ctx.queryTestDb('UPDATE sys_user SET status=0 WHERE id=?', [learner.userId]);
  assert.equal((await ctx.request(null, 'GET', path)).code, 40302, 'disabled account must lose anonymous ticket access');
  await ctx.queryTestDb('UPDATE sys_user SET status=1 WHERE id=?', [learner.userId]);
  assert.equal((await ctx.request(null, 'GET', path)).status, 200, 'enabled account retains its ordinary policy authorization');
  assert.equal((await ctx.request(other, 'POST', `/media/${id}/tickets`, owner)).code, 40302);
  assert.equal((await ctx.request(learner, 'POST', `/media/${id}/tickets`, { ...owner, owner_id: other.userId })).code, 40302);
  assert.equal((await ctx.request(learner, 'POST', `/media/${id}/tickets`, { ...owner, owner_type: 'unregistered' })).code, 40301);
  const badPath = path.replace('/content', 'XX/content');
  assert.equal((await ctx.request(null, 'GET', badPath)).code, 40302);
  assert.equal((await ctx.request(null, 'GET', path, undefined, { Range: 'bytes=0-1,5-6' })).code, 41601);
  await ctx.queryTestDb("DELETE FROM media_reference WHERE asset_id=? AND owner_type='identity_verification_user' AND owner_id=?", [id, learner.userId]);
  assert.equal((await ctx.request(null, 'GET', path)).code, 40302, 'content must recheck its exact reference');
  await ctx.queryTestDb("INSERT INTO media_reference(asset_id,owner_type,owner_id) VALUES (?,'identity_verification_user',?)", [id, learner.userId]);
  const released = await ctx.request(learner, 'DELETE', `/me/identity-verification/images/${id}`);
  assert.equal(released.status, 200); assert.equal((await ctx.request(null, 'GET', path)).code, 40401);
  const remaining = await ctx.queryTestDb('SELECT id FROM media_asset WHERE id=?', [id]); assert.equal(remaining.length, 0);
  const deletedLearner = await debugLearner(ctx);
  const deletedUpload = await uploadIdentity(ctx, deletedLearner, 'id_card_portrait', await syntheticImage('#3164aa'));
  const deletedPath = deletedUpload.data.processed_preview.content_url.replace(/^\/api\/v1/, '');
  assert.equal((await ctx.request(null, 'GET', deletedPath)).status, 200);
  await ctx.queryTestDb('DELETE FROM sys_user WHERE id=?', [deletedLearner.userId]);
  assert.equal((await ctx.request(null, 'GET', deletedPath)).code, 40302, 'deleted account must lose anonymous ticket access');
  console.log('[mobile-media-ticket] exact-owner HMAC, anonymous Range, revocation and temporary-material release passed');
}
