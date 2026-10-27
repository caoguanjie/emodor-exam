import type { JSONContent, ReadonlyRichDocV3 } from '../../api/question-document-types';

export interface SiteAboutSettings {
  institution_name: string;
  platform_subtitle: string;
  version: string;
  contact_email: string;
  wechat_account: string;
  contact_phone: string;
  service_terms: JSONContent | null;
}

export const SITE_ABOUT_FIELDS = [
  { key: 'institution_name', label: '机构名称', max: 128, required: true },
  { key: 'platform_subtitle', label: '平台简介', max: 200, required: true },
  { key: 'version', label: '版本号', max: 32, required: true },
  { key: 'contact_email', label: '联系邮箱', max: 254, required: false },
  { key: 'wechat_account', label: '微信公众号', max: 128, required: false },
  { key: 'contact_phone', label: '联系电话', max: 32, required: false },
] as const;

const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const heading = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });

/** Compatibility defaults mirror the existing mobile shell and the server migration. */
export function defaultSiteAbout(): SiteAboutSettings {
  const sections = [
    ['一、服务内容', '本平台提供在线课程学习、在线考试、成绩查询、错题回顾等教育信息化服务。平台保留根据实际情况调整服务内容、变更服务方式的权利。'],
    ['二、用户义务', '1. 用户注册时应提供真实、准确的个人信息，如有变更应及时更新。\n\n2. 用户应妥善保管账号和密码，因账号密码泄露导致的损失由用户自行承担。\n\n3. 用户不得利用本平台从事任何违法违规活动，不得传播病毒、恶意代码或进行任何可能破坏平台正常运行的行为。'],
    ['三、知识产权', '本平台提供的所有内容，包括但不限于课程资料、试题、软件、技术等，知识产权归本平台所有。未经书面许可，任何单位或个人不得以任何方式复制、传播、修改或用于商业用途。'],
    ['四、隐私保护', '本平台重视用户隐私保护，收集的用户个人信息仅用于提供教育服务，不会向第三方披露，法律法规另有规定的除外。'],
    ['五、免责声明', '1. 本平台尽力保证服务的稳定性和连续性，但不对因不可抗力、系统维护、网络故障等原因导致的服务中断承担责任。\n\n2. 用户理解并同意，使用本平台服务所存在的风险由用户自行承担。'],
    ['六、协议修改', '本平台有权根据需要修改本协议条款，修改后的协议一经发布即生效。如用户不同意修改后的协议，应停止使用本平台服务。'],
    ['七、法律适用', '本协议的订立、执行和解释均适用中华人民共和国法律。如发生争议，双方应友好协商解决；协商不成的，提交平台所在地有管辖权的人民法院诉讼解决。'],
  ];
  return {
    institution_name: '海珠区安全教育培训中心', platform_subtitle: '安全教育培训与考试平台', version: '1.2.0',
    contact_email: '', wechat_account: '', contact_phone: '',
    service_terms: { type: 'doc', content: [
      heading(1, '海珠区安全教育培训中心服务使用协议'),
      paragraph('欢迎使用海珠区安全教育培训中心在线教育平台（以下简称“本平台”）。请您仔细阅读以下条款：'),
      ...sections.flatMap(([title, text]) => [heading(2, title!), ...text!.split('\n\n').map(paragraph)]),
    ] },
  };
}

export function cloneSiteAbout(value: Partial<SiteAboutSettings>): SiteAboutSettings {
  const defaults = defaultSiteAbout();
  const result = Object.fromEntries(SITE_ABOUT_FIELDS.map(field => [
    field.key, value[field.key] ?? defaults[field.key],
  ])) as Omit<SiteAboutSettings, 'service_terms'>;
  return {
    ...result,
    service_terms: JSON.parse(JSON.stringify(value.service_terms === undefined ? defaults.service_terms : value.service_terms)),
  };
}

