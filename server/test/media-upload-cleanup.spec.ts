import { expect, it } from 'vitest';
import { MediaUploadCleanupService } from '../src/modules/media/uploads/media-upload-cleanup.service';

it('does not run COS cleanup for local-only deployments', async () => {
  const cleanup=new MediaUploadCleanupService(null as any,{cosMedia:{provider:'local'}} as any,null);
  expect(await cleanup.runOnce(new Date())).toEqual({cleaned:0,deferred:0});
});
