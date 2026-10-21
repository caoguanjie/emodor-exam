import { Errors } from '../../common/errors';

/**
 * 服务端外呼 URL 主机校验（02 册 5.3 安全基线）：
 * 仅允许 http/https；发请求前校验 host，拒绝 localhost、环回、私有与保留地址字面量
 * （IPv4 保留段与 IPv6 环回/ULA/link-local/映射地址）。
 * allowHosts：显式白名单（host 或 host:port），命中则跳过内网/保留段拒绝——
 * 仅供本地开发/测试放行 Mock AI（经 AI_EGRESS_ALLOW_HOSTS 注入，生产保持为空）。
 * 注：域名解析到内网 IP 的绕过不在本检查范围，由部署边界（出网经受控 egress）兜底。
 */
export function assertPublicHttpUrl(raw: string, allowHosts: string[] = []): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw Errors.param('base_url 不是合法 URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw Errors.param('base_url 仅允许 http/https 协议');

  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw Errors.param('base_url 缺少主机名');

  // 白名单命中（host 精确匹配，或 host:port 精确匹配）→ 跳过后续内网/保留段校验
  const hostPort = `${host}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`;
  if (allowHosts.includes(host) || allowHosts.includes(hostPort)) return;

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localdomain')) {
    throw Errors.param('base_url 不允许指向本机/内网域名');
  }

  // IPv4 字面量（含十进制点分形式）
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const octets = host.split('.').map(Number);
    if (octets.some((x) => x > 255)) throw Errors.param('base_url IPv4 地址非法');
    if (isReservedIPv4(octets[0], octets[1], octets[2])) {
      throw Errors.param('base_url 不允许指向环回/私有/保留 IPv4 地址');
    }
    return;
  }

  // IPv6 字面量（URL.hostname 保留方括号）
  if (host.includes(':')) {
    const h = host.replace(/^\[|\]$/g, '');
    const loopbackOrPrivate =
      h === '::' || h === '::1' || h.startsWith('fc') || h.startsWith('fd') || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
    if (loopbackOrPrivate) throw Errors.param('base_url 不允许指向环回/私有/保留 IPv6 地址');
  }
}

function isReservedIPv4(a: number, b: number, c: number): boolean {
  return (
    a === 0 ||                                        // 0.0.0.0/8（含 0.0.0.0）
    a === 10 ||                                       // 10.0.0.0/8
    a === 127 ||                                      // 环回
    (a === 100 && b >= 64 && b <= 127) ||             // CGNAT 100.64/10
    (a === 169 && b === 254) ||                       // link-local 169.254/16
    (a === 172 && b >= 16 && b <= 31) ||              // 172.16/12
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // 192.0.0/24、TEST-NET-1
    (a === 192 && b === 168) ||                       // 192.168/16
    (a === 198 && (b === 18 || b === 19)) ||          // 基准测试 198.18/15
    (a === 198 && b === 51 && c === 100) ||           // TEST-NET-2
    (a === 203 && b === 0 && c === 113) ||            // TEST-NET-3
    a >= 224                                          // 组播/保留 224/4 以上
  );
}
