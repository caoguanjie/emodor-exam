import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { renderSchemaForDatabase } from './support/test-target.mjs';
import { createEphemeralServices } from './support/ephemeral-services.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const { isSharedBrandingObject } = require('../server/dist/modules/media/shared-branding.js');
let services;
before(async () => { services = await createEphemeralServices(); });
after(async () => {
  await services?.stopProcesses();
  await services?.cleanup();
});

// Real repositories + real authorization/signing; cloud reads are explicitly opt-in.
async function verifyPublicBranding(database, connectionOptions, ids) {
  require('reflect-metadata');
  const { DataSource } = require('typeorm');
  const { MediaAsset } = require('../server/dist/entities/media-asset.entity.js');
  const { MediaReference } = require('../server/dist/entities/media-reference.entity.js');
  const { SiteSetting } = require('../server/dist/entities/site-setting.entity.js');
  const { MediaService } = require('../server/dist/modules/media/media.service.js');
  const { SystemService } = require('../server/dist/modules/system/system.service.js');
  const { CosDownloadUrlAdapter } = require('../server/dist/modules/media/delivery/cos-download-url.adapter.js');
  const { MediaStorageRouter } = require('../server/dist/modules/media/storage/media-storage.router.js');
  const { CosMediaStorage } = require('../server/dist/modules/media/storage/cos-media-storage.js');
  const { LocalMediaStorage } = require('../server/dist/modules/media/storage/local-media-storage.js');
  const live = process.env.VERIFY_BRANDING_COS === '1';
  const config = {
    cosMedia: { provider: 'cos', bucket: 'emodor-education-1256460867', region: 'ap-guangzhou', keyPrefix: 'ruleexam/dev/',
      secretId: live ? process.env.COS_SECRET_ID : 'unusable-test-id',
      secretKey: live ? process.env.COS_SECRET_KEY : 'unusable-test-key',
      sessionToken: live ? process.env.COS_SESSION_TOKEN || null : null },
    mediaDelivery: { mode: 'cos-signed', readUrlTtlSeconds: 300, videoUrlTtlSeconds: 300 },
  };
  const ds = await new DataSource({ type: 'mysql', ...connectionOptions, username: connectionOptions.user,
    database, entities: [MediaAsset, MediaReference, SiteSetting], synchronize: false }).initialize();
  try {
    const router = new MediaStorageRouter(config.cosMedia, new LocalMediaStorage('/unused-branding-test'), new CosMediaStorage(config.cosMedia));
    const media = new MediaService(ds.getRepository(MediaAsset), ds.getRepository(MediaReference), ds, config, undefined, router);
    const system = new SystemService(undefined, undefined, ds.getRepository(SiteSetting), undefined, undefined, ds, media,
      undefined, undefined, new CosDownloadUrlAdapter(config));
    for (const id of ids) {
      const ticket = await system.publicAssetRedirect(id);
      assert.ok(Date.parse(ticket.expires_at) > Date.now());
      const asset = await ds.getRepository(MediaAsset).findOneByOrFail({ id });
      const url = new URL(ticket.content_url);
      assert.equal(url.pathname, `/${asset.storageKey}`);
      if (live) {
        // Do not print the signed URL, HTTP body, SDK errors or credentials.
        const response = await fetch(ticket.content_url, { signal: AbortSignal.timeout(15000) }).catch(() => { throw new Error('COS branding GET failed'); });
        assert.equal(response.status, 200);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(bytes.length, Number(asset.sizeBytes));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
      }
    }
    await assert.rejects(system.publicAssetRedirect('999999'), error => error.code === 40401);
    // A resource ID alone does not authorize access after its reference is removed.
    await ds.getRepository(MediaReference).delete({ assetId: ids[0] });
    await assert.rejects(system.publicAssetRedirect(ids[0]), error => error.code === 40401);
    await ds.getRepository(MediaReference).save({ assetId: ids[0], ownerType: 'site_config', ownerId: '1' });
    if (live) console.log('Fresh database: 4 COS branding reads verified by size and SHA-256');
  } finally { await ds.destroy(); }
}

