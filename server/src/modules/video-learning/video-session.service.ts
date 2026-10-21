import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, LessThan } from 'typeorm';
import type { Id, Page } from '../../common/training-contracts';
import { Errors } from '../../common/errors';
import { CourseLesson } from '../../entities/course-lesson.entity';
import { LessonVersion } from '../../entities/lesson-version.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { TrainingCourse } from '../../entities/training-course.entity';
import { VideoLearningRecord } from '../../entities/video-learning-record.entity';
import { VideoLearningSession } from '../../entities/video-learning-session.entity';
import { CourseService } from '../courses/course.service';
import { LearningSessionService } from '../learning/learning-session.service';
import {
  courseCompletionRate,
  creditVideoInterval,
  mergeCoverage,
  VIDEO_COMPLETION_RATIO,
  VIDEO_HEARTBEAT_INTERVAL_MS,
} from './coverage';
import type {
  CourseProgress,
  VideoHeartbeat,
  VideoProgress,
  VideoRecordView,
  VideoSessionView,
} from './video-learning.dto';

const VIDEO_STALE_AFTER_MS = 90_000;
const ACTIVITY_START_MAX_RETRIES = 3;

function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

@Injectable()
export class VideoSessionService {
  private readonly logger = new Logger(VideoSessionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly learning: LearningSessionService,
    private readonly courses: CourseService,
  ) {}

  private async lockUser(manager: EntityManager, userId: Id): Promise<SysUser> {
    const user = await manager.getRepository(SysUser)
      .createQueryBuilder('user')
      .setLock('pessimistic_write')
      .where('user.id = :userId', { userId: String(userId) })
      .getOne();
    if (!user) throw Errors.notFound('用户不存在');
    return user;
  }

  private progressView(record: VideoLearningRecord, lastSeq = 0): VideoProgress {
    return {
      confirmed_position_ms: numberValue(record.confirmedPositionMs),
      credited_ms: numberValue(record.creditedMs),
      coverage_ms: numberValue(record.coverageMs),
      duration_ms: numberValue(record.durationMs),
      completed: Number(record.completed) === 1,
      last_seq: lastSeq,
    };
  }

  private emptyProgress(durationMs: number): VideoProgress {
    return {
      confirmed_position_ms: 0,
      credited_ms: 0,
      coverage_ms: 0,
      duration_ms: durationMs,
      completed: false,
      last_seq: 0,
    };
  }

  private async recordFor(
    manager: EntityManager,
    userId: Id,
    version: LessonVersion,
  ): Promise<VideoLearningRecord> {
    const repo = manager.getRepository(VideoLearningRecord);
    let record = await repo.findOne({
      where: { userId: String(userId), lessonVersionId: String(version.id) },
    });
    if (record) return record;
    record = repo.create({
      userId: String(userId),
      lessonVersionId: String(version.id),
      durationMs: String(version.durationMs),
      creditedMs: '0',
      coverageIntervals: [],
      coverageMs: '0',
      confirmedPositionMs: '0',
      completed: 0,
      completedAt: null,
      lastLearnAt: null,
    });
    return repo.save(record);
  }

  private async currentScope(
    manager: EntityManager,
    userId: Id,
    lessonId: Id,
  ): Promise<{ user: SysUser; lesson: CourseLesson; version: LessonVersion }> {
    const user = await this.lockUser(manager, userId);
    if (Number(user.status) !== 1 || user.source !== 'institution' || !user.categoryId) {
      throw Errors.dataForbidden('当前学员不在课程应学范围');
    }
    const lesson = await manager.getRepository(CourseLesson).findOne({ where: { id: String(lessonId) } });
    if (!lesson || lesson.lessonType !== 'video') throw Errors.notFound('视频课时不存在');
    const course = await manager.getRepository(TrainingCourse).findOne({ where: { id: String(lesson.courseId) } });
    if (!course) throw Errors.notFound('课程不存在');
    if (course.status !== 'published' || String(course.categoryId) !== String(user.categoryId)) {
      throw Errors.videoUnavailable('课程未上架或不属于当前培训类别');
    }
    if (!lesson.currentVersionId) throw Errors.videoUnavailable('课时当前视频不可用');
    const version = await manager.getRepository(LessonVersion).findOne({
      where: { id: String(lesson.currentVersionId), lessonId: String(lesson.id) },
    });
    if (!version || numberValue(version.durationMs) <= 0) throw Errors.videoUnavailable('课时当前视频不可用');
    return { user, lesson, version };
  }

