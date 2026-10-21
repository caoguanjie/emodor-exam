import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Errors, ExamStatus } from '../../common/errors';
import type { AttemptView, RuleSnapshot } from '../../common/training-contracts';
import { ExamAnswer } from '../../entities/exam-answer.entity';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { ExamRecordQuestion } from '../../entities/exam-record-question.entity';
import { AttemptReaderService, type GradingSnapshot } from './attempt-reader.service';
import { AttemptService } from './attempt.service';

export interface FrozenGradeDetail {
  itemId: string;
  selected: number[] | null;
  isCorrect: number | null;
  gainedCents: number;
}

export interface FrozenGrade {
  totalCents: number;
  details: FrozenGradeDetail[];
}

type LegacyAnswerInput = { question_id: number | string; selected?: number[] };

export function mapLegacyAnswersToItems(
  answers: LegacyAnswerInput[],
  questionToItemId: ReadonlyMap<string, string>,
): LegacyAnswerInput[] {
  return answers.map((answer) => {
    const itemId = questionToItemId.get(String(answer.question_id));
    if (!itemId) throw Errors.param('作答题目不属于本次考试');
    return { question_id: itemId, selected: answer.selected };
  });
}

function normalizedSelection(values: number[] | undefined, mapping: number[]): number[] | null {
  if (!Array.isArray(values) || !values.length) return null;
  const restored = values
    .filter((value) => Number.isInteger(value) && value >= 0 && value < mapping.length)
    .map((value) => mapping[value]);
  const unique = [...new Set(restored)].sort((left, right) => left - right);
  return unique.length ? unique : null;
}