test('fresh SQL initializes usable branding references; reruns preserve edits and removals', async () => {
  const database = `ruleexam_test_branding_${randomBytes(6).toString('hex')}`;
  const sql = renderSchemaForDatabase(await readFile(new URL('../database/init.sql', import.meta.url), 'utf8'), database);
  const connectionOptions = services.mysql;
  const conn = await require('mysql2/promise').createConnection({ ...connectionOptions, multipleStatements: true });
  try {
    await conn.query(sql);
    const [settings] = await conn.query('SELECT setting_key,value_json FROM site_setting ORDER BY id');
    const logo = settings.find(row => row.setting_key === 'logo_asset_id').value_json;
    const banners = settings.find(row => row.setting_key === 'banners').value_json;
    assert.ok(logo, 'fresh environment must have a default Logo');
    assert.equal(banners.length, 3);
    const [assets] = await conn.query('SELECT * FROM media_asset ORDER BY id');
    const [refs] = await conn.query('SELECT asset_id,owner_type,owner_id FROM media_reference ORDER BY asset_id');
    assert.equal(assets.length, 4);
    assert.equal(refs.length, 4);
    const ids = [logo, ...banners.map(banner => banner.asset_id)];
    assert.equal(new Set(ids).size, 4);
    for (const id of ids) {
      const asset = assets.find(row => String(row.id) === id);
      assert.ok(asset);
      assert.equal(asset.storage_provider, 'cos');
      assert.equal(asset.status, 'ready');
      assert.equal(asset.purpose, 'branding');
      assert.equal(asset.media_kind, 'image');
      assert.match(asset.sha256, /^[a-f0-9]{64}$/);
      assert.ok(asset.size_bytes > 0);
      assert.ok(!asset.storage_key.includes('?'));
      assert.equal(isSharedBrandingObject({ storageProvider: asset.storage_provider, cosBucket: asset.cos_bucket,
        cosRegion: asset.cos_region, storageKey: asset.storage_key }), true, 'every seeded cloud object must be protected from deletion');
      assert.ok(refs.some(ref => String(ref.asset_id) === id && ref.owner_type === 'site_config' && Number(ref.owner_id) === (id === logo ? 1 : 2)));
    }
    assert.deepEqual(banners.map(b => assets.find(a => String(a.id) === b.asset_id).original_name), [
      'safety-learning-center-banner-02-practice-asian-text.png',
      'safety-learning-center-banner-03-digital-asian-text.png',
      'safety-learning-center-banner-01-classroom-asian-text.png',
    ]);
    await verifyPublicBranding(database, connectionOptions, ids);
    await conn.query(sql);
    const [again] = await conn.query('SELECT * FROM media_asset ORDER BY id');
    assert.deepEqual(again, assets);
    const [refsAgain] = await conn.query('SELECT asset_id,owner_type,owner_id FROM media_reference ORDER BY asset_id');
    assert.deepEqual(refsAgain, refs);
    const customBanners = [...banners].reverse().map((banner, index) => ({ ...banner, sort: index }));
    await conn.execute("UPDATE site_setting SET value_json=? WHERE setting_key='banners'", [JSON.stringify(customBanners)]);
    await conn.query(sql);
    const [[custom]] = await conn.query("SELECT value_json FROM site_setting WHERE setting_key='banners'");
    assert.deepEqual(custom.value_json, customBanners);
    // Intentional removal must not be undone by a later init.sql run.
    await conn.query("UPDATE site_setting SET value_json=NULL WHERE setting_key='logo_asset_id'");
    await conn.query("UPDATE site_setting SET value_json=JSON_ARRAY() WHERE setting_key='banners'");
    await conn.query("DELETE FROM media_reference WHERE owner_type='site_config'");
    await conn.query(sql);
    const [cleared] = await conn.query('SELECT setting_key,value_json FROM site_setting ORDER BY id');
    assert.equal(cleared[0].value_json, null);
    assert.deepEqual(cleared[1].value_json, []);
    const [[count]] = await conn.query('SELECT COUNT(*) AS n FROM media_reference');
    assert.equal(count.n, 0);
    // Imported databases can already have other media: never assume fixed IDs.
    await conn.query('DELETE FROM site_setting');
    await conn.query('DELETE FROM media_asset');
    await conn.query('ALTER TABLE media_asset AUTO_INCREMENT=9007199254740997');
    await conn.query(sql);
    const [[shifted]] = await conn.query("SELECT value_json FROM site_setting WHERE setting_key='logo_asset_id'");
    assert.equal(shifted.value_json, '9007199254740997');
    const [shiftedRefs] = await conn.query('SELECT CAST(asset_id AS CHAR) AS asset_id,owner_id FROM media_reference ORDER BY asset_id');
    assert.deepEqual(shiftedRefs.map(row => [row.asset_id, Number(row.owner_id)]), [
      ['9007199254740997', 1], ['9007199254740998', 2], ['9007199254740999', 2], ['9007199254741000', 2],
    ]);
    const [[orphans]] = await conn.query('SELECT COUNT(*) AS n FROM media_reference r LEFT JOIN media_asset a ON a.id=r.asset_id WHERE a.id IS NULL');
    assert.equal(orphans.n, 0);
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await conn.end();
  }
});