const nodeAttrs: Record<string, readonly string[]> = {
  paragraph: ['textAlign', 'indent', 'lineHeight'], heading: ['textAlign', 'indent', 'lineHeight', 'level'],
  listItem: ['indent', 'lineHeight'], bulletList: [], orderedList: ['start', 'type'], codeBlock: ['language'],
  tableCell: ['colspan', 'rowspan', 'colwidth', 'align'], tableHeader: ['colspan', 'rowspan', 'colwidth', 'align'],
};
const allowedNodes = new Set(['doc', 'paragraph', 'heading', 'text', 'hardBreak', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader']);
const allowedMarks = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'superscript', 'subscript', 'textStyle', 'highlight']);

/** Keep the existing rich editor core, but persist only schema 3 text and formatting. */
export function serviceTermsFromEditor(input: JSONContent | null): ReadonlyRichDocV3 | null {
  if (input === null) return null;
  let count = 0;
  let hasText = false;
  const read = (node: JSONContent, depth: number): JSONContent => {
    if (++count > 2000 || depth > 16) throw new Error('服务条款结构过于复杂（最多 2000 个节点、16 层）');
    if (['image', 'mediaImage', 'video', 'audio'].includes(node.type || '')) throw new Error('服务条款不支持图片或媒体内容，请删除后再保存');
    if (!node.type || !allowedNodes.has(node.type)) throw new Error('服务条款包含不支持的内容');
    const result: JSONContent = { type: node.type };
    if (node.text !== undefined) {
      result.text = node.text;
      if (node.text.trim()) hasText = true;
    }
    if (node.attrs) {
      if (Object.keys(node.attrs).some(key => !(nodeAttrs[node.type!] || []).includes(key))) throw new Error('服务条款包含不支持的格式属性');
      if (Object.keys(node.attrs).length) result.attrs = { ...node.attrs };
    }
    if (node.type === 'tableCell' || node.type === 'tableHeader') {
      result.attrs = { colspan: 1, rowspan: 1, colwidth: null, align: null, ...result.attrs };
    }
    if (node.content) result.content = node.content.map(child => read(child, depth + 1));
    if (node.marks) {
      const marks = node.marks.flatMap(mark => {
        // Same text-only conversion used by the question authoring codec.
        if (mark.type === 'link') return [];
        if (!allowedMarks.has(mark.type)) throw new Error('服务条款包含不支持的文字格式');
        if (mark.type === 'textStyle') {
          const attrs = Object.fromEntries(Object.entries(mark.attrs || {}).filter(([, value]) => value !== null));
          return Object.keys(attrs).length ? [{ type: mark.type, attrs }] : [];
        }
        return [{ ...mark, ...(mark.attrs ? { attrs: { ...mark.attrs } } : {}) }];
      });
      if (marks.length) result.marks = marks;
    }
    return result;
  };
  const result = read(input, 1);
  if (result.type !== 'doc') throw new Error('服务条款必须是富文档');
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 100000) throw new Error('服务条款不能超过 100000 字节，请缩短内容');
  return hasText ? result as ReadonlyRichDocV3 : null;
}

export function siteAboutPayload(value: SiteAboutSettings): SiteAboutSettings {
  const result = cloneSiteAbout(value);
  for (const field of SITE_ABOUT_FIELDS) {
    const text = result[field.key].trim();
    if (field.required && !text) throw new Error(`请填写${field.label}`);
    if (text.length > field.max) throw new Error(`${field.label}不能超过 ${field.max} 个字符`);
    result[field.key] = text;
  }
  if (result.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.contact_email)) throw new Error('请填写有效的联系邮箱');
  if (result.contact_phone && (!/^\+?[0-9 ()（）-]+$/.test(result.contact_phone) || !/[0-9]/.test(result.contact_phone))) throw new Error('联系电话格式不正确');
  result.service_terms = serviceTermsFromEditor(result.service_terms);
  return result;
}
