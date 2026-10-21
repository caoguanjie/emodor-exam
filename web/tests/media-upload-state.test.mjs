import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMediaUploadState,
  mediaKindForPurpose,
  nextMediaUploadAction,
  reduceMediaUploadState,
  validateMediaFile,
} from '../src/components/media-upload-state.ts';

const limits = {
  video_max_bytes: 512,
  image_max_bytes: 128,
  probe_timeout_ms: 30_000,
  allowed_image_types: ['image/png', 'image/jpeg'],
  allowed_video_types: ['video/mp4'],
};

const image = { name: 'portrait.png', type: 'image/png', size: 64 };
const video = { name: 'lesson.mp4', type: 'video/mp4', size: 256 };

test('validates purpose, server limits, and advertised MIME types', () => {
  assert.equal(mediaKindForPurpose('avatar'), 'image');
  assert.equal(mediaKindForPurpose('video'), 'video');
  assert.equal(mediaKindForPurpose('answer'), null);

  assert.deepEqual(validateMediaFile(image, 'avatar', limits), { ok: true, kind: 'image' });
  assert.equal(validateMediaFile(video, 'avatar', limits).ok, false);
  assert.equal(validateMediaFile({ ...image, size: 129 }, 'avatar', limits).ok, false);
  assert.equal(validateMediaFile({ ...image, type: 'image/svg+xml' }, 'avatar', limits).ok, false);
  assert.equal(validateMediaFile(video, 'answer', limits).ok, false);
});

test('keeps the selected file while upload progresses and enters processing by asset id', () => {
  let state = createMediaUploadState();
  state = reduceMediaUploadState(state, { type: 'select', file: video });
  state = reduceMediaUploadState(state, { type: 'upload-start' });
  state = reduceMediaUploadState(state, { type: 'progress', progress: 37 });
  assert.equal(state.status, 'uploading');
  assert.equal(state.progress, 37);
  assert.equal(state.file, video);

  state = reduceMediaUploadState(state, { type: 'processing', assetId: 'asset-7', durationMs: 9000 });
  assert.equal(state.status, 'processing');
  assert.equal(state.assetId, 'asset-7');
  assert.equal(state.durationMs, 9000);
  assert.equal(nextMediaUploadAction(state), 'poll');
});

test('does not resend when an asset id is known and allows retry when no write result is known', () => {
  let state = reduceMediaUploadState(createMediaUploadState(), { type: 'select', file: image });
  state = reduceMediaUploadState(state, { type: 'error', message: '网络中断' });
  assert.equal(state.status, 'error');
  assert.equal(nextMediaUploadAction(state), 'upload');

  state = reduceMediaUploadState(state, { type: 'retry' });
  assert.equal(state.status, 'uploading');
  assert.equal(state.progress, 0);

  state = reduceMediaUploadState(state, { type: 'processing', assetId: 'asset-8' });
  state = reduceMediaUploadState(state, { type: 'error', message: '状态查询失败', assetId: 'asset-8' });
  assert.equal(nextMediaUploadAction(state), 'poll');
  assert.equal(reduceMediaUploadState(state, { type: 'retry' }).status, 'error');
});

test('ready and clear are local state changes without issuing a delete operation', () => {
  let state = reduceMediaUploadState(createMediaUploadState(), { type: 'select', file: image });
  state = reduceMediaUploadState(state, { type: 'ready', assetId: 'asset-9' });
  assert.equal(state.status, 'ready');
  assert.equal(state.assetId, 'asset-9');
  state = reduceMediaUploadState(state, { type: 'clear' });
  assert.deepEqual(state, createMediaUploadState());
});
