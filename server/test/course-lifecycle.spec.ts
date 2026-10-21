import { describe, expect, it, vi } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { CourseService } from '../src/modules/courses/course.service';
import { LessonVersionService } from '../src/modules/courses/lesson-version.service';
import { TrainingCourse } from '../src/entities/training-course.entity';
import { CourseChapter } from '../src/entities/course-chapter.entity';
import { CourseLesson } from '../src/entities/course-lesson.entity';
import { LessonVersion } from '../src/entities/lesson-version.entity';
import { MediaAsset } from '../src/entities/media-asset.entity';
import { Regulation } from '../src/entities/regulation.entity';
import { SysUser } from '../src/entities/sys-user.entity';
import { CategoryService } from '../src/modules/training/category.service';
import { RegulationService } from '../src/modules/regulations/regulation.service';

type RepoMap = Map<unknown, Record<string, unknown>>;

function managerWith(repositories: RepoMap) {
  return {
    getRepository(entity: unknown) {
      const repository = repositories.get(entity);
      if (!repository) throw new Error(`unexpected repository: ${String((entity as { name?: string })?.name)}`);
      return repository;
    },
  } as any;
}

function courseService(overrides: Record<string, unknown> = {}) {
  const service = Object.create(CourseService.prototype) as any;
  Object.assign(service, {
    audit: { log: vi.fn() },
    categories: { lockActive: vi.fn().mockResolvedValue({ id: '7', status: 1 }) },
    ...overrides,
  });
  return service as CourseService & Record<string, any>;
}