function sameSelection(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Narrow C2 compatibility scorer. C3 replaces the persistence/finalizer shell,
 * while this pure function remains a frozen-snapshot calculation boundary.
 */
export function gradeFrozenSnapshot(snapshot: GradingSnapshot, answers: Map<string, number[]>): FrozenGrade {
  const details = snapshot.items.map((item): FrozenGradeDetail => {
    const selected = item.type === 'image'
      ? null
      : normalizedSelection(answers.get(String(item.itemId)), item.displayToOriginal);
    if (!selected) return { itemId: String(item.itemId), selected: null, isCorrect: null, gainedCents: 0 };

    const expected = [...new Set(item.answer.map(Number))].sort((left, right) => left - right);
    const fullyCorrect = sameSelection(selected, expected);
    if (fullyCorrect) {
      return { itemId: String(item.itemId), selected, isCorrect: 1, gainedCents: Number(item.scoreCents) };
    }
    if (item.type === 'multiple') {
      const expectedSet = new Set(expected);
      const hasWrongChoice = selected.some((value) => !expectedSet.has(value));
      if (!hasWrongChoice && selected.length < expected.length) {
        return {
          itemId: String(item.itemId),
          selected,
          isCorrect: 0,
          gainedCents: Math.round(Number(item.scoreCents) * Number(snapshot.rule.partialCreditRatio)),
        };
      }
    }
    return { itemId: String(item.itemId), selected, isCorrect: 0, gainedCents: 0 };
  });
  return { totalCents: details.reduce((sum, item) => sum + item.gainedCents, 0), details };
}

export function legacyAttemptView(input: {
  attempt: AttemptView;
  attemptNo: number;
  status: string;
  title: string;
  rule: RuleSnapshot;
  itemToQuestionId: ReadonlyMap<string, string>;
}) {
  const { attempt, rule } = input;
  const savedAnswers = Object.fromEntries(
    attempt.answers
      .filter((answer) => Array.isArray(answer.selected))
      .map((answer) => [input.itemToQuestionId.get(String(answer.item_id)), answer.selected])
      .filter((entry): entry is [string, number[]] => Boolean(entry[0])),
  );
  return {
    exam_record_id: Number(attempt.record_id),
    attempt_no: input.attemptNo,
    status: input.status,
    paper: {
      id: Number(attempt.paper_id),
      title: input.title,
      total_score: Number(rule.totalCents) / 100,
      pass_score: Number(rule.passCents) / 100,
      duration_minutes: Number(rule.durationMinutes),
    },
    remaining_seconds: Math.max(0, Math.floor((Date.parse(attempt.deadline_at) - Date.parse(attempt.server_now)) / 1000)),
    deadline_at: attempt.deadline_at,
    questions: attempt.questions.map((question) => {
      const questionId = input.itemToQuestionId.get(String(question.item_id));
      if (!questionId) throw Errors.notFound('本次冻结题目不存在');
      return {
        question_id: Number(questionId),
        type: question.type,
        stem: question.stem,
        options: question.options.map((option) => ({ ...option })),
        score: question.score,
      };
    }),
    saved_answers: savedAnswers,
  };
}

@Injectable()
export class LegacyExamAdapter {
  constructor(
    @InjectRepository(ExamRecord) private readonly recordRepo: Repository<ExamRecord>,
    @InjectRepository(ExamPaper) private readonly paperRepo: Repository<ExamPaper>,
    @InjectRepository(ExamAnswer) private readonly answerRepo: Repository<ExamAnswer>,
    @InjectRepository(ExamRecordQuestion) private readonly itemRepo: Repository<ExamRecordQuestion>,
    private readonly attempts: AttemptService,
    private readonly reader: AttemptReaderService,
    private readonly dataSource: DataSource,
  ) {}

  private async idMaps(recordId: string) {
    const items = await this.itemRepo.find({
      where: { recordId: String(recordId) },
      order: { position: 'ASC', id: 'ASC' },
    });
    if (!items.length) throw Errors.notFound('本次个人题单不存在');
    const itemToQuestionId = new Map<string, string>();
    const questionToItemId = new Map<string, string>();
    for (const item of items) {
      const itemId = String(item.id);
      const questionId = String(item.questionId);
      if (questionToItemId.has(questionId)) throw Errors.paperReleaseConflict('旧固定卷冻结题目重复');
      itemToQuestionId.set(itemId, questionId);
      questionToItemId.set(questionId, itemId);
    }
    return { itemToQuestionId, questionToItemId };
  }

  async answersToItems(recordId: string, answers: LegacyAnswerInput[]) {
    const { questionToItemId } = await this.idMaps(recordId);
    return mapLegacyAnswersToItems(answers, questionToItemId);
  }

  private async adapted(recordId: string, attempt: AttemptView) {
    const record = await this.recordRepo.findOne({ where: { id: String(recordId) } });
    const paper = record && await this.paperRepo.findOne({ where: { id: String(record.paperId) } });
    if (!record || !paper || !record.ruleSnapshot) throw Errors.notFound('考试记录不存在');
    const { itemToQuestionId } = await this.idMaps(String(recordId));
    return legacyAttemptView({
      attempt,
      attemptNo: Number(record.attemptNo),
      status: record.status,
      title: paper.title,
      rule: record.ruleSnapshot,
      itemToQuestionId,
    });
  }

  async start(paperId: string, userId: string) {
    const paper = await this.paperRepo.findOne({ where: { id: String(paperId) } });
    if (!paper) throw Errors.notFound('试卷不存在');
    if (paper.businessScope !== 'regulation' || !paper.regulationId || paper.mode !== 'fixed') {
      throw Errors.contentInvisible('培训考试请使用本人考试接口');
    }
    const attempt = await this.attempts.start(String(userId), String(paperId));
    return this.adapted(attempt.record_id, attempt);
  }

  async recover(recordId: string, userId: string) {
    const attempt = await this.attempts.recover(String(userId), String(recordId));
    return this.adapted(String(recordId), attempt);
  }

  async submitResult(record: ExamRecord) {
    const paper = await this.paperRepo.findOne({ where: { id: String(record.paperId) } });
    const finished = await this.recordRepo.find({ where: { paperId: record.paperId, userId: record.userId } });
    const scores = finished.filter((item) => item.status !== ExamStatus.IN_PROGRESS && item.score !== null).map((item) => Number(item.score));
    const answers = await this.answerRepo.find({ where: { examRecordId: String(record.id) } });
    const { itemToQuestionId } = await this.idMaps(String(record.id));
    return {
      exam_record_id: Number(record.id),
      status: record.status,
      score: record.score === null ? null : Number(record.score),
      pass_score: record.ruleSnapshot ? Number(record.ruleSnapshot.passCents) / 100 : paper ? Number(paper.passScore) : null,
      switch_count: record.switchCount,
      submitted_at: record.submittedAt,
      best_score: scores.length ? Math.max(...scores) : null,
      answer_summary: answers.map((answer) => ({
        question_id: Number(itemToQuestionId.get(String(answer.recordQuestionId))),
        is_correct: answer.isCorrect === null ? null : answer.isCorrect === 1,
        gained_score: Number(answer.gainedScore),
      })),
    };
  }

  async result(recordId: string, userId: string, userRole: string) {
    const record = await this.recordRepo.findOne({ where: { id: String(recordId) } });
    if (!record) throw Errors.notFound('考试记录不存在');
    const isOwner = String(record.userId) === String(userId);
    const isAdmin = userRole === 'super_admin' || userRole === 'regulation_admin';
    if (!isOwner && !isAdmin) throw Errors.dataForbidden();
    if (record.status === ExamStatus.IN_PROGRESS) throw Errors.submitConflict('考试进行中，成绩明细交卷后可查');
    const snapshot = await this.reader.forGrading(this.dataSource.manager, String(record.id));
    const answers = await this.answerRepo.find({ where: { examRecordId: String(record.id) } });
    const answerMap = new Map(answers.map((answer) => [String(answer.recordQuestionId), answer]));
    const finished = await this.recordRepo.find({ where: { paperId: record.paperId, userId: record.userId } });
    const scores = finished.filter((item) => item.status !== ExamStatus.IN_PROGRESS && item.score !== null).map((item) => Number(item.score));
    return {
      exam_record_id: Number(record.id),
      paper_id: Number(record.paperId),
      attempt_no: Number(record.attemptNo),
      status: record.status,
      score: record.score === null ? null : Number(record.score),
      pass_score: Number(snapshot.rule.passCents) / 100,
      switch_count: record.switchCount,
      started_at: record.startedAt,
      submitted_at: record.submittedAt,
      best_score: scores.length ? Math.max(...scores) : null,
      questions: snapshot.items.map((item) => {
        const answer = answerMap.get(String(item.itemId));
        return {
          question_id: Number(item.questionId),
          type: item.type,
          stem: item.stem,
          options: item.options.map((option) => ({ ...option })),
          score: Number(item.scoreCents) / 100,
          selected: answer?.selected ?? null,
          is_correct: answer ? (answer.isCorrect === null ? null : answer.isCorrect === 1) : null,
          gained_score: answer ? Number(answer.gainedScore) : null,
          answer: [...item.answer],
          analysis: item.analysis,
        };
      }),
    };
  }
}
