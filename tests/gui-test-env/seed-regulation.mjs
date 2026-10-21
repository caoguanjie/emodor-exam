// GUI 测试环境准备：以 admin 身份经 API 预置一条制度（docx+pdf 两版本，等解析完成）。
// 用法：ADMIN_PASSWORD=<当前 admin 口令> NEW_ADMIN_PASSWORD=<改密后的新口令> node tests/gui-test-env/seed-regulation.mjs
// 仅做「使后续 GUI 流程可达」的最小准备；学习配置/范围/发布等业务动作留给 GUI 测试执行。
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const JSZip = require('jszip');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000/api/v1';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error('缺少 ADMIN_PASSWORD 环境变量');
  process.exit(1);
}

async function api(method, path, { token, body, raw, contentType } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  if (contentType) headers['Content-Type'] = contentType;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, json, text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function buildDocx(paragraphs) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

function buildPdf(lines) {
  const parts = lines.map((line, i) => {
    const y = 750 - i * 40;
    const esc = line.replace(/([()\\])/g, '\\$1');
    return `BT /F1 12 Tf 50 ${y} Td (${esc}) Tj ET`;
  });
  const stream = parts.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

async function uploadVersion(token, regId, filename, mime, buf, tag) {
  const boundary = '----ruleexamgui' + Date.now() + Math.floor(Math.random() * 1000);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    buf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await fetch(`${BASE}/regulations/${regId}/versions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  const j = await res.json().catch(() => null);
  console.log(`[${tag}] upload → HTTP ${res.status} ${JSON.stringify(j?.data ?? j)}`);
  return j?.data;
}

async function main() {
  const login = await api('POST', '/auth/login', { body: { username: 'admin', password: ADMIN_PASSWORD } });
  if (login.status !== 200 || !login.json?.data?.access_token) {
    console.error('admin 登录失败：', login.status, login.text.slice(0, 300));
    process.exit(1);
  }
  const token = login.json.data.access_token;
  console.log('admin 登录成功');

  // 环境准备：先经 API 完成「首次登录强制改密」，使业务接口可用（GUI 的强制改密流程改由员工账号覆盖）
  // 口令一律环境变量注入，仓库不得含可用凭据字面量（AGENTS.md 红线）
  const NEW_ADMIN_PASSWORD = process.env.NEW_ADMIN_PASSWORD;
  if (!NEW_ADMIN_PASSWORD) {
    console.error('缺少 NEW_ADMIN_PASSWORD 环境变量');
    process.exit(1);
  }
  const ch = await api('PUT', '/auth/password', {
    token,
    body: { old_password: ADMIN_PASSWORD, new_password: NEW_ADMIN_PASSWORD },
  });
  if (ch.status !== 200) {
    // 已改过则用新口令重登
    const relogin = await api('POST', '/auth/login', { body: { username: 'admin', password: NEW_ADMIN_PASSWORD } });
    if (relogin.status !== 200) {
      console.error('改密失败且重登失败：', ch.status, ch.text.slice(0, 200));
      process.exit(1);
    }
    console.log('admin 口令已是新值，重登成功');
  } else {
    console.log('admin 已完成首次改密');
  }
  const relogin2 = await api('POST', '/auth/login', { body: { username: 'admin', password: NEW_ADMIN_PASSWORD } });
  if (relogin2.status !== 200) { console.error('重登失败', relogin2.text.slice(0, 200)); process.exit(1); }
  const adminToken = relogin2.json.data.access_token;

  const c = await api('POST', '/regulations', {
    token: adminToken,
    body: { title: '安全生产管理制度 V1', category: '安全类', description: 'GUI 测试预置制度' },
  });
  if (c.status !== 200 || !c.json?.data?.id) {
    console.error('创建制度失败：', c.status, c.text.slice(0, 300));
    process.exit(1);
  }
  const regId = String(c.json.data.id);
  console.log('制度已创建 id=', regId, 'status=', c.json.data.status);

  const docx = await buildDocx([
    '第一章 总则：为加强安全生产管理，制定本制度。本制度适用于公司全体员工及所有生产场所。',
    '第二章 动火作业：动火作业实行审批制度，审批有效期最长不超过二十四小时，动火作业前必须清理现场可燃物。',
    '第三章 教育培训：公司安全培训每年不少于一次，新员工入职三天内必须完成三级安全教育并考核合格。',
    '第四章 隐患排查：各部门每周开展一次安全隐患排查，重大隐患须在两小时内上报安全管理部门并建立台账。',
    '第五章 附则：本制度自发布之日起施行，由安全生产部负责解释，原相关规定同时废止，修订周期不超过一年。',
  ]);
  const v1 = await uploadVersion(adminToken, regId, 'regulation.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx, 'docx');

  const pdf = buildPdf([
    'Chapter 1 General: hot work approval must not exceed 24 hours; site must be cleared of flammables.',
    'Chapter 2 Training: safety training at least once every year; hidden danger inspection every week.',
  ]);
  const v2 = await uploadVersion(adminToken, regId, 'regulation.pdf', 'application/pdf', pdf, 'pdf');

  for (const [tag, vid] of [['docx', v1?.version_id], ['pdf', v2?.version_id]]) {
    if (!vid) { console.error(`${tag} 版本上传失败`); process.exit(1); }
    let status = '';
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const d = await api('GET', `/regulations/${regId}/versions/${vid}`, { token: adminToken });
      status = d.json?.data?.parse_status || '';
      if (status === 'parsed' || status === 'failed') break;
    }
    console.log(`[${tag}] version ${vid} parse_status=${status}`);
    if (status !== 'parsed') { console.error(`${tag} 解析未成功`); process.exit(1); }
  }
  console.log(`SEED_OK regulation_id=${regId}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
