import { describe, expect, it, vi } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import {
  courseCompletionRate,
  creditVideoInterval,
  mergeCoverage,
  type PlaybackAnchor,
} from '../src/modules/video-learning/coverage';
import { VideoLearningRecord } from '../src/entities/video-learning-record.entity';
import { VideoLearningSession } from '../src/entities/video-learning-session.entity';
import { VideoSessionService } from '../src/modules/video-learning/video-session.service';
import { LearningSessionService } from '../src/modules/learning/learning-session.service';
import { CourseService } from '../src/modules/courses/course.service';
import { LearningSession } from '../src/entities/learning-session.entity';
import { LearningRecord, ScrollCoverageUtil } from '../src/entities/learning-record.entity';
import { Regulation } from '../src/entities/regulation.entity';
import { SysUser } from '../src/entities/sys-user.entity';

const DURATION_MS = 100_000;

function anchor(overrides: Partial<PlaybackAnchor> = {}): PlaybackAnchor {
  return { seq: 0, positionMs: 0, state: 'playing', ...overrides };
}

describe('verified video coverage', () => {
  it('credits a normal playing interval from server elapsed time and real playback progress', () => {
    const result = creditVideoInterval(
      anchor(),
      { seq: 1, position_ms: 30_000, state: 'playing' },
      30_000,
      DURATION_MS,
    );

    expect(result).toEqual({
      nextAnchor: { seq: 1, positionMs: 30_000, state: 'playing' },
      creditedMs: 30_000,
      interval: [0, 30_000],
    });
  });

  it('does not credit replayed or out-of-order sequence numbers', () => {
    const previous = anchor({ seq: 8, positionMs: 30_000 });
    const replayed = creditVideoInterval(
      previous,
      { seq: 8, position_ms: 60_000, state: 'playing' },
      30_000,
      DURATION_MS,
    );
    const outOfOrder = creditVideoInterval(
      previous,
      { seq: 7, position_ms: 60_000, state: 'playing' },
      30_000,
      DURATION_MS,
    );

    expect(replayed.creditedMs).toBe(0);
    expect(replayed.interval).toBeNull();
    expect(replayed.nextAnchor).toEqual(previous);
    expect(outOfOrder).toEqual(replayed);
  });

  it.each(['paused', 'buffering', 'background'] as const)(
    'does not credit %s playback state',
    (state) => {
      const result = creditVideoInterval(
        anchor(),
        { seq: 1, position_ms: 30_000, state },
        30_000,
        DURATION_MS,
      );

      expect(result.creditedMs).toBe(0);
      expect(result.interval).toBeNull();
      expect(result.nextAnchor).toEqual({ seq: 1, positionMs: 30_000, state });
    },
  );

  it('does not credit the first playing beat after a non-playing anchor', () => {
    const result = creditVideoInterval(
      anchor({ seq: 4, positionMs: 30_000, state: 'background' }),
      { seq: 5, position_ms: 31_000, state: 'playing' },
      30_000,
      DURATION_MS,
    );

    expect(result.creditedMs).toBe(0);
    expect(result.interval).toBeNull();
  });

  it('caps a long valid heartbeat at 45 seconds', () => {
    const longHeartbeat = creditVideoInterval(
      anchor(),
      { seq: 1, position_ms: 45_000, state: 'playing' },
      120_000,
      DURATION_MS,
    );

    expect(longHeartbeat.creditedMs).toBeLessThanOrEqual(45_000);
    expect(longHeartbeat.creditedMs).toBe(45_000);
    expect(longHeartbeat.interval).toEqual([0, 45_000]);
  });

  it('rejects a forward jump beyond real elapsed time plus two-second tolerance', () => {
    const previous = mergeCoverage([], [0, 20_000]);
    const jumpedCredit = creditVideoInterval(
      anchor({ seq: 1, positionMs: 20_000 }),
      { seq: 2, position_ms: 55_000, state: 'playing' },
      30_000,
      DURATION_MS,
    );
    const jumped = mergeCoverage(previous.intervals, jumpedCredit.interval);

    expect(jumpedCredit.creditedMs).toBe(0);
    expect(jumpedCredit.interval).toBeNull();
    expect(jumped.coverageMs).toBe(previous.coverageMs);
    expect(jumpedCredit.nextAnchor.positionMs).toBe(55_000);
  });

  it('counts repeated watching as credited time without increasing unique coverage', () => {
    const first = mergeCoverage([], [0, 30_000]);
    const repeatedCredit = creditVideoInterval(
      anchor({ seq: 2, positionMs: 0 }),
      { seq: 3, position_ms: 30_000, state: 'playing' },
      30_000,
      DURATION_MS,
    );
    const repeated = mergeCoverage(first.intervals, repeatedCredit.interval);

    expect(repeatedCredit.creditedMs).toBe(30_000);
    expect(repeated.coverageMs).toBe(30_000);
    expect(repeated.coverageMs / DURATION_MS >= 0.95).toBe(false);
  });

  it('merges overlapping and adjacent intervals and completes at exactly 95 percent coverage', () => {
    const first = mergeCoverage([], [0, 30_000]);
    const second = mergeCoverage(first.intervals, [25_000, 60_000]);
    const at95000 = mergeCoverage(second.intervals, [60_000, 95_000]);

    expect(at95000.intervals).toEqual([[0, 95_000]]);
    expect(at95000.coverageMs / DURATION_MS).toBe(0.95);
    expect(at95000.coverageMs / DURATION_MS >= 0.95).toBe(true);
  });

  it('returns null completion rate when a course has zero currently required lessons', () => {
    const zeroRequired = {
      required: 0,
      completed: 0,
      completion_rate: courseCompletionRate(0, 0),
      lessons: [],
    };

    expect(zeroRequired.completion_rate).toBeNull();
    expect(courseCompletionRate(4, 3)).toBe(0.75);
  });
});

