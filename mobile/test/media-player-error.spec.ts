import { describe, expect, it } from 'vitest'
import { nativeVideoFailure } from '../src/platform/media-player'

describe('native media error classification', () => {
  it.each([[2, 'network'], [3, 'decode'], [4, 'unsupported']] as const)('preserves the HTMLMediaError %i category', (code, expected) => {
    expect(nativeVideoFailure({ target: { error: { code } } })).toBe(expected)
  })
  it.each([['MEDIA_ERR_NETWORK', 'network'], ['MEDIA_ERR_DECODE', 'decode'], ['MEDIA_ERR_SRC_NOT_SUPPORTED', 'unsupported']] as const)('recognizes a provider-supplied standard error name %s without exposing its message', (errMsg, expected) => {
    expect(nativeVideoFailure({ detail: { errMsg } })).toBe(expected)
  })
  it('does not guess an unknown provider failure or reuse a URL embedded in an error message', () => {
    expect(nativeVideoFailure({ detail: { errMsg: 'unexpected failure https://foreign.example/?credential=fixture' } })).toBe('unknown')
    expect(nativeVideoFailure(undefined)).toBe('unknown')
  })
})
