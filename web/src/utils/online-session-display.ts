/** Display helpers keep session validity separate from actual user presence. */
function sessionDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const shanghaiDateTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function formatSessionDateTime(value: string | number | Date | null | undefined): string {
  const date = sessionDate(value);
  if (!date) return '—';
  const parts = Object.fromEntries(shanghaiDateTime.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function sessionRelativeTime(value: string | number | Date | null | undefined, now = Date.now()): string {
  const date = sessionDate(value);
  if (!date) return '—';
  const seconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

export function sessionDeviceLabel(userAgent: string | null | undefined, client?: 'pc' | 'mobile'): string {
  const agent = userAgent || '';
  const ipad = /iPad/i.test(agent) || (/Macintosh/i.test(agent) && /Mobile/i.test(agent));
  const ios = ipad || /iPhone|iPod/i.test(agent);
  const android = /Android/i.test(agent);
  const os = ios ? 'iOS' : /HarmonyOS|OpenHarmony/i.test(agent) ? 'HarmonyOS' : android ? 'Android'
    : /Windows/i.test(agent) ? 'Windows' : /Macintosh|Mac OS X/i.test(agent) ? 'macOS' : /Linux/i.test(agent) ? 'Linux' : '未知系统';
  const device = ipad || (android && !/Mobile/i.test(agent)) ? '平板'
    : /iPhone|iPod|Mobile/i.test(agent) ? '手机'
      : /Windows|Macintosh|Mac OS X|Linux/i.test(agent) || client === 'pc' ? '电脑'
        : client === 'mobile' ? '移动端' : '未知设备';
  const browser = /MicroMessenger/i.test(agent) ? '微信' : /Edg(?:A|iOS)?\//i.test(agent) ? 'Edge'
    : /OPR\/|Opera/i.test(agent) ? 'Opera' : /Firefox\/|FxiOS\//i.test(agent) ? 'Firefox'
      : /Chrome\/|CriOS\//i.test(agent) ? 'Chrome' : /Safari\//i.test(agent) ? 'Safari' : '未知浏览器';
  return `${device} · ${browser} / ${os}`;
}
