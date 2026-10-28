/** Browser UUIDs keep working on HTTP origins where randomUUID is not exposed. */
export function createUuid(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    try { return cryptoApi.randomUUID(); } catch { /* Use the other secure browser source below. */ }
  }
  if (typeof cryptoApi?.getRandomValues === 'function') {
    try {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    } catch { /* Never replace secure randomness with time or Math.random. */ }
  }
  throw new Error('当前浏览器不支持安全随机数，请更换浏览器或使用 HTTPS 后重试');
}
