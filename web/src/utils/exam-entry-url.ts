/** A shared navigation shortcut; never include a paper, account or authorization token. */
export function buildExamEntryUrl(baseUrl: string): string {
  if (!baseUrl.trim()) throw new Error('请配置 VITE_PUBLIC_H5_BASE_URL 为学员 H5 的公开地址（包含部署路径）');
  let url: URL;
  try { url = new URL(baseUrl.trim()); }
  catch { throw new Error('VITE_PUBLIC_H5_BASE_URL 须为完整的 http(s) 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('VITE_PUBLIC_H5_BASE_URL 须为不含账号、查询参数和路由片段的 http(s) 基础地址');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '0.0.0.0' || /^127\./.test(hostname) || hostname === '[::1]') {
    throw new Error('请配置手机可访问的 H5 公开地址，不能使用 localhost 或回环地址');
  }
  if (!url.pathname.endsWith('/') && !url.pathname.endsWith('/index.html')) url.pathname += '/';
  url.hash = '/pages/exam/index';
  return url.toString();
}
