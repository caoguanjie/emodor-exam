// EmodorRuleExam 端到端冒烟测试：覆盖 README 1.1 全闭环
// 资料上传 → AI 出题 → 自动评分；兼容既有只读学习和历史固定卷。
// 运行前提：API 服务已启动（见 tests/run-e2e.sh）；管理员初始口令经环境变量注入（不落源码）。
//
// 用法：BASE_URL=http://127.0.0.1:3000/api/v1 ADMIN_INITIAL_PASSWORD=... \
//       DB_HOST=127.0.0.1 DB_PORT=3306 DB_USERNAME=root DB_PASSWORD=... DB_DATABASE=ruleexam_test_smoke \
//       node tests/e2e-smoke.mjs
import http from 'node:http';
import { isSafeTestDatabase } from './support/test-target.mjs';
import { randomStrongPassword } from './support/password-fixture.mjs';
import { learnerSession, randomLearnerPhone } from './support/learner-session-fixture.mjs';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const JSZip = require('jszip');
const mysql = require('mysql2/promise');
const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
const Redis = require('ioredis');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000/api/v1';
// 测试夹具口令运行期生成（安全约束：测试代码不落可用凭据字面量）
const TEST_INIT_PW = randomStrongPassword('regadmin', '王管理员', 'emp001', '李学员');