  async start(userId: Id, lessonId: Id): Promise<VideoSessionView> {
    for (let retries = 0; retries <= ACTIVITY_START_MAX_RETRIES; retries += 1) {
      const outcome = await this.dataSource.transaction(async (manager) => {
        const { version } = await this.currentScope(manager, userId, lessonId);
        if ((await this.learning.activeSessionIds(manager, String(userId))).length > 0) return null;

        const closeTime = new Date();
        await manager.getRepository(VideoLearningSession)
          .createQueryBuilder()
          .update(VideoLearningSession)
          .set({ activeUserId: null, endedAt: closeTime })
          .where('active_user_id = :userId AND ended_at IS NULL', { userId: String(userId) })
          .execute();

        // The anchor is sampled only after old reading flushes have returned and
        // the prior video close has completed, so credited windows cannot overlap.
        const startedAt = new Date();
        const record = await this.recordFor(manager, userId, version);
        const sessionRepo = manager.getRepository(VideoLearningSession);
        const session = await sessionRepo.save(sessionRepo.create({
          recordId: String(record.id),
          userId: String(userId),
          lessonVersionId: String(version.id),
          activeUserId: String(userId),
          startedAt,
          lastHeartbeatAt: startedAt,
          endedAt: null,
          lastSeq: 0,
          anchorPositionMs: String(record.confirmedPositionMs || '0'),
          anchorState: 'playing',
          creditedMs: '0',
        }));
        return {
          session_id: String(session.id),
          version_id: String(version.id),
          heartbeat_interval_ms: VIDEO_HEARTBEAT_INTERVAL_MS,
          progress: this.progressView(record, session.lastSeq),
        } as VideoSessionView;
      });
      if (outcome) return outcome;
      if (retries === ACTIVITY_START_MAX_RETRIES) {
        throw Errors.videoSessionConflict('学习会话竞争，请重试');
      }
      await this.learning.closeActiveForUser(String(userId), new Date());
    }
    throw Errors.videoSessionConflict('学习会话竞争，请重试');
  }

  private async sessionStillAvailable(
    manager: EntityManager,
    session: VideoLearningSession,
  ): Promise<boolean> {
    const user = await manager.getRepository(SysUser).findOne({ where: { id: String(session.userId) } });
    const version = await manager.getRepository(LessonVersion).findOne({ where: { id: String(session.lessonVersionId) } });
    if (!user || Number(user.status) !== 1 || user.source !== 'institution' || !user.categoryId || !version) return false;
    const lesson = await manager.getRepository(CourseLesson).findOne({ where: { id: String(version.lessonId) } });
    if (!lesson || String(lesson.currentVersionId) !== String(version.id)) return false;
    const course = await manager.getRepository(TrainingCourse).findOne({ where: { id: String(lesson.courseId) } });
    return Boolean(course && course.status === 'published' && String(course.categoryId) === String(user.categoryId));
  }

  async heartbeat(userId: Id, sessionId: Id, input: VideoHeartbeat): Promise<VideoProgress> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      const sessionRepo = manager.getRepository(VideoLearningSession);
      const session = await sessionRepo.createQueryBuilder('session')
        .setLock('pessimistic_write')
        .where('session.id = :sessionId', { sessionId: String(sessionId) })
        .getOne();
      if (!session) throw Errors.videoSessionConflict('视频学习会话不存在');
      if (String(session.userId) !== String(userId)) throw Errors.dataForbidden();
      if (session.endedAt || String(session.activeUserId || '') !== String(userId)) {
        throw Errors.videoSessionConflict();
      }

      const recordRepo = manager.getRepository(VideoLearningRecord);
      const record = await recordRepo.createQueryBuilder('record')
        .setLock('pessimistic_write')
        .where('record.id = :recordId', { recordId: String(session.recordId) })
        .getOne();
      if (!record) throw Errors.videoSessionConflict('视频学习记录不存在');

      if (input.seq <= session.lastSeq) {
        return { progress: this.progressView(record, session.lastSeq), unavailable: false };
      }
      if (!(await this.sessionStillAvailable(manager, session))) {
        const now = new Date();
        session.activeUserId = null;
        session.endedAt = now;
        await sessionRepo.save(session);
        return { progress: this.progressView(record, session.lastSeq), unavailable: true };
      }

      const now = new Date();
      const credit = creditVideoInterval(
        {
          seq: session.lastSeq,
          positionMs: numberValue(session.anchorPositionMs),
          state: session.anchorState,
        },
        input,
        now.getTime() - new Date(session.lastHeartbeatAt).getTime(),
        numberValue(record.durationMs),
      );
      const merged = mergeCoverage(record.coverageIntervals, credit.interval);
      record.creditedMs = String(numberValue(record.creditedMs) + credit.creditedMs);
      record.coverageIntervals = merged.intervals;
      record.coverageMs = String(merged.coverageMs);
      if (credit.interval) {
        record.confirmedPositionMs = String(Math.max(
          numberValue(record.confirmedPositionMs),
          credit.interval[1],
        ));
      }
      record.lastLearnAt = now;
      if (record.completed !== 1
        && numberValue(record.durationMs) > 0
        && merged.coverageMs >= numberValue(record.durationMs) * VIDEO_COMPLETION_RATIO) {
        record.completed = 1;
        record.completedAt = now;
      }
      await recordRepo.save(record);

