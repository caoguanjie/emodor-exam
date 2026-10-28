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
import { SchemaMigration } from './entities/schema-migration.entity';
import { MediaAsset } from './entities/media-asset.entity';
import { MediaUploadSession } from './entities/media-upload-session.entity';
import { MediaReference } from './entities/media-reference.entity';
import { TrainingCourse } from './entities/training-course.entity';
import { CourseChapter } from './entities/course-chapter.entity';
import { CourseLesson } from './entities/course-lesson.entity';
import { LessonVersion } from './entities/lesson-version.entity';
import { VideoLearningRecord } from './entities/video-learning-record.entity';
import { VideoLearningSession } from './entities/video-learning-session.entity';
import { QuestionConcept } from './entities/question-concept.entity';
import { QuestionVersion } from './entities/question-version.entity';
import { QuestionAuthoringCommit } from './entities/question-authoring-commit.entity';
import { SysMenu } from './entities/sys-menu.entity';
import { SysDictionary } from './entities/sys-dictionary.entity';
import { SysDictionaryType } from './entities/sys-dictionary-type.entity';
import { SiteSetting } from './entities/site-setting.entity';
import { LearnerIdentity } from './entities/learner-identity.entity';
import { IdentityVerificationSession } from './entities/identity-verification-session.entity';

