import { describe, expect, it, vi } from 'vitest';
import { VideoSessionService } from '../src/modules/video-learning/video-session.service';
import { VideoLearningController } from '../src/modules/video-learning/video-learning.controller';
import { CourseService } from '../src/modules/courses/course.service';
import { SysUser } from '../src/entities/sys-user.entity';
import { LearnerIdentity } from '../src/entities/learner-identity.entity';
import { IdentityVerificationSession } from '../src/entities/identity-verification-session.entity';
import { CourseLesson } from '../src/entities/course-lesson.entity';
import { TrainingCourse } from '../src/entities/training-course.entity';
import { LessonVersion } from '../src/entities/lesson-version.entity';
import { MediaAsset } from '../src/entities/media-asset.entity';
import { MediaReference } from '../src/entities/media-reference.entity';
import { VideoLearningRecord } from '../src/entities/video-learning-record.entity';
import { VideoLearningSession } from '../src/entities/video-learning-session.entity';

function fixture() {
  const user: any = { id: '31', status: 1, role: 'employee', source: 'external', categoryId: null };
  const course: any = { id: '10', status: 'published', categoryId: '99' };
  const lesson: any = { id: '101', courseId: '10', lessonType: 'video', currentVersionId: '501' };
  const version: any = { id: '501', lessonId: '101', assetId: '401', durationMs: '100000' };
  const asset: any = { id: '401', status: 'ready', purpose: 'video' };
  let identity: any = { userId: '31' };
  let verification: any = null;
  let reference: any = { assetId: '401', ownerType: 'lesson_version_video', ownerId: '501' };
  const sessions: any[] = [];
  const records: any[] = [];
  const chain = (result: () => unknown) => {
    const query: any = { setLock: () => query, where: () => query, getOne: async () => result() };
    return query;
  };
  const sessionRepo: any = {
    create: (value) => ({ ...value }),
    save: async (value) => { if (!value.id) { value.id = String(901 + sessions.length); sessions.push(value); } return value; },
    createQueryBuilder: () => {
      let update = false; let values: any; let params: any;
      const query: any = {
        setLock: () => query, update: () => { update = true; return query; },
        set: (input) => { values = input; return query; },
        where: (_sql, input) => { params = input; return query; },
        getOne: async () => sessions.find((s) => s.id === params.sessionId),
        execute: async () => { if (update) for (const s of sessions) if (!s.endedAt && s.activeUserId === params.userId) Object.assign(s, values); return { affected: 1 }; },
      }; return query;
    },
  };
  const recordRepo: any = {
    findOne: async ({ where }) => records.find((r) => where.id ? r.id === where.id : r.userId === where.userId && r.lessonVersionId === where.lessonVersionId),
    create: (value) => ({ ...value }),
    save: async (value) => { if (!value.id) { value.id = '801'; records.push(value); } return value; },
    createQueryBuilder: () => chain(() => records[0]),
  };
  const repositories = new Map<any, any>([
    [SysUser, { createQueryBuilder: () => chain(() => user), findOne: async () => user }],
    [LearnerIdentity, { findOne: async () => identity }],
    [IdentityVerificationSession, { findOne: async () => verification }],
    [CourseLesson, { findOne: async () => lesson }],
    [TrainingCourse, { findOne: async () => course }],
    [LessonVersion, { findOne: async () => version }],
    [MediaAsset, { findOne: async () => asset }],
    [MediaReference, { findOne: async () => reference }],
    [VideoLearningSession, sessionRepo], [VideoLearningRecord, recordRepo],
  ]);
  const manager: any = { getRepository: (type) => { const repo = repositories.get(type); if (!repo) throw new Error(`unexpected ${type.name}`); return repo; } };
  const tickets = { issue: vi.fn(async (_user, _asset, _ownerType, _ownerId) => ({ content_url: '/api/v1/media/tickets/synthetic/content', expires_at: '2026-10-23T00:00:00.000Z' })) };
  const dataSource: any = { transaction: async (work) => work(manager), getRepository: (type) => manager.getRepository(type) };
  const service = new VideoSessionService(dataSource, { activeSessionIds: async () => [] } as any, {} as any, tickets as any);
  return { service, user, course, lesson, version, asset, sessions, records, tickets, manager, dataSource,
    identity: (value) => { identity = value; }, verification: (value) => { verification = value; }, reference: (value) => { reference = value; } };
}