describe('video learning persistence contract', () => {
  it('maps progress by user and immutable lesson version and enforces one active video per user', () => {
    const metadata = getMetadataArgsStorage();
    expect(metadata.tables.find((item) => item.target === VideoLearningRecord)?.name).toBe('video_learning_record');
    expect(metadata.tables.find((item) => item.target === VideoLearningSession)?.name).toBe('video_learning_session');

    const recordUnique = metadata.indices.find((item) => item.target === VideoLearningRecord
      && item.name === 'uk_video_learning_record_user_version');
    expect(recordUnique?.unique).toBe(true);
    expect(recordUnique?.columns).toEqual(['userId', 'lessonVersionId']);

    const activeUnique = metadata.indices.find((item) => item.target === VideoLearningSession
      && item.name === 'uk_video_learning_session_active_user');
    expect(activeUnique?.unique).toBe(true);
    expect(activeUnique?.columns).toEqual(['activeUserId']);
  });

  it('derives required lesson versions from the learner current assignment without counting optional lessons', async () => {
    const service = Object.create(CourseService.prototype) as any;
    service.userRepo = {
      findOne: vi.fn().mockResolvedValue({ id: '31', status: 1, source: 'institution', categoryId: '7' }),
    };
    service.courseRepo = {
      findOne: vi.fn().mockResolvedValue({ id: '10', categoryId: '7', status: 'published' }),
    };
    service.lessonRepo = {
      find: vi.fn().mockResolvedValue([
        { id: '101', currentVersionId: '501', required: 1, lessonType: 'video' },
        { id: '102', currentVersionId: '502', required: 0, lessonType: 'video' },
        { id: '103', currentVersionId: '503', required: 1, lessonType: 'video' },
      ]),
    };
    service.versionRepo = {
      findBy: vi.fn().mockResolvedValue([
        { id: '501', lessonId: '101', durationMs: '100000' },
        { id: '503', lessonId: '103', durationMs: '200000' },
      ]),
    };

    await expect(service.requiredVideoLessons('31', '10')).resolves.toEqual({
      assigned: true,
      lessons: [
        { lessonId: '101', versionId: '501', durationMs: 100_000 },
        { lessonId: '103', versionId: '503', durationMs: 200_000 },
      ],
    });
  });

  it('excludes an external learner from the required denominator', async () => {
    const service = Object.create(CourseService.prototype) as any;
    service.userRepo = {
      findOne: vi.fn().mockResolvedValue({ id: '31', status: 1, source: 'external', categoryId: '7' }),
    };
    service.courseRepo = {
      findOne: vi.fn().mockResolvedValue({ id: '10', categoryId: '7', status: 'published' }),
    };
    service.lessonRepo = { find: vi.fn() };

    await expect(service.requiredVideoLessons('31', '10')).resolves.toEqual({ assigned: false, lessons: [] });
    expect(service.lessonRepo.find).not.toHaveBeenCalled();
  });

  it('computes course completion from unique current-version coverage, not accumulated credited time', async () => {
    const completedRecord = {
      lessonVersionId: '501', durationMs: '100000', creditedMs: '250000', coverageMs: '95000',
      confirmedPositionMs: '95000', completed: 1, coverageIntervals: [[0, 95000]],
    };
    const recordRepo = {
      find: vi.fn().mockResolvedValue([completedRecord]),
    };
    const manager = {
      getRepository(entity: unknown) {
        if (entity === VideoLearningRecord) return recordRepo;
        throw new Error(`unexpected repository ${(entity as any)?.name}`);
      },
    };
    const dataSource = {
      transaction: vi.fn(async (work) => work(manager)),
    };
    const courses = {
      requiredVideoLessons: vi.fn().mockResolvedValue({
        assigned: true,
        lessons: [
          { lessonId: '101', versionId: '501', durationMs: 100_000 },
          { lessonId: '102', versionId: '502', durationMs: 100_000 },
        ],
      }),
    };
    const service = new VideoSessionService(dataSource as any, {} as any, courses as any);

    await expect(service.progress('31', '10')).resolves.toEqual({
      required: 2,
      completed: 1,
      completion_rate: 0.5,
      lessons: [
        {
          confirmed_position_ms: 95_000,
          credited_ms: 250_000,
          coverage_ms: 95_000,
          duration_ms: 100_000,
          completed: true,
          last_seq: 0,
        },
        {
          confirmed_position_ms: 0,
          credited_ms: 0,
          coverage_ms: 0,
          duration_ms: 100_000,
          completed: false,
          last_seq: 0,
        },
      ],
    });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(courses.requiredVideoLessons).toHaveBeenCalledWith('31', '10', manager);
  });

  it('expires a stale video session without changing credited playback time', async () => {
    const session = {
      id: '901', userId: '31', activeUserId: '31', endedAt: null,
      lastHeartbeatAt: new Date(Date.now() - 120_000), creditedMs: '12345',
    } as VideoLearningSession;
    const save = vi.fn(async (value) => value);
    const lockedRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(session),
      }),
      save,
    };
    const scanRepo = { find: vi.fn().mockResolvedValue([session]) };
    const manager = {
      getRepository(entity: unknown) {
        if (entity === VideoLearningSession) return lockedRepo;
        throw new Error(`unexpected repository ${(entity as any)?.name}`);
      },
    };
    const dataSource = {
      getRepository(entity: unknown) {
        if (entity === VideoLearningSession) return scanRepo;
        throw new Error(`unexpected repository ${(entity as any)?.name}`);
      },
      transaction: vi.fn(async (work) => work(manager)),
    };
    const service = new VideoSessionService(dataSource as any, {} as any, {} as any);

    await expect(service.sweepStalledSessions()).resolves.toBe(1);
    expect(session.activeUserId).toBeNull();
    expect(session.endedAt).toBeInstanceOf(Date);
    expect(session.creditedMs).toBe('12345');
    expect(save).toHaveBeenCalledTimes(1);
  });
});

