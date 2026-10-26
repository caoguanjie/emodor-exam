// Plan by default. A run consumes a private, explicitly labelled test cohort;
// requests/tokens/bodies are never included in the aggregate report.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';

const intervals = { media: 10, authz: 30, exam: 0, heartbeat: 30 };

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
  return scenario.users.slice(0, users).map(user => {
    if (!Array.isArray(user.steps) || !user.steps.length || user.steps.length > 20) throw new Error('每用户需要1到20个预置请求步骤');
    return user.steps.map(step => {
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

export async function runCapacity(input, scenario, { fetchImpl = globalThis.fetch } = {}) {
  const options = optionsOf(input);
  const cohort = validateScenario(scenario, options.users);
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
    limitations: '响应正文带宽不含TLS/请求头；本报告不采集服务端DB池/CPU，须同步记录；生成器不足不能归因于服务端。',
  };
}

export async function main(args) {
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
  const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
  return runCapacity(options, scenario);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(report => console.log(JSON.stringify(report, null, 2))).catch(() => {
    console.error('容量任务未执行或失败；请检查场景、测试目标和参数（不回显私有输入）。');
    process.exitCode = 1;
  });
}