import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { CaptchaService } from './modules/auth/captcha.service';
import { SessionService } from './modules/auth/session.service';
import { SessionIssuerService } from './modules/auth/session-issuer.service';
import { MobileAuthController } from './modules/auth/mobile-auth.controller';
import { DebugMobileAuthController } from './modules/auth/debug-mobile-auth.controller';
import { MobileAuthService } from './modules/auth/mobile-auth.service';
import { SmsChallengeService } from './modules/auth/sms-challenge.service';
import { SMS_PROVIDER, YunxinSmsProvider } from './modules/auth/sms-provider';
import { AccessController } from './modules/access/access.controller';
import { AccessService } from './modules/access/access.service';
import { DepartmentService } from './modules/departments/department.service';
import { MeProfileController, StudentsController } from './modules/users/users.controller';
import { UsersService } from './modules/users/users.service';
import { CategoryController } from './modules/training/category.controller';
import { CategoryService } from './modules/training/category.service';
import { ImportBatchService } from './modules/imports/import-batch.service';
import { RegulationContentController } from './modules/regulations/regulation-content.controller';
import { RegulationVersionService } from './modules/regulations/regulation-version.service';
import { RegulationScopeService } from './modules/regulations/regulation-scope.service';
import { ParsePipelineService } from './modules/regulations/parse-pipeline.service';
import { ContentService } from './modules/regulations/content.service';
import { AiController } from './modules/ai/ai.controller';
import { AiConfigService } from './modules/ai/ai-config.service';
import { AiGatewayService } from './modules/ai/ai-gateway.service';
import { PdfVisionService } from './modules/ai/pdf-vision.service';
import { QuestionGenerationService } from './modules/ai/question-generation.service';
import { QuestionBankService } from './modules/questions/question-bank.service';
import { PaperService } from './modules/ai/paper.service';
import { QuestionMaterialsController } from './modules/question-materials/question-materials.controller';
import { QuestionMaterialsService } from './modules/question-materials/question-materials.service';
import { LearningController } from './modules/learning/learning.controller';
import { LearningSessionService } from './modules/learning/learning-session.service';
import { ExamsController } from './modules/exams/exams.controller';
import { ExamService } from './modules/exams/exam.service';
import { AttemptService } from './modules/exams/attempt.service';
import { AttemptReaderService } from './modules/exams/attempt-reader.service';
import { LegacyExamAdapter } from './modules/exams/legacy-exam-adapter';
import { TrainingExamsController } from './modules/exams/training-exams.controller';
import { AnswerDraftService } from './modules/exams/answer-draft.service';
import { SubmissionService } from './modules/exams/submission.service';
import { ExamAdminController } from './modules/exams/exam-admin.controller';
import { ExamRecordsService } from './modules/exams/exam-records.service';
import { ExamHistoryService } from './modules/exams/exam-history.service';
import { ShuffleService } from './modules/exams/shuffle.service';
import { GradingService } from './modules/exams/grading.service';
import { PaperAdminController } from './modules/exams/paper-admin.controller';
import { PaperReleaseService } from './modules/exams/paper-release.service';
import { SamplingService } from './modules/exams/sampling.service';
import { StatisticsController } from './modules/statistics/statistics.controller';
import { StatisticsService } from './modules/statistics/statistics.service';
import { AdminDashboardController, TrainingStatisticsController } from './modules/statistics/training-statistics.controller';
import { TrainingStatisticsService } from './modules/statistics/training-statistics.service';
import { AdminDashboardService } from './modules/statistics/admin-dashboard.service';
import { HealthController } from './modules/health/health.controller';
import { TasksService } from './tasks.service';
import { MediaController } from './modules/media/media.controller';
import { MediaService } from './modules/media/media.service';
import { MediaProbeService } from './modules/media/media-probe.service';
import { MediaPublisher } from './modules/media/media-publisher.service';
import { MediaStorageRouter } from './modules/media/storage/media-storage.router';
import { LocalMediaStorage } from './modules/media/storage/local-media-storage';
import { CosMediaStorage } from './modules/media/storage/cos-media-storage';
import { MediaUploadSessionController } from './modules/media/uploads/media-upload-session.controller';
import { MediaUploadSessionService } from './modules/media/uploads/media-upload-session.service';
import { MediaUploadGrantService } from './modules/media/uploads/media-upload-grant.service';
import { MediaUploadFinalizerService } from './modules/media/uploads/media-upload-finalizer.service';
import { MediaUploadCleanupService } from './modules/media/uploads/media-upload-cleanup.service';
import { CosDownloadUrlAdapter } from './modules/media/delivery/cos-download-url.adapter';
import { PcMediaTicketService } from './modules/media/delivery/pc-media-ticket.service';
import { MediaDeliveryService } from './modules/media/delivery/media-delivery.service';
import { MediaDeliveryController } from './modules/media/delivery/media-delivery.controller';
import { MediaTicketController } from './modules/media/media-ticket.controller';
import { MediaTicketService } from './modules/media/media-ticket.service';
import { IdentityController } from './modules/identity/identity.controller';
import { IdentityService } from './modules/identity/identity.service';
import { IdentityCrypto } from './modules/identity/identity-crypto';
import { IdentityImageService } from './modules/identity/identity-image.service';
import {
  DisabledIdentityProvider,
  IDENTITY_PROVIDER,
  TencentFaceIdAdapter,
  TencentIdentityProvider,
  TencentIdCardOcrAdapter,
} from './modules/identity/identity-provider';
import { CourseAdminController, LearnerHomeController, MyCoursesController } from './modules/courses/course.controller';
import { CourseService } from './modules/courses/course.service';
import { LessonVersionService } from './modules/courses/lesson-version.service';
import { VideoLearningController } from './modules/video-learning/video-learning.controller';
import { VideoSessionService } from './modules/video-learning/video-session.service';
import { QuestionVersionService } from './modules/questions/question-version.service';
import { QuestionAuthoringController } from './modules/questions/question-authoring.controller';
import { QuestionAuthoringService } from './modules/questions/question-authoring.service';
import { QuestionAuthoringOptionsController } from './modules/questions/question-authoring-options.controller';
import { QuestionImportController } from './modules/questions/question-import.controller';
import { QuestionImportService } from './modules/questions/question-import.service';
import { AiQuestionImportController } from './modules/questions/ai-question-import.controller';
import { AiQuestionImportService } from './modules/questions/ai-question-import.service';
import { SiteConfigController, SystemController } from './modules/system/system.controller';
import { SystemService } from './modules/system/system.service';
import { AuditQueryService } from './modules/system/audit-query.service';

const config = loadConfig();

