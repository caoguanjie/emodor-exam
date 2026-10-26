// Plan by default. A run consumes a private, explicitly labelled test cohort;
// requests/tokens/bodies are never included in the aggregate report.
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';

const intervals = { media: 10, authz: 30, exam: 0, heartbeat: 30 };
const signatureKeys = ['q-sign-algorithm', 'q-ak', 'q-sign-time', 'q-key-time', 'q-header-list', 'q-url-param-list', 'q-signature'];
const responseQueryKeys = ['versionId', 'response-content-type', 'response-content-language', 'response-expires',
  'response-cache-control', 'response-content-disposition', 'response-content-encoding'];
const cosQueryKeys = new Set([...signatureKeys, ...responseQueryKeys, 'x-cos-security-token']);
const readHeaders = new Set(['accept', 'range', 'if-range', 'if-modified-since', 'if-unmodified-since', 'if-none-match', 'if-match']);

function cosTargetOf(scenario) {
  const origin = scenario.cosMediaOrigin, prefix = scenario.cosMediaPrefix;
  if (origin === undefined && prefix === undefined) return null;
  if (typeof origin !== 'string' || !/^https:\/\/[a-z0-9][a-z0-9-]*-\d+\.cos\.[a-z][a-z0-9-]+\.myqcloud\.com$/.test(origin)
    || typeof prefix !== 'string' || !/^ruleexam\/(?:dev|test|staging)\/media\/(?:[A-Za-z0-9_-]+\/)*$/.test(prefix)
    || prefix.split('/').slice(3).some(part => part === 'identity' || part === 'staging')) throw new Error('COS媒体测试origin或正式目录无效');
  return { origin, prefix };
}

function cosRequest(step, target) {
  const fail = () => { throw new Error('COS媒体只接受准确目录内的只读签名请求'); };
  const value = step.url, method = step.method || 'GET', headers = step.headers === undefined ? {} : step.headers;
  if (!target || Object.hasOwn(step, 'path') || typeof value !== 'string' || value.length > 8192
    || /[\s\x00-\x1f\x7f\\#]/.test(value) || !value.startsWith(`${target.origin}/`)
    || !['GET', 'HEAD'].includes(method) || Object.hasOwn(step, 'body')
    || !headers || typeof headers !== 'object' || Array.isArray(headers)) return fail();
  const headerNames = new Set();
  for (const [name, entry] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!readHeaders.has(lower) || headerNames.has(lower) || typeof entry !== 'string' || /[\x00-\x1f\x7f]/.test(entry)
      || /bearer(?:\s|$)/i.test(entry) || /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(entry)) return fail();
    headerNames.add(lower);
  }
  let url;
  try { url = new URL(value); } catch { return fail(); }
  const rawPath = value.slice(target.origin.length).split('?')[0];
  if (url.origin !== target.origin || url.username || url.password || url.hash || url.pathname !== rawPath
    || !url.pathname.startsWith(`/${target.prefix}`) || url.pathname.length <= target.prefix.length + 1
    || !/^[A-Za-z0-9_./-]+$/.test(url.pathname)
    || url.pathname.slice(1).split('/').some((part, index) => !part || part === '.' || part === '..'
      || (index >= 3 && (part === 'identity' || part === 'staging')))) return fail();
  const seen = new Set();
  for (const [name, entry] of url.searchParams) {
    if (!cosQueryKeys.has(name) || seen.has(name) || entry.length > 4096 || /[\x00-\x1f\x7f]/.test(entry)
      || /bearer(?:\s|$)/i.test(entry) || /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(entry)) return fail();
    seen.add(name);
  }
  if (signatureKeys.some(name => !seen.has(name)) || url.searchParams.get('q-sign-algorithm') !== 'sha1'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(url.searchParams.get('q-ak') || '')
    || !/^[a-f0-9]{40}$/i.test(url.searchParams.get('q-signature') || '')
    || ['versionId', 'x-cos-security-token'].some(name => seen.has(name) && !url.searchParams.get(name))) return fail();
  const signedHeaders = (url.searchParams.get('q-header-list') || '').split(';');
  if (!signedHeaders.includes('host') || new Set(signedHeaders).size !== signedHeaders.length
    || signedHeaders.some(name => name !== 'host' && (!readHeaders.has(name) || !headerNames.has(name)))) return fail();
  // COS SDK appends the temporary security token separately from the signed response query.
  const signedQuery = responseQueryKeys.filter(name => seen.has(name)).map(name => name.toLowerCase()).sort().join(';');
  if (url.searchParams.get('q-url-param-list') !== signedQuery) return fail();
  const windows = ['q-sign-time', 'q-key-time'].map(name => {
    const match = /^(\d{1,12});(\d{1,12})$/.exec(url.searchParams.get(name) || '');
    if (!match || Number(match[1]) >= Number(match[2])) return fail();
    return match.slice(1).map(seconds => Number(seconds) * 1000);
  });
  if (windows[1][0] > windows[0][0] || windows[1][1] < windows[0][1]) return fail();
  return { url: value, signatureWindow: windows[0], init: { method, headers, redirect: 'error' } };
}

