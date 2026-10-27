import { describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { readNativeNavigationStyle } from '../src/platform/native-layout'
import { watchNativeExamExitPrompt } from '../src/platform/native-exam-exit'

describe('WeChat custom navigation safe area', () => {
  it('reserves the status bar, home indicator and the actual capsule region', () => {
    expect(readNativeNavigationStyle({
      getWindowInfo: () => ({ windowWidth: 390, screenHeight: 844, statusBarHeight: 47, safeArea: { bottom: 810 } }),
      getMenuButtonBoundingClientRect: () => ({ left: 296, right: 383, top: 51, bottom: 83, width: 87, height: 32 }),
    })).toEqual({
      '--app-safe-area-top': '47px', '--app-safe-area-bottom': '34px',
      '--app-native-nav-height': '40px', '--app-native-menu-inset': '102px', '--app-native-title-inset': '102px',
    })
  })

  it('keeps usable fallbacks when an old base library cannot read the capsule', () => {
    expect(readNativeNavigationStyle({ getWindowInfo: () => ({ windowWidth: 375, screenHeight: 667, statusBarHeight: 20 }) }))
      .toEqual({ '--app-safe-area-top': '20px', '--app-safe-area-bottom': '0px', '--app-native-nav-height': '44px', '--app-native-menu-inset': '0px', '--app-native-title-inset': '84px' })
    expect(readNativeNavigationStyle({})).toEqual({})
    expect(readNativeNavigationStyle({ getWindowInfo: () => { throw new Error('unsupported') } })).toEqual({})
  })

  it('ignores invalid capsule coordinates instead of hiding the page controls', () => {
    expect(readNativeNavigationStyle({
      getWindowInfo: () => ({ windowWidth: 390, screenHeight: 844, statusBarHeight: 47 }),
      getMenuButtonBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }),
    })).toMatchObject({ '--app-native-nav-height': '44px', '--app-native-menu-inset': '0px' })
  })
})

describe('native exam exit prompt lifecycle', () => {
  it('disables before a confirmed exit navigates and cannot enable again after disposal', () => {
    const phase = ref('answering'), leaving = ref(false), locked = ref(false)
    const events: string[] = []
    const dispose = watchNativeExamExitPrompt(
      computed(() => !leaving.value && phase.value === 'answering' && !locked.value),
      { enableAlertBeforeUnload: ({ message }) => { expect(message).toContain('草稿'); events.push('enable') }, disableAlertBeforeUnload: () => events.push('disable') },
    )
    leaving.value = true
    events.push('navigate')
    expect(events).toEqual(['enable', 'disable', 'navigate'])
    dispose(); leaving.value = false
    expect(events).toEqual(['enable', 'disable', 'navigate'])
  })

  it('turns off on submission or hide, restores on answering/show and cleans up on unload', () => {
    const phase = ref('answering'), visible = ref(true), events: string[] = []
    const dispose = watchNativeExamExitPrompt(computed(() => visible.value && phase.value === 'answering'), { enableAlertBeforeUnload: () => events.push('enable'), disableAlertBeforeUnload: () => events.push('disable') })
    phase.value = 'submitting'; phase.value = 'uncertain'; phase.value = 'answering'
    visible.value = false; visible.value = true; dispose(); dispose()
    expect(events).toEqual(['enable', 'disable', 'enable', 'disable', 'enable', 'disable'])
  })

  it('does not fail on unsupported libraries or rejected native calls', () => {
    const active = ref(true)
    const dispose = watchNativeExamExitPrompt(active, {})
    active.value = false; dispose()
    const rejected = watchNativeExamExitPrompt(ref(true), { enableAlertBeforeUnload: () => { throw new Error('unsupported') }, disableAlertBeforeUnload: vi.fn() })
    expect(rejected).not.toThrow()
  })

  it('still removes the current prompt when an older enable call fails after show', () => {
    const active = ref(true), failures: Array<() => void> = [], events: string[] = []
    const dispose = watchNativeExamExitPrompt(active, {
      enableAlertBeforeUnload: options => { failures.push(options.fail!); events.push('enable') },
      disableAlertBeforeUnload: () => events.push('disable'),
    })
    active.value = false; active.value = true; failures[0](); dispose()
    expect(events).toEqual(['enable', 'disable', 'enable', 'disable'])
  })
})