/** emodor-training-platform 应用：NestJS 模块化单体（AD-02），六大业务模块 + 横切能力 */
@Module({
  imports: [
    TypeOrmModule.forRoot(config.db),
    TypeOrmModule.forFeature([
      SysDepartment, SysUser, Regulation, RegulationVersion, RegulationScope,
      LearningSession, LearningRecord, Question, ExamPaper, PaperQuestion, PaperRelease, PaperReleaseQuestion,
      ExamAssignment, ExamRecord, ExamRecordQuestion, ExamAnswer, SchemaMigration,
      TrainingCategory, ImportBatch,
      SysRole, SysPermission, SysRolePermission, SysUserRole, AuthSession,
      MediaAsset, MediaReference, MediaUploadSession,
      TrainingCourse, CourseChapter, CourseLesson, LessonVersion,
      VideoLearningRecord, VideoLearningSession,
      QuestionConcept, QuestionVersion, QuestionAuthoringCommit,
      SysMenu, SysDictionary, SysDictionaryType, SiteSetting,
      LearnerIdentity, IdentityVerificationSession,
    ]),
    JwtModule.register({ secret: config.jwt.secret, signOptions: { expiresIn: config.jwt.expiresIn } }),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    AuthController, MobileAuthController, DebugMobileAuthController, AccessController, StudentsController, MeProfileController, CategoryController,
    RegulationContentController, QuestionMaterialsController, AiController, LearningController, ExamsController, TrainingExamsController, PaperAdminController, ExamAdminController,
    StatisticsController, TrainingStatisticsController, AdminDashboardController, HealthController,
    MediaUploadSessionController, MediaDeliveryController, MediaController, MediaTicketController, IdentityController,
    CourseAdminController, LearnerHomeController, MyCoursesController,
    VideoLearningController, QuestionImportController, AiQuestionImportController, QuestionAuthoringController, QuestionAuthoringOptionsController,
    SystemController, SiteConfigController,
  ],
  providers: [
    // 全局配置单例（loadConfig 启动时读取环境变量）
    { provide: AppConfig, useValue: config },
    AuthService, CaptchaService, SessionService, SessionIssuerService, MobileAuthService, SmsChallengeService, YunxinSmsProvider,
    { provide: SMS_PROVIDER, useExisting: YunxinSmsProvider },
    AccessService, DepartmentService, UsersService, CategoryService, ImportBatchService,
    RegulationVersionService, RegulationScopeService, ParsePipelineService, ContentService, QuestionMaterialsService,
    AiConfigService, AiGatewayService, PdfVisionService, QuestionGenerationService, QuestionBankService, PaperService,
    LearningSessionService, ExamService, AttemptService, AttemptReaderService, LegacyExamAdapter, AnswerDraftService, SubmissionService,
    ExamHistoryService, ExamRecordsService,
    ShuffleService, GradingService, PaperReleaseService, SamplingService, StatisticsService, TrainingStatisticsService, AdminDashboardService,
    RedisService, AuditService, TasksService,
    MediaService, MediaProbeService, MediaTicketService, MediaPublisher,
    MediaUploadSessionService, MediaUploadGrantService, MediaUploadFinalizerService, MediaUploadCleanupService,
    {
      provide: CosDownloadUrlAdapter,
      useFactory: (appConfig: AppConfig) => new CosDownloadUrlAdapter(appConfig),
      inject: [AppConfig],
    },
    PcMediaTicketService, MediaDeliveryService,
    {
      provide: CosMediaStorage,
      useFactory: (appConfig: AppConfig) => appConfig.cosMedia.bucket && appConfig.cosMedia.region
        && appConfig.cosMedia.keyPrefix && appConfig.cosMedia.secretId && appConfig.cosMedia.secretKey
        ? new CosMediaStorage(appConfig.cosMedia) : null,
      inject: [AppConfig],
    },
    {
      provide: MediaStorageRouter,
      useFactory: (appConfig: AppConfig, cos: CosMediaStorage | null) => new MediaStorageRouter(
        appConfig.cosMedia,
        new LocalMediaStorage(appConfig.upload.dir),
        cos ?? undefined,
      ),
      inject: [AppConfig, CosMediaStorage],
    },
    IdentityService, IdentityCrypto, IdentityImageService,
    {
      provide: IDENTITY_PROVIDER,
      useFactory: (appConfig: AppConfig) => appConfig.identity.provider === 'tencent'
        ? new TencentIdentityProvider(
          new TencentIdCardOcrAdapter(appConfig.identity.idCardOcr),
          new TencentFaceIdAdapter(appConfig.identity.faceId),
        )
        : new DisabledIdentityProvider(),
      inject: [AppConfig],
    },
    CourseService, LessonVersionService,
    VideoSessionService,
    QuestionVersionService, QuestionAuthoringService, QuestionImportService, AiQuestionImportService,
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
