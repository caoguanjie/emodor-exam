import { describe, expect, it } from 'vitest';
import { formatSessionDateTime, sessionDeviceLabel, sessionRelativeTime } from '../online-session-display';

describe('online session display', () => {
  it('always formats UTC timestamps as Shanghai time including seconds', () => {
    expect(formatSessionDateTime('2026-10-27T05:28:44.005Z')).toBe('2026-10-27 13:28:44');
    expect(formatSessionDateTime('2026-10-26T16:00:01Z')).toBe('2026-10-27 00:00:01');
    expect(formatSessionDateTime(null)).toBe('—'); expect(formatSessionDateTime('bad-date')).toBe('—');
  });

  it('uses elapsed time without exposing raw timestamps', () => {
    const now = new Date('2026-10-27T06:04:00Z').getTime();
    expect(sessionRelativeTime('2026-10-27T06:03:40Z', now)).toBe('刚刚');
    expect(sessionRelativeTime('2026-10-27T06:01:00Z', now)).toBe('3 分钟前');
    expect(sessionRelativeTime('2026-10-27T04:00:00Z', now)).toBe('2 小时前');
    expect(sessionRelativeTime('2026-10-25T06:04:00Z', now)).toBe('2 天前');
    expect(sessionRelativeTime(null, now)).toBe('—'); expect(sessionRelativeTime('bad-date', now)).toBe('—');
  });

  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/156.0.0.0 Safari/537.36', 'pc', '电脑 · Chrome / macOS'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0', 'pc', '电脑 · Edge / Windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1', 'mobile', '手机 · Safari / iOS'],
    ['Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) Version/18.5 Mobile/15E148 Safari/604.1', 'mobile', '平板 · Safari / iOS'],
    ['Mozilla/5.0 (Linux; Android 16; Phone) AppleWebKit/537.36 Chrome/132.0.0.0 Mobile Safari/537.36', 'mobile', '手机 · Chrome / Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) CriOS/132.0.0.0 Mobile Safari/604.1', 'mobile', '手机 · Chrome / iOS'],
    ['Mozilla/5.0 (Linux; Android 16) Chrome/132.0.0.0 Mobile MicroMessenger/8.0', 'mobile', '手机 · 微信 / Android'],
    [null, 'pc', '电脑 · 未知浏览器 / 未知系统'],
    ['unrecognized-client', 'mobile', '移动端 · 未知浏览器 / 未知系统'],
  ])('summarizes the user agent without losing browser family: %s', (agent, client, want) => {
    expect(sessionDeviceLabel(agent, client as 'pc' | 'mobile')).toBe(want);
  });
});