function lockedUserRepository(user = { id: '31' }) {
  const query = {
    setLock: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(user),
  };
  return { createQueryBuilder: vi.fn().mockReturnValue(query), query };
}

function readingFixture() {
  return {
    id: '700', userId: '31', regulationId: '41', versionId: '51',
    startedAt: new Date('2026-10-21T00:00:00.000Z'), endedAt: null, durationSeconds: 0,
  } as LearningSession;
}

function readingStartService(options: {
  replacedBeforePublish?: boolean;
  failPointerWrite?: boolean;
  failAfterPublish?: boolean;
  failRedisCleanup?: boolean;
} = {}) {
  const session = readingFixture();
  const record = {
    id: '800', userId: '31', regulationId: '41', versionId: '51', totalSeconds: 0,
    maxScrollPercent: 0, scrollCoverage: ScrollCoverageUtil.empty(10), isValid: 0, validAt: null,
  } as LearningRecord;
  const managerSave = vi.fn(async (value) => value);
  const sessionManagerRepo = {
    create: vi.fn((value) => Object.assign(session, value)),
    save: managerSave,
    findOne: vi.fn(async () => session),
    find: vi.fn(async () => session.endedAt ? [] : [session]),
  };
  const recordManagerRepo = {
    findOne: vi.fn().mockResolvedValue(record),
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => value),
  };
  const videoManagerRepo = {
    findOne: vi.fn(async () => options.replacedBeforePublish ? { id: '900', activeUserId: '31' } : null),
    createQueryBuilder: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), execute: vi.fn().mockResolvedValue({ affected: 0 }),
    }),
  };
  const firstUserRepo = lockedUserRepository();
  const secondUserRepo = lockedUserRepository();
  const manager = (userRepo: any) => ({
    getRepository(entity: unknown) {
      if (entity === SysUser) return userRepo;
      if (entity === LearningSession) return sessionManagerRepo;
      if (entity === LearningRecord) return recordManagerRepo;
      if (entity === VideoLearningSession) return videoManagerRepo;
      throw new Error(`unexpected repository ${(entity as any)?.name}`);
    },
  });
  let transactionNo = 0;
  const dataSource = {
    transaction: vi.fn(async (work) => {
      transactionNo += 1;
      const currentTransaction = transactionNo;
      const endedBefore = session.endedAt;
      try {
        const result = await work(manager(currentTransaction === 1 ? firstUserRepo : secondUserRepo));
        if (currentTransaction === 1 && options.replacedBeforePublish) session.endedAt = new Date();
        if (currentTransaction === 2 && options.failAfterPublish) {
          throw new Error('injected phase-two commit failure');
        }
        return result;
      } catch (error) {
        // Simulate transaction rollback of any in-callback endedAt mutation.
        if (currentTransaction >= 2) session.endedAt = endedBefore;
        throw error;
      }
    }),
  };
  const redis = {
    setNx: vi.fn().mockResolvedValue(true),
    hsetAll: vi.fn().mockResolvedValue(undefined),
    set: options.failPointerWrite
      ? vi.fn().mockRejectedValue(new Error('injected redis pointer failure'))
      : vi.fn().mockResolvedValue(undefined),
    get: options.failRedisCleanup
      ? vi.fn().mockRejectedValue(new Error('injected redis cleanup read failure'))
      : vi.fn().mockResolvedValue(null),
    del: vi.fn(async (key: string) => {
      if (options.failRedisCleanup && !key.startsWith('learn:lock:start:')) {
        throw new Error('injected redis cleanup delete failure');
      }
    }),
  };
  const service = Object.create(LearningSessionService.prototype) as any;
  Object.assign(service, {
    regRepo: { findOne: vi.fn().mockResolvedValue({
      id: '41', status: 'published', currentVersionId: '51', scrollSegments: 10, requiredMinutes: 10,
    } as Regulation) },
    sessionRepo: { save: vi.fn(), find: vi.fn().mockResolvedValue([]) },
    recordRepo: { findOne: vi.fn().mockResolvedValue(record) },
    redis,
    dataSource,
    content: { readingContent: vi.fn().mockResolvedValue({}) },
    userContext: vi.fn().mockResolvedValue({ role: 'employee', departmentId: '1' }),
    closeActiveForUser: vi.fn().mockResolvedValue(undefined),
  });
  return { service, session, redis, managerSave };
}