function optionsOf(input) {
  const options = { profile: 'media', users: 500, durationSeconds: 60, bitrateMbps: 3, ...input };
  if (!Object.hasOwn(intervals, options.profile)) throw new Error('未知容量场景');
  if (!Number.isInteger(options.users) || options.users < 1 || options.users > 10000) throw new Error('users 必须为1到10000');
  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0 || options.durationSeconds > 3600) throw new Error('duration-seconds 必须大于0且不超过3600');
  if (!Number.isFinite(options.bitrateMbps) || options.bitrateMbps <= 0 || options.bitrateMbps > 100) throw new Error('bitrate-mbps 无效');
  options.intervalSeconds ??= intervals[options.profile];
  if (!Number.isFinite(options.intervalSeconds) || options.intervalSeconds < 0 || (options.profile !== 'exam' && options.intervalSeconds < 0.1)) throw new Error('interval-seconds 无效');
  return options;
}

export function estimateCapacity(input) {
  const options = optionsOf(input);
  const requests = options.users * (options.profile === 'exam' ? 1 : Math.ceil(options.durationSeconds / options.intervalSeconds));
  return {
    executed: false, profile: options.profile, users: options.users, durationSeconds: options.durationSeconds,
    estimatedRequests: requests, estimatedRequestsPerSecond: requests / options.durationSeconds,
    estimatedMediaBytes: options.profile === 'media' ? options.users * options.bitrateMbps * 1e6 / 8 * options.durationSeconds : 0,
    assumedBitrateMbps: options.profile === 'media' ? options.bitrateMbps : null,
    assumption: options.profile === 'exam' ? '一次集中突发，每用户一条流程；实际请求数由私有场景steps决定' : `每用户每${options.intervalSeconds}秒一轮；码率需以实际素材调整`,
  };
}