describe('mobile video contract', () => {
  it.each([12_000, 100_000])('persists completion for a %i ms video emitting pause before ended', async duration => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      vi.setSystemTime(now);
      const f = fixture(); f.version.durationMs = String(duration);
      await f.service.start('31', '101');
      let seq = 1;
      await f.service.heartbeat('31', '901', { seq, position_ms: 0, state: 'playing' });
      for (let position = 30_000; position < duration; position += 30_000) {
        vi.setSystemTime(now + position);
        await f.service.heartbeat('31', '901', { seq: ++seq, position_ms: position, state: 'playing' });
      }
      vi.setSystemTime(now + duration);
      const paused = await f.service.heartbeat('31', '901', { seq: ++seq, position_ms: duration, state: 'paused' });
      expect(paused).toMatchObject({ coverage_ms: duration, credited_ms: duration, completed: true, confirmed_position_ms: duration });
      const completedAt = f.records[0].completedAt;
      vi.setSystemTime(now + duration + 1);
      const ended = await f.service.heartbeat('31', '901', { seq: ++seq, position_ms: duration, state: 'ended' });
      expect(ended).toMatchObject({ coverage_ms: duration, credited_ms: duration, completed: true });
      expect(f.records[0].coverageIntervals).toEqual([[0, duration]]);
      expect(f.records[0].completedAt).toEqual(completedAt);
      expect(f.sessions[0].activeUserId).toBeNull();
      expect(f.sessions[0].endedAt).toBeInstanceOf(Date);
      await expect(f.service.close('31', '901')).resolves.toMatchObject({ coverage_ms: duration, completed: true });
    } finally { vi.useRealTimers(); }
  });

  it.each(['start', 'heartbeat', 'close', 'records', 'progress'])('rejects a PC token before %s reaches video services', (method) => {
    const sessions = new Proxy({}, { get: () => () => { throw new Error('must not reach service'); } });
    const controller: any = new VideoLearningController(sessions as any);
    const pc = { id: 31, role: 'employee', client: 'pc' };
    const invoke = {
      start: () => controller.start({ lesson_id: '101' }, pc, { body: { lesson_id: '101' } }),
      heartbeat: () => controller.heartbeat('901', { seq: 1, state: 'playing', position_ms: 0 }, pc, { body: { seq: 1, state: 'playing', position_ms: 0 } }),
      close: () => controller.close('901', pc),
      records: () => controller.records({}, pc, { query: {} }),
      progress: () => controller.progress('10', pc),
    }[method];
    expect(invoke).toThrow(expect.objectContaining({ code: 40301 }));
  });

  it('starts a verified external learner without category using the selected current media and a paused anchor', async () => {
    const f = fixture();
    const result = await f.service.start('31', '101');
    expect(result).toMatchObject({ session_id: '901', version_id: '501', heartbeat_interval_ms: 30000,
      media: { asset_id: '401', ticket: { content_url: '/api/v1/media/tickets/synthetic/content' } }, progress: { credited_ms: 0 } });
    expect(f.sessions[0].anchorState).toBe('paused');
    expect(f.tickets.issue).toHaveBeenCalledWith('31', '401', 'lesson_version_video', '501');
    const first = await f.service.heartbeat('31', '901', { seq: 1, position_ms: 30000, state: 'playing' });
    expect(first.credited_ms).toBe(0);
    expect(first.coverage_ms).toBe(0);
  });

  it.each([
    [null, 'IDENTITY_REQUIRED'],
    [{ status: 'rejected', expiresAt: new Date(Date.now() + 60000) }, 'IDENTITY_REQUIRED'],
    [{ status: 'provider_pending', expiresAt: new Date(Date.now() + 60000) }, 'IDENTITY_PENDING'],
    [{ status: 'created', expiresAt: new Date(Date.now() - 1) }, 'IDENTITY_REQUIRED'],
  ])('returns authoritative structured identity gating for %j', async (verification, reason) => {
    const f = fixture(); f.identity(null); f.verification(verification);
    await expect(f.service.start('31', '101')).rejects.toMatchObject({ code: 40302, data: { reason_code: reason } });
    expect(f.sessions).toHaveLength(0);
    expect(f.tickets.issue).not.toHaveBeenCalled();
  });

  it.each(['asset', 'reference'])('does not create a session for an unavailable current %s', async (kind) => {
    const f = fixture();
    if (kind === 'asset') f.asset.status = 'failed'; else f.reference(null);
    await expect(f.service.start('31', '101')).rejects.toMatchObject({ code: 40951 });
    expect(f.sessions).toHaveLength(0);
  });

  it('closes exactly the newly committed session when signing fails after commit', async () => {
    const f = fixture();
    f.tickets.issue.mockImplementation(async () => { f.lesson.currentVersionId = '502'; throw Object.assign(new Error('replaced'), { code: 40302 }); });
    await expect(f.service.start('31', '101')).rejects.toMatchObject({ code: 40951 });
    expect(f.sessions).toHaveLength(1);
    expect(f.sessions[0].activeUserId).toBeNull();
    expect(f.sessions[0].endedAt).toBeInstanceOf(Date);
  });

  it('closes an unavailable session even for a duplicate heartbeat before returning 40951', async () => {
    const f = fixture(); await f.service.start('31', '101');
    await f.service.heartbeat('31', '901', { seq: 1, position_ms: 0, state: 'playing' });
    f.reference(null);
    await expect(f.service.heartbeat('31', '901', { seq: 1, position_ms: 30000, state: 'playing' })).rejects.toMatchObject({ code: 40951 });
    expect(f.sessions[0].activeUserId).toBeNull();
    expect(f.records[0].creditedMs).toBe('0');
  });
});