      session.lastSeq = credit.nextAnchor.seq;
      session.anchorPositionMs = String(credit.nextAnchor.positionMs);
      session.anchorState = credit.nextAnchor.state;
      session.lastHeartbeatAt = now;
      session.creditedMs = String(numberValue(session.creditedMs) + credit.creditedMs);
      if (input.state === 'ended') {
        session.activeUserId = null;
        session.endedAt = now;
      }
      await sessionRepo.save(session);
      return { progress: this.progressView(record, session.lastSeq), unavailable: false };
    });
    if (outcome.unavailable) throw Errors.videoUnavailable('课程已下架、学员范围已变化或视频版本已替换');
    return outcome.progress;
  }

  async close(userId: Id, sessionId: Id): Promise<VideoProgress> {
    return this.dataSource.transaction(async (manager) => {
      const sessionRepo = manager.getRepository(VideoLearningSession);
      const session = await sessionRepo.createQueryBuilder('session')
        .setLock('pessimistic_write')
        .where('session.id = :sessionId', { sessionId: String(sessionId) })
        .getOne();
      if (!session) throw Errors.videoSessionConflict('视频学习会话不存在');
      if (String(session.userId) !== String(userId)) throw Errors.dataForbidden();
      const record = await manager.getRepository(VideoLearningRecord).findOne({ where: { id: String(session.recordId) } });
      if (!record) throw Errors.videoSessionConflict('视频学习记录不存在');
      if (!session.endedAt) {
        const now = new Date();
        session.activeUserId = null;
        session.endedAt = now;
        await sessionRepo.save(session);
      }
      return this.progressView(record, session.lastSeq);
    });
  }

  async progress(userId: Id, courseId: Id): Promise<CourseProgress> {
    return this.dataSource.transaction(async (manager) => {
      const required = await this.courses.requiredVideoLessons(userId, courseId, manager);
      if (!required.assigned || required.lessons.length === 0) {
        return { required: 0, completed: 0, completion_rate: null, lessons: [] };
      }
      const versionIds = required.lessons.map((lesson) => String(lesson.versionId));
      const records = await manager.getRepository(VideoLearningRecord).find({
        where: { userId: String(userId), lessonVersionId: In(versionIds) },
      });
      const byVersion = new Map(records.map((record) => [String(record.lessonVersionId), record]));
      const lessons = required.lessons.map((lesson) => {
        const record = byVersion.get(String(lesson.versionId));
        return record ? this.progressView(record) : this.emptyProgress(lesson.durationMs);
      });
      const completed = lessons.filter((lesson) => lesson.completed).length;
      return {
        required: required.lessons.length,
        completed,
        completion_rate: courseCompletionRate(required.lessons.length, completed),
        lessons,
      };
    });
  }

  async records(userId: Id, page = 1, pageSize = 20): Promise<Page<VideoRecordView>> {
    const normalizedPage = Math.max(1, Math.trunc(page));
    const normalizedPageSize = Math.min(100, Math.max(1, Math.trunc(pageSize)));
    return this.dataSource.transaction(async (manager) => {
      const [records, total] = await manager.getRepository(VideoLearningRecord).findAndCount({
        where: { userId: String(userId) },
        order: { id: 'DESC' },
        skip: (normalizedPage - 1) * normalizedPageSize,
        take: normalizedPageSize,
      });
      const versionIds = records.map((record) => String(record.lessonVersionId));
      const versions = versionIds.length
        ? await manager.getRepository(LessonVersion).findBy({ id: In(versionIds) })
        : [];
      const byId = new Map(versions.map((version) => [String(version.id), version]));
      const items = records.map((record) => {
        const version = byId.get(String(record.lessonVersionId));
        if (!version) throw Errors.internal('视频学习记录版本引用异常');
        return {
          record_id: String(record.id),
          lesson_id: String(version.lessonId),
          version_id: String(record.lessonVersionId),
          progress: this.progressView(record),
        };
      });
      return { items, total, page: normalizedPage, page_size: normalizedPageSize };
    });
  }

  /** Timeout recovery closes ownership only; it never invents an unwitnessed playback interval. */
  async sweepStalledSessions(): Promise<number> {
    const candidates = await this.dataSource.getRepository(VideoLearningSession).find({
      where: { endedAt: IsNull(), lastHeartbeatAt: LessThan(new Date(Date.now() - VIDEO_STALE_AFTER_MS)) },
      order: { id: 'ASC' },
      take: 100,
    });
    let closed = 0;
    for (const candidate of candidates) {
      try {
        const didClose = await this.dataSource.transaction(async (manager) => {
          const repo = manager.getRepository(VideoLearningSession);
          const session = await repo.createQueryBuilder('session')
            .setLock('pessimistic_write')
            .where('session.id = :sessionId', { sessionId: String(candidate.id) })
            .getOne();
          if (!session || session.endedAt || new Date(session.lastHeartbeatAt).getTime() > Date.now() - VIDEO_STALE_AFTER_MS) return false;
          session.activeUserId = null;
          session.endedAt = new Date();
          await repo.save(session);
          return true;
        });
        if (didClose) closed += 1;
      } catch (error: any) {
        this.logger.warn(`视频学习会话回收失败 session=${candidate.id}: ${error?.message}`);
      }
    }
    return closed;
  }
}
