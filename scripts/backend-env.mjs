import { randomBytes } from 'node:crypto';
import { chmod, lstat, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const identityKeys = ['IDENTITY_DATA_ENCRYPTION_KEY', 'IDENTITY_FINGERPRINT_SECRET', 'MEDIA_TICKET_SECRET'];
const systemKeys = ['JWT_SECRET', 'EXAM_SHUFFLE_SECRET', 'APP_ENCRYPTION_KEY', ...identityKeys];
const smsKeys = ['YUNXIN_SMS_APP_KEY', 'YUNXIN_SMS_APP_SECRET', 'YUNXIN_SMS_LOGIN_CODE_TEMPLATE_ID'];
const cosImportKeys = ['COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_BUCKET', 'COS_REGION'];
const runtimeOverrides = new WeakMap();

async function readOptionalEnv(path) {
  try {
    return parseEnv(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('环境文件读取失败，请检查文件权限和 KEY=VALUE 格式。');
  }
}

function quoteValue(key, value) {
  // Single quotes keep dollar signs, hashes and backslashes literal in Node and Compose.
  if (/[\r\n']/.test(value)) throw new Error(`${key} 含换行或单引号，请手工配置根目录 .env；未创建文件。`);
  return `'${value}'`;
}

export async function initializeLocalEnv(root = repositoryRoot, environment = process.env) {
  const target = join(root, '.env');
  try {
    await lstat(target);
    return { created: false };
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('无法检查根目录 .env。');
  }
  const template = await readFile(join(root, 'deploy/.env.example'), 'utf8');
  const legacy = await readOptionalEnv(join(root, 'server/.env'));
  const supplied = { ...legacy, ...environment };
  const values = {
    ...parseEnv(template),
    NODE_ENV: 'development', PORT: '3000',
    DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_USERNAME: 'root', DB_PASSWORD: '',
    REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379',
    DATA_DIR: './data', UPLOAD_DIR: './data/uploads', LOG_DIR: './data/logs',
    SMS_PROVIDER: 'yunxin', IDENTITY_PROVIDER: 'tencent',
    TENCENT_ID_CARD_OCR_ENABLED: 'true', TENCENT_FACEID_ENABLED: 'true',
  };
  const supported = new Set([
    ...Object.keys(values),
    ...[...template.matchAll(/^(?:#\s*)?([A-Z][A-Z0-9_]*)=/gm)].map(match => match[1]),
  ]);
  for (const key of supported) {
    if (supplied[key] !== undefined) values[key] = supplied[key];
  }
  // Never replace a saved AI encryption key with a new, incompatible one.
  if (!values.APP_ENCRYPTION_KEY) {
    try {
      await lstat(resolve(root, values.DATA_DIR, 'ai-config.json.enc'));
      throw new Error('已有加密 AI 配置，但未提供原 APP_ENCRYPTION_KEY；请先注入原密钥，未创建文件。');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  for (const key of systemKeys) {
    if (!values[key]) values[key] = randomBytes(key === 'JWT_SECRET' ? 48 : 32).toString('base64');
  }
  // The real-flow entry must use SMS rather than the development login shortcut.
  values.SERVER_DEBUG_LOGIN_ENABLED = 'false';
  const seen = new Set();
  const body = template.split(/\r?\n/).map(line => {
    const match = line.match(/^(?:#\s*)?([A-Z][A-Z0-9_]*)=/);
    if (!match || !Object.hasOwn(values, match[1])) return line;
    seen.add(match[1]);
    return `${match[1]}=${quoteValue(match[1], values[match[1]])}`;
  }).join('\n');
  const extra = Object.entries(values).filter(([key]) => !seen.has(key))
    .map(([key, value]) => `${key}=${quoteValue(key, value)}`).join('\n');
  try {
    await writeFile(target, `# 本地配置：由 env:init 创建，已有文件不会覆盖；供应商空值请手工填写。\n${body}\n# 本地启动参数（从仓库根启动）\n${extra}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') return { created: false };
    throw new Error('创建根目录 .env 失败，请检查目录权限。');
  }
  return { created: true };
}

export async function readBackendEnv(root = repositoryRoot, environment = process.env) {
  let source;
  try { source = await readFile(join(root, '.env'), 'utf8'); }
  catch { throw new Error('缺少或无法读取根目录 .env，请先执行 npm --prefix server run env:init。'); }
  // Match Node --env-file precedence: an exported variable wins over the file.
  const parsed = parseEnv(source);
  const values = { ...parsed, ...environment };
  runtimeOverrides.set(values, new Set(Object.keys(parsed).filter(key => Object.hasOwn(environment, key))));
  return values;
}

export async function importLocalCosEnv(root, sourceEnvPath) {
  const target = resolve(root, '.env');
  const sourcePath = resolve(sourceEnvPath);
  if (sourcePath === target) throw new Error('COS 导入源文件不得与目标 .env 相同。');
  const sourceReal = await realpath(sourcePath).catch(() => { throw new Error('无法读取明确指定的 COS 源文件。'); });
  const targetReal = await realpath(target).catch(() => null);
  if (sourceReal === targetReal) throw new Error('COS 导入源文件不得与目标 .env 相同。');
  const source = await readOptionalEnv(sourcePath);
  for (const key of ['COS_SECRET_ID', 'COS_SECRET_KEY']) {
    if (!source[key]?.trim()) throw new Error(`COS 源文件缺少 ${key}；未合并任何配置。`);
  }
  const keys = cosImportKeys.filter(key => Object.hasOwn(source, key));
  // Validate quoting before touching the destination. The source pair is all or nothing.
  const incoming = keys.map(key => `${key}=${quoteValue(key, source[key])}`).join('\n');
  const lockPath = join(root, '.env.cos-import.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { throw new Error('COS 配置导入正在进行或目录不可写，请稍后重试。'); }
  const temporary = join(root, `.env.cos-import-${randomBytes(12).toString('hex')}.tmp`);
  try {
    let before = '';
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('目标 .env 必须是普通文件。');
      before = await readFile(target, 'utf8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const prior = parseEnv(before);
    if (keys.every(key => prior[key] === source[key])) {
      await chmod(target, 0o600);
      return { changed: false, keys };
    }
    // Append a final Node env override block to preserve comments and every unrelated
    // value byte-for-byte, including multiline secrets belonging to other services.
    const after = `${before}${before && !before.endsWith('\n') ? '\n' : ''}# COS 白名单导入（其余项目配置保持原样）\n${incoming}\n`;
    await writeFile(temporary, after, { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
    return { changed: true, keys };
  } catch (error) {
    if (error?.message?.startsWith('目标 .env')) throw error;
    throw new Error('COS 配置原子合并失败；请检查文件权限。');
  } finally {
    await rm(temporary, { force: true });
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

export function inspectBackendEnv(env, { real = false } = {}) {
  const rows = [];
  const check = (name, ok, reason) => rows.push({ name, ok: Boolean(ok), status: ok ? '已配置' : reason });
  const present = name => typeof env[name] === 'string' && env[name].trim().length > 0;
  for (const name of systemKeys) {
    const value = env[name] || '';
    const valid = identityKeys.includes(name)
      ? Buffer.from(value, 'base64').length === 32 && Buffer.from(value, 'base64').toString('base64') === value
      : value.length >= 32;
    check(name, valid, present(name) ? '格式不正确' : '未配置');
  }
  const providedIdentityKeys = identityKeys.map(key => env[key]).filter(Boolean);
  check('IDENTITY_KEYS', new Set(providedIdentityKeys).size === providedIdentityKeys.length, '三项密钥必须独立');
  check('SMS_PROVIDER', real ? env.SMS_PROVIDER === 'yunxin' : ['disabled', 'yunxin'].includes(env.SMS_PROVIDER || 'disabled'), '真实短信需设置为 yunxin');
  if (real || env.SMS_PROVIDER === 'yunxin') for (const name of smsKeys) check(name, present(name), '未配置');
  check('IDENTITY_PROVIDER', real ? env.IDENTITY_PROVIDER === 'tencent' : ['disabled', 'tencent'].includes(env.IDENTITY_PROVIDER || 'disabled'), '真实实名需设置为 tencent');
  for (const group of ['TENCENT_ID_CARD_OCR', 'TENCENT_FACEID']) {
    const enabled = env[`${group}_ENABLED`] || 'false';
    check(`${group}_ENABLED`, real || env.IDENTITY_PROVIDER === 'tencent' ? enabled === 'true' : ['true', 'false'].includes(enabled), '需设置为 true（启用）或有效布尔值');
    if (real || env.IDENTITY_PROVIDER === 'tencent' || enabled === 'true') {
      for (const suffix of ['SECRET_ID', 'SECRET_KEY']) check(`${group}_${suffix}`, present(`${group}_${suffix}`), '未配置');
    }
  }
  check('SERVER_DEBUG_LOGIN_ENABLED', (real || env.NODE_ENV === 'production')
    ? (env.SERVER_DEBUG_LOGIN_ENABLED || 'false') === 'false'
    : ['true', 'false'].includes(env.SERVER_DEBUG_LOGIN_ENABLED || 'false'), '真实闭环与生产环境须关闭调试登录');
  const storageProvider = env.MEDIA_STORAGE_PROVIDER || 'local';
  check('MEDIA_STORAGE_PROVIDER', ['local', 'cos'].includes(storageProvider), '仅支持 local 或 cos');
  const deliveryMode = env.MEDIA_DELIVERY_MODE || 'proxy';
  check('MEDIA_DELIVERY_MODE', ['proxy', 'cos-signed'].includes(deliveryMode), '仅支持 proxy 或 cos-signed');
  for (const name of ['MEDIA_READ_URL_TTL_SECONDS', 'MEDIA_VIDEO_URL_TTL_SECONDS']) {
    const raw = env[name] ?? '300';
    check(name, /^[1-9]\d*$/.test(raw) && Number(raw) <= 3600, '必须为 1—3600 秒');
  }
  if (storageProvider === 'cos' || deliveryMode === 'cos-signed') {
    for (const key of cosImportKeys) check(key, present(key), '未配置');
    check('COS_KEY_PREFIX', /^(?:[A-Za-z0-9_-]+\/)+$/.test(env.COS_KEY_PREFIX || ''), present('COS_KEY_PREFIX') ? '必须为有界相对目录前缀并以 / 结尾' : '未配置');
    if (present('COS_BUCKET')) check('COS_BUCKET_FORMAT', /^[a-z0-9][a-z0-9-]*-\d+$/.test(env.COS_BUCKET), '格式不正确');
    if (present('COS_REGION')) check('COS_REGION_FORMAT', /^[a-z][a-z0-9-]+$/.test(env.COS_REGION), '格式不正确');
  }
  const overrides = runtimeOverrides.get(env);
  if (overrides) for (const row of rows) if (overrides.has(row.name)) row.status += '（进程环境覆盖 .env）';
  return rows;
}

export function formatReport(rows) {
  return rows.map(row => `${row.ok ? '✓' : '✗'} ${row.name}: ${row.status}`).join('\n');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'import-cos') {
    if (args.length !== 2 || args[0] !== '--from-env' || !args[1]) throw new Error('用法：node scripts/backend-env.mjs import-cos --from-env <明确源路径>');
    const result = await importLocalCosEnv(repositoryRoot, args[1]);
    console.log(`${result.changed ? '已原子合并' : '配置相同，未重复写入'} COS 白名单：${result.keys.join(', ')}；根 .env 权限为 600。`);
    return;
  }
  if (!['init', 'check'].includes(command) || args.some(arg => command !== 'check' || arg !== '--real')) {
    throw new Error('用法：node scripts/backend-env.mjs init|check [--real]，或 import-cos --from-env <明确源路径>');
  }
  if (command === 'init') {
    const { created } = await initializeLocalEnv();
    console.log(created ? '已创建根目录 .env（权限 600）；已有后端配置已带入，缺少的系统密钥已生成。请填写供应商空值。' : '根目录 .env 已存在，保持原样；未覆盖任何配置或密钥。');
    return;
  }
  const rows = inspectBackendEnv(await readBackendEnv(), { real: args.includes('--real') });
  console.log(formatReport(rows));
  const ready = rows.every(row => row.ok);
  console.log(ready ? '配置项检查通过；尚未验证供应商凭据、网络或真实业务结果。' : '请补齐根目录 .env 中的缺失项；本检查没有发短信、调用实名或启动后端。');
  if (!ready) process.exitCode = 1;
}

// macOS /var and /private/var can refer to the same executable file.
const invokedPath = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(() => null) : null;
if (invokedPath === await realpath(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
