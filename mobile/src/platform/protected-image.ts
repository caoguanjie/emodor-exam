import type { MediaTicketView } from '@/api/media'
import { getMediaTicket } from '@/api/media'
import { resolveMediaUrl } from './media-url'
import { mediaTicketNextSignatureDelay, mediaTicketRenewalDelay, mediaTicketRetryDelay } from './media-ticket-timing'
export interface ProtectedImageContext {
  assetId: string; ownerType: string; ownerId: string; epoch: number; userId: string;
  authenticated: boolean; loggingIn: boolean; initialTicket?: MediaTicketView
}
export function createProtectedImageController(options: { read(): ProtectedImageContext; show(url: string): void }) {
  const initial = { ...options.read() }
  let previous: ProtectedImageContext | null = null
  let revision = 0, retried = false, disposed = false, timer: ReturnType<typeof setTimeout> | undefined
  let expiresAt = 0, source = '', cancelRetry: (() => void) | undefined
  let flight: { generation: number; context: ProtectedImageContext; promise: Promise<void> } | null = null
  const sameOwner = (a: ProtectedImageContext, b: ProtectedImageContext) => a.assetId === b.assetId && a.ownerType === b.ownerType && a.ownerId === b.ownerId
  const sameSession = (a: ProtectedImageContext, b: ProtectedImageContext) => a.epoch === b.epoch && a.userId === b.userId && a.authenticated === b.authenticated && a.loggingIn === b.loggingIn
  const current = (generation: number, context: ProtectedImageContext) => !disposed && generation === revision && sameOwner(context, options.read()) && sameSession(context, options.read())
  function clear() { revision++; clearTimeout(timer); timer = undefined; cancelRetry?.(); cancelRetry = undefined; flight = null; expiresAt = 0; source = ''; options.show('') }
  function display(ticket: MediaTicketView, generation: number, context: ProtectedImageContext) {
    if (!current(generation, context)) return false
    const remaining = Date.parse(ticket.expires_at) - Date.now()
    if (!Number.isFinite(remaining) || remaining <= 0) throw new Error('图片地址已过期')
    const nextSource = resolveMediaUrl(ticket.content_url)
    if (nextSource === source) return false
    source = nextSource; options.show(source)
    expiresAt = Date.parse(ticket.expires_at)
    timer = setTimeout(() => { if (current(generation, context)) void load() }, mediaTicketRenewalDelay(expiresAt))
    return true
  }
  function waitForRetry(delay: number): Promise<boolean> {
    return new Promise(resolve => {
      const retryTimer = setTimeout(() => { cancelRetry = undefined; resolve(true) }, delay)
      cancelRetry = () => { clearTimeout(retryTimer); resolve(false) }
    })
  }
  function load(): Promise<void> {
    if (flight && current(flight.generation, flight.context)) return flight.promise
    const context = { ...options.read() }, generation = ++revision
    clearTimeout(timer); timer = undefined
    if (!context.assetId || !context.ownerId || !context.authenticated || !context.userId || context.loggingIn) { options.show(''); return Promise.resolve() }
    const promise = (async () => {
      let networkRetries = 0, duplicateRetries = 0
      while (current(generation, context)) {
        try {
          const ticket = await getMediaTicket(context.assetId, context.ownerType, context.ownerId)
          if (!current(generation, context)) return
          if (display(ticket, generation, context)) return
          if (duplicateRetries++ >= 1) { options.show(''); return }
          if (!await waitForRetry(mediaTicketNextSignatureDelay())) return
        } catch (error) {
          if (!current(generation, context)) return
          const failure = error as { code?: number; status?: number }
          if (networkRetries++ === 0 && (Number(failure?.code) <= 0 || Number(failure?.status) >= 500)) {
            const retry = await waitForRetry(mediaTicketRetryDelay(expiresAt))
            if (retry) continue
            return
          }
          options.show(''); return
        }
      }
    })().finally(() => { if (flight?.promise === promise) flight = null })
    flight = { generation, context, promise }
    return promise
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