describe('cross-type active learning coordination', () => {
  it('closes active reading sessions across every regulation for the same user', async () => {
    const service = Object.create(LearningSessionService.prototype) as any;
    service.sessionRepo = {
      find: vi.fn().mockResolvedValue([
        { id: '701', userId: '31', regulationId: '41', endedAt: null },
        { id: '702', userId: '31', regulationId: '42', endedAt: null },
      ]),
    };
    service.flushSession = vi.fn().mockResolvedValue({ durationSeconds: 0 });

    await service.closeActiveForUser('31', new Date('2026-10-21T00:01:00.000Z'));

    expect(service.flushSession).toHaveBeenCalledTimes(2);
    expect(service.flushSession.mock.calls.map((call) => call[0])).toEqual(['701', '702']);
  });

  it('does not publish a late reading Redis pointer after a video start replaced the committed reading row', async () => {
    const { service, redis, managerSave } = readingStartService({ replacedBeforePublish: true });

    await expect(service.start('41', 31)).rejects.toMatchObject({ code: 40906, httpStatus: 409 });
    expect(managerSave).toHaveBeenCalled();
    expect(redis.hsetAll).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('fails closed when Redis pointer publication fails after the reading row commits', async () => {
    const { service, session, redis } = readingStartService({ failPointerWrite: true });

    await expect(service.start('41', 31)).rejects.toThrow('injected redis pointer failure');
    expect(session.endedAt).toBeInstanceOf(Date);
    expect(redis.del).toHaveBeenCalledWith('learn:session:700');
    expect(redis.del).toHaveBeenCalledWith('learn:active:31:41');
  });

  it('commits DB fail-closed state even when Redis cleanup also fails', async () => {
    const { service, session } = readingStartService({
      failPointerWrite: true,
      failRedisCleanup: true,
    });

    await expect(service.start('41', 31)).rejects.toThrow('injected redis pointer failure');
    expect(session.endedAt).toBeInstanceOf(Date);
  });

  it('fails closed after Redis publication when the phase-two transaction cannot commit', async () => {
    const { service, session, redis } = readingStartService({ failAfterPublish: true });

    await expect(service.start('41', 31)).rejects.toThrow('injected phase-two commit failure');
    expect(session.endedAt).toBeInstanceOf(Date);
    expect(redis.del).toHaveBeenCalledWith('learn:session:700');
  });

  it('rejects an ended reading from DB before consulting a stale Redis pointer', async () => {
    const session = { ...readingFixture(), endedAt: new Date() } as LearningSession;
    const redis = { get: vi.fn() };
    const service = Object.create(LearningSessionService.prototype) as any;
    Object.assign(service, {
      sessionRepo: { findOne: vi.fn().mockResolvedValue(session) },
      redis,
      sessionMutex: new Map(),
    });

    await expect(service.heartbeat('700', 31, [], 0)).rejects.toMatchObject({ code: 40906 });
    expect(redis.get).not.toHaveBeenCalled();
  });
});
