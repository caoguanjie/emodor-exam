import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../../stores/auth';
import { mediaContext, onMediaContextChange } from '../media-context';

const mocks = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('../../api/http', () => ({ default: { post: mocks.post, get: mocks.get }, tryRefresh: vi.fn() }));
beforeEach(() => { sessionStorage.clear(); sessionStorage.setItem('re_user', JSON.stringify({ id: 11 })); vi.resetAllMocks(); setActivePinia(createPinia()); });
afterEach(() => { sessionStorage.clear(); });
describe('media identity epoch', () => {
  it('keeps media tasks valid during an ordinary access-token refresh', () => {
    const auth = useAuthStore(); const before = mediaContext();
    auth.setAccessToken('unusable-access-fixture');
    expect(mediaContext()).toEqual(before);
  });
  it('invalidates media work immediately when logout starts, before its network response', async () => {
    let finish!: () => void;
    mocks.post.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const auth = useAuthStore(); const before = mediaContext().epoch;
    const listener = vi.fn(); const unsubscribe = onMediaContextChange(listener);
    const pending = auth.logout();
    expect(mediaContext().epoch).toBeGreaterThan(before); expect(listener).toHaveBeenCalledTimes(1);
    finish(); await pending;
    expect(mediaContext().userId).toBe(''); unsubscribe();
  });
});
