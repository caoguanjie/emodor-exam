import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createProtectedImageController, type ProtectedImageContext } from '../src/platform/protected-image'

const mocks = vi.hoisted(() => ({ ticket: vi.fn() }))
vi.mock('../src/api/media', () => ({ getMediaTicket: mocks.ticket }))
const ticket = { content_url: '/api/v1/media/tickets/fixture/content', expires_at: '2099-01-01T00:00:00.000Z' }
let context: ProtectedImageContext
beforeEach(() => { vi.resetAllMocks(); setActivePinia(createPinia()); context = { assetId: '901', ownerType: 'sys_user_avatar', ownerId: '17', epoch: 1, userId: '17', authenticated: true, loggingIn: false }; mocks.ticket.mockResolvedValue(ticket) })
afterEach(() => { vi.useRealTimers() })
describe('protected image account boundary', () => {
  it('does not redisplay a deterministic same-second image signature or geometrically chase its expiry', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    mocks.ticket.mockImplementation(async () => { const second = Math.floor(Date.now() / 1000); return { content_url: `/api/v1/media/tickets/signed-${second}/content`, expires_at: new Date(second * 1000 + 1000).toISOString() } });
    const show = vi.fn(), image = createProtectedImageController({ read: () => context, show }); image.update();
    await vi.advanceTimersByTimeAsync(999); expect(mocks.ticket).toHaveBeenCalledTimes(2); expect(show.mock.calls.filter(call => call[0])).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(551); expect(mocks.ticket).toHaveBeenCalledTimes(3); expect(show.mock.calls.filter(call => call[0])).toHaveLength(2); image.dispose();
  });
  it('ends an image renewal after the same signature repeats across a UTC-second boundary', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    const fixed = { ...ticket, expires_at: new Date(Date.now() + 300000).toISOString() }; context = { ...context, initialTicket: fixed }; mocks.ticket.mockResolvedValue(fixed);
    const show = vi.fn(), image = createProtectedImageController({ read: () => context, show }); image.update();
    await vi.advanceTimersByTimeAsync(310000); expect(mocks.ticket).toHaveBeenCalledTimes(2); expect(show).toHaveBeenLastCalledWith(''); image.dispose();
  });
  it.each([1000, 5000, 300000].flatMap(ttl => [0, 200, 800].map(latency => ({ ttl, latency }))))('renews a $ttl ms image ticket before expiry after $latency ms response latency', async ({ ttl, latency }) => {
    vi.useFakeTimers(); const started = Date.now(), calls: number[] = [];
    mocks.ticket.mockImplementation(() => { const issued = Date.now(); calls.push(issued); return new Promise(resolve => setTimeout(() => resolve({ ...ticket, expires_at: new Date(issued + ttl).toISOString() }), latency)) });
    const image = createProtectedImageController({ read: () => context, show: vi.fn() }); image.update();
    await vi.advanceTimersByTimeAsync(ttl - 1);
    expect(calls.length).toBeGreaterThanOrEqual(2); expect(calls[1]).toBeLessThan(started + ttl); image.dispose();
  });
  it('shares an in-flight image renewal with an image-error retry instead of sending another request', async () => {
    vi.useFakeTimers(); context = { ...context, initialTicket: { ...ticket, expires_at: new Date(Date.now() + 5000).toISOString() } };
    let finish!: (value: typeof ticket) => void; mocks.ticket.mockImplementation(() => new Promise(resolve => { finish = resolve }));
    const image = createProtectedImageController({ read: () => context, show: vi.fn() }); image.update();
    await vi.advanceTimersByTimeAsync(4999); image.retry(); expect(mocks.ticket).toHaveBeenCalledTimes(1);
    finish(ticket); await Promise.resolve(); image.dispose();
  });
  it('retries a failed image address request at most once and clears the image after both fail', async () => {
    vi.useFakeTimers(); const show = vi.fn(); context = { ...context, initialTicket: { ...ticket, expires_at: new Date(Date.now() + 1000).toISOString() } };
    mocks.ticket.mockRejectedValue(Object.assign(new Error('offline'), { code: -1, status: 0 }));
    const image = createProtectedImageController({ read: () => context, show }); image.update();
    await vi.advanceTimersByTimeAsync(5000); expect(mocks.ticket).toHaveBeenCalledTimes(2); expect(show).toHaveBeenLastCalledWith(''); image.dispose();
  });
  it('does not turn an epoch invalidation into a new request using the old token', async () => {
    const show = vi.fn(); const image = createProtectedImageController({ read: () => context, show })
    image.update(); await vi.waitFor(() => expect(show).toHaveBeenLastCalledWith(expect.stringContaining('/api/v1/media/tickets/fixture/content')))
    context = { ...context, epoch: 2 }; image.update()
    expect(show).toHaveBeenLastCalledWith(''); expect(mocks.ticket).toHaveBeenCalledTimes(1)
    context = { ...context, authenticated: false }; image.update()
    context = { ...context, userId: '18', authenticated: true }; image.update()
    await vi.waitFor(() => expect(mocks.ticket).toHaveBeenCalledTimes(2)); image.dispose()
  })
  it('never displays a late response from the previous asset or previous account', async () => {
    let finish!: (value: typeof ticket) => void
    mocks.ticket.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const show = vi.fn(); const image = createProtectedImageController({ read: () => context, show })
    image.update(); context = { ...context, epoch: 2 }; image.update(); finish(ticket)
    await Promise.resolve(); await Promise.resolve(); expect(show.mock.calls.some(call => call[0].includes?.('/fixture/'))).toBe(false); image.dispose()
  })
  it('does not reuse an initial ticket after its exact owner tuple changes', async () => {
    context = { ...context, initialTicket: ticket }
    const show = vi.fn(); const image = createProtectedImageController({ read: () => context, show })
    image.update(); expect(mocks.ticket).not.toHaveBeenCalled()
    context = { ...context, assetId: '902', ownerId: '18' }; image.update()
    expect(mocks.ticket).toHaveBeenCalledWith('902', 'sys_user_avatar', '18'); image.dispose()
  })
})
