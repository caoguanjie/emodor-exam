import { describe, expectTypeOf, it } from 'vitest'
import type { SessionTransport } from '../src/platform/session'
import type { MediaPicker, PickedMedia } from '../src/platform/media-picker'
import type {
  MediaPlayerAdapter,
  MediaPlayerSnapshot,
  MediaPlayerState,
} from '../src/platform/media-player'
import type { NavigationGuard } from '../src/platform/navigation'

describe('platform adapter contracts', () => {
  it('returns an access token from refresh and no value from logout', () => {
    expectTypeOf<SessionTransport['refresh']>().toEqualTypeOf<() => Promise<string>>()
    expectTypeOf<SessionTransport['logout']>().toEqualTypeOf<() => Promise<void>>()
  })

  it('limits identity capture to an ID side or a live face', () => {
    expectTypeOf<MediaPicker['pickIdentitySide']>()
      .toEqualTypeOf<(side: 'portrait' | 'emblem') => Promise<PickedMedia>>()
    expectTypeOf<MediaPicker['captureLiveFace']>()
      .toEqualTypeOf<() => Promise<PickedMedia>>()
    expectTypeOf<PickedMedia>().toEqualTypeOf<{
      tempFilePath: string
      size: number
      mimeType?: string
    }>()
  })

  it('asks the exam screen whether navigation may continue', () => {
    expectTypeOf<NavigationGuard['confirmExitExam']>()
      .toEqualTypeOf<() => Promise<boolean>>()
  })

  it('normalizes playback into millisecond snapshots with a disposable subscription', () => {
    expectTypeOf<MediaPlayerState>().toEqualTypeOf<
      'idle' | 'playing' | 'paused' | 'buffering' | 'background' | 'ended' | 'error'
    >()
    expectTypeOf<MediaPlayerSnapshot>().toEqualTypeOf<{
      state: MediaPlayerState
      positionMs: number
      durationMs?: number
      error?: { code?: string; message?: string }
    }>()
    expectTypeOf<MediaPlayerAdapter['play']>().toEqualTypeOf<() => void>()
    expectTypeOf<MediaPlayerAdapter['pause']>().toEqualTypeOf<() => void>()
    expectTypeOf<MediaPlayerAdapter['seek']>()
      .toEqualTypeOf<(positionMs: number) => void>()
    expectTypeOf<MediaPlayerAdapter['subscribe']>()
      .toEqualTypeOf<(listener: (snapshot: MediaPlayerSnapshot) => void) => () => void>()
  })
})
