/** 短票据使用剩余时间的一半留给续签；长票据提前十秒。 */
export function mediaTicketRenewalDelay(expiresAt: number): number {
  const remaining = Math.max(0, expiresAt - Date.now());
  return Math.min(2147483647, Math.floor(remaining - Math.min(10000, remaining / 2)));
}

export function mediaTicketRetryDelay(expiresAt: number): number {
  return expiresAt > 0 ? Math.min(1000, mediaTicketRenewalDelay(expiresAt)) : 1000;
}
