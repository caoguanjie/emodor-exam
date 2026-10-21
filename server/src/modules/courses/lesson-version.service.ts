import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { Errors } from '../../common/errors';
import { CourseChapter } from '../../entities/course-chapter.entity';
import { CourseLesson } from '../../entities/course-lesson.entity';
import { LessonVersion } from '../../entities/lesson-version.entity';
import { MediaAsset } from '../../entities/media-asset.entity';
import { TrainingCourse } from '../../entities/training-course.entity';
import { MediaService } from '../media/media.service';
import type { CourseActor } from './course.service';

export interface ChapterInput {
  title: string;
  sort_order?: number;
}

export interface LessonInput {
  chapter_id: string;
  title: string;
  lesson_type: 'video';
  required?: boolean;
  sort_order?: number;
  asset_id?: string | null;
}

export interface LessonPatch {
  title?: string;
  lesson_type?: 'video';
  required?: boolean;
  sort_order?: number;
}

@Injectable()
export class LessonVersionService {
  constructor(
    @InjectRepository(TrainingCourse) private readonly courseRepo: Repository<TrainingCourse>,
    @InjectRepository(CourseChapter) private readonly chapterRepo: Repository<CourseChapter>,
    @InjectRepository(CourseLesson) private readonly lessonRepo: Repository<CourseLesson>,
    @InjectRepository(LessonVersion) private readonly versionRepo: Repository<LessonVersion>,
    private readonly dataSource: DataSource,
    private readonly media: MediaService,
    private readonly audit: AuditService,
  ) {}

