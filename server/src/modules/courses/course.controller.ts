import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors, RoleEnum } from '../../common/errors';
import { Roles } from '../../common/guards/roles.guard';
import { CategoryService } from '../training/category.service';
import { SystemService } from '../system/system.service';
import {
  CategoryOptionsQueryDto, CHAPTER_KEYS, COURSE_KEYS, CourseListQueryDto, CreateChapterDto, CreateCourseDto,
  CreateLessonDto, LESSON_CREATE_KEYS, LESSON_UPDATE_KEYS, ReplaceVideoDto, UpdateChapterDto, UpdateCourseDto, UpdateLessonDto,
} from './course.dto';
import { CourseService } from './course.service';
import { LessonVersionService } from './lesson-version.service';

function assertKeys(value: unknown, allowed: readonly string[], label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Errors.param(`${label}必须是对象`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw Errors.param(`${label}包含不支持的字段：${unknown.join(',')}`);
}

function id(value: string, label: string): string {
  const normalized = String(value);
  if (!/^[1-9]\d*$/.test(normalized)) throw Errors.param(`${label}必须是字符串 ID`);
  return normalized;
}

@Controller('admin/courses')
@Roles(RoleEnum.SUPER_ADMIN)
export class CourseAdminController {
  constructor(
    private readonly courses: CourseService,
    private readonly lessons: LessonVersionService,
    private readonly categories: CategoryService,
  ) {}

  private actor(user: AuthUser) {
    return { id: String(user.id), name: user.username };
  }

  @Get('category-options')
  @Permissions('courses:write')
  async categoryOptions(
    @Query(new StrictDtoValidationPipe(['page', 'page_size', 'keyword'])) query: CategoryOptionsQueryDto,
    @Req() req: Request,
  ) {
    assertKeys(req.query, ['page', 'page_size', 'keyword'], '类别选项查询');
    const page = await this.categories.list({ ...query, status: 1 });
    return { ...page, items: page.items.map((item) => ({ id: String(item.id), name: item.name })) };
  }

  @Get()
  @Permissions('courses:read')
  list(
    @Query(new StrictDtoValidationPipe(['page', 'page_size', 'keyword', 'category_id', 'status'])) query: CourseListQueryDto,
    @Req() req: Request,
  ) {
    assertKeys(req.query, ['page', 'page_size', 'keyword', 'category_id', 'status'], '课程查询');
    return this.courses.list(query);
  }

  @Post()
  @Permissions('courses:write')
  create(
    @Body(new StrictDtoValidationPipe(COURSE_KEYS)) dto: CreateCourseDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertKeys(req.body, COURSE_KEYS, '课程请求');
    return this.courses.create(dto, this.actor(user), req.ip || null);
  }

  @Get(':id')
  @Permissions('courses:read')
  detail(@Param('id') courseId: string) {
    return this.courses.adminDetail(id(courseId, 'course_id'));
  }

  @Put(':id')
  @Permissions('courses:write')
  update(
    @Param('id') courseId: string,
    @Body(new StrictDtoValidationPipe(COURSE_KEYS)) dto: UpdateCourseDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertKeys(req.body, COURSE_KEYS, '课程请求');
    return this.courses.update(id(courseId, 'course_id'), dto, this.actor(user), req.ip || null);
  }

  @Post(':id/publish')
  @Permissions('courses:publish')
  publish(@Param('id') courseId: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.courses.publish(id(courseId, 'course_id'), this.actor(user), req.ip || null);
  }

  @Post(':id/offline')
  @Permissions('courses:publish')
  offline(@Param('id') courseId: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.courses.offline(id(courseId, 'course_id'), this.actor(user), req.ip || null);
  }

  @Get(':id/chapters')
  @Permissions('courses:read')
  async chapters(@Param('id') courseId: string) {
    const detail = await this.courses.adminDetail(id(courseId, 'course_id'));
    return detail.chapters;
  }

  @Post(':id/chapters')
  @Permissions('courses:write')
  createChapter(
    @Param('id') courseId: string,
    @Body(new StrictDtoValidationPipe(CHAPTER_KEYS)) dto: CreateChapterDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertKeys(req.body, CHAPTER_KEYS, '章节请求');
    return this.lessons.createChapter(id(courseId, 'course_id'), dto, this.actor(user), req.ip || null);
  }

  @Put(':id/chapters/:chapterId')
  @Permissions('courses:write')
  updateChapter(
    @Param('id') courseId: string,
    @Param('chapterId') chapterId: string,
    @Body(new StrictDtoValidationPipe(CHAPTER_KEYS)) dto: UpdateChapterDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertKeys(req.body, CHAPTER_KEYS, '章节请求');
    return this.lessons.updateChapter(id(courseId, 'course_id'), id(chapterId, 'chapter_id'), dto, this.actor(user), req.ip || null);
  }

  @Get(':id/lessons')
  @Permissions('courses:read')
  async courseLessons(@Param('id') courseId: string) {
    const detail = await this.courses.adminDetail(id(courseId, 'course_id'));
    return detail.chapters.flatMap((chapter) => chapter.lessons);
  }

  @Post(':id/lessons')
  @Permissions('courses:write')
  createLesson(
    @Param('id') courseId: string,
    @Body(new StrictDtoValidationPipe(LESSON_CREATE_KEYS)) dto: CreateLessonDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertKeys(req.body, LESSON_CREATE_KEYS, '课时请求');
    return this.lessons.createLesson(id(courseId, 'course_id'), dto, this.actor(user), req.ip || null);
  }

  @Put(':id/lessons/:lessonId')
  @Permissions('courses:write')
  updateLesson(
    @Param('id') courseId: string,
    @Param('lessonId') lessonId: string,
    @Body(new StrictDtoValidationPipe(LESSON_UPDATE_KEYS)) dto: UpdateLessonDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertKeys(req.body, LESSON_UPDATE_KEYS, '课时请求');
    return this.lessons.updateLesson(id(courseId, 'course_id'), id(lessonId, 'lesson_id'), dto, this.actor(user), req.ip || null);
  }

  @Post(':id/lessons/:lessonId/versions')
  @Permissions('courses:write')
  replaceVideo(
    @Param('id') courseId: string,
    @Param('lessonId') lessonId: string,
    @Body(new StrictDtoValidationPipe(['asset_id'])) dto: ReplaceVideoDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertKeys(req.body, ['asset_id'], '视频版本请求');
    return this.lessons.replaceVideo(id(courseId, 'course_id'), id(lessonId, 'lesson_id'), dto.asset_id, this.actor(user), req.ip || null);
  }
}

@Controller('me')
export class LearnerHomeController {
  constructor(
    private readonly courses: CourseService,
    private readonly system: SystemService,
  ) {}

  @Get('home')
  async home(
    @Query(new StrictDtoValidationPipe(['page', 'page_size'])) query: CourseListQueryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertKeys(req.query, ['page', 'page_size'], '首页课程查询');
    const [siteConfig, courses] = await Promise.all([
      this.system.publicConfig(),
      this.courses.visibleCourses(String(user.id), query.page ?? 1, query.page_size ?? 20),
    ]);
    return { site_config: siteConfig, courses };
  }
}

@Controller('me/courses')
export class MyCoursesController {
  constructor(private readonly courses: CourseService) {}

  @Get()
  list(
    @Query(new StrictDtoValidationPipe(['page', 'page_size'])) query: CourseListQueryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertKeys(req.query, ['page', 'page_size'], '课程查询');
    return this.courses.visibleCourses(String(user.id), query.page, query.page_size);
  }

  @Get(':id')
  detail(@Param('id') courseId: string, @CurrentUser() user: AuthUser) {
    return this.courses.learnerDetail(String(user.id), id(courseId, 'course_id'));
  }
}
