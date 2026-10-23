import test from 'node:test';
import assert from 'node:assert/strict';
import { addSiteBanner, removeSiteBanner } from '../src/views/admin/site-settings-state.ts';

test('adds an uploaded banner with the next sort value and keeps at most three banners', () => {
  const initial = [
    { asset_id: 'banner-20', sort: 20 },
    { asset_id: 'banner-10', sort: 10 },
  ];

  assert.deepEqual(addSiteBanner(initial, 'banner-30'), [
    { asset_id: 'banner-10', sort: 10 },
    { asset_id: 'banner-20', sort: 20 },
    { asset_id: 'banner-30', sort: 30 },
  ]);

  assert.deepEqual(addSiteBanner(initial, 'banner-40'), [
    { asset_id: 'banner-10', sort: 10 },
    { asset_id: 'banner-20', sort: 20 },
    { asset_id: 'banner-40', sort: 30 },
  ]);

  const full = addSiteBanner(initial, 'banner-30');
  assert.deepEqual(addSiteBanner(full, 'banner-40'), full);
  assert.deepEqual(addSiteBanner(full, 'banner-20'), full);
});

test('removes a banner by asset id without changing the remaining order', () => {
  const banners = [
    { asset_id: 'banner-10', sort: 10 },
    { asset_id: 'banner-20', sort: 20 },
    { asset_id: 'banner-30', sort: 30 },
  ];

  assert.deepEqual(removeSiteBanner(banners, 'banner-20'), [
    { asset_id: 'banner-10', sort: 10 },
    { asset_id: 'banner-30', sort: 30 },
  ]);
  assert.deepEqual(removeSiteBanner(banners, 'missing'), banners);
});
