import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { AuthSession } from '../../entities/auth-session.entity';
import { AppConfig } from '../../config/configuration';
import { Errors } from '../../common/errors';
import { RedisService } from '../../common/redis.service';
import { AuditService } from '../../common/audit.service';
import type { SessionListStatus } from './session-query.dto';

export interface SessionListFilters { keyword?: string; status?: SessionListStatus }
type SessionAuditActor = string | number | { id: string | number; name: string; sourceIp?: string | null };

interface SessionListRow {
  id: string; sid: string; user_id: string; username: string | null; real_name: string | null;
  client: 'pc' | 'mobile' | null; user_agent: string | null; ip_address: string | null;
  created_at: Date; last_seen_at: Date; revoked_at: Date | null; expires_at: Date | null;
}

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

  private auditActor(actor: SessionAuditActor) {
    if (typeof actor === 'object') return { id: actor.id, name: actor.name, sourceIp: actor.sourceIp || null };
    return { id: Number(actor), name: `user:${String(actor)}`, sourceIp: null };
  }

  async create(userId: string | number, ip: string | null, userAgent: string | null, manager?: EntityManager, identity: { client: 'pc' | 'mobile'; authMethod: 'password' | 'sms' | 'debug' } = { client: 'pc', authMethod: 'password' }): Promise<AuthSession> {
    const repo = manager?.getRepository(AuthSession) || this.repo;
    const now = new Date();
    const session = repo.create({
      sid: randomBytes(24).toString('hex'), userId: String(userId),
      client: identity.client, authMethod: identity.authMethod,
      ipAddress: ip, userAgent: userAgent?.slice(0, 255) || null,
      // Do not let MySQL CURRENT_TIMESTAMP(3) fill these two columns in its
      // own timezone.  A newly-created session must share one JS timestamp
      // across the UI-visible created/updated/last-seen fields.
      createdAt: now, updatedAt: now, lastSeenAt: now,
      expiresAt: new Date(now.getTime() + this.refreshTtlSeconds * 1000), revokedAt: null,
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
    return !session || Boolean(session.revokedAt) || Boolean(session.expiresAt && session.expiresAt.getTime() <= Date.now());
  }

  /** Durable session identity must match JWT claims; a valid sid is not enough. */
  async isActiveFor(sid: string, userId: string | number, client: 'pc' | 'mobile', authMethod?: string): Promise<boolean> {
    if (await this.isRevoked(sid)) return false;
    const session = await this.repo.findOne({ where: { sid } });
    return Boolean(session && String(session.userId) === String(userId)
      && (session.client || 'pc') === client && (!authMethod || (session.authMethod || 'password') === authMethod));
  }

  async revoke(sessionId: string, actorInput: SessionAuditActor): Promise<void> {
    const session = await this.repo.findOne({ where: { id: String(sessionId) } });
    if (!session) throw Errors.notFound('会话不存在');
    if (!session.revokedAt) {
      session.revokedAt = new Date();
      await this.repo.save(session);
    }
    await this.redis.revokeSession(session.sid, this.refreshTtlSeconds);
    const actor = this.auditActor(actorInput);
    const action = typeof actorInput === 'object' ? 'auth.session.force_revoke' : 'auth.session.revoke';
    this.audit?.log({ actor_id: actor.id, actor_name: actor.name, action, object_type: 'auth_session', object_id: session.id, detail: { user_id: session.userId }, result: 'success', source_ip: actor.sourceIp });
  }

  async revokeBySid(sid: string, actorInput: SessionAuditActor): Promise<void> {
    const session = await this.repo.findOne({ where: { sid } });
    if (!session) return;
    await this.revoke(String(session.id), actorInput);
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

  async list(page = 1, pageSize = 20, filters: SessionListFilters = {}, currentSid?: string) {
    const safePage = Math.min(1_000_000, Math.max(1, Number(page) || 1));
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const now = new Date();
    const qb = this.repo.createQueryBuilder('s')
      .leftJoin('sys_user', 'u', 'u.id = s.user_id')
      .select('s.id', 'id').addSelect('s.sid', 'sid').addSelect('s.user_id', 'user_id')
      .addSelect('u.username', 'username').addSelect('u.real_name', 'real_name')
      .addSelect('s.client', 'client').addSelect('s.user_agent', 'user_agent').addSelect('s.ip_address', 'ip_address')
      .addSelect('s.created_at', 'created_at').addSelect('s.last_seen_at', 'last_seen_at')
      .addSelect('s.revoked_at', 'revoked_at').addSelect('s.expires_at', 'expires_at');
    const keyword = filters.keyword?.trim();
    if (keyword) {
      // Use an explicit escape character so SQL wildcards in a name stay literal,
      // independent of the server's NO_BACKSLASH_ESCAPES mode.
      const pattern = `%${keyword.replace(/[!%_]/g, '!$&')}%`;
      qb.andWhere("(u.username LIKE :keyword ESCAPE '!' OR u.real_name LIKE :keyword ESCAPE '!')", { keyword: pattern });
    }
    const status = filters.status ?? 'active';
    const expiry = 'COALESCE(s.expires_at, DATE_ADD(s.created_at, INTERVAL :refreshTtlSeconds SECOND))';
    if (status === 'active' || status === 'expired') {
      qb.andWhere(`s.revoked_at IS NULL AND ${expiry} ${status === 'active' ? '>' : '<='} :now`,
        { refreshTtlSeconds: this.refreshTtlSeconds, now });
    } else if (status === 'revoked') {
      qb.andWhere('s.revoked_at IS NOT NULL');
    }
    const total = await qb.getCount();
    // Raw projection queries with a join require limit/offset; skip/take is
    // reserved for TypeORM's entity pagination and can be ignored here.
    const rows = await qb.orderBy('s.created_at', 'DESC').addOrderBy('s.id', 'DESC')
      .offset((safePage - 1) * safePageSize).limit(safePageSize).getRawMany<SessionListRow>();
    return {
      items: rows.map((row) => {
        // Legacy rows from a rolling deployment may not expose the new field
        // until 002_access has completed; retain the old derived fallback only
        // for that compatibility window.
        const expiresAt = row.expires_at || new Date(row.created_at.getTime() + this.refreshTtlSeconds * 1000);
        return {
          id: String(row.id), sid: row.sid, user_id: String(row.user_id),
          username: row.username ?? null, real_name: row.real_name ?? null,
          client: row.client === 'mobile' ? 'mobile' : 'pc', is_current: Boolean(currentSid && row.sid === currentSid),
          user_agent: row.user_agent, ip_address: row.ip_address,
          created_at: row.created_at, last_seen_at: row.last_seen_at, revoked_at: row.revoked_at,
          expires_at: expiresAt,
          status: row.revoked_at ? 'revoked' : (expiresAt.getTime() <= now.getTime() ? 'expired' : 'active'),
        };
      }),
      total, page: safePage, page_size: safePageSize,
    };
  }
}
