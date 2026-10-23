import { describe, expect, it } from 'vitest'
const path = '../src/utils/' + 'server-clock.ts'
describe('server deadline clock', () => {
  it('calibrates the server offset and never adds offline or background time back', async () => {
    const { createServerClock = () => ({ remainingSeconds: () => 0, expired: () => false }) } = await import(path).catch(() => ({}))
    let local = Date.parse('2026-10-22T10:00:00Z')
    const clock = createServerClock('2026-10-22T10:01:10Z', '2026-10-22T10:01:00Z', () => local)
    expect(clock.remainingSeconds()).toBe(10)
    local += 3000; expect(clock.remainingSeconds()).toBe(7)
    local += 8000; expect(clock.remainingSeconds()).toBe(0); expect(clock.expired()).toBe(true)
  })
})
