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
import { RedisService } from './common/redis.service';
import { AuditService } from './common/audit.service';

// 业务表实体 + 迁移注册表（schema_migrations 是运维元数据，不计入业务表清单）
import { SysDepartment } from './entities/sys-department.entity';
import { SysUser } from './entities/sys-user.entity';
import { Regulation } from './entities/regulation.entity';
import { RegulationVersion } from './entities/regulation-version.entity';
import { RegulationScope } from './entities/regulation-scope.entity';
import { LearningSession } from './entities/learning-session.entity';
import { LearningRecord } from './entities/learning-record.entity';
import { Question } from './entities/question.entity';
import { ExamPaper } from './entities/exam-paper.entity';
import { PaperQuestion } from './entities/paper-question.entity';
import { ExamRecord } from './entities/exam-record.entity';
import { ExamAnswer } from './entities/exam-answer.entity';
import { SchemaMigration } from './entities/schema-migration.entity';

import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { DepartmentsController } from './modules/departments/departments.controller';
import { DepartmentService } from './modules/departments/department.service';
import { UsersController } from './modules/users/users.controller';
import { UsersService } from './modules/users/users.service';
import { UserImportService } from './modules/users/user-import.service';
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
import { ShuffleService } from './modules/exams/shuffle.service';
import { GradingService } from './modules/exams/grading.service';
import { StatisticsController } from './modules/statistics/statistics.controller';
import { StatisticsService } from './modules/statistics/statistics.service';
import { HealthController } from './modules/health/health.controller';
import { TasksService } from './tasks.service';

const config = loadConfig();

/** EmodorRuleExam 应用：NestJS 模块化单体（AD-02），六大业务模块 + 横切能力 */
@Module({
  imports: [
    TypeOrmModule.forRoot(config.db),
    TypeOrmModule.forFeature([
      SysDepartment, SysUser, Regulation, RegulationVersion, RegulationScope,
      LearningSession, LearningRecord, Question, ExamPaper, PaperQuestion, ExamRecord, ExamAnswer, SchemaMigration,
    ]),
    JwtModule.register({ secret: config.jwt.secret, signOptions: { expiresIn: config.jwt.expiresIn } }),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    AuthController, DepartmentsController, UsersController,
    RegulationsController, AiController, LearningController, ExamsController,
    StatisticsController, HealthController,
  ],
  providers: [
    // 全局配置单例（loadConfig 启动时读取环境变量）
    { provide: AppConfig, useValue: config },
    AuthService, DepartmentService, UsersService, UserImportService,
    RegulationService, RegulationVersionService, RegulationScopeService, ParsePipelineService, ContentService,
    AiConfigService, AiGatewayService, PdfVisionService, QuestionGenerationService, QuestionReviewService, PaperService,
    LearningSessionService, ExamService, ShuffleService, GradingService, StatisticsService,
    RedisService, AuditService, TasksService,
    // 守卫链（07 册 2.3.2）：① JWT 认证 → ② RBAC 角色（全局顺序注册）
    { provide: APP_GUARD, useClass: JwtAuthGuard },
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
