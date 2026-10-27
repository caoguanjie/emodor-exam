interface WindowInfo {
  windowWidth?: number
  screenHeight?: number
  statusBarHeight?: number
  safeArea?: { bottom: number }
}
interface MenuRect { left: number; right: number; top: number; bottom: number; width: number; height: number }
interface NativeLayoutApi {
  getWindowInfo?: () => WindowInfo
  getMenuButtonBoundingClientRect?: () => MenuRect
}
type NavigationStyle = Record<string, string>
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** Read native coordinates only; unavailable or invalid capsule data keeps a normal 44px bar. */
export function readNativeNavigationStyle(api: NativeLayoutApi): NavigationStyle {
  if (typeof api.getWindowInfo !== 'function') return {}
  let window: WindowInfo
  try { window = api.getWindowInfo() } catch { return {} }
  if (!window || typeof window !== 'object') return {}
  const status = finite(window.statusBarHeight) && window.statusBarHeight >= 0 && window.statusBarHeight <= 100 ? window.statusBarHeight : 0
  const bottom = finite(window.screenHeight) && finite(window.safeArea?.bottom)
    ? Math.max(0, Math.min(100, window.screenHeight - window.safeArea.bottom)) : 0
  let height = 44, inset = 0
  try {
    const rect = api.getMenuButtonBoundingClientRect?.(), width = window.windowWidth
    if (rect && finite(width) && width > 0 && Object.values(rect).every(finite)
      && rect.left > width / 2 && rect.right <= width && rect.right > rect.left && rect.width > 0
      && rect.top >= status && rect.bottom > rect.top && rect.height > 0 && rect.height <= 64
      && rect.bottom <= status + 100) {
      height = rect.height + 2 * (rect.top - status)
      inset = width - rect.left + 8
    }
  } catch { /* Older base libraries may expose an unsupported capsule API. */ }
  return { '--app-safe-area-top': `${status}px`, '--app-safe-area-bottom': `${bottom}px`, '--app-native-nav-height': `${height}px`, '--app-native-menu-inset': `${inset}px`, '--app-native-title-inset': `${Math.max(84, inset)}px` }
}

/** H5 retains its existing CSS env() safe areas and layout. */
export function nativeNavigationStyle(): NavigationStyle {
  // #ifdef MP-WEIXIN
  if (typeof uni !== 'undefined') return readNativeNavigationStyle(uni)
  // #endif
  return {}
}