function lessonService(overrides: Record<string, unknown> = {}) {
  const service = Object.create(LessonVersionService.prototype) as any;
  Object.assign(service, {
    audit: { log: vi.fn() },
    media: { assertUsable: vi.fn().mockResolvedValue(undefined), bind: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  });
  return service as LessonVersionService & Record<string, any>;
}

describe('course lifecycle', () => {
  it('creates a draft without reading the outer transaction result before initialization', async () => {
    const repository = {
      create: vi.fn((value) => ({ ...value })),
      save: vi.fn(async (value) => ({ id: '1', ...value })),
    };
    const manager = managerWith(new Map([[TrainingCourse, repository]]));
    const service = courseService({
      dataSource: { transaction: (work: any) => work(manager) },
      media: { assertUsable: vi.fn(), bind: vi.fn() },
    });

    await expect(service.create({ title: '课程', category_id: '7' }, { id: '9', name: 'admin' }, null))
      .resolves.toMatchObject({ id: '1', status: 'draft', category_id: '7' });
    expect(repository.save).toHaveBeenCalledOnce();
  });

  it('rejects publishing when a required video lesson has no ready current version', async () => {
    const course = { id: '1', categoryId: '7', status: 'draft', publishedAt: null };
    const manager = managerWith(new Map([
      [TrainingCourse, { findOne: vi.fn().mockResolvedValue(course), save: vi.fn() }],
      [CourseLesson, { find: vi.fn().mockResolvedValue([{ id: '11', required: 1, currentVersionId: null }]) }],
      [LessonVersion, { findBy: vi.fn().mockResolvedValue([]) }],
      [MediaAsset, { findBy: vi.fn().mockResolvedValue([]) }],
    ]));
    const service = courseService({ dataSource: { transaction: (work: any) => work(manager) } });

    await expect(service.publish('1', { id: '9', name: 'admin' }, null)).rejects.toMatchObject({
      httpStatus: 409,
    });
    expect(course.status).toBe('draft');
  });

  it('publishes when every required video lesson points at a ready video asset', async () => {
    const course = { id: '1', categoryId: '7', status: 'draft', publishedAt: null as Date | null };
    const save = vi.fn(async (value) => value);
    const manager = managerWith(new Map([
      [TrainingCourse, { findOne: vi.fn().mockResolvedValue(course), save }],
      [CourseLesson, { find: vi.fn().mockResolvedValue([{ id: '11', lessonType: 'video', required: 1, currentVersionId: '50' }]) }],
      [LessonVersion, { findBy: vi.fn().mockResolvedValue([{ id: '50', lessonId: '11', assetId: '20', durationMs: '120000' }]) }],
      [MediaAsset, { findBy: vi.fn().mockResolvedValue([{ id: '20', purpose: 'video', mediaKind: 'video', status: 'ready', durationMs: '120000' }]) }],
    ]));
    const service = courseService({ dataSource: { transaction: (work: any) => work(manager) } });

    await expect(service.publish('1', { id: '9', name: 'admin' }, null)).resolves.toMatchObject({
      id: '1', status: 'published', required_lesson_count: 1,
    });
    expect(save).toHaveBeenCalledOnce();
    expect(course.publishedAt).toBeInstanceOf(Date);
  });

  it('rejects taking a draft course directly offline', async () => {
    const course = { id: '1', status: 'draft' };
    const manager = managerWith(new Map([
      [TrainingCourse, { findOne: vi.fn().mockResolvedValue(course), save: vi.fn() }],
    ]));
    const service = courseService({
      dataSource: { transaction: (work: any) => work(manager) },
      lessonRepo: { count: vi.fn() },
    });

    await expect(service.offline('1', { id: '9', name: 'admin' }, null)).rejects.toMatchObject({
      httpStatus: 409,
    });
    expect(course.status).toBe('draft');
    expect(service.lessonRepo.count).not.toHaveBeenCalled();
  });

  it('replaces a published lesson video by appending a version and preserving the old row', async () => {
    const oldVersion = { id: '50', lessonId: '11', versionNo: 1, assetId: '19', durationMs: '90000' };
    const lesson = { id: '11', courseId: '1', lessonType: 'video', currentVersionId: '50' };
    const savedVersions: any[] = [];
    const versionRepo = {
      findOne: vi.fn().mockResolvedValue(oldVersion),
      create: vi.fn((value) => ({ ...value })),
      save: vi.fn(async (value) => {
        const saved = { id: '51', ...value };
        savedVersions.push(saved);
        return saved;
      }),
    };
    const manager = managerWith(new Map([
      [TrainingCourse, { findOne: vi.fn().mockResolvedValue({ id: '1', status: 'published' }) }],
      [CourseLesson, { findOne: vi.fn().mockResolvedValue(lesson), save: vi.fn(async (value) => value) }],
      [LessonVersion, versionRepo],
      [MediaAsset, { findOne: vi.fn().mockResolvedValue({ id: '20', purpose: 'video', mediaKind: 'video', status: 'ready', durationMs: '120000' }) }],
    ]));
    const service = lessonService({ dataSource: { transaction: (work: any) => work(manager) } });

    await expect(service.replaceVideo('1', '11', '20', { id: '9', name: 'admin' }, null)).resolves.toEqual({
      version_id: '51', asset_id: '20', duration_ms: 120000, version_no: 2,
    });
    expect(oldVersion).toEqual({ id: '50', lessonId: '11', versionNo: 1, assetId: '19', durationMs: '90000' });
    expect(savedVersions).toHaveLength(1);
    expect(lesson.currentVersionId).toBe('51');
    expect(service.media.bind).toHaveBeenCalledWith(manager, '20', 'lesson_version_video', '51');
  });

  it('rejects an unknown lesson type before writing anything', async () => {
    const service = lessonService({ dataSource: { transaction: vi.fn() } });
    await expect(service.createLesson('1', {
      chapter_id: '10', title: '资料课时', lesson_type: 'document', required: true, sort_order: 1,
    } as any, { id: '9', name: 'admin' }, null)).rejects.toMatchObject({ httpStatus: 400 });
    expect(service.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('returns an empty assigned page for an external learner without querying courses', async () => {
    const createQueryBuilder = vi.fn();
    const service = courseService({
      userRepo: { findOne: vi.fn().mockResolvedValue({ id: '31', status: 1, source: 'external', categoryId: '7' }) },
      courseRepo: { createQueryBuilder },
    });
    await expect(service.visibleCourses('31', 2, 20)).resolves.toEqual({ items: [], total: 0, page: 2, page_size: 20 });
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });

  it('rejects a published course from another training category', async () => {
    const service = courseService({
      userRepo: { findOne: vi.fn().mockResolvedValue({ id: '31', status: 1, source: 'institution', categoryId: '7' }) },
      courseRepo: { findOne: vi.fn().mockResolvedValue({ id: '1', status: 'published', categoryId: '8' }) },
    });
    await expect(service.learnerDetail('31', '1')).rejects.toMatchObject({ httpStatus: 403 });
  });

  it('returns the immutable current lesson version with string IDs', async () => {
    const service = lessonService({
      lessonRepo: { findOne: vi.fn().mockResolvedValue({ id: '11', currentVersionId: '51' }) },
      versionRepo: { findOne: vi.fn().mockResolvedValue({ id: '51', assetId: '20', durationMs: '120000' }) },
    });
    await expect(service.current('11')).resolves.toEqual({ versionId: '51', assetId: '20', durationMs: 120000 });
  });
});

describe('course and regulation category references', () => {
  it('keeps B1 table and category index metadata aligned with the DDL', () => {
    const storage = getMetadataArgsStorage();
    const tableNames = [TrainingCourse, CourseChapter, CourseLesson, LessonVersion]
      .map((target) => storage.tables.find((table) => table.target === target)?.name);
    expect(tableNames).toEqual(['training_course', 'course_chapter', 'course_lesson', 'lesson_version']);
    expect(storage.indices.find((index) => index.target === Regulation && index.name === 'idx_regulation_category_id')?.columns)
      .toEqual(['categoryId']);
    expect(storage.indices.find((index) => index.target === LessonVersion && index.name === 'uk_lesson_version_number')?.unique)
      .toBe(true);
  });

  it('does not revalidate an unchanged regulation category when other metadata is edited', async () => {
    const regulation = { id: '3', title: '旧标题', category: 'legacy', categoryId: '7', description: null };
    const lockActive = vi.fn();
    const repository = {
      findOne: vi.fn().mockResolvedValue(regulation),
      save: vi.fn(async (value) => value),
    };
    const service = Object.create(RegulationService.prototype) as any;
    service.categories = { lockActive };
    service.dataSource = { transaction: vi.fn((work: any) => work(managerWith(new Map([[Regulation, repository]])))) };
    service.audit = { log: vi.fn() };

    await expect(service.update('3', { title: '新标题', category_id: '7' }, { id: 9, name: 'admin' }, null))
      .resolves.toMatchObject({ title: '新标题', category: 'legacy', category_id: '7' });
    expect(lockActive).not.toHaveBeenCalled();
  });

  it('locks a changed active category and allows an explicit null to clear the relation', async () => {
    const regulation = { id: '3', title: '标题', category: 'legacy', categoryId: '7', description: null };
    const lockActive = vi.fn().mockResolvedValue({ id: '8', status: 1 });
    const repository = {
      findOne: vi.fn().mockResolvedValue(regulation),
      save: vi.fn(async (value) => value),
    };
    const service = Object.create(RegulationService.prototype) as any;
    service.categories = { lockActive };
    service.dataSource = { transaction: (work: any) => work(managerWith(new Map([[Regulation, repository]]))) };
    service.audit = { log: vi.fn() };

    await expect(service.update('3', { category_id: '8' }, { id: 9, name: 'admin' }, null))
      .resolves.toMatchObject({ category_id: '8', category: 'legacy' });
    expect(lockActive).toHaveBeenCalledOnce();
    await expect(service.update('3', { category_id: null }, { id: 9, name: 'admin' }, null))
      .resolves.toMatchObject({ category_id: null, category: 'legacy' });
  });

  it('prevents deleting a training category referenced by a course', async () => {
    const manager = {
      findOne: vi.fn().mockResolvedValue({ id: '7', status: 1 }),
      getRepository(entity: unknown) {
        if (entity === SysUser) return { count: vi.fn().mockResolvedValue(0) };
        if (entity === TrainingCourse) return { count: vi.fn().mockResolvedValue(1) };
        if (entity === Regulation) return { count: vi.fn().mockResolvedValue(0) };
        throw new Error(`unexpected repository: ${String((entity as any)?.name)}`);
      },
    } as any;
    const service = Object.create(CategoryService.prototype) as any;
    service.categoryRepo = { manager: { transaction: (work: any) => work(manager) } };
    service.audit = { log: vi.fn() };

    await expect(service.remove('7', { id: '9', name: 'admin' }, null)).rejects.toMatchObject({ httpStatus: 409 });
  });
});