describe('lesson video owner policy', () => {
  function ownerFixture() {
    const f = fixture(); let permissions: string[] = [];
    const policies = new Map<string, any>();
    const service: any = Object.create(CourseService.prototype);
    Object.assign(service, { userRepo: f.manager.getRepository(SysUser), courseRepo: f.manager.getRepository(TrainingCourse),
      lessonRepo: f.manager.getRepository(CourseLesson), versionRepo: f.manager.getRepository(LessonVersion), dataSource: f.dataSource,
      access: { permissions: async () => permissions }, media: { registerOwnerPolicy: (name, policy) => policies.set(name, policy) } });
    service.onModuleInit();
    return { ...f, policy: policies.get('lesson_version_video'), permissions: (value: string[]) => { permissions = value; } };
  }
  it('keeps courses:read Bearer previews while denying administrator learner tickets', async () => {
    const f = ownerFixture(); f.user.role = 'super_admin'; f.permissions(['courses:read']); f.identity(null); f.course.status = 'offline';
    expect(await f.policy.authorizeRead('31', '501', '401')).toBe(true);
    expect(typeof f.policy.authorizeTicket).toBe('function');
    expect(await f.policy.authorizeTicket('31', '501', '401')).toBe(false);
  });
  it('rechecks identity, current version, role and management permissions for learner video tickets', async () => {
    const f = ownerFixture();
    expect(typeof f.policy.authorizeTicket).toBe('function');
    expect(await f.policy.authorizeTicket('31', '501', '401')).toBe(true);
    expect(await f.policy.authorizeTicket('31', '501', '402')).toBe(false);
    f.identity(null); expect(await f.policy.authorizeRead('31', '501', '401')).toBe(false);
    f.identity({ userId: '31' }); f.lesson.currentVersionId = '502'; expect(await f.policy.authorizeTicket('31', '501', '401')).toBe(false);
    f.lesson.currentVersionId = '501'; f.permissions(['statistics:read']); expect(await f.policy.authorizeTicket('31', '501', '401')).toBe(false);
    f.permissions([]); f.user.role = 'regulation_admin'; expect(await f.policy.authorizeTicket('31', '501', '401')).toBe(false);
  });
  it.each([
    [null, 'IDENTITY_REQUIRED'],
    [{ status: 'rejected', expiresAt: new Date(Date.now() + 60000) }, 'IDENTITY_REQUIRED'],
    [{ status: 'provider_pending', expiresAt: new Date(Date.now() + 60000) }, 'IDENTITY_PENDING'],
  ])('returns a structured identity reason for learner ticket policy %j', async (verification, reason) => {
    const f = ownerFixture(); f.identity(null); f.verification(verification);
    await expect(f.policy.authorizeTicket('31', '501', '401')).rejects.toMatchObject({ code: 40302, data: { reason_code: reason } });
    await expect(f.policy.authorizeRead('31', '501', '401')).resolves.toBe(false);
  });
});
