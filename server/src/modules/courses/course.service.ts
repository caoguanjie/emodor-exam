import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { Errors } from '../../common/errors';
import type { CourseSummary, Id, Page } from '../../common/training-contracts';
import { CourseChapter } from '../../entities/course-chapter.entity';
import { CourseLesson } from '../../entities/course-lesson.entity';
import { LessonVersion } from '../../entities/lesson-version.entity';
import { LearnerIdentity } from '../../entities/learner-identity.entity';
import { IdentityVerificationSession } from '../../entities/identity-verification-session.entity';
import { MediaAsset } from '../../entities/media-asset.entity';
import { Regulation } from '../../entities/regulation.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { TrainingCourse } from '../../entities/training-course.entity';
import { AccessService } from '../access/access.service';
import { MediaService } from '../media/media.service';
import { CategoryService } from '../training/category.service';

export interface CourseActor {
  id: Id;
  name: string;
}

export interface CourseInput {
  title: string;
  category_id: Id;
  cover_asset_id?: Id | null;
  description?: string | null;
  regulation_ids?: Id[] | null;
  is_recommended?: boolean;
  sort_order?: number;
}

export interface CoursePatch {
  title?: string;
  category_id?: Id;
  cover_asset_id?: Id | null;
  description?: string | null;
  regulation_ids?: Id[] | null;
  is_recommended?: boolean;
  sort_order?: number;
}

type RequiredReadiness = { requiredCount: number; missingLessonIds: string[] };

export interface RequiredVideoLesson {
  lessonId: Id;
  versionId: Id;
  durationMs: number;
}

@Injectable()
export class CourseService implements OnModuleInit {
  constructor(
    @InjectRepository(TrainingCourse) private readonly courseRepo: Repository<TrainingCourse>,
    @InjectRepository(CourseChapter) private readonly chapterRepo: Repository<CourseChapter>,
    @InjectRepository(CourseLesson) private readonly lessonRepo: Repository<CourseLesson>,
    @InjectRepository(LessonVersion) private readonly versionRepo: Repository<LessonVersion>,
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    @InjectRepository(Regulation) private readonly regulationRepo: Repository<Regulation>,
    @InjectRepository(MediaAsset) private readonly mediaAssetRepo: Repository<MediaAsset>,
    private readonly dataSource: DataSource,
    private readonly categories: CategoryService,
    private readonly media: MediaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.media.registerOwnerPolicy('training_course_cover', {
      allowedPurposes: ['course_cover'],
      authorizeRead: (actorId, courseId) => this.canReadCourse(actorId, courseId),
      validateBinding: async (manager, _asset, courseId) => {
        const exists = await manager.getRepository(TrainingCourse).exist({ where: { id: String(courseId) } });
        if (!exists) throw Errors.notFound('课程不存在');
      },
    });
    this.media.registerOwnerPolicy('lesson_version_video', {
      allowedPurposes: ['video'],
      authorizeRead: (actorId, versionId, assetId) => this.canReadLessonVersion(actorId, versionId, assetId),
      authorizeTicket: (actorId, versionId, assetId) => this.canReadLearnerVideo(actorId, versionId, assetId),
      validateBinding: async (manager, _asset, versionId) => {
        const exists = await manager.getRepository(LessonVersion).exist({ where: { id: String(versionId) } });
        if (!exists) throw Errors.notFound('课时版本不存在');
      },
    });
  }

  private page(page: number, pageSize: number): { page: number; pageSize: number } {
    const normalizedPage = Math.max(1, Number.isInteger(Number(page)) ? Number(page) : 1);
    const normalizedSize = Math.min(100, Math.max(1, Number.isInteger(Number(pageSize)) ? Number(pageSize) : 20));
    return { page: normalizedPage, pageSize: normalizedSize };
  }

