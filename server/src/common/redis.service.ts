import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../config/configuration';

interface MemEntry {
  value: string;
  expiresAt: number | null;
}

/**
 * Redis 服务（AD-04：只存可再生临时态，MySQL 是唯一权威源）。
 * Redis 不可用时降级为进程内 Map 兜底（单实例部署语义，07 册 5.2/AD-04 降级取舍）：
 * 已落库数据零丢失，临时态（锁/缓存/累计）在单实例内保持正确。
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | null = null;
  private mem = new Map<string, MemEntry>();
  private available = false;
  private readonly keyPrefix: string;

  constructor(private readonly config: AppConfig) {
    this.keyPrefix = config.redis.keyPrefix || '';
  }

  /** 应用级前缀同时覆盖 Redis 命令、SCAN 匹配和进程内兜底键。 */
  private scopedKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async onModuleInit() {
    if (!this.config.redis.enabled) return;
    try {
      this.client = new Redis({
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password,
        lazyConnect: false,
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 3000)),
      });
      this.client.on('error', () => {
        this.available = false;
      });
      await this.client.ping();
      this.available = true;
      this.client.on('ready', () => {
        this.available = true;
      });
    } catch {
      this.available = false;
    }
  }

  async onModuleDestroy() {
    if (this.client) await this.client.quit().catch(() => undefined);
  }

  isAvailable(): boolean {
    return this.available && this.client !== null;
  }

  private async withFallback<T>(op: () => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
    if (this.isAvailable()) {
      try {
        return await op();
      } catch {
        this.available = false;
      }
    }
    return fallback();
  }

  // ---- 进程内兜底实现（带 TTL）----
  private memGet(key: string): MemEntry | undefined {
    const e = this.mem.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
      this.mem.delete(key);
      return undefined;
    }
    return e;
  }

  async get(key: string): Promise<string | null> {
    const scoped = this.scopedKey(key);
    return this.withFallback(
      () => this.client!.get(scoped),
      () => this.memGet(scoped)?.value ?? null,
    );
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const scoped = this.scopedKey(key);
    return this.withFallback(
      async () => {
        if (ttlSeconds) await this.client!.set(scoped, value, 'EX', ttlSeconds);
        else await this.client!.set(scoped, value);
      },
      () => {
        this.mem.set(scoped, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
      },
    );
  }

  async del(...keys: string[]): Promise<void> {
    const scoped = keys.map((key) => this.scopedKey(key));
    return this.withFallback(
      async () => {
        await this.client!.del(...scoped);
      },
      () => {
        for (const k of scoped) this.mem.delete(k);
      },
    );
  }

  async exists(key: string): Promise<boolean> {
    const scoped = this.scopedKey(key);
    return this.withFallback(
      () => this.client!.exists(scoped).then((n) => n > 0),
      () => this.memGet(scoped) !== undefined,
    );
  }

  /** SET key value NX EX ttl —— 防重复提交锁（04 册 1.5 / 05 册 AD-04） */
  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const scoped = this.scopedKey(key);
    return this.withFallback(
      () => this.client!.set(scoped, value, 'EX', ttlSeconds, 'NX').then((r) => r === 'OK'),
      () => {
        if (this.memGet(scoped) !== undefined) return false;
        this.mem.set(scoped, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
        return true;
      },
    );
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const scoped = this.scopedKey(key);
    return this.withFallback(
      async () => {
        const n = await this.client!.incr(scoped);
        if (ttlSeconds && n === 1) await this.client!.expire(scoped, ttlSeconds);
        return n;
      },
      () => {
        const cur = Number(this.memGet(scoped)?.value ?? 0) + 1;
        const prev = this.mem.get(scoped);
        const expiresAt = ttlSeconds && !prev ? Date.now() + ttlSeconds * 1000 : prev?.expiresAt ?? null;
        this.mem.set(scoped, { value: String(cur), expiresAt });
        return cur;
      },
    );
  }

  // ---- 认证吊销键（07 册 2.1.4：黑名单 / 用户级封禁）----
  /** 登出吊销：写 auth:blacklist:{jti}（TTL = access 剩余有效期） */
  async blacklistJti(jti: string, ttlSeconds: number): Promise<void> {
    await this.set(`auth:blacklist:${jti}`, '1', ttlSeconds);
  }

  /** 登出吊销：EXISTS auth:blacklist:{jti}（jti 已由调用方白名单校验） */
  async isTokenBlacklisted(jti: string): Promise<boolean> {
    return this.exists(`auth:blacklist:${jti}`);
  }

  /** 用户级封禁时刻：GET auth:block:{user_id}（值 = 封禁时刻秒级时间戳） */
  async getTokenBlockTs(userId: number): Promise<string | null> {
    return this.get(`auth:block:${userId}`);
  }

  /** 写用户级封禁键（改密 / 重置密码 / 停用账号，TTL = refresh 剩余有效期） */
  async setUserBlock(userId: number, blockTsSeconds: number, ttlSeconds: number): Promise<void> {
    await this.set(`auth:block:${userId}`, String(blockTsSeconds), ttlSeconds);
  }

  /** 登录失败计数（防爆破，07 册 2.2.2）：返回当前连续失败次数 */
  async incrLoginFail(username: string, ttlSeconds: number): Promise<number> {
    return this.incr(`auth:fail:${username}`, ttlSeconds);
  }

  async getLoginFail(username: string): Promise<string | null> {
    return this.get(`auth:fail:${username}`);
  }

  /** 锁定键剩余秒数（40106 message 含剩余秒数，04 册 5.2） */
  async getLoginFailTtl(username: string): Promise<number> {
    const scoped = this.scopedKey(`auth:fail:${username}`);
    return this.withFallback(
      () => this.client!.ttl(scoped),
      () => {
        const e = this.mem.get(scoped);
        if (!e || e.expiresAt === null) return -1;
        return Math.max(0, Math.ceil((e.expiresAt - Date.now()) / 1000));
      },
    );
  }

  async clearLoginFail(username: string): Promise<void> {
    await this.del(`auth:fail:${username}`);
  }

  // ---- Hash（学习会话累计 learn:session:{id}，03 册 6.3）----
  async hset(key: string, field: string, value: string): Promise<void> {
    const scoped = this.scopedKey(key);
    return this.withFallback(
      () => this.client!.hset(scoped, field, value).then(() => undefined),
      () => {
        const e = this.memGet(scoped);
        const obj: Record<string, string> = e ? JSON.parse(e.value) : {};
        obj[field] = value;
        this.mem.set(scoped, { value: JSON.stringify(obj), expiresAt: e?.expiresAt ?? null });
      },
    );
  }

  async hsetAll(key: string, data: Record<string, string>, ttlSeconds?: number): Promise<void> {
    const scoped = this.scopedKey(key);
    return this.withFallback(
      async () => {
        await this.client!.hset(scoped, data);
        if (ttlSeconds) await this.client!.expire(scoped, ttlSeconds);
      },
      () => {
        const e = this.memGet(scoped);
        const obj: Record<string, string> = e ? JSON.parse(e.value) : {};
        Object.assign(obj, data);
        this.mem.set(scoped, { value: JSON.stringify(obj), expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : e?.expiresAt ?? null });
      },
    );
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const scoped = this.scopedKey(key);
    return this.withFallback(
      () => this.client!.hgetall(scoped),
      () => {
        const e = this.memGet(scoped);
        return e ? JSON.parse(e.value) : {};
      },
    );
  }

  async hdel(key: string, ...fields: string[]): Promise<void> {
    const scoped = this.scopedKey(key);
    return this.withFallback(
      () => this.client!.hdel(scoped, ...fields).then(() => undefined),
      () => {
        const e = this.memGet(scoped);
        if (!e) return;
        const obj: Record<string, string> = JSON.parse(e.value);
        for (const f of fields) delete obj[f];
        this.mem.set(scoped, { value: JSON.stringify(obj), expiresAt: e.expiresAt });
      },
    );
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const scoped = this.scopedKey(key);
    return this.withFallback(
      () => this.client!.expire(scoped, ttlSeconds).then(() => undefined),
      () => {
        const e = this.mem.get(scoped);
        if (e) e.expiresAt = Date.now() + ttlSeconds * 1000;
      },
    );
  }

  /** 按前缀批量删除（统计缓存失效，05 册 7.4.4：SCAN 而非 KEYS） */
  async delByPrefix(prefix: string): Promise<void> {
    const scopedPrefix = this.scopedKey(prefix);
    return this.withFallback(
      async () => {
        let cursor = '0';
        do {
          const [next, keys] = await this.client!.scan(cursor, 'MATCH', `${scopedPrefix}*`, 'COUNT', 200);
          cursor = next;
          if (keys.length) await this.client!.del(...keys);
        } while (cursor !== '0');
      },
      () => {
        for (const k of Array.from(this.mem.keys())) if (k.startsWith(scopedPrefix)) this.mem.delete(k);
      },
    );
  }
}
