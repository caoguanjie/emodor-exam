import { isEmail } from 'class-validator';
import { Errors } from '../../common/errors';
import type { ReadonlyRichDocV3, ReadonlyRichBlockV3 } from '../../common/question-content-v3';
import { parseRichDocV3 } from '../questions/question-content-v3';

export interface SiteAboutConfig {
  institution_name: string;
  platform_subtitle: string;
  version: string;
  contact_email: string;
  wechat_account: string;
  contact_phone: string;
  service_terms: ReadonlyRichDocV3 | null;
}

export const SITE_ABOUT_KEYS = [
  'institution_name', 'platform_subtitle', 'version', 'contact_email',
  'wechat_account', 'contact_phone', 'service_terms',
] as const;
const STRING_LIMITS = { institution_name: 128, platform_subtitle: 200, version: 32, contact_email: 254, wechat_account: 128, contact_phone: 32 } as const;
const REQUIRED_TEXT = new Set(['institution_name', 'platform_subtitle', 'version']);

// Existing H5 copy from fixtures/ui-scenarios/shell.ts and profile/terms.vue.
// Keep these defaults independent of frontend runtime modules.
const DEFAULT_INSTITUTION = '海珠区安全教育培训中心';
const DEFAULT_TERMS = [
  ['一、服务内容', '本平台提供在线课程学习、在线考试、成绩查询、错题回顾等教育信息化服务。平台保留根据实际情况调整服务内容、变更服务方式的权利。'],
  ['二、用户义务', '1. 用户注册时应提供真实、准确的个人信息，如有变更应及时更新。\n\n2. 用户应妥善保管账号和密码，因账号密码泄露导致的损失由用户自行承担。\n\n3. 用户不得利用本平台从事任何违法违规活动，不得传播病毒、恶意代码或进行任何可能破坏平台正常运行的行为。'],
  ['三、知识产权', '本平台提供的所有内容，包括但不限于课程资料、试题、软件、技术等，知识产权归本平台所有。未经书面许可，任何单位或个人不得以任何方式复制、传播、修改或用于商业用途。'],
  ['四、隐私保护', '本平台重视用户隐私保护，收集的用户个人信息仅用于提供教育服务，不会向第三方披露，法律法规另有规定的除外。'],
  ['五、免责声明', '1. 本平台尽力保证服务的稳定性和连续性，但不对因不可抗力、系统维护、网络故障等原因导致的服务中断承担责任。\n\n2. 用户理解并同意，使用本平台服务所存在的风险由用户自行承担。'],
  ['六、协议修改', '本平台有权根据需要修改本协议条款，修改后的协议一经发布即生效。如用户不同意修改后的协议，应停止使用本平台服务。'],
  ['七、法律适用', '本协议的订立、执行和解释均适用中华人民共和国法律。如发生争议，双方应友好协商解决；协商不成的，提交平台所在地有管辖权的人民法院诉讼解决。'],
] as const;

export function defaultSiteAbout(): SiteAboutConfig {
  const paragraph = (text: string): ReadonlyRichBlockV3 => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const content: ReadonlyRichBlockV3[] = [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: `${DEFAULT_INSTITUTION}服务使用协议` }] },
    paragraph(`欢迎使用${DEFAULT_INSTITUTION}在线教育平台（以下简称“本平台”）。请您仔细阅读以下条款：`),
  ];
  for (const [title, text] of DEFAULT_TERMS) {
    content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: title }] });
    content.push(...text.split('\n\n').map(paragraph));
  }
  return {
    institution_name: DEFAULT_INSTITUTION, platform_subtitle: '安全教育培训与考试平台', version: '1.2.0',
    contact_email: '', wechat_account: '', contact_phone: '', service_terms: { type: 'doc', content },
  };
}

/** Bound raw input before JSON serialization, DTO transformation or recursive parsing. */
function assertBoundedTerms(input: unknown): void {
  const pending = [{ value: input, depth: 1 }];
  const seen = new Set<object>();
  let values = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++values > 12_000 || depth > 40) throw Errors.param('服务条款结构过大或嵌套过深');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
    if (typeof value === 'number' && Number.isFinite(value)) continue;
    if (!value || typeof value !== 'object') throw Errors.param('服务条款必须是 JSON 富文档');
    if (seen.has(value)) throw Errors.param('服务条款结构不能循环或复用节点');
    seen.add(value);
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw Errors.param('服务条款必须是普通 JSON 对象');
    }
    if ((value as { type?: unknown }).type === 'image') throw Errors.param('服务条款不支持图片或媒体');
    const children = Object.values(value);
    if (values + pending.length + children.length > 12_000) throw Errors.param('服务条款结构过大');
    for (const child of children) pending.push({ value: child, depth: depth + 1 });
  }
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 100_000) throw Errors.param('服务条款 JSON 不能超过 100000 字节');
}

export function normalizeSiteAbout(input: unknown): SiteAboutConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Errors.param('关于我们配置必须是对象');
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some(key => !SITE_ABOUT_KEYS.includes(key as typeof SITE_ABOUT_KEYS[number]))) throw Errors.param('关于我们配置包含不支持的字段');
  const out: Record<string, unknown> = {};
  for (const [key, limit] of Object.entries(STRING_LIMITS)) {
    if (typeof raw[key] !== 'string' || (raw[key] as string).length > limit) throw Errors.param(`关于我们 ${key} 最多 ${limit} 字符且必须是字符串`);
    const text = (raw[key] as string).trim();
    if (REQUIRED_TEXT.has(key) && !text) throw Errors.param(`关于我们 ${key} 不能为空`);
    out[key] = text;
  }
  if (out.contact_email && !isEmail(out.contact_email as string)) throw Errors.param('联系邮箱格式非法');
  if (out.contact_phone && (!/^\+?[0-9 ()（）-]+$/.test(out.contact_phone as string) || !/[0-9]/.test(out.contact_phone as string))) {
    throw Errors.param('联系电话只支持数字、开头的 +、空格、短横线或括号，且至少包含一位数字');
  }
  if (raw.service_terms === null) out.service_terms = null;
  else {
    assertBoundedTerms(raw.service_terms);
    const document = parseRichDocV3(raw.service_terms);
    if (Buffer.byteLength(JSON.stringify(document), 'utf8') > 100_000) throw Errors.param('服务条款 JSON 不能超过 100000 字节');
    out.service_terms = document;
  }
  return out as unknown as SiteAboutConfig;
}

/** Read only the public whitelist; missing or corrupt legacy values use existing H5 defaults. */
export function publicSiteAbout(input: unknown): SiteAboutConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return defaultSiteAbout();
  const raw = input as Record<string, unknown>;
  try {
    return normalizeSiteAbout(Object.fromEntries(SITE_ABOUT_KEYS.map(key => [key, raw[key]])));
  } catch {
    return defaultSiteAbout();
  }
}
