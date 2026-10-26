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