  private title(value: string, label: string): string {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 255) throw Errors.param(`${label}必填且不超过 255 个字符`);
    return normalized;
  }

  private assertVideo(value: unknown): asserts value is 'video' {
    if (value !== 'video') throw Errors.param('lesson_type 当前仅支持 video');
  }

  private assertStructureEditable(course: TrainingCourse): void {
    if (course.status === 'published') throw Errors.courseConflict('已上架课程请先下架后再修改章节或课时结构');
  }

  async createChapter(courseId: string, input: ChapterInput, actor: CourseActor, ip: string | null) {
    const chapter = await this.dataSource.transaction(async (manager) => {
      const course = await manager.getRepository(TrainingCourse).findOne({ where: { id: String(courseId) }, lock: { mode: 'pessimistic_write' } });
      if (!course) throw Errors.notFound('课程不存在');
      this.assertStructureEditable(course);
      const repo = manager.getRepository(CourseChapter);
      return repo.save(repo.create({ courseId: String(courseId), title: this.title(input.title, '章节标题'), sortOrder: input.sort_order ?? 0 }));
    });
    this.audit.log({ actor_id: Number(actor.id), actor_name: actor.name, action: 'course.chapter.create', object_type: 'course_chapter', object_id: chapter.id, detail: { course_id: courseId }, result: 'success', source_ip: ip });
    return { id: String(chapter.id), course_id: String(chapter.courseId), title: chapter.title, sort_order: chapter.sortOrder };
  }

  async updateChapter(courseId: string, chapterId: string, input: Partial<ChapterInput>, actor: CourseActor, ip: string | null) {
    const chapter = await this.dataSource.transaction(async (manager) => {
      const course = await manager.getRepository(TrainingCourse).findOne({ where: { id: String(courseId) }, lock: { mode: 'pessimistic_write' } });
      if (!course) throw Errors.notFound('课程不存在');
      this.assertStructureEditable(course);
      const repo = manager.getRepository(CourseChapter);
      const row = await repo.findOne({ where: { id: String(chapterId), courseId: String(courseId) }, lock: { mode: 'pessimistic_write' } });
      if (!row) throw Errors.notFound('章节不存在');
      if (input.title !== undefined) row.title = this.title(input.title, '章节标题');
      if (input.sort_order !== undefined) row.sortOrder = input.sort_order;
      return repo.save(row);
    });
    this.audit.log({ actor_id: Number(actor.id), actor_name: actor.name, action: 'course.chapter.update', object_type: 'course_chapter', object_id: chapter.id, detail: { course_id: courseId }, result: 'success', source_ip: ip });
    return { id: String(chapter.id), course_id: String(chapter.courseId), title: chapter.title, sort_order: chapter.sortOrder };
  }

  async createLesson(courseId: string, input: LessonInput, actor: CourseActor, ip: string | null) {
    this.assertVideo(input.lesson_type);
    if (input.asset_id) await this.media.assertUsable(actor.id, input.asset_id, 'video');
    const lesson = await this.dataSource.transaction(async (manager) => {
      const course = await manager.getRepository(TrainingCourse).findOne({ where: { id: String(courseId) }, lock: { mode: 'pessimistic_write' } });
      if (!course) throw Errors.notFound('课程不存在');
      this.assertStructureEditable(course);
      const chapter = await manager.getRepository(CourseChapter).findOne({ where: { id: String(input.chapter_id), courseId: String(courseId) } });
      if (!chapter) throw Errors.notFound('章节不存在或不属于当前课程');
      const repo = manager.getRepository(CourseLesson);
      const row = await repo.save(repo.create({
        courseId: String(courseId),
        chapterId: String(input.chapter_id),
        title: this.title(input.title, '课时标题'),
        lessonType: 'video',
        required: input.required === false ? 0 : 1,
        sortOrder: input.sort_order ?? 0,
        currentVersionId: null,
      }));
      if (input.asset_id) await this.appendVersion(manager, row, input.asset_id, actor.id);
      return row;
    });
    this.audit.log({ actor_id: Number(actor.id), actor_name: actor.name, action: 'course.lesson.create', object_type: 'course_lesson', object_id: lesson.id, detail: { course_id: courseId }, result: 'success', source_ip: ip });
    return this.lessonView(lesson);
  }

  async updateLesson(courseId: string, lessonId: string, input: LessonPatch, actor: CourseActor, ip: string | null) {
    if (input.lesson_type !== undefined) this.assertVideo(input.lesson_type);
    const lesson = await this.dataSource.transaction(async (manager) => {
      const course = await manager.getRepository(TrainingCourse).findOne({ where: { id: String(courseId) }, lock: { mode: 'pessimistic_write' } });
      if (!course) throw Errors.notFound('课程不存在');
      this.assertStructureEditable(course);
      const repo = manager.getRepository(CourseLesson);
      const row = await repo.findOne({ where: { id: String(lessonId), courseId: String(courseId) }, lock: { mode: 'pessimistic_write' } });
      if (!row) throw Errors.notFound('课时不存在');
      if (input.title !== undefined) row.title = this.title(input.title, '课时标题');
      if (input.required !== undefined) row.required = input.required ? 1 : 0;
      if (input.sort_order !== undefined) row.sortOrder = input.sort_order;
      return repo.save(row);
    });
    this.audit.log({ actor_id: Number(actor.id), actor_name: actor.name, action: 'course.lesson.update', object_type: 'course_lesson', object_id: lesson.id, detail: { course_id: courseId }, result: 'success', source_ip: ip });
    return this.lessonView(lesson);
  }

  async replaceVideo(courseId: string, lessonId: string, assetId: string, actor: CourseActor, ip: string | null) {
    await this.media.assertUsable(actor.id, assetId, 'video');
    const version = await this.dataSource.transaction(async (manager) => {
      const course = await manager.getRepository(TrainingCourse).findOne({ where: { id: String(courseId) }, lock: { mode: 'pessimistic_write' } });
      if (!course) throw Errors.notFound('课程不存在');
      const lessonRepo = manager.getRepository(CourseLesson);
      const lesson = await lessonRepo.findOne({ where: { id: String(lessonId), courseId: String(courseId) }, lock: { mode: 'pessimistic_write' } });
      if (!lesson) throw Errors.notFound('课时不存在');
      this.assertVideo(lesson.lessonType);
      return this.appendVersion(manager, lesson, assetId, actor.id);
    });
    this.audit.log({ actor_id: Number(actor.id), actor_name: actor.name, action: 'course.lesson.video.replace', object_type: 'lesson_version', object_id: version.version_id, detail: { course_id: courseId, lesson_id: lessonId }, result: 'success', source_ip: ip });
    return version;
  }

  private async appendVersion(manager: EntityManager, lesson: CourseLesson, assetId: string, actorId: string) {
    const asset = await manager.getRepository(MediaAsset).findOne({ where: { id: String(assetId) } });
    if (!asset || asset.status !== 'ready' || asset.purpose !== 'video' || asset.mediaKind !== 'video' || asset.durationMs === null || Number(asset.durationMs) <= 0) {
      throw Errors.courseConflict('视频资源未就绪或缺少有效时长');
    }
    const versionRepo = manager.getRepository(LessonVersion);
    const latest = await versionRepo.findOne({ where: { lessonId: String(lesson.id) }, order: { versionNo: 'DESC' } });
    const saved = await versionRepo.save(versionRepo.create({
      lessonId: String(lesson.id),
      versionNo: Number(latest?.versionNo || 0) + 1,
      assetId: String(assetId),
      durationMs: String(asset.durationMs),
      createdBy: String(actorId),
    }));
    await this.media.bind(manager, String(assetId), 'lesson_version_video', String(saved.id));
    lesson.currentVersionId = String(saved.id);
    await manager.getRepository(CourseLesson).save(lesson);
    return { version_id: String(saved.id), asset_id: String(saved.assetId), duration_ms: Number(saved.durationMs), version_no: saved.versionNo };
  }

  async current(lessonId: string): Promise<{ versionId: string; assetId: string; durationMs: number }> {
    const lesson = await this.lessonRepo.findOne({ where: { id: String(lessonId) } });
    if (!lesson || !lesson.currentVersionId) throw Errors.notFound('课时当前版本不存在');
    const version = await this.versionRepo.findOne({ where: { id: String(lesson.currentVersionId), lessonId: String(lessonId) } });
    if (!version) throw Errors.notFound('课时当前版本不存在');
    return { versionId: String(version.id), assetId: String(version.assetId), durationMs: Number(version.durationMs) };
  }

  private lessonView(lesson: CourseLesson) {
    return {
      id: String(lesson.id),
      course_id: String(lesson.courseId),
      chapter_id: String(lesson.chapterId),
      title: lesson.title,
      lesson_type: lesson.lessonType,
      required: Boolean(lesson.required),
      sort_order: lesson.sortOrder,
      current_version_id: lesson.currentVersionId ? String(lesson.currentVersionId) : null,
    };
  }
}
