import 'reflect-metadata';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource, In } from 'typeorm';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { Errors } from '../src/common/errors';
import { CourseLesson } from '../src/entities/course-lesson.entity';
import { CourseChapter } from '../src/entities/course-chapter.entity';
import { TrainingCourse } from '../src/entities/training-course.entity';
import { CourseAdminController } from '../src/modules/courses/course.controller';
import { CourseService } from '../src/modules/courses/course.service';
import { LessonVersionService } from '../src/modules/courses/lesson-version.service';

const actor = { id: '9', name: 'admin' };

function deletionFixture(status = 'offline', lessonCourseId = '1') {
  const events: string[] = [];
  const lesson = { id: '11', courseId: lessonCourseId, currentVersionId: '51', deletedAt: null as Date | null };
  const history = {
    versions: [{ id: '50', lessonId: '11', assetId: '19' }, { id: '51', lessonId: '11', assetId: '20' }],
    references: [{ ownerType: 'lesson_version_video', ownerId: '50', assetId: '19' }],
    records: [{ userId: '31', lessonVersionId: '50', completed: 1, coverageMs: '90000' }],
  };
  const courseRepo = {
    findOne: vi.fn(async (options) => {
      expect(options).toEqual({ where: { id: '1' }, lock: { mode: 'pessimistic_write' } });
      events.push('lock-course');
      return { id: '1', status };
    }),
  };
  const lessonRepo = {
    findOne: vi.fn(async (options) => {
      expect(options).toEqual({ where: { id: '11', courseId: '1' }, lock: { mode: 'pessimistic_write' } });
      events.push('lock-lesson');
      return lesson.courseId === '1' && !lesson.deletedAt ? lesson : null;
    }),
    softDelete: vi.fn(async (criteria) => {
      expect(criteria).toEqual({ id: '11', courseId: '1' });
      events.push('soft-delete');
      lesson.deletedAt = new Date();
      return { affected: 1 };
    }),
  };
  const manager = {
    getRepository(entity: unknown) {
      if (entity === TrainingCourse) return courseRepo;
      if (entity === CourseLesson) return lessonRepo;
      throw new Error('Deletion must not mutate versions, media references or learning facts');
    },
  };
  const service = Object.assign(Object.create(LessonVersionService.prototype), {
    dataSource: { transaction: async (work) => { const result = await work(manager); events.push('commit'); return result; } },
    audit: { log: vi.fn(() => { events.push('audit'); }) },
  });
  return { service, courseRepo, lessonRepo, lesson, history, events };
}