function validateScenario(scenario, users) {
  if (scenario?.environment !== 'test') throw new Error('只允许显式标记的测试环境');
  let base;
  try { base = new URL(scenario.baseUrl); } catch { throw new Error('测试环境baseUrl无效'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
  const testHost = /(^|[.-])(test|staging)([.-]|$)/i.test(base.hostname);
  if ((!local && (!testHost || base.protocol !== 'https:')) || !['http:', 'https:'].includes(base.protocol)
    || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('测试环境必须是本机或HTTPS test/staging origin');
  if (!Array.isArray(scenario.users) || scenario.users.length < users) throw new Error('测试用户场景数量不足，不能用一个账号冒充所有在线用户');
  const cosTarget = cosTargetOf(scenario);
  return scenario.users.slice(0, users).map(user => {
    if (!Array.isArray(user.steps) || !user.steps.length || user.steps.length > 20) throw new Error('每用户需要1到20个预置请求步骤');
    return user.steps.map(step => {
      if (!step || typeof step !== 'object') throw new Error('测试请求格式无效');
      if (Object.hasOwn(step, 'url')) return cosRequest(step, cosTarget);
      if (typeof step.path !== 'string' || !step.path.startsWith('/api/v1/') || step.path.includes('#') || /[\r\n\\]/.test(step.path)) throw new Error('测试请求必须是固定API相对路径');
      const url = new URL(step.path, base);
      if (url.origin !== base.origin || !url.pathname.startsWith('/api/v1/')) throw new Error('测试请求越过指定origin');
      const method = step.method || 'GET';
      if (!['GET', 'HEAD', 'POST'].includes(method)) throw new Error('容量场景只接受GET/HEAD/POST');
      if (step.headers && (typeof step.headers !== 'object' || Array.isArray(step.headers))) throw new Error('测试请求头格式无效');
      return { url: url.href, init: { method, headers: step.headers || {},
        ...(step.body === undefined ? {} : { body: typeof step.body === 'string' ? step.body : JSON.stringify(step.body) }), redirect: 'error' } };
    });
  });
}

export async function runCapacity(input, scenario, { fetchImpl = globalThis.fetch, nowMs = Date.now } = {}) {
  const options = optionsOf(input);
  const cohort = validateScenario(scenario, options.users);
  const wallNow = nowMs();
  if (!Number.isFinite(wallNow)) throw new Error('容量测试时钟无效');
  // Finish validating the entire cohort before the first API or COS request.
  for (const steps of cohort) for (const step of steps) if (step.signatureWindow
    && (step.signatureWindow[0] > wallNow || step.signatureWindow[1] <= wallNow + options.durationSeconds * 1000)) {
    throw new Error('COS签名必须已经有效且覆盖本次完整运行；请重新准备私有场景');
  }
  const samples = [];
  let attemptedRequests = 0, completedRequests = 0, deadlineAbortedRequests = 0, errorRequests = 0, responseBytes = 0, inFlight = 0, peakInFlight = 0, activeUsers = 0;
  const statuses = {};
  const started = performance.now(), deadline = started + options.durationSeconds * 1000;
  const cpuStart = process.cpuUsage();
  const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.durationSeconds * 1000);
  try {
    await Promise.all(cohort.map(async (steps, index) => {
      // Heartbeats/authz are spread over an interval; exam deliberately remains a burst.
      if (options.profile !== 'exam') {
        const offset = options.intervalSeconds * 1000 * index / options.users;
        await delay(Math.min(offset, options.durationSeconds * 1000), undefined, { signal: controller.signal }).catch(() => {});
      }
      if (controller.signal.aborted) return;
      activeUsers++;
      do {
        const cycle = performance.now();
        for (const step of steps) {
          if (controller.signal.aborted) break;
          const before = performance.now(); attemptedRequests++; inFlight++; peakInFlight = Math.max(peakInFlight, inFlight);
          let failed = false, deadlineAborted = false;
          try {
            const response = await fetchImpl(step.url, { ...step.init, signal: controller.signal });
            statuses[response.status] = (statuses[response.status] || 0) + 1;
            failed = !response.ok;
            if (response.body) for await (const bytes of response.body) responseBytes += bytes.byteLength;
          } catch { deadlineAborted = controller.signal.aborted; failed = !deadlineAborted; }
          finally {
            inFlight--;
            if (deadlineAborted) deadlineAbortedRequests++;
            else {
              completedRequests++; if (failed) errorRequests++;
              const latency = performance.now() - before;
              // Bounded reservoir; report sample count explicitly for percentiles.
              if (samples.length < 100000) samples.push(latency);
              else { const slot = Math.floor(Math.random() * completedRequests); if (slot < samples.length) samples[slot] = latency; }
            }
          }
        }
        if (options.profile === 'exam') break;
        const wait = Math.max(0, options.intervalSeconds * 1000 - (performance.now() - cycle));
        await delay(Math.min(wait, Math.max(0, deadline - performance.now())), undefined, { signal: controller.signal }).catch(() => {});
      } while (!controller.signal.aborted && performance.now() < deadline);
    }));
  } finally { clearTimeout(timeout); loop.disable(); }
  const elapsedSeconds = (performance.now() - started) / 1000;
  const cpu = process.cpuUsage(cpuStart); samples.sort((a, b) => a - b);
  const percentile = q => samples.length ? samples[Math.min(samples.length - 1, Math.ceil(samples.length * q) - 1)] : null;
  return {
    executed: true, profile: options.profile, intendedUsers: options.users, activeUsers, peakInFlight,
    elapsedSeconds, attemptedRequests, completedRequests, deadlineAbortedRequests, errorRequests, errorRate: completedRequests ? errorRequests / completedRequests : 0,
    achievedRequestsPerSecond: completedRequests / elapsedSeconds,
    responseBytes, responseBytesPerSecond: responseBytes / elapsedSeconds,
    p95Ms: percentile(0.95), p99Ms: percentile(0.99), latencySampleCount: samples.length, statuses,
    generator: { cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system, rssBytes: process.memoryUsage().rss,
      eventLoopP99Ms: loop.percentile(99) / 1e6 },
    limitations: '响应正文吞吐不等于实时播放码率且不含TLS/请求头；COS仅预检目标、签名形状和有效窗，真实验签由COS执行；本报告不采集服务端DB池/CPU，须同步记录；生成器不足不能归因于服务端。',
  };
}

export async function main(args, dependencies) {
  const options = {}; let run = false, scenarioPath;
  const fields = { '--profile': 'profile', '--users': 'users', '--duration-seconds': 'durationSeconds', '--bitrate-mbps': 'bitrateMbps', '--interval-seconds': 'intervalSeconds' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--run') run = true;
    else if (arg === '--scenario') scenarioPath = args[++i];
    else if (Object.hasOwn(fields, arg)) { const value = args[++i]; options[fields[arg]] = arg === '--profile' ? value : Number(value); }
    else throw new Error('未知容量参数');
  }
  if (!run) return estimateCapacity(options);
  if (!scenarioPath) throw new Error('--run 需要明确 --scenario 私有测试场景文件');
  const file = await open(scenarioPath, 'r');
  let scenario;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error('场景必须是0600私有普通文件');
    scenario = JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
  return runCapacity(options, scenario, dependencies);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(report => console.log(JSON.stringify(report, null, 2))).catch(() => {
    console.error('容量任务未执行或失败；请检查场景、测试目标和参数（不回显私有输入）。');
    process.exitCode = 1;
  });
}
