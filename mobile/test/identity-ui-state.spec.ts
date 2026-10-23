import { describe, expect, it } from 'vitest'
import { canSubmitIdentity } from '../src/types/identity'
import type { IdentityAssetState, IdentityMaterialKind } from '../src/types/identity'
import { identityScenarios, resolveIdentityScenario } from '../src/fixtures/ui-scenarios/identity'
import { identityRouteCatalog } from '../src/fixtures/route-catalog/identity'

describe('identity material submission', () => {
  it('requires all three ready materials and explicit consent', () => {
    expect(canSubmitIdentity({ portrait: 'ready', emblem: 'ready', face: 'ready', consent: true })).toBe(true)
    expect(canSubmitIdentity({ portrait: 'ready', emblem: 'ready', face: 'ready', consent: false })).toBe(false)
    expect(canSubmitIdentity({ portrait: 'ready', emblem: 'ready', face: null, consent: true })).toBe(false)
    expect(canSubmitIdentity({ portrait: null, emblem: 'ready', face: 'ready', consent: true })).toBe(false)
    expect(canSubmitIdentity({ portrait: 'ready', emblem: null, face: 'ready', consent: true })).toBe(false)
  })

  it('blocks uploading, unreadable or unsafe material instead of treating any selection as ready', () => {
    expect(canSubmitIdentity({ portrait: 'ready', emblem: 'uploading', face: 'ready', consent: true })).toBe(false)
    expect(canSubmitIdentity({ portrait: 'ready', emblem: 'error', face: 'ready', consent: true })).toBe(false)
    expect(canSubmitIdentity({ portrait: 'unsafe', emblem: 'ready', face: 'ready', consent: true })).toBe(false)
  })

  it.each<{ kind: IdentityMaterialKind; state: IdentityAssetState }>([
    { kind: 'portrait', state: 'uploading' }, { kind: 'portrait', state: 'error' },
    { kind: 'emblem', state: 'unsafe' },
    { kind: 'face', state: 'uploading' }, { kind: 'face', state: 'error' }, { kind: 'face', state: 'unsafe' },
  ])('blocks $kind material in the $state state', ({ kind, state }) => {
    expect(canSubmitIdentity({ portrait: 'ready', emblem: 'ready', face: 'ready', consent: true, [kind]: state })).toBe(false)
  })
})

describe('identity static routes', () => {
  it('makes the collection, result and recovery boards independently reachable', () => {
    expect(identityRouteCatalog.map(route => route.pencilBoard)).toEqual(expect.arrayContaining([
      'mRBVM', 'MEvwS', 'OMfFk', 'rWuDB', 'FuNk8', 'z3zF4', 'WfDJI', 'ePapq',
      'P0rCMp', 'nJHTm', 'M3UfG', 'D8wgXK', 'OLXgA', 'uD0Us', 'oD7Ix', 'XYPSP',
    ]))
    expect(identityRouteCatalog).toEqual(expect.arrayContaining([
      { path: '/pages/identity/index', scenario: 'identity-pending', pencilBoard: 'WfDJI', expectedText: '认证结果处理中' },
      { path: '/pages/identity/detail', scenario: 'identity-detail', pencilBoard: 'P0rCMp', expectedText: '已通过实名认证' },
    ]))
  })

  it('rejects malformed, unknown and foreign-page query states', () => {
    expect(resolveIdentityScenario('identity-ready', 'identity-collect')?.id).toBe('identity-ready')
    expect(resolveIdentityScenario(['identity-ready'], 'identity-collect')?.id).toBe('identity-collect')
    expect(resolveIdentityScenario('missing', 'identity-collect')?.id).toBe('identity-collect')
    expect(resolveIdentityScenario('identity-detail', 'identity-collect')?.id).toBe('identity-collect')
    expect(resolveIdentityScenario('identity-ready', 'identity-detail')?.id).toBe('identity-detail')
  })

  it('returns fresh scenario and material objects for a new page entry', () => {
    const first = resolveIdentityScenario('identity-ready', 'identity-collect')
    first.materials.face = 'error'
    const second = resolveIdentityScenario('identity-ready', 'identity-collect')
    expect(second).not.toBe(first)
    expect(second.materials).not.toBe(first.materials)
    expect(second.materials.face).toBe('ready')
  })

  it('keeps submitted material pending until a verified result exists', () => {
    expect(identityScenarios['identity-uploading']?.state).toBe('collecting')
    expect(identityScenarios['identity-verifying']?.state).toBe('submitting')
    expect(identityScenarios['identity-pending']?.state).toBe('pending')
    expect(identityScenarios['identity-success']?.state).toBe('verified')
  })

  it('retains the unaffected materials when only the face or emblem needs replacement', () => {
    expect(identityScenarios['identity-face-rejected']?.materials).toEqual({ portrait: 'ready', emblem: 'ready', face: 'error', consent: true })
    expect(identityScenarios['identity-emblem-rejected']?.materials).toEqual({ portrait: 'ready', emblem: 'error', face: 'ready', consent: true })
    expect(identityScenarios['identity-upload-failed']?.materials).toEqual({ portrait: 'ready', emblem: 'error', face: 'ready', consent: true })
  })
})
