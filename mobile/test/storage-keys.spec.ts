import { describe, expect, it } from 'vitest'
import { createMobileStorageKey } from '../src/utils/storage-keys'

describe('mobile storage isolation', () => {
  it('keeps learner drafts outside the PC namespace', () => {
    expect(createMobileStorageKey('exam-draft', 'u1', 'a1'))
      .toBe('ruleexam:mobile:u1:exam-draft:a1')
  })

  it('separates drafts belonging to different learners', () => {
    expect(createMobileStorageKey('exam-draft', 'u2', 'a1'))
      .not.toBe(createMobileStorageKey('exam-draft', 'u1', 'a1'))
  })

  it('separates different attempts for the same learner', () => {
    expect(createMobileStorageKey('exam-draft', 'u1', 'a2'))
      .not.toBe(createMobileStorageKey('exam-draft', 'u1', 'a1'))
  })

  it('allows application settings without a learner or resource', () => {
    expect(createMobileStorageKey('preferences'))
      .toBe('ruleexam:mobile:preferences')
  })

  it('escapes separators so learner and resource IDs cannot share a key', () => {
    expect(createMobileStorageKey('exam-draft', 'u:1', 'a:1'))
      .toBe('ruleexam:mobile:u%3A1:exam-draft:a%3A1')
    expect(createMobileStorageKey('exam-draft', 'u:1', 'a1'))
      .not.toBe(createMobileStorageKey('1:exam-draft', 'u', 'a1'))
  })
})