describe('course lesson safe deletion', () => {
  it.each(['draft', 'offline'])('removes a %s lesson under course/lesson locks and preserves every history reference', async (status) => {
    const f = deletionFixture(status);
    const before = JSON.stringify(f.history);
    expect(typeof f.service.deleteLesson).toBe('function');
    await expect(f.service.deleteLesson('1', '11', actor, null)).resolves.toEqual({ id: '11', deleted: true });
    expect(f.lesson.deletedAt).toBeInstanceOf(Date);
    expect(f.lesson.currentVersionId).toBe('51');
    expect(JSON.stringify(f.history)).toBe(before);
    expect(f.events).toEqual(['lock-course', 'lock-lesson', 'soft-delete', 'commit', 'audit']);
    expect(f.service.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'course.lesson.delete', object_type: 'course_lesson', object_id: '11', detail: { course_id: '1' },
    }));
  });

  it.each([
    ['published', '1', 40930],
    ['offline', '2', 40401],
  ])('rejects status=%s and lesson course=%s without changing facts', async (status, courseId, code) => {
    const f = deletionFixture(status, courseId);
    expect(typeof f.service.deleteLesson).toBe('function');
    await expect(f.service.deleteLesson('1', '11', actor, null)).rejects.toMatchObject({ code });
    expect(f.lesson.deletedAt).toBeNull();
    expect(f.lessonRepo.softDelete).not.toHaveBeenCalled();
    expect(f.service.audit.log).not.toHaveBeenCalled();
  });

  it('rejects a missing course and a repeated deletion', async () => {
    const missing = deletionFixture();
    missing.courseRepo.findOne.mockResolvedValueOnce(null as any);
    expect(typeof missing.service.deleteLesson).toBe('function');
    await expect(missing.service.deleteLesson('1', '11', actor, null)).rejects.toMatchObject({ code: 40401 });
    expect(missing.lessonRepo.findOne).not.toHaveBeenCalled();
    const f = deletionFixture();
    await f.service.deleteLesson('1', '11', actor, null);
    await expect(f.service.deleteLesson('1', '11', actor, null)).rejects.toMatchObject({ code: 40401 });
    expect(f.lessonRepo.softDelete).toHaveBeenCalledTimes(1);
  });

  it('propagates a failed database mutation without writing a success audit', async () => {
    const f = deletionFixture();
    f.lessonRepo.softDelete.mockRejectedValueOnce(new Error('write failed'));
    expect(typeof f.service.deleteLesson).toBe('function');
    await expect(f.service.deleteLesson('1', '11', actor, null)).rejects.toThrow('write failed');
    expect(f.lesson.deletedAt).toBeNull();
    expect(f.events).not.toContain('commit');
    expect(f.service.audit.log).not.toHaveBeenCalled();
  });

  it('registers DELETE and enforces courses:write through the actual permission guard', async () => {
    const handler = (CourseAdminController.prototype as any).deleteLesson;
    expect(typeof handler).toBe('function');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id/lessons/:lessonId');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.DELETE);
    for (const permissions of [[], ['courses:read'], ['courses:publish'], ['courses:write']]) {
      const access = { assertAllowed: async (_id, code) => { if (!permissions.includes(code)) throw Errors.forbidden(); } };
      const context: any = {
        getHandler: () => handler, getClass: () => CourseAdminController,
        switchToHttp: () => ({ getRequest: () => ({ method: 'DELETE', user: { id: 9 } }) }),
      };
      const check = new PermissionsGuard(new Reflector(), access as any).canActivate(context);
      if (permissions.includes('courses:write')) await expect(check).resolves.toBe(true);
      else await expect(check).rejects.toMatchObject({ code: 40301 });
    }
    const f = deletionFixture();
    const controller = new CourseAdminController({} as any, f.service, {} as any) as any;
    await expect(controller.deleteLesson('1', '11', { id: 9, username: 'admin' }, { ip: '127.0.0.1' }))
      .resolves.toEqual({ id: '11', deleted: true });
    expect(() => controller.deleteLesson('1', '0', { id: 9 }, {})).toThrow();
  });

  it('returns the persisted creation timestamp in course detail', async () => {
    const createdAt = new Date('2026-10-20T08:01:02.123Z');
    const service = Object.assign(Object.create(CourseService.prototype), {
      courseRepo: { findOne: async () => ({ id: '1', categoryId: '7', status: 'offline' }) },
      chapterRepo: { find: async () => [{ id: '8', title: 'chapter', sortOrder: 0 }] },
      lessonRepo: { find: async () => [{ id: '11', chapterId: '8', title: 'lesson', required: 1, sortOrder: 0, createdAt }] },
      versionRepo: {},
    });
    const detail = await service.adminDetail('1');
    expect(detail.chapters[0].lessons[0].created_at).toEqual(createdAt);
  });
});

describe('real TypeORM lesson SQL contract (metadata only, no database connection)', () => {
  let source: DataSource;
  beforeAll(async () => {
    source = new DataSource({ type: 'mysql', database: 'metadata_only', entities: [CourseLesson, CourseChapter, TrainingCourse], synchronize: false });
    await (source as any).buildMetadatas();
  });

  it('excludes deleted lessons in find/list/count/readiness, media, video and statistics predicates by default', () => {
    const repo = source.getRepository(CourseLesson);
    for (const where of [
      { courseId: '1' }, { courseId: '1', required: 1 }, { id: '11' },
      { id: '11', courseId: '1' }, { courseId: In(['1', '2']), required: 1, lessonType: 'video' as const },
    ]) {
      const query = repo.createQueryBuilder('lesson').setFindOptions({ where });
      expect(query.getSql()).toMatch(/`lesson`\.`deleted_at` IS NULL/);
    }
    const counts = repo.createQueryBuilder('lesson').select('lesson.course_id', 'course_id')
      .addSelect('COUNT(*)', 'count').where('lesson.course_id IN (:...courseIds)', { courseIds: ['1'] })
      .andWhere('lesson.is_required = 1').groupBy('lesson.course_id').getSql();
    expect(counts).toMatch(/`lesson`\.`deleted_at` IS NULL/);
    expect(repo.createQueryBuilder('lesson').withDeleted().getSql()).not.toContain('IS NULL');
  });

  it('soft deletion emits an UPDATE without destroying the current version or history', () => {
    const metadata = source.getMetadata(CourseLesson);
    expect(metadata.deleteDateColumn?.databaseName).toBe('deleted_at');
    expect(metadata.deleteDateColumn?.precision).toBe(3);
    const sql = source.getRepository(CourseLesson).createQueryBuilder().softDelete()
      .where({ id: '11', courseId: '1' }).getSql();
    expect(sql).toMatch(/^UPDATE `course_lesson` SET `deleted_at` = CURRENT_TIMESTAMP/);
    expect(sql).not.toMatch(/DELETE FROM|current_version_id|lesson_version|media_reference|video_learning/);
    expect(source.isInitialized).toBe(false);
  });
});
