export function createServerClock(deadlineAt: string, serverNow: string, now = () => Date.now()) {
  const deadline = Date.parse(deadlineAt), offset = Date.parse(serverNow) - now()
  if (!Number.isFinite(deadline) || !Number.isFinite(offset)) throw new Error('考试时间数据无效，请重新加载')
  const remainingMs = () => Math.max(0, deadline - (now() + offset))
  return { remainingSeconds: () => Math.ceil(remainingMs() / 1000), expired: () => remainingMs() === 0 }
}
