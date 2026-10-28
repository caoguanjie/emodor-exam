import { constants } from 'node:fs';
import { open, lstat, rename, rm, realpath } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { inspectBackendEnv, formatReport } from './backend-env.mjs';

const required = ['YUNXIN_SMS_APP_KEY', 'YUNXIN_SMS_APP_SECRET', 'YUNXIN_SMS_LOGIN_CODE_TEMPLATE_ID', 'TENCENT_ID_CARD_OCR_SECRET_ID', 'TENCENT_ID_CARD_OCR_SECRET_KEY', 'TENCENT_FACEID_SECRET_ID', 'TENCENT_FACEID_SECRET_KEY'];
const optional = ['TENCENT_ID_CARD_OCR_TOKEN', 'TENCENT_FACEID_TOKEN'];
const switches = { SMS_PROVIDER: 'yunxin', IDENTITY_PROVIDER: 'tencent', TENCENT_ID_CARD_OCR_ENABLED: 'true', TENCENT_FACEID_ENABLED: 'true' };

// Intentionally support single-line assignments only. Reject ambiguity before writes.
function parseStrict(text) {
  const values = {}, lines = text.split(/\r?\n/), positions = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error(`第 ${i + 1} 行格式不支持，请使用单行 KEY=VALUE。`);
    const [, key, raw] = match;
    if (positions.has(key)) throw new Error(`${key} 重复，请先合并重复项。`);
    const quote = raw[0];
    if (["'", '"', '`'].includes(quote)) {
      const end = raw.indexOf(quote, 1);
      if (end < 1 || !/^\s*(?:#.*)?$/.test(raw.slice(end + 1))) throw new Error(`${key} 引号或多行格式不支持。`);
    }
    const parsed = parseEnv(line);
    if (!Object.hasOwn(parsed, key) || /[\r\n]/.test(parsed[key])) throw new Error(`${key} 格式不支持。`);
    values[key] = parsed[key]; positions.set(key, i);
  }
  return { values, positions, lines };
}
async function readStrict(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat();
    if (!info.isFile()) throw new Error();
    const text = await file.readFile('utf8');
    return { ...parseStrict(text), text, info };
  } catch (error) {
    if (error.message?.includes('格式不支持') || error.message?.includes('重复') || error.message?.startsWith('第 ')) throw error;
    throw new Error('配置必须是可读取的普通文件，不能使用符号链接。');
  } finally { await file?.close(); }
}
function incoming(values) {
  const missing = required.filter(key => !values[key]?.trim());
  if (missing.length) throw new Error(`未配置：${missing.join(', ')}`);
  return Object.fromEntries([...Object.entries(switches), ...[...required, ...optional].filter(k => values[k]?.trim()).map(k => [k, values[k]])]);
}
function assignment(key, value) {
  if (/[\r\n']/.test(value)) throw new Error(`${key} 含不支持的引号或换行，请手工配置。`);
  return `${key}='${value}'`;
}
export async function exportSupplier(source, output) {
  const data = incoming((await readStrict(source)).values);
  const content = Object.entries(data).map(([k, v]) => assignment(k, v)).join('\n') + '\n';
  let file;
  try { file = await open(output, 'wx', 0o600); await file.writeFile(content); await file.sync(); }
  catch { throw new Error('无法创建导出文件；已有文件不会覆盖，请选择新的文件名。'); }
  finally { await file?.close(); }
  return Object.keys(data);
}
export async function mergeSupplier(source, destination) {
  const target = resolve(destination);
  if (await realpath(source) === await realpath(target)) throw new Error('来源与目标不能是同一文件。');
  const data = incoming((await readStrict(source)).values);
  const lockPath = target + '.supplier.lock';
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { throw new Error('配置正在修改或目录不可写，请稍后重试。'); }
  const temporary = join(dirname(target), '.supplier-' + randomBytes(12).toString('hex') + '.tmp');
  try {
    const prior = await readStrict(target);
    for (const [key, value] of Object.entries(data)) {
      if (!Object.hasOwn(switches, key) && prior.values[key]?.trim() && prior.values[key] !== value) throw new Error(`${key} 已有不同配置，未修改任何内容。`);
      if (Object.hasOwn(switches, key) && prior.values[key]?.trim() && ![value, 'disabled', 'false'].includes(prior.values[key])) throw new Error(`${key} 已有其他服务设置，未修改任何内容。`);
    }
    const lines = [...prior.lines];
    let changed = false;
    for (const [key, value] of Object.entries(data)) {
      if (prior.values[key] === value) continue;
      const line = assignment(key, value);
      if (prior.positions.has(key)) lines[prior.positions.get(key)] = line;
      else { if (lines.at(-1) === '') lines.pop(); lines.push(line, ''); }
      changed = true;
    }
    if (!changed) return { changed: false };
    const after = lines.join(prior.text.includes('\r\n') ? '\r\n' : '\n');
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(after); await file.sync(); } finally { await file.close(); }
    const current = await lstat(target);
    if (!current.isFile() || current.ino !== prior.info.ino || current.mtimeMs !== prior.info.mtimeMs || current.size !== prior.info.size) throw new Error('目标配置已变化，请重新执行。');
    await rename(temporary, target);
    return { changed: true };
  } finally { await rm(temporary, { force: true }); await lock.close(); await rm(lockPath, { force: true }); }
}
export async function checkDeployment(path, environment = process.env) {
  const { values, positions, lines } = await readStrict(path);
  for (const [key, index] of positions) {
    const raw = lines[index].slice(lines[index].indexOf('=') + 1).trimStart();
    if (raw[0] !== "'" && values[key].includes('$')) throw new Error(`${key} 含变量插值，请用单引号保存原值后再检查。`);
  }
  const rows = inspectBackendEnv({ ...values, NODE_ENV: 'production' }, { real: true });
  rows.push({ name: 'DB_USERNAME', ok: Boolean(values.DB_USERNAME?.trim() && values.DB_USERNAME.trim().toLowerCase() !== 'root'), status: '必须填写非 root 的业务账号' });
  rows.push({ name: 'DB_PASSWORD', ok: Boolean(values.DB_PASSWORD?.trim()), status: '必须填写数据库密码' });
  for (const [key, value] of Object.entries(values)) {
    if (Object.hasOwn(environment, key) && environment[key] !== value) rows.push({ name: key, ok: false, status: '终端同名变量与文件不同，请先移除终端覆盖' });
  }
  return rows;
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'export' && args.length === 4 && args[0] === '--from' && args[2] === '--out') {
    await exportSupplier(args[1], args[3]); console.log('已导出短信和实名配置，文件权限为 600；未导出系统密钥。');
  } else if (command === 'merge' && args.length === 4 && args[0] === '--from' && args[2] === '--to') {
    const result = await mergeSupplier(args[1], args[3]); console.log(result.changed ? '已补齐短信和实名配置，其他配置保持原样。' : '配置相同，无需修改。');
  } else if (command === 'check' && args.length === 2 && args[0] === '--file') {
    const rows = await checkDeployment(args[1]); console.log(formatReport(rows));
    if (rows.some(r => !r.ok)) process.exitCode = 1;
    else console.log('配置填写检查通过；尚未发送短信或调用实名认证。');
  } else throw new Error('用法：export --from <源文件> --out <新文件>；merge --from <源文件> --to <服务器配置>；check --file <服务器配置>');
}
if (process.argv[1] && await realpath(resolve(process.argv[1])).catch(() => null) === await realpath(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    // Filesystem errors can include paths. Never echo raw errors from external inputs.
    console.error(error.code ? '文件操作失败，请检查路径、权限和文件是否存在。' : error.message);
    process.exitCode = 1;
  });
}
