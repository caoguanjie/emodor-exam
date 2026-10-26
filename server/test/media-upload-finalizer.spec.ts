import { expect, it } from 'vitest';
import { MediaUploadFinalizerService } from '../src/modules/media/uploads/media-upload-finalizer.service';

it('does not schedule cloud processing for local-only deployments', async () => {
  const finalizer=new MediaUploadFinalizerService(null as any,null as any,{cosMedia:{provider:'local'}} as any,null,null as any,null as any,null as any);
  expect(await finalizer.runOnce()).toEqual({completed:0,failed:0});
});
