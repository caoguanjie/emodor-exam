// Disposable local MySQL/Redis pair for isolated tests.
// Passwords are generated in memory and passed to mysql2, never to argv/logs.
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');

const MYSQLD = '/opt/homebrew/opt/mysql@8.0/bin/mysqld';
const REDIS = '/opt/homebrew/bin/redis-server';

function assertBinary(path, name) {
  if (!existsSync(path)) throw new Error(`ephemeral ${name} binary not found`);
}

export async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function spawnOwned(command, args, cwd) {
  return spawn(command, args, { cwd, stdio: 'ignore', windowsHide: true });
}

async function waitForSocket(socketPath, child, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(socketPath)) return;
    if (child.exitCode !== null) throw new Error('ephemeral MySQL exited during bootstrap');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('ephemeral MySQL socket did not become ready');
}

async function waitForTcp(host, port, child, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error('ephemeral service exited before becoming ready');
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port });
        socket.once('connect', () => { socket.destroy(); resolve(); });
        socket.once('error', reject);
        socket.setTimeout(500, () => { socket.destroy(); reject(new Error('connect timeout')); });
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error('ephemeral service did not become ready');
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit').catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

export async function createEphemeralServices() {
  assertBinary(MYSQLD, 'MySQL');
  assertBinary(REDIS, 'Redis');
  const root = await mkdtemp(join(tmpdir(), 'ruleexam-a1-'));
  const mysqlDir = join(root, 'mysql');
  const redisDir = join(root, 'redis');
  await mkdir(mysqlDir, { recursive: true });
  await mkdir(redisDir, { recursive: true });
  const mysqlSocket = join(mysqlDir, 'mysql.sock');
  const mysqlPid = join(mysqlDir, 'mysqld.pid');
  const mysqlErr = join(mysqlDir, 'mysqld.err');
  const mysqlPort = await getFreePort();
  const redisPort = await getFreePort();
  const password = `A9${randomBytes(24).toString('base64url')}`;
  const username = `a1_${randomBytes(8).toString('hex')}`;
  let bootstrap;
  let mysqlProcess;
  let redisProcess;
  let cleaned = false;

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await stopProcess(redisProcess);
    await stopProcess(mysqlProcess);
    await stopProcess(bootstrap);
    await rm(root, { recursive: true, force: true });
  };

  try {
    // Initialize a private datadir without contacting any host service.
    const init = spawnOwned(MYSQLD, ['--initialize-insecure', `--datadir=${mysqlDir}`, '--basedir=/opt/homebrew/opt/mysql@8.0'], mysqlDir);
    const [initResult] = await once(init, 'exit');
    if (initResult !== 0) throw new Error('ephemeral MySQL datadir initialization failed');

    // Bootstrap root/user credentials over a Unix socket while networking is off.
    bootstrap = spawnOwned(MYSQLD, [
      `--datadir=${mysqlDir}`, `--socket=${mysqlSocket}`, `--pid-file=${mysqlPid}`, `--log-error=${mysqlErr}`,
      '--skip-networking', '--skip-grant-tables=0', '--bind-address=127.0.0.1', '--user=' + process.env.USER,
    ], mysqlDir);
    await waitForSocket(mysqlSocket, bootstrap);
    const socketConn = await mysql.createConnection({ socketPath: mysqlSocket, user: 'root', password: '' });
    const tcpUser = `\`${username}\`@'127.0.0.1'`;
    const localUser = `\`${username}\`@'localhost'`;
    const escapedPassword = mysql.escape(password);
    await socketConn.query(`CREATE USER IF NOT EXISTS ${tcpUser} IDENTIFIED BY ${escapedPassword}`);
    await socketConn.query(`ALTER USER ${tcpUser} IDENTIFIED BY ${escapedPassword}`);
    await socketConn.execute(`GRANT ALL PRIVILEGES ON *.* TO ${tcpUser} WITH GRANT OPTION`);
    await socketConn.query(`CREATE USER IF NOT EXISTS ${localUser} IDENTIFIED BY ${escapedPassword}`);
    await socketConn.query(`ALTER USER ${localUser} IDENTIFIED BY ${escapedPassword}`);
    await socketConn.execute(`GRANT ALL PRIVILEGES ON *.* TO ${localUser} WITH GRANT OPTION`);
    await socketConn.end();
    await stopProcess(bootstrap);
    bootstrap = undefined;

    mysqlProcess = spawnOwned(MYSQLD, [
      `--datadir=${mysqlDir}`, `--socket=${mysqlSocket}`, `--pid-file=${mysqlPid}`, `--log-error=${mysqlErr}`,
      `--port=${mysqlPort}`, '--bind-address=127.0.0.1', '--skip-name-resolve', '--max-connections=100', '--user=' + process.env.USER,
    ], mysqlDir);
    await waitForTcp('127.0.0.1', mysqlPort, mysqlProcess);
    const testConn = await mysql.createConnection({ host: '127.0.0.1', port: mysqlPort, user: username, password });
    await testConn.ping();
    await testConn.end();

    redisProcess = spawnOwned(REDIS, [
      '--bind', '127.0.0.1', '--port', String(redisPort), '--dir', redisDir,
      '--save', '', '--appendonly', 'no', '--protected-mode', 'yes', '--daemonize', 'no',
    ], redisDir);
    await waitForTcp('127.0.0.1', redisPort, redisProcess);

    return {
      root,
      mysql: { host: '127.0.0.1', port: mysqlPort, user: username, password },
      redis: { host: '127.0.0.1', port: redisPort },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
