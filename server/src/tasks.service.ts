import { Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ParsePipelineService } from './modules/regulations/parse-pipeline.service';
import { LearningSessionService } from './modules/learning/learning-session.service';
import { ExamService } from './modules/exams/exam.service';
import { StatisticsService } from './modules/statistics/statistics.service';
import { MediaService } from './modules/media/media.service';
import { VideoSessionService } from './modules/video-learning/video-session.service';
import { MediaUploadFinalizerService } from './modules/media/uploads/media-upload-finalizer.service';
import { MediaUploadCleanupService } from './modules/media/uploads/media-upload-cleanup.service';

/**
 * 定时任务编排（02 册 2.2 横切能力，06 册 4.3 双触发）：
 * ① 超时收口：每 30 秒扫描 in_progress 且 deadline_at ≤ NOW 的记录（主触发）；
 * ② 僵尸学习会话收口：每 60 秒扫描（90 秒离线 / 长暂停 / 超长会话兜底）；
 * ③ 解析兜底：每 60 秒扫描 pending 超过 2 分钟的版本（防事件丢失）；
 * ④ 统计缓存兜底过期由 TTL 5 分钟承担，事件失效由交卷/达标事务后主动触发。
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  private examSweepRunning = false;
  private learningSweepRunning = false;
  private uploadCleanupRunning = false;

  constructor(
    private readonly examService: ExamService,
    private readonly learningService: LearningSessionService,
    private readonly parsePipeline: ParsePipelineService,
    private readonly statistics: StatisticsService,
    private readonly media: MediaService,
    private readonly videoLearning: VideoSessionService,
    @Optional() private readonly uploadFinalizer?: MediaUploadFinalizerService,
    @Optional() private readonly uploadCleanup?: MediaUploadCleanupService,
  ) {}

  /** Claims and the instance slot limit belong to the finalizer; idle slots can be refilled. */
  @Interval(1_000)
  async finalizeMediaUploads() {
    try { await this.uploadFinalizer?.runOnce(); }
    catch { this.logger.warn('媒体上传后台校验暂未完成，等待持久任务重试'); }
  }

  @Interval(60_000)
  async sweepUploadSessions() {
    if (this.uploadCleanupRunning) return;
    this.uploadCleanupRunning = true;
    try { await this.uploadCleanup?.runOnce(new Date()); }
    catch { this.logger.warn('媒体上传清理暂未完成，等待持久任务重试'); }
    finally { this.uploadCleanupRunning = false; }
  }

  /** 触发器一（主）：超时未交卷收口，每 30 秒。 */
  @Interval(30_000)
  async sweepExamTimeouts() {
    if (this.examSweepRunning) return;
    this.examSweepRunning = true;
    try {
      const n = await this.examService.sweepTimeouts();
      if (n > 0) this.logger.log(`超时未交卷收口：${n} 条`);
    } catch (e: any) {
      this.logger.warn(`超时扫描失败: ${e?.message}`);
    } finally {
      this.examSweepRunning = false;
    }
  }

  /** 触发器③：学习会话兜底收口，每 60 秒（05 册 5.4.6） */
  @Interval(60_000)
  async sweepLearningSessions() {
    if (this.learningSweepRunning) return;
    this.learningSweepRunning = true;
    try {
      await this.learningService.sweepStalledSessions();
    } catch (e: any) {
      this.logger.warn(`学习会话兜底失败: ${e?.message}`);
    }
    try {
      const n = await this.videoLearning.sweepStalledSessions();
      if (n > 0) this.logger.log(`视频学习会话回收：${n} 条`);
    } catch (e: any) {
      this.logger.warn(`视频学习会话回收失败: ${e?.message}`);
    } finally {
      this.learningSweepRunning = false;
    }
  }

  /** 解析兜底扫描，每 60 秒（05 册 3.4.3 双通道之二） */
  @Interval(60_000)
  async sweepParseQueue() {
    try {
      await this.parsePipeline.scanStalled();
    } catch (e: any) {
      this.logger.warn(`解析兜底扫描失败: ${e?.message}`);
    }
  }

  /** 统计缓存兜底：每 10 分钟清空全部 stat: 前缀（事件失效的补充，TTL 为主） */
  @Interval(600_000)
  async sweepStatisticsCache() {
    try {
      await this.statistics.invalidateAllStatistics();
    } catch { /* ignore */ }
  }

  /** 媒体延迟清理：先释放 24h 未提交实名材料，再二次检查其余孤儿引用。 */
  @Interval(3_600_000)
  async sweepMediaOrphans() {
    try {
      const removed = await this.media.cleanupTemporaryIdentityImages();
      if (removed > 0) this.logger.log(`临时实名材料清理：${removed} 条`);
    } catch (e: any) {
      this.logger.warn(`临时实名材料清理失败: ${e?.message}`);
    }
    try {
      const removed = await this.media.cleanupOrphans();
      if (removed > 0) this.logger.log(`媒体孤儿清理：${removed} 条`);
    } catch (e: any) {
      this.logger.warn(`媒体孤儿清理失败: ${e?.message}`);
    }
  }
}
