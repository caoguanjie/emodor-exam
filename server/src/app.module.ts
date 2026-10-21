import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';

import { loadConfig, AppConfig } from './config/configuration';
import { ResponseInterceptor } from './common/response.interceptor';
import { GlobalExceptionFilter } from './common/http-exception.filter';
import { DtoValidationPipe } from './common/dto-validation.pipe';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RedisService } from './common/redis.service';
import { AuditService } from './common/audit.service';
import { SysRole } from './entities/sys-role.entity';
import { SysPermission } from './entities/sys-permission.entity';
import { SysRolePermission } from './entities/sys-role-permission.entity';
import { SysUserRole } from './entities/sys-user-role.entity';
import { AuthSession } from './entities/auth-session.entity';

// 业务表实体 + 迁移注册表（schema_migration 是运维元数据，不计入业务表清单）
import { SysDepartment } from './entities/sys-department.entity';
import { SysUser } from './entities/sys-user.entity';
import { TrainingCategory } from './entities/training-category.entity';
import { ImportBatch } from './entities/import-batch.entity';
import { Regulation } from './entities/regulation.entity';
import { RegulationVersion } from './entities/regulation-version.entity';
import { RegulationScope } from './entities/regulation-scope.entity';
import { LearningSession } from './entities/learning-session.entity';
import { LearningRecord } from './entities/learning-record.entity';
import { Question } from './entities/question.entity';
import { ExamPaper } from './entities/exam-paper.entity';
import { PaperQuestion } from './entities/paper-question.entity';
import { PaperRelease } from './entities/paper-release.entity';
import { PaperReleaseQuestion } from './entities/paper-release-question.entity';
import { ExamRecord } from './entities/exam-record.entity';
import { ExamAssignment } from './entities/exam-assignment.entity';
import { ExamRecordQuestion } from './entities/exam-record-question.entity';
import { ExamAnswer } from './entities/exam-answer.entity';
import { ExamReviewEvent } from './entities/exam-review-event.entity';
import { SchemaMigration } from './entities/schema-migration.entity';
import { MediaAsset } from './entities/media-asset.entity';
import { MediaReference } from './entities/media-reference.entity';
import { TrainingCourse } from './entities/training-course.entity';
import { CourseChapter } from './entities/course-chapter.entity';
import { CourseLesson } from './entities/course-lesson.entity';
import { LessonVersion } from './entities/lesson-version.entity';
import { VideoLearningRecord } from './entities/video-learning-record.entity';
import { VideoLearningSession } from './entities/video-learning-session.entity';
import { QuestionConcept } from './entities/question-concept.entity';
import { QuestionVersion } from './entities/question-version.entity';
import { SysMenu } from './entities/sys-menu.entity';
import { SysDictionary } from './entities/sys-dictionary.entity';
import { SiteSetting } from './entities/site-setting.entity';

import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { CaptchaService } from './modules/auth/captcha.service';
import { SessionService } from './modules/auth/session.service';
import { AccessController } from './modules/access/access.controller';
import { AccessService } from './modules/access/access.service';
import { DepartmentsController } from './modules/departments/departments.controller';
import { DepartmentService } from './modules/departments/department.service';
import { MeProfileController, StudentsController, UsersController } from './modules/users/users.controller';
import { UsersService } from './modules/users/users.service';
import { UserImportService } from './modules/users/user-import.service';
import { CategoryController } from './modules/training/category.controller';
import { CategoryService } from './modules/training/category.service';
import { ImportBatchService } from './modules/imports/import-batch.service';
import { RegulationsController } from './modules/regulations/regulations.controller';
import { RegulationService } from './modules/regulations/regulation.service';
import { RegulationVersionService } from './modules/regulations/regulation-version.service';
import { RegulationScopeService } from './modules/regulations/regulation-scope.service';
import { ParsePipelineService } from './modules/regulations/parse-pipeline.service';
import { ContentService } from './modules/regulations/content.service';
import { AiController } from './modules/ai/ai.controller';
import { AiConfigService } from './modules/ai/ai-config.service';
import { AiGatewayService } from './modules/ai/ai-gateway.service';
import { PdfVisionService } from './modules/ai/pdf-vision.service';
import { QuestionGenerationService } from './modules/ai/question-generation.service';
import { QuestionReviewService } from './modules/ai/question-review.service';
import { PaperService } from './modules/ai/paper.service';
import { LearningController } from './modules/learning/learning.controller';
import { LearningSessionService } from './modules/learning/learning-session.service';
import { ExamsController } from './modules/exams/exams.controller';
import { ExamService } from './modules/exams/exam.service';
import { AttemptService } from './modules/exams/attempt.service';
import { AttemptReaderService } from './modules/exams/attempt-reader.service';
import { LegacyExamAdapter } from './modules/exams/legacy-exam-adapter';
import { TrainingExamsController } from './modules/exams/training-exams.controller';
import { AnswerMediaController } from './modules/exams/answer-media.controller';
import { AnswerDraftService } from './modules/exams/answer-draft.service';
import { SubmissionService } from './modules/exams/submission.service';
import { ExamHistoryService } from './modules/exams/exam-history.service';
import { ManualGradingService } from './modules/exams/manual-grading.service';
import { GradingAdminController } from './modules/exams/grading-admin.controller';
import { ShuffleService } from './modules/exams/shuffle.service';
import { GradingService } from './modules/exams/grading.service';
import { PaperAdminController } from './modules/exams/paper-admin.controller';
import { PaperReleaseService } from './modules/exams/paper-release.service';
import { SamplingService } from './modules/exams/sampling.service';
import { StatisticsController } from './modules/statistics/statistics.controller';
import { StatisticsService } from './modules/statistics/statistics.service';
import { HealthController } from './modules/health/health.controller';
import { TasksService } from './tasks.service';
import { MediaController } from './modules/media/media.controller';
import { MediaService } from './modules/media/media.service';
import { MediaProbeService } from './modules/media/media-probe.service';
import { CourseAdminController, LearnerHomeController, MyCoursesController } from './modules/courses/course.controller';
import { CourseService } from './modules/courses/course.service';
import { LessonVersionService } from './modules/courses/lesson-version.service';
import { VideoLearningController } from './modules/video-learning/video-learning.controller';
import { VideoSessionService } from './modules/video-learning/video-session.service';
import { QuestionConceptService } from './modules/questions/question-concept.service';
import { QuestionVersionService } from './modules/questions/question-version.service';
import { QuestionImportController } from './modules/questions/question-import.controller';
import { QuestionImportService } from './modules/questions/question-import.service';
import { SiteConfigController, SystemController } from './modules/system/system.controller';
import { SystemService } from './modules/system/system.service';
import { AuditQueryService } from './modules/system/audit-query.service';

