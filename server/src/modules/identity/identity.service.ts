import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Errors } from '../../common/errors';
import { AppConfig } from '../../config/configuration';
import { LearnerIdentity } from '../../entities/learner-identity.entity';
import { IdentityVerificationSession } from '../../entities/identity-verification-session.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { MediaService } from '../media/media.service';
import { IdentityCrypto } from './identity-crypto';
import { IDENTITY_PROVIDER, IdentityImageType, IdentityProvider, IdentityProviderResult, IdentitySettings } from './identity-provider';
import { IdentitySessionCreateDto } from './identity.dto';
import { AuditService } from '../../common/audit.service';

const OWNER = 'identity_verification_user';
const PURPOSES = ['identity_face', 'identity_id_portrait', 'identity_id_emblem'] as const;
export function clearIdentityMaterials(reason: string | null): IdentityImageType[] {
  if (reason === 'FACE_MISMATCH' || reason === 'FACE_QUALITY_FAILED') return ['face'];
  if (reason === 'ID_CARD_PORTRAIT_PARSE_FAILED') return ['id_card_portrait'];
  if (reason === 'ID_CARD_EMBLEM_PARSE_FAILED') return ['id_card_emblem'];
  if (reason === 'ID_CARD_DOCUMENT_INVALID' || reason === 'ID_CARD_EXPIRED') return ['id_card_portrait', 'id_card_emblem'];
  return [];
}
@Injectable()
export class IdentityService implements OnModuleInit {
  constructor(
    @InjectRepository(LearnerIdentity) private readonly identities: Repository<LearnerIdentity>,
    @InjectRepository(IdentityVerificationSession) private readonly sessions: Repository<IdentityVerificationSession>,
    private readonly dataSource: DataSource,
    private readonly media: MediaService,
    @Inject(IDENTITY_PROVIDER) private readonly provider: IdentityProvider,
    private readonly crypto: IdentityCrypto,
    private readonly config: AppConfig,
    @Optional() private readonly audit?: AuditService,
  ) {}
  onModuleInit() {
    this.media.registerOwnerPolicy(OWNER, { allowedPurposes: PURPOSES,
      authorizeRead: async (actor, owner) => actor === owner,
      validateBinding: async (_manager, asset, owner) => { if (asset.ownerId !== owner || asset.uploadedBy !== owner) throw Errors.dataForbidden(); },
    });
  }
  assertAvailable() { if (!this.provider.enabled) throw Errors.serviceUnavailable('实名认证暂不可用'); }
  async assertNameEditable(manager: EntityManager, userId: string, before: string, after: string) {
    if (before !== after && await manager.getRepository(LearnerIdentity).findOne({ where: { userId } })) throw Errors.param('实名认证姓名不能通过普通资料修改');
  }
  private async user(manager: EntityManager, id: string) {
    const user = await manager.getRepository(SysUser).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!user || Number(user.status) !== 1) throw Errors.accountDisabled();
    if (user.role !== 'employee') throw Errors.forbidden();
    return user;
  }
  private async material(userId: string, input: IdentitySessionCreateDto, manager?: EntityManager) {
    if (new Set(Object.values(input)).size !== 3) throw Errors.param('三图材料不可重复');
    await this.media.assertUsable(userId, input.face_asset_id, 'identity_face', userId, manager);
    await this.media.assertUsable(userId, input.id_card_portrait_asset_id, 'identity_id_portrait', userId, manager);
    await this.media.assertUsable(userId, input.id_card_emblem_asset_id, 'identity_id_emblem', userId, manager);
  }
  private fingerprint(input: IdentitySessionCreateDto) { return createHash('sha256').update([input.face_asset_id, input.id_card_portrait_asset_id, input.id_card_emblem_asset_id].join(':')).digest('hex'); }
  private sessionView(session: IdentityVerificationSession) {
    return { session_id: session.id, status: session.status === 'verified' ? 'verified' as const : ['rejected', 'expired'].includes(session.status) ? 'rejected' as const : 'pending' as const,
      reason_code: session.reasonCode, clear_materials: clearIdentityMaterials(session.reasonCode), expires_at: session.expiresAt.toISOString() };
  }
  async view(userId: string) {
    let identity = await this.identities.findOne({ where: { userId: String(userId) } });
    if (!identity) {
      const recoverable = await this.sessions.findOne({ where: { userId: String(userId), status: 'provider_verified' }, order: { createdAt: 'DESC' } });
      if (recoverable) { await this.bind(recoverable); identity = await this.identities.findOne({ where: { userId: String(userId) } }); }
    }
    if (identity) {
      const value = this.crypto.decrypt<{ realName: string; idNumber: string }>(identity.identityEncrypted);
      return { status: 'verified' as const, real_name: value.realName, id_number_masked: value.idNumber.slice(0, 3) + '*'.repeat(Math.max(4, value.idNumber.length - 7)) + value.idNumber.slice(-4), verified_at: identity.verifiedAt.toISOString(), current_session_id: null, reason_code: null };
    }
    const sessions = await this.sessions.find({ where: { userId: String(userId) }, order: { createdAt: 'DESC' }, take: 1 });
    const latest = sessions[0];
    if (!latest || latest.expiresAt.getTime() <= Date.now()) return { status: 'unverified' as const, real_name: null, id_number_masked: null, verified_at: null, current_session_id: null, reason_code: null };
    return { status: ['rejected', 'expired'].includes(latest.status) ? 'rejected' as const : 'pending' as const, real_name: null, id_number_masked: null, verified_at: null, current_session_id: latest.id, reason_code: latest.reasonCode };
  }
  async create(userId: string, input: IdentitySessionCreateDto) {
    const fingerprint = this.fingerprint(input);
    const result = await this.dataSource.transaction(async (manager) => {
      const user = await this.user(manager, String(userId));
      const identity = await manager.getRepository(LearnerIdentity).findOne({ where: { userId: String(userId) } });
      if (identity) throw Errors.identityAlreadyVerified();
      const repo = manager.getRepository(IdentityVerificationSession);
      const same = await repo.find({ where: { userId: String(userId), materialFingerprint: fingerprint }, order: { createdAt: 'DESC' } });
      const reusable = same.find((s) => s.status === 'provider_verified' || s.expiresAt.getTime() > Date.now());
      if (reusable) return reusable;
      const active = await repo.find({ where: { userId: String(userId) }, order: { createdAt: 'DESC' } });
      for (const stale of active) {
        if (['created', 'provider_pending', 'provider_unknown'].includes(stale.status) && stale.expiresAt.getTime() <= Date.now()) { stale.status = 'expired'; stale.reasonCode = 'SESSION_EXPIRED'; await repo.save(stale); }
      }
      if (active.some((s) => s.status === 'provider_verified' || !['verified', 'rejected', 'expired'].includes(s.status) && s.expiresAt.getTime() > Date.now())) throw Errors.sessionConflict('已有实名认证正在处理中');
      if (!user.realName?.trim() || !user.categoryId) throw Errors.param('请先填写姓名并确认培训工种');
      this.assertAvailable();
      await this.material(String(userId), input, manager);
      const ttl = (this.config as AppConfig & { identity: IdentitySettings }).identity?.sessionTtlSeconds || 600;
      const session = await repo.save(repo.create({ id: randomUUID(), userId: String(userId), faceAssetId: input.face_asset_id, idCardPortraitAssetId: input.id_card_portrait_asset_id, idCardEmblemAssetId: input.id_card_emblem_asset_id,
        materialFingerprint: fingerprint, status: 'created', provider: 'tencent', providerRequestId: null, providerResultEncrypted: null, providerLeaseUntil: null,
        reasonCode: null, expiresAt: new Date(Date.now() + ttl * 1000), boundAt: null, boundEventId: null, createdAt: new Date(), updatedAt: new Date() }));
      for (const id of [session.faceAssetId, session.idCardPortraitAssetId, session.idCardEmblemAssetId]) await this.media.bind(manager, id, OWNER, String(userId));
      return session;
    });
    return this.get(String(userId), result.id);
  }
  async get(userId: string, sessionId: string) {
    // A committed claim precedes the network operation. Other instances only observe pending.
    const claim = await this.dataSource.transaction(async (manager) => {
      await this.user(manager, String(userId));
      const repo = manager.getRepository(IdentityVerificationSession);
      const session = await repo.findOne({ where: { id: sessionId }, lock: { mode: 'pessimistic_write' } });
      if (!session) throw Errors.notFound('认证会话不存在');
      if (session.userId !== String(userId)) throw Errors.dataForbidden();
      if (session.status === 'verified' || session.status === 'rejected' || session.status === 'expired') return { session, call: false };
      // A persisted successful result may always complete its binding, even after TTL.
      if (session.status === 'provider_verified') return { session, call: false };
      if (session.expiresAt.getTime() <= Date.now()) { session.status = 'expired'; session.reasonCode = 'SESSION_EXPIRED'; return { session: await repo.save(session), call: false }; }
      if (session.status === 'provider_pending' && session.providerLeaseUntil && session.providerLeaseUntil.getTime() <= Date.now()) { session.status = 'provider_unknown'; return { session: await repo.save(session), call: false }; }
      if (session.status !== 'created') return { session, call: false };
      this.assertAvailable();
      session.status = 'provider_pending'; session.providerLeaseUntil = new Date(Math.min(session.expiresAt.getTime(), Date.now() + 120_000));
      return { session: await repo.save(session), call: true };
    });
    let session = claim.session;
    if (claim.call) {
      const input = { face_asset_id: session.faceAssetId, id_card_portrait_asset_id: session.idCardPortraitAssetId, id_card_emblem_asset_id: session.idCardEmblemAssetId };
      await this.material(String(userId), input);
      const result = await this.provider.verify({
        face: await this.media.readPrivateBytes(String(userId), session.faceAssetId, 'identity_face'),
        portrait: await this.media.readPrivateBytes(String(userId), session.idCardPortraitAssetId, 'identity_id_portrait'),
        emblem: await this.media.readPrivateBytes(String(userId), session.idCardEmblemAssetId, 'identity_id_emblem'),
      });
      // Separate commit from binding: process failure afterwards must not repeat the supplier call.
      session = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(IdentityVerificationSession);
        const current = await repo.findOne({ where: { id: session.id }, lock: { mode: 'pessimistic_write' } });
        if (!current || !['provider_pending', 'provider_unknown'].includes(current.status)) throw Errors.serviceUnavailable('认证会话状态已变化');
        current.providerRequestId = result.providerRequestId || null;
        if (result.status === 'verified') { current.providerResultEncrypted = this.crypto.encrypt(result); current.status = 'provider_verified'; }
        else { current.status = 'rejected'; current.reasonCode = result.reasonCode; }
        return repo.save(current);
      });
    }
    if (session.status === 'provider_verified') session = await this.bind(session);
    return this.sessionView(session);
  }
  private async bind(session: IdentityVerificationSession): Promise<IdentityVerificationSession> {
    const result = this.crypto.decrypt<Extract<IdentityProviderResult, { status: 'verified' }>>(session.providerResultEncrypted!);
    const fingerprint = this.crypto.fingerprint(result.idNumber);
    try {
      const bound = await this.dataSource.transaction(async (manager) => {
        const user = await this.user(manager, session.userId);
        const sessions = manager.getRepository(IdentityVerificationSession);
        const current = await sessions.findOne({ where: { id: session.id }, lock: { mode: 'pessimistic_write' } });
        if (!current || current.status !== 'provider_verified') return current!;
        const repo = manager.getRepository(LearnerIdentity);
        const collision = await repo.findOne({ where: { idFingerprint: fingerprint }, lock: { mode: 'pessimistic_write' } });
        if (collision && collision.userId !== session.userId) { current.status = 'rejected'; current.reasonCode = 'IDENTITY_ALREADY_BOUND'; return sessions.save(current); }
        const existing = await repo.findOne({ where: { userId: session.userId }, lock: { mode: 'pessimistic_write' } });
        if (existing) {
          // A late result never changes an already-authoritative identity or name.
          current.status = 'verified'; current.boundAt = existing.verifiedAt;
          return sessions.save(current);
        }
        const currentSessions = await sessions.find({ where: { userId: session.userId }, order: { createdAt: 'DESC' } });
        const newer = currentSessions.find((s) => !['rejected', 'expired'].includes(s.status));
        if (newer && newer.id !== session.id) throw Errors.sessionConflict('认证会话已变化');
        await this.material(session.userId, { face_asset_id: session.faceAssetId, id_card_portrait_asset_id: session.idCardPortraitAssetId, id_card_emblem_asset_id: session.idCardEmblemAssetId }, manager);
        if (!existing) await repo.save(repo.create({ userId: session.userId, idFingerprint: fingerprint, identityEncrypted: this.crypto.encrypt({ realName: result.realName, idNumber: result.idNumber }), sessionId: session.id, providerRequestId: result.providerRequestId, verifiedAt: new Date() }));
        for (const id of [session.faceAssetId, session.idCardPortraitAssetId, session.idCardEmblemAssetId]) await this.media.bind(manager, id, OWNER, session.userId);
        user.realName = result.realName; await manager.getRepository(SysUser).save(user);
        current.status = 'verified'; current.boundAt = new Date(); current.boundEventId ||= randomUUID(); current.reasonCode = null;
        return sessions.save(current);
      });
      if (bound.status === 'verified' && bound.boundEventId) {
        // The DB event is the durable audit authority. File delivery is best-effort after commit.
        void Promise.resolve().then(() => this.audit?.log({ actor_id: session.userId, actor_name: `learner:${session.userId}`, action: 'identity.verified', object_type: 'identity_verification_session', object_id: session.id, detail: { event_id: bound.boundEventId, status: 'verified' }, result: 'success', source_ip: null })).catch(() => undefined);
      }
      return bound;
    } catch (error: any) {
      if (error?.code === 'ER_DUP_ENTRY') {
        // A unique fingerprint race is resolved from the committed authority, without another provider call.
        const collision = await this.identities.findOne({ where: { idFingerprint: fingerprint } });
        if (collision && collision.userId !== session.userId) {
          return this.dataSource.transaction(async (manager) => { await this.user(manager, session.userId); const repo = manager.getRepository(IdentityVerificationSession); const current = await repo.findOne({ where: { id: session.id }, lock: { mode: 'pessimistic_write' } }); current!.status = 'rejected'; current!.reasonCode = 'IDENTITY_ALREADY_BOUND'; return repo.save(current!); });
        }
      }
      throw error;
    }
  }
}
