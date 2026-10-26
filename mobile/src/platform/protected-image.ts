import type { MediaTicketView } from '@/api/media'
import { getMediaTicket } from '@/api/media'
import { resolveMediaUrl } from './media-url'
export interface ProtectedImageContext {
  assetId: string; ownerType: string; ownerId: string; epoch: number; userId: string;
  authenticated: boolean; loggingIn: boolean; initialTicket?: MediaTicketView
}
export function createProtectedImageController(options: { read(): ProtectedImageContext; show(url: string): void }) {
  const initial = { ...options.read() }
  let previous: ProtectedImageContext | null = null
  let revision = 0, retried = false, disposed = false, timer: ReturnType<typeof setTimeout> | undefined
  const sameOwner = (a: ProtectedImageContext, b: ProtectedImageContext) => a.assetId === b.assetId && a.ownerType === b.ownerType && a.ownerId === b.ownerId
  const sameSession = (a: ProtectedImageContext, b: ProtectedImageContext) => a.epoch === b.epoch && a.userId === b.userId && a.authenticated === b.authenticated && a.loggingIn === b.loggingIn
  const current = (generation: number, context: ProtectedImageContext) => !disposed && generation === revision && sameOwner(context, options.read()) && sameSession(context, options.read())
  function clear() { revision++; clearTimeout(timer); timer = undefined; options.show('') }
  function display(ticket: MediaTicketView, generation: number, context: ProtectedImageContext) {
    if (!current(generation, context)) return
    const remaining = Date.parse(ticket.expires_at) - Date.now()
    if (!Number.isFinite(remaining) || remaining <= 0) throw new Error('图片地址已过期')
    options.show(resolveMediaUrl(ticket.content_url))
    timer = setTimeout(() => { if (current(generation, context)) void load() }, Math.min(2147483647, Math.max(1000, remaining - 10000)))
  }
  async function load() {
    const context = { ...options.read() }, generation = ++revision
    clearTimeout(timer); timer = undefined
    if (!context.assetId || !context.ownerId || !context.authenticated || !context.userId || context.loggingIn) { options.show(''); return }
    try {
      const ticket = await getMediaTicket(context.assetId, context.ownerType, context.ownerId)
      if (current(generation, context)) display(ticket, generation, context)
    } catch { if (current(generation, context)) options.show('') }
  }
  function update() {
    if (disposed) return
    const context = { ...options.read() }
    if (previous && sameOwner(previous, context) && sameSession(previous, context) && previous.initialTicket === context.initialTicket) return
    const epochChanged = previous !== null && previous.epoch !== context.epoch
    previous = context; clear(); retried = false
    // Session stores increment the epoch before clearing the previous token.
    // Wait for the subsequent identity/auth transition instead of requesting
    // another old-account ticket during that intermediate state.
    if (epochChanged || !context.authenticated || !context.userId || context.loggingIn) return
    if (context.initialTicket && sameOwner(initial, context) && initial.epoch === context.epoch && initial.userId === context.userId && Date.parse(context.initialTicket.expires_at) > Date.now()) {
      try { display(context.initialTicket, revision, context) } catch { options.show('') }
    } else void load()
  }
  function retry() { if (!retried && !disposed) { retried = true; void load() } }
  function dispose() { disposed = true; clear() }
  return { update, retry, dispose }
}
