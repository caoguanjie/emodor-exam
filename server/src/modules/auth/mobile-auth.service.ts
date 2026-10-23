import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Response } from 'express';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { SysUser } from '../../entities/sys-user.entity';
import { AppConfig } from '../../config/configuration';
import { Errors } from '../../common/errors';
import { AuditService } from '../../common/audit.service';
import { maskPhone, normalizeChinaMobile } from './phone';
import { SessionService } from './session.service';
import { SessionIssuerService } from './session-issuer.service';
import { SmsChallengeService } from './sms-challenge.service';
import { IdentityService } from '../identity/identity.service';

@Injectable()
export class MobileAuthService {
  constructor(
    @InjectRepository(SysUser) private readonly users: Repository<SysUser>,
    private readonly dataSource: DataSource,
    private readonly config: AppConfig,
    private readonly challenges: SmsChallengeService,
    private readonly sessions: SessionService,
    private readonly issuer: SessionIssuerService,
    private readonly audit: AuditService,
    @Optional() private readonly identity?: IdentityService,
  ) {
    if (config.debugLoginEnabled && !['test', 'development'].includes(config.env)) throw new Error('Debug Login 只能在 test/development 启用');
  }

  private async publicUser(user: SysUser) {
    const identity = this.identity ? await this.identity.view(String(user.id)) : { status: 'unverified' as const, real_name: null };
    return { id: Number(user.id), username: user.username, real_name: identity.status === 'verified' ? identity.real_name : user.realName, phone_masked: maskPhone(user.phone!), role: 'employee' as const, source: user.source || null, category_id: user.categoryId ? Number(user.categoryId) : null, identity_status: identity.status };
  }

  send(phone: string, ip: string) { return this.challenges.issue(phone, ip); }

  async login(phone: string, challengeId: string, code: string, ip: string | null, userAgent: string | null, res: Response) {
    await this.challenges.verify(challengeId, phone, code);
    return this.loginByPhone(phone, 'sms', ip, userAgent, res);
  }

  async debugLogin(phone: string, ip: string | null, userAgent: string | null, res: Response) {
    // Check before even looking up an account. This route never writes identity results.
    if (!this.config.debugLoginEnabled || !['test', 'development'].includes(this.config.env)) throw Errors.serviceUnavailable('调试登录未开启');
    return this.loginByPhone(phone, 'debug', ip, userAgent, res);
  }

  private async loginByPhone(input: string, authMethod: 'sms' | 'debug', ip: string | null, userAgent: string | null, res: Response) {
    const phone = normalizeChinaMobile(input);
    let result!: { user: SysUser; session: Awaited<ReturnType<SessionService['create']>> };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await this.dataSource.transaction(async (manager) => {
          const repo = manager.getRepository(SysUser);
          let user = await repo.createQueryBuilder('u').setLock('pessimistic_write').where('u.phone = :phone', { phone }).getOne();
          if (!user) {
            user = await repo.save(repo.create({
              username: `m_${randomBytes(20).toString('hex')}`, passwordHash: await bcrypt.hash(randomBytes(48).toString('base64'), 12),
              realName: '', employeeNo: null, departmentId: null, categoryId: null, source: 'external', role: 'employee', phone, email: null,
              avatarId: null, status: 1, authVersion: 0, forcePasswordChange: 0, loginCount: 0, lastLoginAt: null, lastLoginIp: null, rolesConfigured: 0,
            }));
          }
          await this.issuer.assertMobileUser(user, manager);
          user.lastLoginAt = new Date(); user.lastLoginIp = ip;
          await repo.save(user);
          const session = await this.sessions.create(user.id, ip, userAgent, manager, { client: 'mobile', authMethod });
          return { user, session };
        });
        break;
      } catch (error: any) {
        if (attempt === 2 || !['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK'].includes(String(error?.code))) throw error;
        // Unique phone is the database serialization point for concurrent first logins.
      }
    }
    const pair = await this.issuer.issue(result.user, { client: 'mobile', authMethod, ip, userAgent }, res, result.session);
    this.audit.log({ actor_id: Number(result.user.id), actor_name: `learner:${result.user.id}`, action: `auth.mobile.${authMethod}`, object_type: 'sys_user', object_id: result.user.id, detail: { phone_masked: maskPhone(phone) }, result: 'success', source_ip: ip });
    return { ...pair, user: await this.publicUser(result.user) };
  }

  async refresh(token: string | undefined, ip: string | null, res: Response) {
    const result = await this.issuer.refresh(token, 'mobile', ip, res);
    return { access_token: result.access_token, expires_in: result.expires_in, user: await this.publicUser(result.user) };
  }

  async logout(refreshToken: string | undefined, ip: string | null, res: Response) {
    const userId = await this.issuer.revokeMobileCookie(refreshToken, res);
    if (userId !== null) this.audit.log({ actor_id: userId, actor_name: `learner:${userId}`, action: 'auth.mobile.logout', object_type: 'sys_user', object_id: userId, detail: {}, result: 'success', source_ip: ip });
    return null;
  }
}
