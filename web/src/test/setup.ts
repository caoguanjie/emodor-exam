import { afterEach } from 'vitest';

afterEach(() => { if (typeof document !== 'undefined') document.body.innerHTML = ''; });

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!globalThis.matchMedia) {
  globalThis.matchMedia = (query: string): MediaQueryList => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false,
  });
}
