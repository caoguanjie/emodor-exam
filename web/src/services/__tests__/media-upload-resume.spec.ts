import { beforeEach, describe, expect, it } from 'vitest';
import { MediaResumeStore, type ResumeRecord } from '../media-upload-resume';

const fingerprint = 'a'.repeat(64);
const record: ResumeRecord = { userId: '11', sessionId: 'session-1', requestId: 'request-1', fingerprint, sizeBytes: 99, expiresAt: '2099-01-01T00:00:00.000Z', purpose: 'video' };
let store: MediaResumeStore;
beforeEach(() => { store = new MediaResumeStore(); });
describe('upload recovery metadata', () => {
  it('persists only resumable metadata and never lets another subject restore it', async () => {
    await store.put({ ...record, credentials: { secret: 'unusable' }, url: 'https://forbidden.example/' } as ResumeRecord);
    expect(await store.get('12', fingerprint)).toBeNull();
    expect(await store.get('11', fingerprint)).toEqual(record);
    await store.remove('12', 'session-1');
    expect(await store.get('11', fingerprint)).toEqual(record);
    await store.remove('11', 'session-1');
    expect(await store.get('11', fingerprint)).toBeNull();
  });
  it('does not resume a different fingerprint or an expired session', async () => {
    await store.put(record);
    expect(await store.get('11', 'b'.repeat(64))).toBeNull();
    await store.put({ ...record, expiresAt: '2000-01-01T00:00:00.000Z' });
    expect(await store.get('11', fingerprint)).toBeNull();
  });
});
