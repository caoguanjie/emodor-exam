import { describe, expect, it } from 'vitest'
import { learnerLandingUrl, needsLearnerProfile, identityNeedsProfile } from '../src/utils/learner-onboarding'

describe('learner onboarding routing', () => {
  it('requires both a trimmed name and a confirmed category, but no avatar', () => {
    expect(needsLearnerProfile({ real_name: '  ', category_id: 3 })).toBe(true)
    expect(needsLearnerProfile({ real_name: '学员', category_id: null })).toBe(true)
    expect(needsLearnerProfile({ real_name: '学员', category_id: '9007199254740993' })).toBe(false)
    expect(learnerLandingUrl({ real_name: '', category_id: null })).toBe('/pages/profile/info?onboarding=1')
    expect(learnerLandingUrl({ real_name: '学员', category_id: 3 })).toBe('/pages/home/index')
  })
  it('allows existing pending or verified identity results to be read even if old profile data is incomplete', () => {
    const missing = { real_name: '', category_id: null }
    expect(identityNeedsProfile('unverified', missing)).toBe(true)
    expect(identityNeedsProfile('rejected', missing)).toBe(true)
    expect(identityNeedsProfile('pending', missing)).toBe(false)
    expect(identityNeedsProfile('verified', missing)).toBe(false)
  })
})
