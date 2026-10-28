import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePcMedia, resolvePublicBranding, assertControlledMediaUrl } from '../media-content';
import { invalidateMediaContext } from '../media-context';

const mocks = vi.hoisted(() => ({ ticket: vi.fn() }));
vi.mock('../../api/media', () => ({ getPcMediaTicket: mocks.ticket }));
const path = '/api/v1/media/preview-tickets/fixture.signature/content';
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.setItem('re_user', JSON.stringify({ id: 11 }));
  invalidateMediaContext();
  mocks.ticket.mockResolvedValue({ content_url: path, expires_at: '2099-01-01T00:00:00.000Z' });
});
afterEach(() => { vi.unstubAllEnvs(); invalidateMediaContext(); sessionStorage.clear(); });

describe('controlled PC media addresses', () => {
  it('requests a short preview ticket without downloading any file bytes', async () => {
    expect((await resolvePcMedia('21')).content_url).toBe(path);
    expect(mocks.ticket).toHaveBeenCalledWith('21', expect.any(AbortSignal));
    expect((await resolvePcMedia('21')).content_url).toBe(path);
    expect(mocks.ticket).toHaveBeenCalledTimes(1);
  });
  it('rejects the retired arbitrary media origin and keeps the local preview route', () => {
    vi.stubEnv('VITE_MEDIA_ORIGIN', 'https://media.example.test');
    expect(() => assertControlledMediaUrl(`https://media.example.test${path}`)).toThrow();
    for (const value of [`https://evil.example${path}`, `https://media.example.test.evil/${path}`, `https://media.example.test${path}?jwt=bad`, 'javascript:alert(1)', '//evil.example/path', '/api/v1/media/21/content', '/internal/object/key']) {
      expect(() => assertControlledMediaUrl(value)).toThrow();
    }
  });
  it('uses only backend-issued COS URLs under the precise public media configuration', async () => {
    const origin = 'https://shared-123456.cos.ap-guangzhou.myqcloud.com';
    const url = `${origin}/ruleexam/dev/media/session/video.mp4?q-sign-algorithm=sha1&q-ak=unusable-fixture-id&q-sign-time=1793000000%3B1793000300&q-key-time=1793000000%3B1793000300&q-header-list=host&q-url-param-list=&q-signature=${'a'.repeat(40)}`;
    vi.stubEnv('VITE_COS_MEDIA_ORIGIN', origin); vi.stubEnv('VITE_COS_MEDIA_PREFIX', 'ruleexam/dev/media/');
    mocks.ticket.mockResolvedValue({ content_url: url, expires_at: '2099-01-01T00:00:00.000Z' });
    expect((await resolvePcMedia('21')).content_url).toBe(url);
    expect(assertControlledMediaUrl(url)).toBe(url);
  });
  it('rejects a pending address from the previous account even if the response ignores cancellation', async () => {
    let finish!: (value: { content_url: string; expires_at: string }) => void;
    mocks.ticket.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = resolvePcMedia('21');
    const failure = pending.catch(error => error);
    invalidateMediaContext();
    sessionStorage.setItem('re_user', JSON.stringify({ id: 12 }));
    finish({ content_url: path, expires_at: '2099-01-01T00:00:00.000Z' });
    expect((await failure).name).toBe('AbortError');
    mocks.ticket.mockResolvedValue({ content_url: path, expires_at: '2099-01-01T00:00:00.000Z' });
    await resolvePcMedia('21');
    expect(mocks.ticket).toHaveBeenCalledTimes(2);
  });
  it('returns a fixed branding address without caching a whitelist decision', () => {
    expect(resolvePublicBranding('25')).toBe('/api/v1/site-config/assets/25/content');
    vi.stubEnv('VITE_MEDIA_ORIGIN', 'https://media.example.test');
    expect(resolvePublicBranding('25')).toBe('/api/v1/site-config/assets/25/content');
    expect(resolvePublicBranding('')).toBe('');
    expect(() => resolvePublicBranding('../25')).toThrow();
  });
});
