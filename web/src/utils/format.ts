/**
 * 展示格式化工具：接口时间戳为 ISO UTC 字符串，列表直接绑定会显示原始串（如 2026-09-13T07:30:37.273Z），
 * 统一经此转换为本地时区可读格式；空值显示占位符。
 */
export function formatDateTime(v: string | number | Date | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
