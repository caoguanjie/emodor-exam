import { describe, expect, it } from 'vitest'
import type { RouteScenario } from '../src/fixtures/types'

const catalogModule = '../src/fixtures/route-catalog/' + 'shell.ts'
const scenarioModule = '../src/fixtures/ui-scenarios/' + 'shell.ts'

describe('shell static routes', () => {
  it('keeps every shell page reachable through a named Pencil state', async () => {
    const { shellRouteCatalog = [] } = await import(catalogModule).catch(() => ({}))
    expect(shellRouteCatalog.map((item: RouteScenario) => item.path)).toEqual(expect.arrayContaining([
      '/pages/auth/login', '/pages/home/index', '/pages/course/index',
      '/pages/course/detail', '/pages/course/player', '/pages/profile/index',
      '/pages/profile/info', '/pages/profile/about', '/pages/profile/terms',
    ]))
    expect(shellRouteCatalog).toEqual(expect.arrayContaining([
      { path: '/pages/auth/login', scenario: 'login-send-failed', pencilBoard: 'O1zuf', expectedText: '验证码发送失败，请检查网络后重试' },
      { path: '/pages/course/player', scenario: 'course-no-video', pencilBoard: 't6Z5eu', expectedText: '课程视频尚未提供' },
      { path: '/pages/profile/info', scenario: 'profile-job', pencilBoard: 'KNYYf', expectedText: '选择工种' },
    ]))
  })

  it('resolves a known query state and falls back for malformed or foreign states', async () => {
    const { resolveShellScenario = () => undefined } = await import(scenarioModule).catch(() => ({}))
    expect(resolveShellScenario('login-sent', 'login-default')?.loginState).toBe('sent')
    expect(resolveShellScenario(['login-error'], 'login-default')?.loginState).toBe('idle')
    expect(resolveShellScenario('missing-state', 'course-list')?.id).toBe('course-list')
    expect(resolveShellScenario('profile-job', 'login-default')?.id).toBe('login-default')
  })

  it('returns fresh state, including a fresh chapter array, for every route entry', async () => {
    const { resolveShellScenario = () => undefined } = await import(scenarioModule).catch(() => ({}))
    const first = resolveShellScenario('course-collapsed', 'course-video')
    first.collapsedChapters.push('closure')
    const second = resolveShellScenario('course-collapsed', 'course-video')
    expect(second).not.toBe(first)
    expect(second.collapsedChapters).toEqual(['hazards'])
  })

  it('distinguishes expired codes, verified identity and folded chapters without an API', async () => {
    const { shellScenarios = {} } = await import(scenarioModule).catch(() => ({}))
    expect(shellScenarios['login-expired']?.message).toBe('验证码错误或已过期，请重新获取')
    expect(shellScenarios['profile-verified']?.verified).toBe(true)
    expect(shellScenarios['course-collapsed']?.collapsedChapters).toEqual(['hazards'])
  })

  it('protects authoritative identity fields while allowing ordinary profile choices', async () => {
    const { isProfileFieldReadonly = () => false } = await import(scenarioModule).catch(() => ({}))
    expect(isProfileFieldReadonly('name')).toBe(true)
    expect(isProfileFieldReadonly('phone')).toBe(true)
    expect(isProfileFieldReadonly('job')).toBe(false)
    expect(isProfileFieldReadonly('gender')).toBe(false)
    expect(isProfileFieldReadonly('birthday')).toBe(false)
  })
})