const ADMIN_INITIAL = process.env.ADMIN_INITIAL_PASSWORD;
if (IS_MAIN && !ADMIN_INITIAL) {
  console.error('缺少 ADMIN_INITIAL_PASSWORD 环境变量（运行期注入，不落源码）');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name} ${extra}`);
  }
}

// ---------- 极简 Mock AI 服务（OpenAI 兼容 /chat/completions） ----------
function parseMockAiPort(rawPort, mode) {
  if (rawPort === undefined || rawPort === '') return 9101;
  if (!/^[0-9]{1,5}$/.test(rawPort)) {
    throw new Error('MOCK_AI_PORT 必须是 1024-65535 的十进制端口');
  }
  if (rawPort === '0') {
    if (mode !== 'ephemeral') throw new Error('MOCK_AI_PORT=0 仅允许内部 ephemeral runner 模式');
    return 0;
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error('MOCK_AI_PORT 必须是 1024-65535 的十进制端口');
  }
  return port;
}

// Standalone invocation keeps the historical 9101 default. The ephemeral
// runner injects the explicit internal auto-port mode, so the server asks the
// kernel for its actual bound port instead of relying on a racy free-port probe.
let mockPort = parseMockAiPort(process.env.MOCK_AI_PORT, process.env.MOCK_AI_PORT_MODE);
const MOCK_QUESTIONS = buildMockQuestions();

function buildMockQuestions() {
  // 10 单选 × 6 分 + 5 多选 × 8 分 = 100 分
  const singles = [];
  for (let i = 1; i <= 10; i++) {
    const correct = (i - 1) % 4; // 答案轮换 A-D：避免「答案集中于同一选项」分布异常判定
    singles.push({
      type: 'single',
      stem: `【Mock】制度第${i}章规定的核心要求是什么？`,
      options: [
        { key: 'A', text: `第${i}章要求A${correct === 0 ? '（正确）' : ''}` },
        { key: 'B', text: `第${i}章要求B${correct === 1 ? '（正确）' : ''}` },
        { key: 'C', text: `第${i}章要求C${correct === 2 ? '（正确）' : ''}` },
        { key: 'D', text: `第${i}章要求D${correct === 3 ? '（正确）' : ''}` },
      ],
      answer: [correct],
      analysis: `依据第${i}章原文要点。`,
    });
  }
  const multiples = [];
  for (let i = 1; i <= 5; i++) {
    multiples.push({
      type: 'multiple',
      stem: `【Mock】以下哪些属于第${i}部分规定的适用范围？`,
      options: [
        { key: 'A', text: `范围甲（正确）` },
        { key: 'B', text: `范围乙（正确）` },
        { key: 'C', text: `范围丙` },
        { key: 'D', text: `范围丁` },
      ],
      answer: [0, 1],
      analysis: `依据第${i}部分适用范围条款。`,
    });
  }
  return [...singles, ...multiples];
}

export function startMockAi(port = mockPort) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let prompt = '';
        try {
          const parsed = JSON.parse(body);
          prompt = (parsed.messages || []).map((m) => m.content).join('\n');
        } catch { /* ignore */ }
        // 连通性测试（请回复 OK）
        if (prompt.includes('请回复 OK')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
          return;
        }
        // Respect the requested distribution so a one-question task does not
        // silently receive the historical 10+5 fixture batch.
        const singleCount = prompt.match(/(\d+)\s*道单选题/)?.[1];
        const multipleCount = prompt.match(/(\d+)\s*道多选题/)?.[1];
        const wantOne = prompt.includes('重新命制 1 道');
        const singles = MOCK_QUESTIONS.filter((question) => question.type === 'single');
        const multiples = MOCK_QUESTIONS.filter((question) => question.type === 'multiple');
        const list = singleCount !== undefined || multipleCount !== undefined
          ? [...singles.slice(0, Number(singleCount || 0)), ...multiples.slice(0, Number(multipleCount || 0))]
          : (wantOne ? [MOCK_QUESTIONS[0]] : MOCK_QUESTIONS);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(list) } }] }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string' || !Number.isInteger(address.port)) {
        server.close(() => reject(new Error('Mock AI 未返回有效监听端口')));
        return;
      }
      mockPort = address.port;
      resolve(server);
    });
  });
}

// ---------- HTTP 帮助函数 ----------
async function api(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

// 管理员登录必须走真实验证码链路。测试只读取本次 runner 注入的隔离 Redis
// 前缀中的答案，不改变生产 API，也不把答案写入日志。
async function adminCaptchaLogin(username, password) {
  const issued = await api('POST', '/auth/captcha');
  if (issued.status !== 200 || !issued.json?.data?.captcha_id) {
    throw new Error(`管理员验证码签发失败：${issued.status}`);
  }
  const redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: false,
  });
  try {
    const prefix = process.env.REDIS_KEY_PREFIX || '';
    const answer = await redis.get(`${prefix}auth:captcha:${issued.json.data.captcha_id}`);
    if (!answer) throw new Error('管理员验证码夹具答案不存在于本次隔离 Redis');
    return api('POST', '/auth/login', {
      body: { username, password, captcha_id: issued.json.data.captcha_id, captcha_code: answer },
    });
  } finally {
    await redis.quit();
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- 最小 docx 构造（mammoth 可解析） ----------
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
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
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

// ---------- 最小 PDF 构造（pdf-parse 可提取文本） ----------
function buildPdf(lines) {
  // 每行独立 BT/Tj/ET 文本对象（短 token，规避 pdf.js lexer 128 字节限制）
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
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

// ---------- 主流程 ----------
const state = { tokens: {} };

async function main() {
  if (!isSafeTestDatabase(process.env.DB_DATABASE)) throw new Error('冒烟仅允许 ruleexam_test_* 隔离数据库');
  const mockServer = await startMockAi();
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'ruleexam',
  });

  console.log('\n== 0. 健康检查 ==');
  {
    const r = await api('GET', '/health');
    check('GET /health 200 且 mysql=up', r.status === 200 && r.json?.data?.mysql === 'up', JSON.stringify(r.json));
  }

  console.log('\n== 1. 认证（FR-ORG-01 / 07 册 2.2.3 首登强制改密） ==');
  {
    const bad = await adminCaptchaLogin('admin', 'wrong-password-x');
    check('错误口令 → 40104（不泄露区别）', bad.status === 401 && bad.json?.code === 40104);
    const r = await adminCaptchaLogin('admin', ADMIN_INITIAL);
    check('首登成功且 force_change_password=true', r.status === 200 && r.json?.data?.force_change_password === true, JSON.stringify(r.json?.code));
    const restrictedToken = r.json?.data?.access_token;
    const blocked = await api('GET', '/admin/question-materials', { token: restrictedToken });
    check('受限令牌访问业务接口被拒（40301）', blocked.status === 403 && blocked.json?.code === 40301);
    // iat 为秒级精度：等待 >=1 秒确保改密封禁时刻严格晚于受限令牌 iat（07 册 2.1.4 判定语义）
    await sleep(1100);
    // 口令用十六进制随机串：不包含用户名/工号/姓名的 3 字符子串（符合 07 册 2.2.2 强度策略）
    const newPw = 'Zz9' + Math.random().toString(16).slice(2, 12);
    const ch = await api('PUT', '/auth/password', { token: restrictedToken, body: { old_password: ADMIN_INITIAL, new_password: newPw } });
    check('修改密码成功并签发完整令牌', ch.status === 200 && !!ch.json?.data?.access_token, JSON.stringify(ch.json));
    state.tokens.admin = ch.json?.data?.access_token;
    const again = await adminCaptchaLogin('admin', newPw);
    check('新口令重新登录成功且不再强制改密', again.json?.data?.force_change_password === false);
    state.tokens.admin = again.json?.data?.access_token;
    const oldTokenCheck = await api('GET', '/auth/profile', { token: restrictedToken });
    check('改密后旧令牌被吊销（40107）', oldTokenCheck.status === 401 && oldTokenCheck.json?.code === 40107, JSON.stringify(oldTokenCheck.json));
  }

  console.log('\n== 2. 学员与管理员账号、历史只读范围夹具 ==');
  let deptA, deptB, admin2Id, empId;
  {
    for (const path of ['/departments/tree', '/users', '/regulations']) {
      const gone = await api('GET', path, { token: state.tokens.admin });
      check(`取消管理接口不可调用：${path}`, gone.status === 404);
    }
    // 管理 CRUD 已删除；只为仍保留的旧学习/固定卷创建历史范围夹具。
    const [d1] = await db.query("INSERT INTO sys_department(parent_id,name,status) VALUES(1,'生产中心',1)");
    const [d2] = await db.query("INSERT INTO sys_department(parent_id,name,status) VALUES(1,'职能中心',1)");
    deptA = String(d1.insertId); deptB = String(d2.insertId);
    const [permissions] = await db.query("SELECT p.code FROM sys_permission p JOIN sys_role_permission rp ON rp.permission_id=p.id JOIN sys_role r ON r.id=rp.role_id WHERE r.code='regulation_admin'");
    const role = await api('POST', '/admin/roles', { token: state.tokens.admin, body: {
      code: 'smoke_operator', name: '冒烟业务管理', permissions: [...new Set([...permissions.map(p => p.code), 'exam_records:read'])],
    } });
    check('创建业务角色', role.status === 200);
    const mkAdmin = await api('POST', '/admin/administrators', { token: state.tokens.admin, body: {
      username: 'regadmin', password: TEST_INIT_PW, real_name: '王管理员', role_ids: [String(role.json.data.id)],
    } });
    const category = await api('POST', '/admin/training-categories', { token: state.tokens.admin, body: {name:'冒烟培训'} });
    check('创建冒烟学员类别', category.status === 200, JSON.stringify({status:category.status,code:category.json?.code,message:category.json?.message}));
    const student = (username, real_name) => ({
      username, phone: randomLearnerPhone(), real_name, category_id:String(category.json.data.id), source:'institution',
    });
    const mkEmp = await api('POST', '/admin/students', { token: state.tokens.admin, body:student('emp001','李学员') });
    check('独立创建管理员与学员', mkAdmin.status === 200 && mkEmp.status === 200, JSON.stringify({
      admin: {status:mkAdmin.status,code:mkAdmin.json?.code,message:mkAdmin.json?.message},
      student: {status:mkEmp.status,code:mkEmp.json?.code,message:mkEmp.json?.message},
    }));
    if (mkAdmin.status !== 200 || mkEmp.status !== 200) throw new Error('账号夹具创建失败；停止连锁断言');
    admin2Id = mkAdmin.json?.data?.id; empId = mkEmp.json?.data?.id;
    const duplicate = await api('POST', '/admin/students', {token:state.tokens.admin,body:student('emp001','重复')});
    check('用户名重复被拒', duplicate.json?.code === 40001);
    for (const [username,password] of [['weakpw1','admin123'],['weakpw2','12345678']]) {
      const rejected = await api('POST','/admin/students',{token:state.tokens.admin,body:{ ...student(username,'禁止学员口令'), password }});
      check(`学员密码字段被拒：${username}`,rejected.json?.code===40001);
    }
    await db.query('UPDATE sys_user SET department_id=? WHERE id=?',[deptA,empId]);
    await db.query('UPDATE sys_user SET department_id=? WHERE id=?',[deptB,admin2Id]);
    const er = await api('POST','/auth/login',{body:{username:'emp001',password:TEST_INIT_PW}});
    check('学员不能使用PC密码登录',er.status===401 && er.json?.code===40104);
    const mobileEmployee = await learnerSession({
      env: process.env,
      queryTestDb: async (sql, params) => (await db.execute(sql, params))[0],
    }, empId);
    state.tokens.emp=mobileEmployee.accessToken;
    check('学员业务使用隔离移动会话夹具',!!state.tokens.emp);
    const denied = await api('POST','/admin/question-materials',{token:state.tokens.emp,body:{title:'越权资料'}});
    check('学员无资料写权限',denied.status===403);
    let ar = await adminCaptchaLogin('regadmin',TEST_INIT_PW);
    const adminNewPw='Vb5'+randomBytes(8).toString('hex');
    await api('PUT','/auth/password',{token:ar.json?.data?.access_token,body:{old_password:TEST_INIT_PW,new_password:adminNewPw}});
    ar=await adminCaptchaLogin('regadmin',adminNewPw);
    state.tokens.regadmin=ar.json?.data?.access_token;
    const adminsDenied=await api('GET','/admin/administrators',{token:state.tokens.regadmin});
    check('业务管理员无管理员管理权限',adminsDenied.status===403);
  }

  console.log('\n== 3. 出题资料上传与解析 ==');
  let regId, versionId;
  {
    const c = await api('POST', '/admin/question-materials', {
      token: state.tokens.regadmin,
      body: { title: '安全生产管理制度 V1', description: '冒烟测试出题资料' },
    });
    check('创建出题资料', c.status === 200 && !!c.json?.data?.id);
    regId = String(c.json.data.id);

    const docx = await buildDocx([
      '第一章 总则：为加强安全生产管理，制定本制度。本制度适用于公司全体员工及所有生产场所。',
      '第二章 动火作业：动火作业实行审批制度，审批有效期最长不超过二十四小时，动火作业前必须清理现场可燃物。',
      '第三章 教育培训：公司安全培训每年不少于一次，新员工入职三天内必须完成三级安全教育并考核合格。',
      '第四章 隐患排查：各部门每周开展一次安全隐患排查，重大隐患须在两小时内上报安全管理部门并建立台账。',
      '第五章 附则：本制度自发布之日起施行，由安全生产部负责解释，原相关规定同时废止，修订周期不超过一年。',
    ]);
    // multipart 手工构造（docx）
    const boundary = '----ruleexam' + Date.now();
    const part = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="regulation.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`),
      docx,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await fetch(`${BASE}/admin/question-materials/${regId}/versions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.tokens.regadmin}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: part,
    });
    const upJson = await res.json();
    check('上传 docx → 版本创建 parse_status=pending', res.status === 200 && upJson?.data?.parse_status === 'pending', JSON.stringify(upJson));
    versionId = String(upJson.data.id);
    check('版本号 version_no = 1', upJson.data.version_no === 1);

    // 伪装扩展名文件被拒（魔数校验，07 册 4.3.1）
    const boundary2 = '----ruleexam' + (Date.now() + 1);
    const fakePart = Buffer.concat([
      Buffer.from(`--${boundary2}\r\nContent-Disposition: form-data; name="file"; filename="fake.docx"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from('this is not a zip file at all........'),
      Buffer.from(`\r\n--${boundary2}--\r\n`),
    ]);
    const fake = await fetch(`${BASE}/admin/question-materials/${regId}/versions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.tokens.regadmin}`, 'Content-Type': `multipart/form-data; boundary=${boundary2}` },
      body: fakePart,
    });
    const fakeJson = await fake.json();
    check('魔数不符的伪装文件被拒（42201）', fakeJson?.code === 42201, JSON.stringify(fakeJson));

    // 轮询解析状态（异步解析流水线）
    let parsed = null;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const d = await api('GET', `/admin/question-materials/${regId}/versions/${versionId}/status`, { token: state.tokens.regadmin });
      if (d.json?.data?.parse_status === 'parsed') {
        parsed = d.json.data;
        break;
      }
      if (d.json?.data?.parse_status === 'failed') break;
    }
    const [parsedRows] = await db.query('SELECT content_html FROM regulation_version WHERE id=?',[versionId]);
    check('docx 异步解析成功，API不暴露正文', !!parsed && !('content_html' in parsed) && parsedRows[0]?.content_html?.includes('第三章'), JSON.stringify(parsed?.parse_status));

    // PDF 版本（双路径：pdf → text_content，content_html 为空）
    const pdf = buildPdf([
      'Chapter 1 General: hot work approval must not exceed 24 hours; site must be cleared of flammables.',
      'Chapter 2 Training: safety training at least once every year; hidden danger inspection every week.',
    ]);
    const boundary3 = '----ruleexam' + (Date.now() + 2);
    const pdfPart = Buffer.concat([
      Buffer.from(`--${boundary3}\r\nContent-Disposition: form-data; name="file"; filename="regulation.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      pdf,
      Buffer.from(`\r\n--${boundary3}--\r\n`),
    ]);
    const res2 = await fetch(`${BASE}/admin/question-materials/${regId}/versions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.tokens.regadmin}`, 'Content-Type': `multipart/form-data; boundary=${boundary3}` },
      body: pdfPart,
    });
    const up2 = await res2.json();
    let pdfParsed = false;
    if (up2?.data?.id) {
      for (let i = 0; i < 30; i++) {
        await sleep(1000);
        const d = await api('GET', `/admin/question-materials/${regId}/versions/${up2.data.id}/status`, { token: state.tokens.regadmin });
        if (d.json?.data?.parse_status === 'parsed') {
          pdfParsed = true;
          break;
        }
        if (d.json?.data?.parse_status === 'failed') break;
      }
    }
    check('pdf 版本解析成功（第二版本，append-only）', pdfParsed && up2?.data?.version_no === 2, JSON.stringify(up2));

    // 只读兼容功能的历史夹具，不恢复已删除的管理操作。
    await db.query("UPDATE regulation SET required_minutes=1,scroll_segments=10,current_version_id=?,status='published',published_at=NOW(3) WHERE id=?",[versionId,regId]);
    await db.query('INSERT INTO regulation_scope(regulation_id,department_id) VALUES(?,?),(?,?)',[regId,deptA,regId,deptB]);
    // F8 回归（发布试卷前）：我的制度列表 has_published_paper=false
    const lrPre = await api('GET', '/learning/regulations', { token: state.tokens.emp });
    const lrPreItem = lrPre.json?.data?.list?.find((x) => Number(x.id) === Number(regId));
    check('试卷未发布时 has_published_paper=false', !!lrPreItem && lrPreItem.has_published_paper === false, JSON.stringify(lrPreItem?.has_published_paper));
  }

  console.log('\n== 4. AI 配置与出题（FR-AIQ-01~03） ==');
  let questionIds = [];
  {
    const category = await api('POST', '/admin/training-categories', {
      token: state.tokens.admin,
      body: { name: `legacy smoke 题库类别 ${Date.now()}` },
    });
    const trainingCategoryId = String(category.json?.data?.id || '');
    check('创建 legacy smoke 合法题库类别', category.status === 200 && /^\d+$/.test(trainingCategoryId), JSON.stringify(category.json));
    const deny = await api('GET', '/ai/config', { token: state.tokens.regadmin });
    check('regulation_admin 读 AI 配置被拒（40301，缺少 ai_config:read）', deny.status === 403);
    const denyWrite = await api('PUT', '/ai/config', {
      token: state.tokens.regadmin,
      body: { base_url: 'http://127.0.0.1:9/v1', api_key: 'legacy-config-denied', model: 'legacy-denied' },
    });
    check('regulation_admin 写 AI 配置被拒（40301，缺少 ai_config:write）', denyWrite.status === 403);
    const denyTest = await api('POST', '/ai/config/test', { token: state.tokens.regadmin });
    check('regulation_admin 测试 AI 配置被拒（40301，缺少 ai_config:write）', denyTest.status === 403);
    const save = await api('PUT', '/ai/config', {
      token: state.tokens.admin,
      body: { base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: 'sk-mock-not-a-real-key', model: 'mock-model' },
    });
    check('保存 AI 配置（api_key 掩码回显）', save.status === 200 && /sk-\*\*\*\*/.test(save.json?.data?.api_key_masked || ''), JSON.stringify(save.json?.data));
    const test = await api('POST', '/ai/config/test', { token: state.tokens.admin });
    check('AI 连通性测试成功', test.status === 200 && test.json?.data?.ok === true, JSON.stringify(test.json));

    const badSum = await api('POST', '/ai/generate-questions', {
      token: state.tokens.regadmin,
      body: {
        material_id: regId, material_version_id: versionId, category_id: trainingCategoryId, difficulty: 'easy',
        question_count_single: 10, question_count_multiple: 5, score_single: 5, score_multiple: 8,
      },
    });
    check('分值合计 ≠ 100 被拦截（40001）', badSum.json?.code === 40001);
    const gen = await api('POST', '/ai/generate-questions', {
      token: state.tokens.regadmin,
      body: {
        material_id: regId, material_version_id: versionId, category_id: trainingCategoryId, difficulty: 'easy',
        question_count_single: 10, question_count_multiple: 5, score_single: 6, score_multiple: 8,
      },
    });
    check('发起出题（异步任务受理，回显分值策略）', gen.status === 200 && !!gen.json?.data?.task_id && gen.json.data.score_single === 6, JSON.stringify(gen.json));
    const taskId = gen.json?.data?.task_id;
    let completed = null;
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      const st = await api('GET', `/ai/generate-status/${taskId}`, { token: state.tokens.regadmin });
      if (st.json?.data?.status === 'completed') {
        completed = st.json.data;
        break;
      }
      if (st.json?.data?.status === 'failed') break;
    }
    check('出题任务完成，15 题落库为 pending（source=ai）', completed?.questions?.length === 15 && completed.questions.every((q) => q.status === 'pending' && q.source === 'ai'), JSON.stringify({ status: completed?.status, error: completed?.error, blocks: completed?.failed_blocks }));
    questionIds = completed?.questions?.map((q) => String(q.id)) || [];

    // 逐题审核通过（FR-AIQ-03）
    let approved = 0;
    for (const question of completed?.questions || []) {
      const r = await api('PUT', `/ai/questions/${question.id}/review`, {
        token: state.tokens.regadmin,
        body: { expected_version_id: String(question.current_version_id), status: 'approved' },
      });
      if (r.json?.data?.status === 'approved') approved++;
    }
    check('15 题全部审核通过（approved）', approved === 15, `approved=${approved}`);
  }

  console.log('\n== 5. 组卷与发布（FR-AIQ-07，SUM=100 校验） ==');
  let paperId;
  {
    const p = await api('POST', '/ai/papers', {
      token: state.tokens.regadmin,
      body: { regulation_id: regId, title: '安全生产管理制度 V1 考试', pass_score: 60, duration_minutes: 30, max_attempts: 3, partial_credit_ratio: 0.5 },
    });
    paperId = String(p.json?.data?.id);
    check('创建试卷（draft，策略默认值）', p.status === 200 && p.json?.data?.status === 'draft');
    // 取题目类型以匹配分值：single=6, multiple=8 → 10×6 + 5×8 = 100
    const qRows = questionIds.length ? await db.query('SELECT id, type FROM question WHERE id IN (?)', [questionIds]) : [[]];
    const items = qRows[0].map((r) => ({ question_id: Number(r.id), score: r.type === 'single' ? 6 : 8 }));
    check('题库可检索到 15 道已审核题目', qRows[0].length === 15, `rows=${qRows[0].length}`);
    const setQ = await api('PUT', `/ai/papers/${paperId}/questions`, { token: state.tokens.regadmin, body: { items } });
    check('组卷成功（sum_score=100）', setQ.json?.data?.sum_score === 100, JSON.stringify(setQ.json));
    const badPub = await api('POST', `/ai/papers/${paperId}/publish`, { token: state.tokens.regadmin });
    check('发布试卷 → published（SUM=100 通过）', badPub.json?.data?.status === 'published', JSON.stringify(badPub.json));
    // F8 回归（发布试卷后）：我的制度列表 has_published_paper 翻转为 true
    const lrPost = await api('GET', '/learning/regulations', { token: state.tokens.emp });
    const lrPostItem = lrPost.json?.data?.list?.find((x) => Number(x.id) === Number(regId));
    check('发布试卷后 has_published_paper=true', !!lrPostItem && lrPostItem.has_published_paper === true, JSON.stringify(lrPostItem?.has_published_paper));
    // 发布后改题被锁（40907）
    const lock = await api('PUT', `/ai/papers/${paperId}/questions`, { token: state.tokens.regadmin, body: { items: items.slice(0, 3) } });
    check('发布后修改题目组成被拒（40907）', lock.json?.code === 40907);
  }

  console.log('\n== 6. 考试资格校验（FR-LRN-06：未达标 40901 附差距） ==');
  {
    const list = await api('GET', '/exams/papers', { token: state.tokens.emp });
    const item = list.json?.data?.list?.find((x) => String(x.paper_id) === paperId);
    check('可考列表含目标试卷且 is_eligible=false', !!item && item.is_eligible === false, JSON.stringify(item));
    const start = await api('POST', `/exams/papers/${paperId}/start`, { token: state.tokens.emp });
    check('未达标开考被拒（40901 + 差距信息）', start.json?.code === 40901 && start.json?.data?.gap?.time_gap_seconds > 0, JSON.stringify(start.json?.data));
  }

  console.log('\n== 7. 有效学习（FR-LRN-01~05：心跳容差 / 失焦 / 位图 / 双条件判定） ==');
  let sessionId;
  {
    const prog0 = await api('GET', `/learning/records/${regId}`, { token: state.tokens.emp });
    check('进度查询（未达标附 gap）', prog0.json?.data?.is_valid === false && prog0.json?.data?.gap?.time_gap_seconds === 60, JSON.stringify(prog0.json?.data?.gap));

    const st = await api('POST', '/learning/sessions/start', { token: state.tokens.emp, body: { regulation_id: regId } });
    sessionId = String(st.json?.data?.session_id);
    check('会话开始（返回 session_id 与节拍参数）', !!sessionId && st.json?.data?.heartbeat_interval_seconds === 30);

    // 高频心跳被限流（42901，节拍窗口）
    const spam = await api('POST', '/learning/heartbeat', { token: state.tokens.emp, body: { session_id: sessionId, dwell_segments: [0], scroll_percent: 10 } });
    check('异常高频心跳被限流（42901）', spam.json?.code === 42901, JSON.stringify(spam.json?.code));

    // 失焦暂停 → 恢复（锚点模型，05 册 5.4.3）
    const pz = await api('POST', '/learning/heartbeat/pause', { token: state.tokens.emp, body: { session_id: sessionId, dwell_segments: [0], scroll_percent: 10 } });
    check('pause：结算一个窗口并置 paused', pz.json?.data?.state === 'paused');
    const hz = await api('POST', '/learning/heartbeat', { token: state.tokens.emp, body: { session_id: sessionId, dwell_segments: [1], scroll_percent: 20 } });
    check('paused 期间心跳不计费', hz.json?.code === 0 && hz.json?.data?.credited_seconds === 0, JSON.stringify(hz.json?.data));
    const rs = await api('POST', '/learning/heartbeat/resume', { token: state.tokens.emp, body: { session_id: sessionId } });
    check('resume：锚点重置不计时长', rs.json?.data?.state === 'active');

    // 单活跃会话约束：再次 start → 后开者胜出（返回新会话）
    const st2 = await api('POST', '/learning/sessions/start', { token: state.tokens.emp, body: { regulation_id: regId } });
    const sessionId2 = String(st2.json?.data?.session_id);
    check('单活跃约束：后开者胜出且返回新会话', st2.status === 200 && sessionId2 !== sessionId);
    const oldBeat = await api('POST', '/learning/heartbeat', { token: state.tokens.emp, body: { session_id: sessionId, dwell_segments: [], scroll_percent: 30 } });
    check('旧会话心跳返回 40906（已被取代）', oldBeat.json?.code === 40906, JSON.stringify(oldBeat.json?.code));
    sessionId = sessionId2;

    // 两拍 × 30 秒 + 底部段停留 → 达标（60 秒墙钟时间）；段 3 特意保留到 end 时搭载上报
    await sleep(31_000);
    const b1 = await api('POST', '/learning/heartbeat', { token: state.tokens.emp, body: { session_id: sessionId, dwell_segments: [0, 1, 2], scroll_percent: 40 } });
    check('第 1 拍：计入 ≈30 秒', b1.json?.data?.credited_seconds >= 25 && b1.json?.data?.credited_seconds <= 45, JSON.stringify(b1.json?.data?.credited_seconds));
    await sleep(31_000);
    const b2 = await api('POST', '/learning/heartbeat', { token: state.tokens.emp, body: { session_id: sessionId, dwell_segments: [4, 5, 6, 7, 8, 9], scroll_percent: 100 } });
    check('第 2 拍：累计 ≥ 60 秒且 progress_hint=true', b2.json?.data?.total_seconds >= 60 && b2.json?.data?.progress_hint === true, JSON.stringify({ t: b2.json?.data?.total_seconds, h: b2.json?.data?.progress_hint }));
    check('is_valid 仍为 false（仅落库事务可产生）', b2.json?.data?.is_valid === false);

    // F4 回归：end 携带 dwell_segments/scroll_percent（段 3 此前从未上报），锁内合并后位图应 10 段全置位
    const end = await api('POST', `/learning/sessions/${sessionId}/end`, { token: state.tokens.emp, body: { dwell_segments: [3], scroll_percent: 100 } });
    check('会话结束落库 → is_valid=true 且 valid_at 非空', end.json?.data?.progress?.is_valid === true && !!end.json?.data?.progress?.valid_at, JSON.stringify(end.json?.data?.progress?.is_valid));
    check('end 搭载段位合并生效：滚动覆盖位图 10 段全置位（含底部段）', end.json?.data?.progress?.scroll_coverage?.covered_count === 10, JSON.stringify(end.json?.data?.progress?.scroll_coverage));

    // 资格只升不降：is_valid 查询确认
    const prog = await api('GET', `/learning/records/${regId}`, { token: state.tokens.emp });
    check('进度查询确认有效学习达标', prog.json?.data?.is_valid === true);
  }

  console.log('\n== 8. 考试全流程（FR-EXM-01~07：乱序/计时/幂等交卷/自动评分） ==');
  let examRecordId;
  {
    const start = await api('POST', `/exams/papers/${paperId}/start`, { token: state.tokens.emp });
    check('开考成功（in_progress，15 题乱序下发）', start.json?.data?.exam_record_id > 0 && start.json?.data?.questions?.length === 15, JSON.stringify(start.json?.code));
    examRecordId = String(start.json.data.exam_record_id);
    const qs = start.json.data.questions;
    check('下发载荷不含 answer / analysis（防偷答案）', qs.every((q) => !('answer' in q) && !('analysis' in q)));
    check('每题选项 4 个（乱序后）', qs.every((q) => q.options?.length === 4));
    check('乱序后选项 key 仍为原始 A-D（双射）', qs.every((q) => [...q.options.map((o) => o.key)].sort().join('') === 'ABCD'));

    // 双开考幂等：再次 start 返回同一记录（断网重进场景，04 册 1.5）
    const start2 = await api('POST', `/exams/papers/${paperId}/start`, { token: state.tokens.emp });
    check('重复开考幂等返回同一 in_progress 记录', String(start2.json?.data?.exam_record_id) === examRecordId);

    // 在考不可拉取成绩明细（C-1：解析仅在交卷后下发，恢复在考走 start 幂等路径）
    const inProgressResult = await api('GET', `/exams/records/${examRecordId}/result`, { token: state.tokens.emp });
    check('在考拉取成绩明细被拒（40905）', inProgressResult.json?.code === 40905, JSON.stringify(inProgressResult.json?.code));

    const removedSwitch = await api('POST', `/exams/records/${examRecordId}/switch`, {token:state.tokens.emp});
    check('切屏接口已删除', removedSwitch.status === 404);

    // 从库读取正确答案，按呈现位置提交（白盒冒烟：判分规则已由单元测试覆盖）
    const [answerRows] = await db.query('SELECT id, answer FROM question WHERE id IN (?)', [qs.map((q) => String(q.question_id))]);
    const answerMap = new Map(answerRows.map((r) => [String(r.id), typeof r.answer === 'string' ? JSON.parse(r.answer) : r.answer]));
    const answers = qs.map((q) => {
      const correctOriginal = answerMap.get(String(q.question_id)) || [];
      // 呈现位置 = 乱序数组中 key 对应原始下标字母的位置
      const display = correctOriginal.map((origIdx) => q.options.findIndex((o) => o.key === String.fromCharCode(65 + origIdx)));
      return { question_id: q.question_id, selected: display };
    });
    const hb = await api('POST', `/exams/records/${examRecordId}/heartbeat`, { token: state.tokens.emp, body: { answers: answers.slice(0, 5) } });
    check('考试心跳：作答暂存 + 服务端剩余时间校准', hb.json?.code === 0 && hb.json?.data?.remaining_seconds > 0, JSON.stringify(hb.json?.data?.remaining_seconds));

    const sub = await api('POST', `/exams/records/${examRecordId}/submit`, { token: state.tokens.emp, body: { answers } });
    check('交卷评分：全对 100 分 → passed', sub.json?.data?.status === 'passed' && Number(sub.json?.data?.score) === 100, JSON.stringify({ s: sub.json?.data?.status, score: sub.json?.data?.score }));
    check('交卷响应含逐题对错摘要（15 题）', sub.json?.data?.answer_summary?.length === 15);

    // 幂等：重复交卷返回首次结果
    const sub2 = await api('POST', `/exams/records/${examRecordId}/submit`, { token: state.tokens.emp, body: { answers } });
    check('重复交卷幂等（返回首次评分结果）', sub2.json?.data?.status === 'passed' && Number(sub2.json?.data?.score) === 100);

    // 已通过再考被拒（40903，防刷分）
    const start3 = await api('POST', `/exams/papers/${paperId}/start`, { token: state.tokens.emp });
    check('已通过后再发起被拒（40903）', start3.json?.code === 40903, JSON.stringify(start3.json?.code));

    // 成绩与答题明细（解析此时下发）
    const result = await api('GET', `/exams/records/${examRecordId}/result`, { token: state.tokens.emp });
    check('成绩明细含 answer 与 analysis（交卷后可见）', result.json?.data?.questions?.every((q) => 'answer' in q && 'analysis' in q));

    // 数据范围：他人成绩不可见（40302）
    const other = await api('GET', `/admin/exam-records/${examRecordId}/result`, { token: state.tokens.regadmin });
    check('有记录读取权限的管理员可查成绩', other.status === 200, JSON.stringify(other.json?.code));
  }

  console.log('\n== 9. 统计报表（FR-STT-01~05） ==');
  {
    const ov = await api('GET', `/statistics/regulations/${regId}/overview`, { token: state.tokens.regadmin });
    const d = ov.json?.data;
    check('应学人数 = 2（两个部门在职员工）', d?.assigned_count === 2, JSON.stringify(d?.assigned_count));
    check('学习完成率 = 0.5（1/2）', d?.learning?.completion_rate === 0.5, JSON.stringify(d?.learning));
    check('参考人数 = 1、通过率 = 1、平均分 = 100', d?.exam?.participant_count === 1 && d?.exam?.pass_rate === 1 && d?.exam?.average_score === 100, JSON.stringify(d?.exam));
    check('分数分布：[90,100] = 1', d?.exam?.score_distribution?.['[90,100]'] === 1, JSON.stringify(d?.exam?.score_distribution));
    const dep = await api('GET', `/statistics/regulations/${regId}/departments`, { token: state.tokens.regadmin });
    check('部门维度对比（两部门切片）', dep.json?.data?.list?.length === 2, JSON.stringify(dep.json?.data?.list?.length));
    const unc = await api('GET', `/statistics/regulations/${regId}/uncompleted`, { token: state.tokens.regadmin });
    check('未完成清单：regadmin（学习未达标，未参考）', unc.json?.data?.list?.length === 1 && unc.json.data.list[0].type === '学习未达标', JSON.stringify(unc.json?.data?.list?.map((u) => u.type)));
    const personal = await api('GET', `/statistics/users/${empId}`, { token: state.tokens.regadmin });
    check('个人维度（管理员查员工）', personal.json?.data?.user?.id === Number(empId) && personal.json?.data?.exams?.length === 1);
    const own = await api('GET', `/statistics/users/${empId}`, { token: state.tokens.emp });
    check('employee 仅可查本人（数据范围收口）', own.status === 200);
    const foreign = await api('GET', '/statistics/users/1', { token: state.tokens.emp });
    check('employee 查他人被拒（40302）', foreign.json?.code === 40302);

    // Excel 导出（二进制流，跳过统一信封）
    const exp = await fetch(`${BASE}/statistics/export?type=uncompleted&regulation_id=${regId}`, {
      headers: { Authorization: `Bearer ${state.tokens.regadmin}` },
    });
    const buf = Buffer.from(await exp.arrayBuffer());
    check('Excel 导出（未完成清单，xlsx 魔数 PK）', exp.status === 200 && buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b, `bytes=${buf.length}`);
    const exp2 = await fetch(`${BASE}/statistics/export?type=regulation_overview`, {
      headers: { Authorization: `Bearer ${state.tokens.regadmin}` },
    });
    check('Excel 导出（制度维度统计表）', exp2.status === 200);
  }

  console.log('\n== 10. 审计与管理端预览 ==');
  {
    const preview = await api('GET', `/regulations/${regId}/content`, { token: state.tokens.emp });
    check('历史学习内容仍受控可读', preview.status === 200 && preview.json?.data?.file_type === 'docx');
    const fs = await import('node:fs');
    const logDir = process.env.LOG_DIR ? join(process.env.LOG_DIR, 'audit') : new URL('../server/data/logs/audit/', import.meta.url).pathname;
    const files = fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];
    check('审计日志文件生成（JSON 行）', files.some((f) => f.startsWith('audit-')), JSON.stringify(files));
  }

  await db.end();
  mockServer.close();
  console.log(`\n========== 冒烟测试结果：通过 ${passed} / 失败 ${failed} ==========`);
  if (failed) {
    console.log('失败项：');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

if (IS_MAIN) {
  main().catch((e) => {
    console.error('冒烟测试异常终止：', e);
    process.exit(1);
  });
}