  private title(value: string): string {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 255) throw Errors.param('课程标题必填且不超过 255 个字符');
    return normalized;
  }

  private regulationIds(value: Id[] | null | undefined): string[] | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const ids = [...new Set(value.map(String))];
    if (ids.some((id) => !/^[1-9]\d*$/.test(id))) throw Errors.param('regulation_ids 必须是字符串 ID 数组');
    return ids.length ? ids : null;
  }

  private summary(course: TrainingCourse, requiredCount: number): CourseSummary {
    return {
      id: String(course.id),
      title: course.title,
      category_id: String(course.categoryId),
      cover_asset_id: course.coverAssetId ? String(course.coverAssetId) : null,
      status: course.status,
      required_lesson_count: requiredCount,
    };
  }

  private adminSummary(course: TrainingCourse, requiredCount: number) {
    return {
      ...this.summary(course, requiredCount),
      description: course.description,
      regulation_ids: course.regulationIds?.map(String) ?? [],
      is_recommended: Boolean(course.isRecommended),
      sort_order: course.sortOrder,
      published_at: course.publishedAt,
      created_at: course.createdAt,
      updated_at: course.updatedAt,
    };
  }

  private async requiredCounts(courseIds: string[]): Promise<Map<string, number>> {
    if (!courseIds.length) return new Map();
    const rows = await this.lessonRepo.createQueryBuilder('lesson')
      .select('lesson.course_id', 'course_id')
      .addSelect('COUNT(*)', 'count')
      .where('lesson.course_id IN (:...courseIds)', { courseIds })
      .andWhere('lesson.is_required = 1')
      .groupBy('lesson.course_id')
      .getRawMany<{ course_id: string; count: string }>();
    return new Map(rows.map((row) => [String(row.course_id), Number(row.count)]));
  }

  private async validateRegulations(manager: EntityManager, ids: string[] | null | undefined): Promise<void> {
    if (!ids?.length) return;
    const rows = await manager.getRepository(Regulation).findBy({ id: In(ids) });
    if (rows.length !== ids.length) throw Errors.param('存在无效的关联制度');
  }

  private async readiness(manager: EntityManager, courseId: string): Promise<RequiredReadiness> {
    const lessons = await manager.getRepository(CourseLesson).find({
      where: { courseId: String(courseId), required: 1 },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    const versionIds = lessons.map((lesson) => lesson.currentVersionId).filter((id): id is string => Boolean(id));
    const versions = versionIds.length
      ? await manager.getRepository(LessonVersion).findBy({ id: In(versionIds) })
      : [];
    const versionById = new Map(versions.map((version) => [String(version.id), version]));
    const assetIds = [...new Set(versions.map((version) => String(version.assetId)))];
    const assets = assetIds.length
      ? await manager.getRepository(MediaAsset).findBy({ id: In(assetIds) })
      : [];
    const assetById = new Map(assets.map((asset) => [String(asset.id), asset]));
    const missingLessonIds = lessons.filter((lesson) => {
      if (lesson.lessonType !== 'video' || !lesson.currentVersionId) return true;
      const version = versionById.get(String(lesson.currentVersionId));
      if (!version || String(version.lessonId) !== String(lesson.id) || Number(version.durationMs) <= 0) return true;
      const asset = assetById.get(String(version.assetId));
      return !asset || asset.status !== 'ready' || asset.purpose !== 'video' || asset.mediaKind !== 'video'
        || asset.durationMs === null || Number(asset.durationMs) <= 0;
    }).map((lesson) => String(lesson.id));
    return { requiredCount: lessons.length, missingLessonIds };
  }

  async list(query: { page?: number; page_size?: number; keyword?: string; category_id?: string; status?: string }) {
    const { page, pageSize } = this.page(Number(query.page || 1), Number(query.page_size || 20));
    const qb = this.courseRepo.createQueryBuilder('course');
    if (query.keyword?.trim()) qb.andWhere('course.title LIKE :keyword', { keyword: `%${query.keyword.trim()}%` });
    if (query.category_id) qb.andWhere('course.category_id = :categoryId', { categoryId: String(query.category_id) });
    if (query.status) qb.andWhere('course.status = :status', { status: query.status });
    qb.orderBy('course.sort_order', 'ASC').addOrderBy('course.id', 'DESC');
    const total = await qb.getCount();
    const courses = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();
    const counts = await this.requiredCounts(courses.map((course) => String(course.id)));
    return { items: courses.map((course) => this.adminSummary(course, counts.get(String(course.id)) || 0)), total, page, page_size: pageSize };
  }

  async create(input: CourseInput, actor: CourseActor, ip: string | null) {
    const regulationIds = this.regulationIds(input.regulation_ids);
    if (input.cover_asset_id) await this.media.assertUsable(actor.id, input.cover_asset_id, 'course_cover');
    const saved = await this.dataSource.transaction(async (manager) => {
      await this.categories.lockActive(manager, input.category_id);
      await this.validateRegulations(manager, regulationIds);
      const repo = manager.getRepository(TrainingCourse);
      const course = await repo.save(repo.create({
        title: this.title(input.title),
        categoryId: String(input.category_id),
        coverAssetId: input.cover_asset_id ? String(input.cover_asset_id) : null,
        description: input.description?.trim() || null,
        regulationIds: regulationIds ?? null,
        isRecommended: input.is_recommended ? 1 : 0,
        sortOrder: input.sort_order ?? 0,
        status: 'draft',
        createdBy: String(actor.id),
        publishedAt: null,
      }));
      if (course.coverAssetId) await this.media.bind(manager, course.coverAssetId, 'training_course_cover', String(course.id));
      return course;
    });
    this.audit.log({ actor_id: Number(actor.id), actor_name: actor.name, action: 'course.create', object_type: 'training_course', object_id: saved.id, detail: { title: saved.title }, result: 'success', source_ip: ip });
    return this.adminSummary(saved, 0);
  }

  async update(id: string, input: CoursePatch, actor: CourseActor, ip: string | null) {
    const before = await this.courseRepo.findOne({ where: { id: String(id) } });
    if (!before) throw Errors.notFound('课程不存在');
    const regulationIds = this.regulationIds(input.regulation_ids);
    const coverChanged = input.cover_asset_id !== undefined && String(input.cover_asset_id || '') !== String(before.coverAssetId || '');
    if (coverChanged && input.cover_asset_id) await this.media.assertUsable(actor.id, input.cover_asset_id, 'course_cover');
    const saved = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(TrainingCourse);
      const course = await repo.findOne({ where: { id: String(id) }, lock: { mode: 'pessimistic_write' } });
      if (!course) throw Errors.notFound('课程不存在');
      if (input.category_id !== undefined && String(input.category_id) !== String(course.categoryId)) {
        await this.categories.lockActive(manager, input.category_id);
        course.categoryId = String(input.category_id);
      }
      await this.validateRegulations(manager, regulationIds);
      if (input.title !== undefined) course.title = this.title(input.title);
      if (input.description !== undefined) course.description = input.description?.trim() || null;
      if (regulationIds !== undefined) course.regulationIds = regulationIds;
      if (input.is_recommended !== undefined) course.isRecommended = input.is_recommended ? 1 : 0;
      if (input.sort_order !== undefined) course.sortOrder = input.sort_order;
      if (input.cover_asset_id !== undefined && String(input.cover_asset_id || '') !== String(course.coverAssetId || '')) {
        const oldAssetId = course.coverAssetId;
        const newAssetId = input.cover_asset_id ? String(input.cover_asset_id) : null;
        if (newAssetId) {
          // Recheck actor ownership against the row state observed under the
          // course lock. Another update may have changed the cover since the
          // optimistic check above.
          await this.media.assertUsable(actor.id, newAssetId, 'course_cover');
          await this.media.bind(manager, newAssetId, 'training_course_cover', String(course.id));
        }
        if (oldAssetId) await this.media.unbind(manager, String(oldAssetId), 'training_course_cover', String(course.id));
        course.coverAssetId = newAssetId;
      }
      return repo.save(course);
    });
    const requiredCount = await this.lessonRepo.count({ where: { courseId: String(id), required: 1 } });
    this.audit.log({ actor_id: Number(actor.id), actor_name: actor.name, action: 'course.update', object_type: 'training_course', object_id: id, detail: {}, result: 'success', source_ip: ip });
    return this.adminSummary(saved, requiredCount);
  }

  async publish(id: string, actor: CourseActor, ip: string | null) {
    const result = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(TrainingCourse);
      const course = await repo.findOne({ where: { id: String(id) }, lock: { mode: 'pessimistic_write' } });
      if (!course) throw Errors.notFound('课程不存在');
      if (course.status === 'published') {
        const current = await this.readiness(manager, id);
        return { course, readiness: current };
      }
      await this.categories.lockActive(manager, String(course.categoryId));
      const current = await this.readiness(manager, id);
      if (current.missingLessonIds.length) {
        throw Errors.courseConflict('发布校验未通过：必学视频资源缺失或尚未就绪');
      }
      course.status = 'published';
      course.publishedAt = new Date();
      await repo.save(course);
      return { course, readiness: current };
    });
    this.audit.log({ actor_id: Number(actor.id), actor_name: actor.name, action: 'course.publish', object_type: 'training_course', object_id: id, detail: { required_lesson_count: result.readiness.requiredCount }, result: 'success', source_ip: ip });
    return this.adminSummary(result.course, result.readiness.requiredCount);
  }

  async offline(id: string, actor: CourseActor, ip: string | null) {
    const course = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(TrainingCourse);
      const row = await repo.findOne({ where: { id: String(id) }, lock: { mode: 'pessimistic_write' } });
      if (!row) throw Errors.notFound('课程不存在');
      if (row.status === 'draft') throw Errors.courseConflict('草稿课程尚未上架，不能下架');
      if (row.status === 'published') {
        row.status = 'offline';
        await repo.save(row);
      }
      return row;
    });
    const requiredCount = await this.lessonRepo.count({ where: { courseId: String(id), required: 1 } });
    this.audit.log({ actor_id: Number(actor.id), actor_name: actor.name, action: 'course.offline', object_type: 'training_course', object_id: id, detail: {}, result: 'success', source_ip: ip });
    return this.adminSummary(course, requiredCount);
  }

  async adminDetail(id: string) {
    const course = await this.courseRepo.findOne({ where: { id: String(id) } });
    if (!course) throw Errors.notFound('课程不存在');
    return this.detailView(course);
  }

  private async learner(userId: string): Promise<SysUser | null> {
    return this.userRepo.findOne({ where: { id: String(userId) } });
  }

  private isVisibleTo(user: SysUser | null, course: TrainingCourse): boolean {
    return Boolean(user && Number(user.status) === 1 && user.source === 'institution' && user.categoryId
      && course.status === 'published' && String(course.categoryId) === String(user.categoryId));
  }

  private canBrowse(user: SysUser | null, course: TrainingCourse): boolean {
    return Boolean(user && Number(user.status) === 1 && course.status === 'published');
  }

  async visibleCourses(userId: Id, page = 1, pageSize = 20): Promise<Page<CourseSummary>> {
    const normalized = this.page(page, pageSize);
    const user = await this.learner(userId);
    if (!user || Number(user.status) !== 1) {
      return { items: [], total: 0, page: normalized.page, page_size: normalized.pageSize };
    }
    const qb = this.courseRepo.createQueryBuilder('course')
      .where('course.status = :status', { status: 'published' })
      .orderBy('course.is_recommended', 'DESC')
      .addOrderBy('course.sort_order', 'ASC')
      .addOrderBy('course.id', 'DESC');
    const total = await qb.getCount();
    const courses = await qb.skip((normalized.page - 1) * normalized.pageSize).take(normalized.pageSize).getMany();
    const counts = await this.requiredCounts(courses.map((course) => String(course.id)));
    return {
      items: courses.map((course) => this.summary(course, counts.get(String(course.id)) || 0)),
      total,
      page: normalized.page,
      page_size: normalized.pageSize,
    };
  }

  async assignedCourseIds(userId: Id): Promise<Id[]> {
    const user = await this.learner(userId);
    if (!user || Number(user.status) !== 1 || user.source !== 'institution' || !user.categoryId) return [];
    const rows = await this.courseRepo.find({
      where: { categoryId: String(user.categoryId), status: 'published' },
      order: { sortOrder: 'ASC', id: 'DESC' },
    });
    return rows.map((course) => String(course.id));
  }

  /** Current required denominator. A supplied manager keeps scope reads inside the caller transaction. */
  async requiredVideoLessons(
    userId: Id,
    courseId: Id,
    manager?: EntityManager,
  ): Promise<{ assigned: boolean; lessons: RequiredVideoLesson[] }> {
    const userRepo = manager?.getRepository(SysUser) ?? this.userRepo;
    const courseRepo = manager?.getRepository(TrainingCourse) ?? this.courseRepo;
    const lessonRepo = manager?.getRepository(CourseLesson) ?? this.lessonRepo;
    const versionRepo = manager?.getRepository(LessonVersion) ?? this.versionRepo;
    const [user, course] = await Promise.all([
      userRepo.findOne({ where: { id: String(userId) } }),
      courseRepo.findOne({ where: { id: String(courseId) } }),
    ]);
    if (!course) throw Errors.notFound('课程不存在');
    if (!this.canBrowse(user, course)) return { assigned: false, lessons: [] };

    const lessons = (await lessonRepo.find({
      where: { courseId: String(courseId), required: 1, lessonType: 'video' },
      order: { sortOrder: 'ASC', id: 'ASC' },
    })).filter((lesson) => Number(lesson.required) === 1 && lesson.lessonType === 'video');
    const currentIds = lessons.map((lesson) => lesson.currentVersionId).filter((value): value is string => Boolean(value));
    const versions = currentIds.length ? await versionRepo.findBy({ id: In(currentIds) }) : [];
    const byId = new Map(versions.map((version) => [String(version.id), version]));
    const required = lessons.map((lesson) => {
      const version = lesson.currentVersionId ? byId.get(String(lesson.currentVersionId)) : undefined;
      if (!version || String(version.lessonId) !== String(lesson.id) || Number(version.durationMs) <= 0) {
        throw Errors.videoUnavailable('必学课时当前视频不可用');
      }
      return {
        lessonId: String(lesson.id),
        versionId: String(version.id),
        durationMs: Number(version.durationMs),
      };
    });
    return { assigned: true, lessons: required };
  }

  async learnerDetail(userId: Id, courseId: Id) {
    const [user, course] = await Promise.all([
      this.learner(userId),
      this.courseRepo.findOne({ where: { id: String(courseId) } }),
    ]);
    if (!course) throw Errors.notFound('课程不存在');
    if (!this.canBrowse(user, course)) throw Errors.dataForbidden('无权访问该课程');
    return this.detailView(course, true);
  }

  private async detailView(course: TrainingCourse, learner = false) {
    const [chapters, lessons] = await Promise.all([
      this.chapterRepo.find({ where: { courseId: String(course.id) }, order: { sortOrder: 'ASC', id: 'ASC' } }),
      this.lessonRepo.find({ where: { courseId: String(course.id) }, order: { sortOrder: 'ASC', id: 'ASC' } }),
    ]);
    const versionIds = lessons.map((lesson) => lesson.currentVersionId).filter((id): id is string => Boolean(id));
    const versions = versionIds.length ? await this.versionRepo.findBy({ id: In(versionIds) }) : [];
    const versionById = new Map(versions.map((version) => [String(version.id), version]));
    const lessonView = (lesson: CourseLesson) => {
      const version = lesson.currentVersionId ? versionById.get(String(lesson.currentVersionId)) : undefined;
      return {
        id: String(lesson.id),
        title: lesson.title,
        lesson_type: lesson.lessonType,
        required: Boolean(lesson.required),
        sort_order: lesson.sortOrder,
        current_version: version ? {
          version_id: String(version.id),
          asset_id: String(version.assetId),
          duration_ms: Number(version.durationMs),
        } : null,
      };
    };
    const requiredLessons = lessons.filter((lesson) => Boolean(lesson.required));
    const missingRequiredLessonIds = requiredLessons
      .filter((lesson) => !lesson.currentVersionId || !versionById.has(String(lesson.currentVersionId)))
      .map((lesson) => String(lesson.id));
    const base = {
      ...this.summary(course, requiredLessons.length),
      description: course.description,
      chapters: chapters.map((chapter) => ({
        id: String(chapter.id),
        title: chapter.title,
        sort_order: chapter.sortOrder,
        lessons: lessons.filter((lesson) => String(lesson.chapterId) === String(chapter.id)).map(lessonView),
      })),
    };
    if (learner) return base;
    return {
      ...base,
      regulation_ids: course.regulationIds?.map(String) ?? [],
      is_recommended: Boolean(course.isRecommended),
      sort_order: course.sortOrder,
      missing_required_lesson_ids: missingRequiredLessonIds,
      published_at: course.publishedAt,
      created_at: course.createdAt,
      updated_at: course.updatedAt,
    };
  }

  private async canReadCourse(actorId: string, courseId: string, assignedOnly = false): Promise<boolean> {
    try {
      const permissions = await this.access.permissions(actorId);
      if (permissions.includes('courses:read')) return true;
      const [user, course] = await Promise.all([
        this.learner(actorId),
        this.courseRepo.findOne({ where: { id: String(courseId) } }),
      ]);
      return Boolean(course && (assignedOnly ? this.isVisibleTo(user, course) : this.canBrowse(user, course)));
    } catch {
      return false;
    }
  }

  private async canReadLessonVersion(actorId: string, versionId: string, assetId?: string): Promise<boolean> {
    try {
      const version = await this.versionRepo.findOne({ where: { id: String(versionId) } });
      if (!version || (assetId && String(version.assetId) !== String(assetId))) return false;
      const user = await this.learner(actorId);
      if (!user || Number(user.status) !== 1) return false;
      if ((await this.access.permissions(actorId, { useCache: false })).includes('courses:read')) {
        const lesson = await this.lessonRepo.findOne({ where: { id: String(version.lessonId) } });
        return Boolean(lesson && await this.courseRepo.findOne({ where: { id: String(lesson.courseId) } }));
      }
      return await this.canReadLearnerVideo(actorId, versionId, assetId);
    } catch {
      return false;
    }
  }

  private async canReadLearnerVideo(actorId: string, versionId: string, assetId?: string): Promise<boolean> {
    const user = await this.learner(actorId);
    if (!user || Number(user.status) !== 1 || user.role !== 'employee'
      || (await this.access.permissions(actorId, { useCache: false })).length > 0) return false;
    if (!await this.dataSource.getRepository(LearnerIdentity).findOne({ where: { userId: actorId } })) {
      const latest = await this.dataSource.getRepository(IdentityVerificationSession).findOne({
        where: { userId: actorId }, order: { createdAt: 'DESC' },
      });
      const pending = latest && !['verified', 'rejected', 'expired'].includes(latest.status)
        && latest.expiresAt.getTime() > Date.now();
      throw Errors.dataForbidden('请先完成实名认证', { reason_code: pending ? 'IDENTITY_PENDING' : 'IDENTITY_REQUIRED' });
    }
    const version = await this.versionRepo.findOne({ where: { id: String(versionId) } });
    if (!version || Number(version.durationMs) <= 0 || (assetId && String(version.assetId) !== String(assetId))) return false;
    const lesson = await this.lessonRepo.findOne({ where: { id: String(version.lessonId) } });
    if (!lesson || lesson.lessonType !== 'video' || String(lesson.currentVersionId) !== String(version.id)) return false;
    const course = await this.courseRepo.findOne({ where: { id: String(lesson.courseId) } });
    return Boolean(course && this.canBrowse(user, course));
  }
}
