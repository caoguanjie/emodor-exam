import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { delimiter } from 'node:path';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisService } from '../src/common/redis.service';

const HOMEBREW_REDIS_SERVER = '/opt/homebrew/bin/redis-server';
const runId = randomUUID().replaceAll('-', '');
const prefixA = `a1:redis:${runId}:a:`;
const prefixB = `a1:redis:${runId}:b:`;

let port: number;
let taskDir: string;
let redisServer: string;
let redisProcess: ChildProcess | undefined;
let raw: Redis;
let serviceA: RedisService;
let serviceB: RedisService;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function findFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to allocate a loopback port')));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function executablePath(candidate: string): Promise<string | undefined> {
  try {
    await access(candidate, fsConstants.X_OK);
    return candidate;
  } catch {
    return undefined;
  }
}

async function resolveRedisServer(): Promise<string> {
  const explicit = process.env.TEST_REDIS_SERVER;
  if (explicit) {
    const resolved = await executablePath(explicit);
    if (!resolved) throw new Error(`TEST_REDIS_SERVER is not an executable: ${explicit}`);
    return resolved;
  }

  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const resolved = await executablePath(join(directory, 'redis-server'));
    if (resolved) return resolved;
  }

  const fallback = await executablePath(HOMEBREW_REDIS_SERVER);
  if (fallback) return fallback;
  throw new Error(
    `required redis-server binary is missing; install redis-server, add it to PATH, or set TEST_REDIS_SERVER (checked ${HOMEBREW_REDIS_SERVER})`,
  );
}

async function waitForRedis(client: Redis): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await client.connect();
      await client.ping();
      return;
    } catch (error) {
      lastError = error;
      client.disconnect();
      await delay(50);
    }
  }
  throw new Error(`owned redis did not become ready: ${String(lastError)}`);
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(hasExited(child));
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

async function stopOwnedRedis(child: ChildProcess | undefined): Promise<void> {
  if (!child || hasExited(child)) return;
  if (!child.kill('SIGTERM') && !hasExited(child)) {
    throw new Error('failed to send SIGTERM to owned redis process');
  }
  if (await waitForExit(child, 3_000)) return;

  if (!child.kill('SIGKILL') && !hasExited(child)) {
    throw new Error('failed to send SIGKILL to owned redis process');
  }
  if (!(await waitForExit(child, 3_000)) && !hasExited(child)) {
    throw new Error('owned redis process did not exit; refusing to remove its task directory');
  }
}

