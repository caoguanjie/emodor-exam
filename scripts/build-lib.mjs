import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const supportedTargets = new Set(['web', 'h5', 'mp-weixin']);

export function parseBuildTargets(argv) {
  if (!argv.length || argv.some((target) => !supportedTargets.has(target))) {
    throw new Error('用法：node scripts/build.mjs web|h5|web h5|mp-weixin');
  }
  const targets = [...new Set(argv)];
  if (targets.includes('mp-weixin') && targets.length !== 1) {
    throw new Error('mp-weixin 必须单独构建；网站组合构建使用 web h5。');
  }
  return targets;
}

async function pathInfo(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function validateEntrypoint(directory, entrypoint = 'index.html') {
  const file = join(directory, entrypoint);
  const info = await pathInfo(file);
  if (!info?.isFile() || info.size === 0) throw new Error(`构建产物缺少有效入口：${file}`);
}

export async function assembleRelease({ targets, existingDist, webOutput, h5Output, stagingDir }) {
  const hasWeb = targets.includes('web');
  const hasH5 = targets.includes('h5');
  if (!hasWeb && !hasH5) throw new Error('网站产物必须包含 web 或 h5。');
  const existing = await pathInfo(existingDist);
  if (existing && !existing.isDirectory()) throw new Error(`发布目录必须是普通目录：${existingDist}`);
  if (hasWeb) {
    await validateEntrypoint(webOutput);
    if (await pathInfo(join(webOutput, 'mobile'))) throw new Error('PC 产物不能包含保留目录 mobile。');
  }
  if (hasH5) await validateEntrypoint(h5Output);
  await mkdir(stagingDir);

  // 只保留本次没有构建的端；已构建端的旧哈希资源不混入新版本。
  if (existing) {
    for (const entry of await readdir(existingDist)) {
      if ((entry === 'mobile' && !hasH5) || (entry !== 'mobile' && !hasWeb)) {
        await cp(join(existingDist, entry), join(stagingDir, entry), { recursive: true });
      }
    }
  }
  if (hasWeb) await cp(webOutput, stagingDir, { recursive: true });
  if (hasH5) await cp(h5Output, join(stagingDir, 'mobile'), { recursive: true });

  if (hasWeb || await pathInfo(join(stagingDir, 'index.html'))) await validateEntrypoint(stagingDir);
  if (hasH5 || await pathInfo(join(stagingDir, 'mobile'))) await validateEntrypoint(join(stagingDir, 'mobile'));
  return stagingDir;
}

export async function atomicPublish(stagingDir, distDir, operations = {}) {
  const move = operations.rename ?? rename;
  const parent = dirname(distDir);
  await mkdir(parent, { recursive: true });
  if ((await stat(stagingDir)).dev !== (await stat(parent)).dev) {
    throw new Error('staging 与发布目录必须位于同一文件系统。');
  }
  const current = await pathInfo(distDir);
  if (current && !current.isDirectory()) throw new Error(`发布目录必须是普通目录：${distDir}`);
  const backupDir = await mkdtemp(join(parent, '.build-backup-'));
  const previous = join(backupDir, 'previous');
  let backedUp = false;
  let keepBackup = false;
  try {
    if (current) {
      await move(distDir, previous);
      backedUp = true;
    }
    try {
      await move(stagingDir, distDir);
    } catch (publishError) {
      if (backedUp) {
        try {
          await move(previous, distDir);
        } catch (rollbackError) {
          keepBackup = true;
          throw new AggregateError([publishError, rollbackError], `发布与回滚失败；旧产物保留在 ${previous}`);
        }
      }
      throw publishError;
    }
  } finally {
    if (!keepBackup) {
      // 发布已经完成时，备份清理失败不能被误报成发布失败。
      await rm(backupDir, { recursive: true, force: true }).catch((error) => {
        console.warn(`旧构建备份未清理：${backupDir} (${error.message})`);
      });
    }
  }
}

function checkCancellation(signal) {
  if (signal?.aborted) throw new Error(`构建已取消 (${signal.reason})`);
}

function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

async function stopCompiler(child, signal) {
  const pid = process.platform === 'win32' ? child.pid : -child.pid;
  if (!pid) return;
  const send = (name) => {
    try { process.kill(pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  send(signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
  const deadline = Date.now() + 3_000;
  while (processExists(pid) && Date.now() < deadline) await delay(25);
  if (processExists(pid)) send('SIGKILL');
  const killDeadline = Date.now() + 3_000;
  while (processExists(pid) && Date.now() < killDeadline) await delay(25);
  if (processExists(pid)) throw new Error(`编译子进程组尚未退出：${pid}`);
}

async function compileTarget(target, { rootDir, outputDir, signal }) {
  checkCancellation(signal);
  const project = target === 'web' ? 'web' : 'mobile';
  const script = target === 'web' ? 'build' : `build:${target}`;
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
    cwd: join(rootDir, project),
    // 独立进程组只包含本次编译，信号不会触及调用者或其它构建。
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      RULEEXAM_BUILD_OUT_DIR: outputDir,
      ...(target === 'web' ? {} : { UNI_OUTPUT_DIR: outputDir }),
    },
    stdio: 'inherit',
  });
  const closed = new Promise((fulfill, reject) => {
    child.once('error', reject);
    child.once('close', (code, exitSignal) => fulfill({ code, signal: exitSignal }));
  });
  let stopping;
  let stopError;
  const onAbort = () => {
    stopping ??= stopCompiler(child, signal.reason).catch((error) => { stopError = error; });
  };
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) onAbort();
  try {
    const outcome = await closed;
    if (stopping) await stopping;
    if (stopError) throw stopError;
    checkCancellation(signal);
    if (outcome.code !== 0) throw new Error(`${target} 构建失败 (${outcome.signal ?? `exit ${outcome.code}`})`);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function runBuild(argv, { rootDir = repositoryRoot, buildTarget = compileTarget, signal } = {}) {
  const targets = parseBuildTargets(argv);
  rootDir = resolve(rootDir);
  const lockDir = join(rootDir, '.build.lock');
  try {
    await mkdir(lockDir);
  } catch (error) {
    if (error.code === 'EEXIST') {
      let owner;
      try { owner = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8')); } catch {}
      const state = Number.isInteger(owner?.pid) && owner.pid > 0
        ? (processExists(owner.pid) ? `进程 ${owner.pid} 仍在运行` : `旧进程 ${owner.pid} 已退出，核查后可手动移除旧锁`)
        : '无法确认持有者，请核查是否仍有构建运行';
      throw new Error(`构建锁已存在：${lockDir}；${state}。`);
    }
    throw error;
  }
  let workDir;
  const owner = { pid: process.pid, token: randomUUID() };
  try {
    await writeFile(join(lockDir, 'owner.json'), JSON.stringify(owner), { flag: 'wx' });
    checkCancellation(signal);
    // 临时产物与 dist 同盘，编译失败时完全不触碰现有发布目录。
    workDir = await mkdtemp(join(rootDir, '.build-'));
    const outputs = {};
    for (const target of targets) {
      outputs[target] = join(workDir, target);
      checkCancellation(signal);
      await buildTarget(target, { rootDir, outputDir: outputs[target], signal });
      checkCancellation(signal);
    }
    if (targets[0] === 'mp-weixin') {
      await validateEntrypoint(outputs['mp-weixin'], 'app.json');
      await validateEntrypoint(outputs['mp-weixin'], 'app.js');
      const distDir = join(rootDir, 'mobile/dist/build/mp-weixin');
      checkCancellation(signal);
      // 发布临界区不中断：即使收到信号，也先完成切换或回滚，再清理退出。
      await atomicPublish(outputs['mp-weixin'], distDir);
      checkCancellation(signal);
      return distDir;
    }
    const distDir = join(rootDir, 'dist');
    const stagingDir = await assembleRelease({
      targets, existingDist: distDir, webOutput: outputs.web,
      h5Output: outputs.h5, stagingDir: join(workDir, 'release'),
    });
    checkCancellation(signal);
    await atomicPublish(stagingDir, distDir);
    checkCancellation(signal);
    return distDir;
  } finally {
    try {
      if (workDir) await rm(workDir, { recursive: true, force: true });
    } finally {
      const current = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8'));
      if (current.pid === owner.pid && current.token === owner.token) await rm(lockDir, { recursive: true, force: true });
      else console.warn(`构建锁持有者已变化，保留现有锁：${lockDir}`);
    }
  }
}
