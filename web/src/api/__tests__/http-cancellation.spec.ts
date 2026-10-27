import { afterEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, CanceledError, type AxiosAdapter } from 'axios';
import http from '../http';

const mocks = vi.hoisted(() => ({
  toast: vi.fn(), profile: vi.fn(), logout: vi.fn(), setAccessToken: vi.fn(), setPwdPending: vi.fn(),
}));
vi.mock('element-plus', () => ({ ElMessage: { error: mocks.toast } }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({
  accessToken: '', fetchProfile: mocks.profile, logoutLocal: mocks.logout,
  setAccessToken: mocks.setAccessToken, setPwdPending: mocks.setPwdPending,
}) }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
const failingAdapter = (status: number, code: number): AxiosAdapter => async config => {
  throw new AxiosError('http failed', 'ERR_BAD_RESPONSE', config, undefined, {
    status, statusText: '', config, headers: {}, data: { code, message: '接口拒绝' },
  });
};

describe('HTTP cancellation boundary', () => {
  it('does not toast or refresh authentication for an aborted request', async () => {
    const refresh = vi.spyOn(axios, 'post');
    const canceled = new CanceledError('view deactivated');
    await expect(http.get('/admin/dashboard', { adapter: async () => { throw canceled; } })).rejects.toBe(canceled);
    expect(mocks.toast).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled(); expect(mocks.profile).not.toHaveBeenCalled();
  });
  it('keeps ordinary server errors visible', async () => {
    await expect(http.get('/admin/dashboard', { adapter: failingAdapter(500, 50001) })).rejects.toMatchObject({ code: 50001 });
    expect(mocks.toast).toHaveBeenCalledWith('接口拒绝'); expect(mocks.profile).not.toHaveBeenCalled();
  });
  it('still refreshes the principal on an authorization failure', async () => {
    await expect(http.get('/admin/dashboard/exam-trend', { adapter: failingAdapter(403, 40301) })).rejects.toMatchObject({ code: 40301 });
    expect(mocks.profile).toHaveBeenCalledTimes(1); expect(mocks.toast).toHaveBeenCalledWith('接口拒绝');
  });
  it('still attempts session refresh and logs out after a final 401', async () => {
    vi.stubGlobal('location', { pathname: '/login', href: '/login' });
    const refresh = vi.spyOn(axios, 'post').mockRejectedValue(new Error('expired refresh'));
    await expect(http.get('/admin/dashboard', { adapter: failingAdapter(401, 40102) })).rejects.toMatchObject({ response: { status: 401 } });
    expect(refresh).toHaveBeenCalledTimes(1); expect(mocks.logout).toHaveBeenCalledTimes(1);
  });
});
