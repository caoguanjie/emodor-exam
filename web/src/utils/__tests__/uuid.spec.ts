import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUuid } from '../uuid';

afterEach(() => vi.unstubAllGlobals());

describe('secure browser UUID generation', () => {
  it('uses the native method with its crypto receiver when it is available', () => {
    const cryptoApi = { randomUUID: vi.fn(function (this: unknown) { expect(this).toBe(cryptoApi); return 'a057c987-188f-44e3-8115-20de8b0ac111'; }), getRandomValues: vi.fn() };
    vi.stubGlobal('crypto', cryptoApi);
    expect(createUuid()).toBe('a057c987-188f-44e3-8115-20de8b0ac111');
    expect(cryptoApi.getRandomValues).not.toHaveBeenCalled();
  });

  it('creates UUID v4 from secure random bytes when randomUUID is unavailable', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => { bytes.fill(255); return bytes; });
    vi.stubGlobal('crypto', { getRandomValues });
    expect(createUuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(getRandomValues.mock.calls[0]![0]).toHaveLength(16);
  });

  it('can use secure random bytes if an exposed native method fails', () => {
    vi.stubGlobal('crypto', { randomUUID: () => { throw new Error('unsupported'); }, getRandomValues: (bytes: Uint8Array) => bytes.fill(0) });
    expect(createUuid()).toBe('00000000-0000-4000-8000-000000000000');
  });

  it.each([undefined, {}, { getRandomValues: () => { throw new Error('entropy unavailable'); } }])('rejects without an available secure entropy source: %s', cryptoApi => {
    const insecureRandom = vi.spyOn(Math, 'random');
    vi.stubGlobal('crypto', cryptoApi);
    expect(() => createUuid()).toThrow('当前浏览器不支持安全随机数');
    expect(insecureRandom).not.toHaveBeenCalled();
    insecureRandom.mockRestore();
  });
});