beforeAll(async () => {
  redisServer = await resolveRedisServer();
  taskDir = await mkdtemp(join(tmpdir(), 'ruleexam-redis-prefix-'));
  port = await findFreeLoopbackPort();
  redisProcess = spawn(
    redisServer,
    [
      '--bind', '127.0.0.1',
      '--port', String(port),
      '--dir', taskDir,
      '--save', '',
      '--appendonly', 'no',
      '--protected-mode', 'no',
      '--loglevel', 'warning',
    ],
    { stdio: 'ignore' },
  );
  redisProcess.on('error', () => undefined);

  raw = new Redis({
    host: '127.0.0.1',
    port,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  raw.on('error', () => undefined);
  await waitForRedis(raw);

  const config = (keyPrefix: string) => ({
    redis: { enabled: true, host: '127.0.0.1', port, keyPrefix },
  });
  serviceA = new RedisService(config(prefixA) as any);
  serviceB = new RedisService(config(prefixB) as any);
  await serviceA.onModuleInit();
  await serviceB.onModuleInit();
  expect(serviceA.isAvailable()).toBe(true);
  expect(serviceB.isAvailable()).toBe(true);
});

afterAll(async () => {
  await serviceA?.onModuleDestroy();
  await serviceB?.onModuleDestroy();
  if (raw) await raw.quit().catch(() => raw.disconnect());
  await stopOwnedRedis(redisProcess);
  if (taskDir) await rm(taskDir, { recursive: true, force: true });
});

describe('RedisService real Redis key namespace', () => {
  it('uses the configured physical prefix for strings, counters, NX locks, TTLs, and deletion', async () => {
    await serviceA.set('string:key', 'value');
    expect(await serviceA.get('string:key')).toBe('value');
    await serviceA.del('string:key');
    expect(await serviceA.get('string:key')).toBeNull();

    expect(await serviceA.incr('counter:key', 30)).toBe(1);
    expect(await serviceA.incr('counter:key', 30)).toBe(2);
    expect(await raw.get(`${prefixA}counter:key`)).toBe('2');
    expect(await raw.get('counter:key')).toBeNull();

    expect(await serviceA.setNx('lock:key', 'first', 30)).toBe(true);
    expect(await serviceA.setNx('lock:key', 'second', 30)).toBe(false);
    expect(await serviceA.get('lock:key')).toBe('first');
    expect(await raw.get(`${prefixA}lock:key`)).toBe('first');
    expect(await raw.get('lock:key')).toBeNull();

    const ttlUser = `ttl-${runId}`;
    const ttlKey = `auth:fail:${ttlUser}`;
    expect(await serviceA.incr(ttlKey, 30)).toBe(1);
    const initialTtl = await serviceA.getLoginFailTtl(ttlUser);
    expect(initialTtl).toBeGreaterThan(0);
    await serviceA.expire(ttlKey, 3);
    const shortenedTtl = await serviceA.getLoginFailTtl(ttlUser);
    expect(shortenedTtl).toBeGreaterThan(0);
    expect(shortenedTtl).toBeLessThanOrEqual(3);
    expect(await raw.get(`${prefixA}${ttlKey}`)).toBe('1');
    expect(await raw.get(ttlKey)).toBeNull();

    await serviceA.set('physical:key', 'prefixed');
    const physicalKeys = await raw.keys('*');
    expect(physicalKeys).toContain(`${prefixA}physical:key`);
    expect(await raw.get(`${prefixA}physical:key`)).toBe('prefixed');
    expect(physicalKeys).not.toContain('physical:key');
  });

  it('keeps hashes and prefix scans isolated, including the outside sentinel key', async () => {
    await raw.set('sentinel:outside', 'must-survive');
    await serviceA.hsetAll('hash:key', { first: 'one', second: 'two' }, 30);
    await serviceA.hset('hash:key', 'third', 'three');
    expect(await serviceA.hgetall('hash:key')).toEqual({ first: 'one', second: 'two', third: 'three' });
    await serviceA.hdel('hash:key', 'second');
    expect(await serviceA.hgetall('hash:key')).toEqual({ first: 'one', third: 'three' });
    expect(await raw.hgetall(`${prefixA}hash:key`)).toEqual({ first: 'one', third: 'three' });
    expect(await raw.hgetall('hash:key')).toEqual({});
    expect(await raw.ttl(`${prefixA}hash:key`)).toBeGreaterThan(0);

    await serviceA.set('scan:one', 'a1');
    await serviceA.set('scan:two', 'a2');
    await serviceA.set('keep:one', 'keep-a');
    await serviceB.set('scan:one', 'b1');
    await raw.set('scan:outside', 'outside');

    await serviceA.delByPrefix('scan:');
    expect(await serviceA.get('scan:one')).toBeNull();
    expect(await serviceA.get('scan:two')).toBeNull();
    expect(await serviceA.get('keep:one')).toBe('keep-a');
    expect(await serviceB.get('scan:one')).toBe('b1');
    expect(await raw.get('scan:outside')).toBe('outside');
    expect(await raw.get('sentinel:outside')).toBe('must-survive');
    expect(await raw.get(`${prefixA}scan:one`)).toBeNull();
    expect(await raw.get(`${prefixA}scan:two`)).toBeNull();
    expect(await raw.get(`${prefixA}keep:one`)).toBe('keep-a');
    expect(await raw.get(`${prefixB}scan:one`)).toBe('b1');

    await serviceA.set('shared:key', 'a');
    await serviceB.set('shared:key', 'b');
    expect(await serviceA.get('shared:key')).toBe('a');
    expect(await serviceB.get('shared:key')).toBe('b');
    await serviceA.del('shared:key');
    expect(await serviceA.get('shared:key')).toBeNull();
    expect(await serviceB.get('shared:key')).toBe('b');
    expect(await raw.get(`${prefixA}shared:key`)).toBeNull();
    expect(await raw.get(`${prefixB}shared:key`)).toBe('b');

    const physicalKeys = await raw.keys('*');
    expect(physicalKeys).toContain(`${prefixB}shared:key`);
    expect(physicalKeys).not.toContain('shared:key');
    expect(physicalKeys).toContain('scan:outside');
  });
});
