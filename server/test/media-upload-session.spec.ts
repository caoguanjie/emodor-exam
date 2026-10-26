import { describe, expect, it } from 'vitest';
import { normalizeUploadInit } from '../src/modules/media/uploads/media-upload.dto';
import { MediaUploadSessionController } from '../src/modules/media/uploads/media-upload-session.controller';

const input = { client_request_id:'00112233-4455-4677-8899-aabbccddeeff',purpose:'avatar' as const, filename:'avatar.png',mime_type:'image/png',size_bytes:12,fingerprint_sha256:'a'.repeat(64) };

describe('upload input boundary', () => {
  it('rejects untrusted size, fingerprint, private purpose and unsupported MIME before persistence', () => {
    for (const change of [{size_bytes:-1},{size_bytes:1.5},{size_bytes:11*1024*1024},{fingerprint_sha256:'fake'},{purpose:'identity_face'},{mime_type:'text/html'},{client_request_id:'not-uuid'}]) {
      expect(() => normalizeUploadInit({...input,...change} as any,{} as any)).toThrow();
    }
    expect(normalizeUploadInit(input,{} as any)).toEqual(input);
  });
  it('normalizes a display filename without including a client filesystem path', () => {
    expect(normalizeUploadInit({...input,filename:'../../头像.png'},{} as any).filename).toBe('头像.png');
  });
  it('checks the original body so global DTO stripping cannot hide an unsupported upload field', () => {
    let calls=0;const controller=new MediaUploadSessionController({begin:()=>{calls++;}} as any,{} as any);
    expect(()=>controller.begin({id:1} as any,input,{body:{...input,foreign_key:'not-allowed'}} as any)).toThrow();
    expect(calls).toBe(0);
  });
});
