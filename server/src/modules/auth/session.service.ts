import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { AuthSession } from '../../entities/auth-session.entity';
import { AppConfig } from '../../config/configuration';
import { Errors } from '../../common/errors';
import { RedisService } from '../../common/redis.service';
import { AuditService } from '../../common/audit.service';

@Injectable()
export class SessionService {
  private readonly refreshTtlSeconds: number;

  constructor(
    @InjectRepository(AuthSession) private readonly repo: Repository<AuthSession>,
    private readonly redis: RedisService,
    private readonly audit?: AuditService,
    config?: AppConfig,
  ) {
    this.refreshTtlSeconds = (config?.jwt.refreshExpiresDays || 7) * 86400;
  }

  async create(userId: string | number, ip: string | null, userAgent: string | null, manager?: EntityManager): Promise<AuthSession> {
    const repo = manager?.getRepository(AuthSession) || this.repo;
    const now = new Date();
    const session = repo.create({
      sid: randomBytes(24).toString('hex'), userId: String(userId),
      ipAddress: ip, userAgent: userAgent?.slice(0, 255) || null,
      lastSeenAt: now, expiresAt: new Date(now.getTime() + this.refreshTtlSeconds * 1000), revokedAt: null,
    });
    return repo.save(session);
  }

  async touch(sid: string, renewExpiry = false): Promise<void> {
    if (!/^[a-f0-9]{48}$/.test(sid)) return;
    const current = await this.repo.findOne({ where: { sid } });
    if (!current || current.revokedAt) return;
    const now = new Date();
    const changes: Partial<AuthSession> = { lastSeenAt: now };
    if (renewExpiry) {
      // A successful refresh grants the full refresh TTL again. Persist the
      // true expiry rather than deriving it from the original login time.
      changes.expiresAt = new Date(now.getTime() + this.refreshTtlSeconds * 1000);
    }
    await this.repo.update({ sid }, changes);
  }

  async isRevoked(sid: string): Promise<boolean> {
    if (!/^[a-f0-9]{48}$/.test(sid)) return false;
    // Redis 是快速吊销缓存，数据库撤销态是持久事实；即使 Redis 重启或
    // key 过期，已被管理端强制下线的会话也不能重新放行旧 JWT。
    if (await this.redis.isSessionRevoked(sid)) return true;
    const session = await this.repo.findOne({ where: { sid } });
    // 带 sid 的新令牌必须对应落库会话；不存在的 sid 视为无效，避免伪造
    // 一个格式正确但从未签发过的会话标识绕过会话收口。
    return !session || Boolean(session.revokedAt);
  }

  async revoke(sessionId: string, actorId: string | number): Promise<void> {
    const session = await this.repo.findOne({ where: { id: String(sessionId) } });
    if (!session) throw Errors.notFound('会话不存在');
    if (!session.revokedAt) {
      session.revokedAt = new Date();
      await this.repo.save(session);
    }
    await this.redis.revokeSession(session.sid, this.refreshTtlSeconds);
    this.audit?.log({ actor_id: Number(actorId), actor_name: 'system', action: 'auth.session.revoke', object_type: 'auth_session', object_id: session.id, detail: { user_id: session.userId }, result: 'success', source_ip: null });
  }

  async revokeBySid(sid: string, actorId: string | number): Promise<void> {
    const session = await this.repo.findOne({ where: { sid } });
    if (!session) return;
    await this.revoke(String(session.id), actorId);
  }

  /**
   * 在调用方事务内吊销用户现有 durable sessions，并返回旧 sid；Redis
   * 标记必须由调用方在事务提交后写入，避免回滚后留下错误的缓存吊销。
   */
  async invalidateUser(manager: EntityManager, userId: string | number): Promise<string[]> {
    const repo = manager.getRepository(AuthSession);
    const current = await repo.find({ where: { userId: String(userId), revokedAt: IsNull() } });
    if (!current.length) return [];
    await repo.createQueryBuilder()
      .update(AuthSession)
      .set({ revokedAt: new Date() })
      .where('user_id = :userId AND revoked_at IS NULL', { userId: String(userId) })
      .execute();
    return current.map((session) => session.sid);
  }

  /** Redis 侧快速收口；持久状态已由 invalidateUser/revoke 写入数据库。 */
  async markRevoked(sids: string[]): Promise<void> {
    await Promise.all(sids.map((sid) => this.redis.revokeSession(sid, this.refreshTtlSeconds)));
  }

  async list(page = 1, pageSize = 20) {
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const qb = this.repo.createQueryBuilder('s');
    const total = await qb.getCount();
    const rows = await qb.orderBy('s.created_at', 'DESC').skip((safePage - 1) * safePageSize).take(safePageSize).getMany();
    const now = Date.now();
    return {
      items: rows.map((row) => {
        // Legacy rows from a rolling deployment may not expose the new field
        // until 002_access has completed; retain the old derived fallback only
        // for that compatibility window.
        const expiresAt = row.expiresAt || new Date(row.createdAt.getTime() + this.refreshTtlSeconds * 1000);
        return {
        id: String(row.id), sid: row.sid, user_id: String(row.userId),
        user_agent: row.userAgent, ip_address: row.ipAddress,
        created_at: row.createdAt, last_seen_at: row.lastSeenAt, revoked_at: row.revokedAt,
        expires_at: expiresAt,
        status: row.revokedAt ? 'revoked' : (expiresAt.getTime() <= now ? 'expired' : 'active'),
        };
      }),
      total, page: safePage, page_size: safePageSize,
    };
  }
}