const config = loadConfig();

/** EmodorRuleExam 应用：NestJS 模块化单体（AD-02），六大业务模块 + 横切能力 */
@Module({
  imports: [
    TypeOrmModule.forRoot(config.db),
    TypeOrmModule.forFeature([
      SysDepartment, SysUser, Regulation, RegulationVersion, RegulationScope,
      LearningSession, LearningRecord, Question, ExamPaper, PaperQuestion, PaperRelease, PaperReleaseQuestion,
      ExamAssignment, ExamRecord, ExamRecordQuestion, ExamAnswer, ExamReviewEvent, SchemaMigration,
      TrainingCategory, ImportBatch,
      SysRole, SysPermission, SysRolePermission, SysUserRole, AuthSession,
      MediaAsset, MediaReference,
      TrainingCourse, CourseChapter, CourseLesson, LessonVersion,
      VideoLearningRecord, VideoLearningSession,
      QuestionConcept, QuestionVersion,
      SysMenu, SysDictionary, SiteSetting,
    ]),
    JwtModule.register({ secret: config.jwt.secret, signOptions: { expiresIn: config.jwt.expiresIn } }),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    AuthController, AccessController, DepartmentsController, UsersController, StudentsController, MeProfileController, CategoryController,
    RegulationsController, AiController, LearningController, ExamsController, TrainingExamsController, AnswerMediaController, PaperAdminController, GradingAdminController,
    StatisticsController, HealthController,
    MediaController,
    CourseAdminController, LearnerHomeController, MyCoursesController,
    VideoLearningController, QuestionImportController,
    SystemController, SiteConfigController,
  ],
  providers: [
    // 全局配置单例（loadConfig 启动时读取环境变量）
    { provide: AppConfig, useValue: config },
    AuthService, CaptchaService, SessionService, AccessService, DepartmentService, UsersService, UserImportService, CategoryService, ImportBatchService,
    RegulationService, RegulationVersionService, RegulationScopeService, ParsePipelineService, ContentService,
    AiConfigService, AiGatewayService, PdfVisionService, QuestionGenerationService, QuestionReviewService, PaperService,
    LearningSessionService, ExamService, AttemptService, AttemptReaderService, LegacyExamAdapter, AnswerDraftService, SubmissionService,
    ExamHistoryService, ManualGradingService,
    ShuffleService, GradingService, PaperReleaseService, SamplingService, StatisticsService,
    RedisService, AuditService, TasksService,
    MediaService, MediaProbeService,
    CourseService, LessonVersionService,
    VideoSessionService,
    QuestionConceptService, QuestionVersionService, QuestionImportService,
    SystemService, AuditQueryService,
    // 守卫链（07 册 2.3.2）：① JWT 认证 → ② 细权限映射 → ③ 兼容角色边界
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // 统一响应信封 { code, message, data }（README 3.4）
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    // DTO 校验（class-validator 白名单 → 40001）
    { provide: APP_PIPE, useValue: new DtoValidationPipe() },
    // 全局异常过滤器（40xxx / 50xxx 映射）
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    Reflector,
  ],
})
export class AppModule {}
