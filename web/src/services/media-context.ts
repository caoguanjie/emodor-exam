export type MediaContext = { userId: string; epoch: number };
let epoch = 0;
const listeners = new Set<() => void>();

export function mediaContext(): MediaContext {
  let userId = '';
  try {
    const value = JSON.parse(sessionStorage.getItem('re_user') || 'null');
    const id = String(value?.id ?? '');
    if (/^[1-9]\d*$/.test(id)) userId = id;
  } catch { /* no persisted principal */ }
  return { userId, epoch };
}
export function isMediaContextCurrent(context: MediaContext): boolean {
  const current = mediaContext();
  return current.epoch === context.epoch && current.userId === context.userId;
}
export function invalidateMediaContext(): number {
  epoch += 1;
  for (const listener of listeners) listener();
  return epoch;
}
export function onMediaContextChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
