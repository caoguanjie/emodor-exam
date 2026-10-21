import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { PaperQuestion } from '../../entities/paper-question.entity';
import { Question } from '../../entities/question.entity';
import { Errors, PaperStatus, QuestionStatus } from '../../common/errors';
import { AuditService } from '../../common/audit.service';

/**
 * 组卷服务（05 册 4.4.7）：试卷策略配置、选题入卷校验（approved + 同制度 + 不重复）、
 * 发布校验 SUM(paper_question.score) = 100（C-04）、发布后 paper_question 锁定（40907）、
 * 策略字段发布后仍可调（pass_score / partial_credit_ratio 判分实时读；duration/max_attempts 对后续发起生效）。
 */
@Injectable()
export class PaperService {
  constructor(
    @InjectRepository(ExamPaper) private readonly paperRepo: Repository<ExamPaper>,
    @InjectRepository(PaperQuestion) private readonly pqRepo: Repository<PaperQuestion>,
    @InjectRepository(Question) private readonly questionRepo: Repository<Question>,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  paperView(p: ExamPaper) {
    return {
      id: Number(p.id),
      regulation_id: Number(p.regulationId),
      title: p.title,
      total_score: Number(p.totalScore),
      pass_score: Number(p.passScore),
      duration_minutes: p.durationMinutes,
      max_attempts: p.maxAttempts,
      partial_credit_ratio: Number(p.partialCreditRatio),
      status: p.status,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    };
  }

  async list(query: { page?: number; page_size?: number; regulation_id?: number; status?: string }) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size || 20)));
    const qb = this.paperRepo.createQueryBuilder('p');
    if (query.regulation_id) qb.andWhere('p.regulation_id = :rid', { rid: String(query.regulation_id) });
    if (query.status) qb.andWhere('p.status = :status', { status: query.status });
    qb.orderBy('p.id', 'DESC');
    const total = await qb.getCount();
    const rows = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();
    return { list: rows.map((p) => this.paperView(p)), total, page, page_size: pageSize };
  }

  async detail(id: string) {
    const p = await this.paperRepo.findOne({ where: { id } });
    if (!p) throw Errors.notFound('试卷不存在');
    const questions = await this.pqRepo.find({ where: { paperId: id }, order: { sort: 'ASC', id: 'ASC' } });
    const qIds = questions.map((pq) => pq.questionId);
    const qRows = qIds.length ? await this.questionRepo.find({ where: { id: In(qIds) } }) : [];
    const qMap = new Map(qRows.map((q) => [q.id, q]));
    return {
      ...this.paperView(p),
      sum_score: questions.reduce((a, pq) => a + Number(pq.score), 0),
      questions: questions.map((pq) => {
        const q = qMap.get(pq.questionId);
        return {
          paper_question_id: Number(pq.id),
          question_id: Number(pq.questionId),
          sort: pq.sort,
          score: Number(pq.score),
          type: q?.type,
          stem: q?.stem,
          status: q?.status,
          source: q?.source,
        };
      }),
    };
  }

  async create(input: { regulation_id: string; title: string; pass_score?: number; duration_minutes?: number; max_attempts?: number; partial_credit_ratio?: number }, actor: { id: number; name: string }, ip: string | null) {
    this.validateStrategy({
      pass_score: input.pass_score,
      duration_minutes: input.duration_minutes,
      max_attempts: input.max_attempts,
      partial_credit_ratio: input.partial_credit_ratio,
    });
    const p = await this.paperRepo.save(
      this.paperRepo.create({
        regulationId: input.regulation_id,
        title: input.title,
        passScore: String(input.pass_score ?? 60),
        durationMinutes: input.duration_minutes ?? 30,
        maxAttempts: input.max_attempts ?? 3,
        partialCreditRatio: String(input.partial_credit_ratio ?? 0.5),
        status: PaperStatus.DRAFT,
        createdBy: String(actor.id),
      }),
    );
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'paper.create', object_type: 'exam_paper',
      object_id: p.id, detail: { title: input.title, regulation_id: Number(input.regulation_id) }, result: 'success', source_ip: ip,
    });
    return this.paperView(p);
  }

  private validateStrategy(patch: { pass_score?: number; duration_minutes?: number; max_attempts?: number; partial_credit_ratio?: number }) {
    if (patch.pass_score !== undefined && !(patch.pass_score > 0 && patch.pass_score <= 100)) {
      throw Errors.param('pass_score 取值范围 (0, 100]');
    }
    if (patch.duration_minutes !== undefined && (!Number.isInteger(patch.duration_minutes) || patch.duration_minutes < 1)) {
      throw Errors.param('duration_minutes 须为 ≥ 1 的整数');
    }
    if (patch.max_attempts !== undefined && (!Number.isInteger(patch.max_attempts) || patch.max_attempts < 1)) {
      throw Errors.param('max_attempts 须为 ≥ 1 的整数');
    }
    if (patch.partial_credit_ratio !== undefined && !(patch.partial_credit_ratio >= 0 && patch.partial_credit_ratio <= 1)) {
      throw Errors.param('partial_credit_ratio 取值范围 [0.00, 1.00]');
    }
  }

  /** 修改策略字段（发布后仍可调，按各自生效边界生效，NFR-15） */
  async updateStrategy(id: string, patch: { title?: string; pass_score?: number; duration_minutes?: number; max_attempts?: number; partial_credit_ratio?: number }, actor: { id: number; name: string }, ip: string | null) {
    const p = await this.paperRepo.findOne({ where: { id } });
    if (!p) throw Errors.notFound('试卷不存在');
    if (p.status === PaperStatus.ARCHIVED) throw Errors.param('已归档试卷不可修改');
    this.validateStrategy(patch);
    if (patch.title !== undefined) p.title = patch.title;
    if (patch.pass_score !== undefined) p.passScore = String(patch.pass_score);
    if (patch.duration_minutes !== undefined) p.durationMinutes = patch.duration_minutes;
    if (patch.max_attempts !== undefined) p.maxAttempts = patch.max_attempts;
    if (patch.partial_credit_ratio !== undefined) p.partialCreditRatio = String(patch.partial_credit_ratio);
    await this.paperRepo.save(p);
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'paper.update', object_type: 'exam_paper',
      object_id: id, detail: patch as any, result: 'success', source_ip: ip,
    });
    return this.paperView(p);
  }

  /** 组卷（PUT /ai/papers/{id}/questions）：全量替换题目组成；发布后锁定（40907） */
  async setQuestions(id: string, items: { question_id: number | string; score?: number }[], actor: { id: number; name: string }, ip: string | null) {
    const p = await this.paperRepo.findOne({ where: { id } });
    if (!p) throw Errors.notFound('试卷不存在');
    if (p.status !== PaperStatus.DRAFT) throw Errors.paperQuestionsLocked();
    if (!Array.isArray(items) || !items.length) throw Errors.param('试卷至少需要 1 道题');

    const qIds = Array.from(new Set(items.map((it) => String(it.question_id))));
    const qRows = await this.questionRepo.find({ where: { id: In(qIds) } });
    const qMap = new Map(qRows.map((q) => [q.id, q]));
    const entities: PaperQuestion[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const q = qMap.get(String(it.question_id));
      if (!q) throw Errors.param(`题目 ${it.question_id} 不存在`);
      // 选题入卷校验（05 册 4.4.7）：approved + 同制度 + 同卷不重复
      if (q.status !== QuestionStatus.APPROVED) throw Errors.param(`题目 ${it.question_id} 未审核通过，不能入卷`);
      if (q.regulationId !== p.regulationId) throw Errors.param(`题目 ${it.question_id} 与试卷不属于同一制度`);
      if (seen.has(q.id)) throw Errors.param(`题目 ${it.question_id} 重复`);
      seen.add(q.id);
      entities.push(
        this.pqRepo.create({
          paperId: id,
          questionId: q.id,
          sort: i,
          score: String(it.score ?? Number(q.score)),
        }),
      );
    }
    await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(PaperQuestion);
      await repo.delete({ paperId: id });
      await repo.save(entities);
    });
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'paper.questions.set', object_type: 'exam_paper',
      object_id: id, detail: { count: entities.length }, result: 'success', source_ip: ip,
    });
    return this.detail(id);
  }

  /** 发布（FR-AIQ-07 验收①）：SUM(score) = 100 校验，不足/超出均拦截并提示差额 */
  async publish(id: string, actor: { id: number; name: string }, ip: string | null) {
    const p = await this.paperRepo.findOne({ where: { id } });
    if (!p) throw Errors.notFound('试卷不存在');
    if (p.status === PaperStatus.PUBLISHED) return this.paperView(p);
    if (p.status === PaperStatus.ARCHIVED) throw Errors.param('已归档试卷不可发布');
    const sumQb = await this.pqRepo
      .createQueryBuilder('pq')
      .select('COALESCE(SUM(pq.score), 0)', 'sum')
      .where('pq.paper_id = :pid', { pid: id })
      .getRawOne();
    const sum = Number(sumQb?.sum || 0);
    const total = Number(p.totalScore);
    if (sum !== total) {
      throw Errors.publishCheckFailed(`试卷总分校验未通过：题目分值合计 ${sum.toFixed(2)}，应为 ${total.toFixed(2)}（差额 ${(total - sum).toFixed(2)}）`);
    }
    p.status = PaperStatus.PUBLISHED;
    await this.paperRepo.save(p);
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'paper.publish', object_type: 'exam_paper',
      object_id: id, detail: { sum_score: sum }, result: 'success', source_ip: ip,
    });
    return this.paperView(p);
  }

  /** 归档（archived 后不可再发起新作答，C-08） */
  async archive(id: string, actor: { id: number; name: string }, ip: string | null) {
    const p = await this.paperRepo.findOne({ where: { id } });
    if (!p) throw Errors.notFound('试卷不存在');
    p.status = PaperStatus.ARCHIVED;
    await this.paperRepo.save(p);
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'paper.archive', object_type: 'exam_paper',
      object_id: id, detail: {}, result: 'success', source_ip: ip,
    });
    return this.paperView(p);
  }

  async findById(id: string) {
    return this.paperRepo.findOne({ where: { id } });
  }

  async findPublishedByRegulation(regulationId: string) {
    return this.paperRepo.findOne({ where: { regulationId, status: PaperStatus.PUBLISHED } });
  }
}
