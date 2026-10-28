import { EntityManager, In } from 'typeorm';
import { difficultyForSource } from '../../common/question-difficulty';
import type { LearnerExamMetadata, LearnerExamQuestionType, LearnerExamSummary, QuestionType } from '../../common/training-contracts';
import { ExamAssignment } from '../../entities/exam-assignment.entity';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { PaperRelease } from '../../entities/paper-release.entity';
import { SysUser } from '../../entities/sys-user.entity';

/** Project only aggregate facts; malformed historical rules remain unknown. */
function projectQuestionTypes(rows: unknown[] | null, totalCents: number | null): LearnerExamQuestionType[] | null {
  if (!rows?.length || totalCents === null || !Number.isSafeInteger(totalCents)) return null;
  const types: QuestionType[] = ['single', 'multiple', 'judgment'];
  const groups = new Map<QuestionType, { count: number; totalCents: number; scoreCents: number | null }>();
  let combinedCents = 0, combinedCount = 0;
  for (const input of rows) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const row = input as Record<string, unknown>;
    if (!types.includes(row.type as QuestionType)
      || typeof row.count !== 'number' || !Number.isSafeInteger(row.count) || row.count < 0
      || typeof row.scoreCents !== 'number' || !Number.isSafeInteger(row.scoreCents) || row.scoreCents < 0) return null;
    const rowCents = row.count * row.scoreCents;
    combinedCents += rowCents;
    combinedCount += row.count;
    if (!Number.isSafeInteger(rowCents) || !Number.isSafeInteger(combinedCents) || !Number.isSafeInteger(combinedCount)) return null;
    if (!row.count) continue;
    const type = row.type as QuestionType, current = groups.get(type);
    groups.set(type, {
      count: (current?.count ?? 0) + row.count,
      totalCents: (current?.totalCents ?? 0) + rowCents,
      scoreCents: current && current.scoreCents !== row.scoreCents ? null : row.scoreCents,
    });
  }
  if (combinedCents !== totalCents) return null;
  return types.flatMap(type => {
    const group = groups.get(type);
    return group ? [{ type, count: group.count, score_per_question: group.scoreCents === null ? null : group.scoreCents / 100, total_score: group.totalCents / 100 }] : [];
  });
}

/** Unknown historical facts stay unknown; this never reads mutable paper settings. */
export function projectExamRuleMetadata(rule: unknown): LearnerExamMetadata {
  const value = rule && typeof rule === 'object' ? rule as Record<string, unknown> : {};
  const positive = (input: unknown): number | null => typeof input === 'number' && Number.isFinite(input) && input > 0 ? input : null;
  const totalCents = positive(value.totalCents), passCents = positive(value.passCents);
  const rows = Array.isArray(value.rules) ? value.rules : null;
  return {
    total_score: totalCents === null ? null : totalCents / 100,
    pass_score: passCents === null ? null : passCents / 100,
    duration_minutes: positive(value.durationMinutes),
    question_count: rows?.length && rows.every(row => row && typeof row.count === 'number' && Number.isSafeInteger(row.count) && row.count >= 0)
      ? rows.reduce((sum, row) => sum + row.count, 0) : null,
    question_types: projectQuestionTypes(rows, totalCents),
  };
}

export function latestExamRecord(records: readonly ExamRecord[]): ExamRecord | null {
  return records.reduce<ExamRecord | null>((latest, row) => !latest || BigInt(row.id) > BigInt(latest.id) ? row : latest, null);
}

export function isActiveExamRecord(record: Pick<ExamRecord, 'status' | 'deadlineAt'>, nowMs: number): boolean {
  return record.status === 'in_progress' && record.deadlineAt != null && new Date(record.deadlineAt).getTime() > nowMs;
}

/** Load release metadata in one batch; deliberately never load published question pools. */
export async function readLearnerExamSummaries(
  manager: EntityManager,
  user: SysUser,
  papers: readonly ExamPaper[],
  assignments: readonly ExamAssignment[],
  records: readonly ExamRecord[],
  nowMs = Date.now(),
): Promise<Array<{ view: LearnerExamSummary; release: PaperRelease | null }>> {
  if (!papers.length) return [];
  const releaseRows = await manager.getRepository(PaperRelease).find({
    where: { paperId: In(papers.map(paper => String(paper.id))) },
    select: ['id', 'paperId', 'versionNo', 'businessScope', 'poolScope', 'categoryId', 'ruleSnapshot', 'requiresLearning', 'requiredLearningMinutes', 'courseIds'],
    order: { versionNo: 'DESC', id: 'DESC' },
  });
  return papers.map(paper => {
    const paperId = String(paper.id);
    const assignment = assignments.find(row => String(row.paperId) === paperId && String(row.userId) === String(user.id));
    const candidates = releaseRows.filter(row => String(row.paperId) === paperId && row.businessScope === 'training');
    const release = assignment
      ? candidates.find(row => String(row.id) === String(assignment.releaseId)) || null
      : candidates.reduce<PaperRelease | null>((latest, row) => !latest || row.versionNo > latest.versionNo ? row : latest, null);
    const ownedRecords = records.filter(row => String(row.paperId) === paperId && String(row.userId) === String(user.id));
    const latest = latestExamRecord(ownedRecords);
    const active = latestExamRecord(ownedRecords.filter(row => isActiveExamRecord(row, nowMs)));
    const limit = assignment?.ruleSnapshot?.maxAttempts ?? release?.ruleSnapshot?.maxAttempts;
    const maxAttempts = typeof limit === 'number' && Number.isSafeInteger(limit) && limit > 0 ? limit : null;
    return {
      release,
      view: {
        paper_id: paperId, title: paper.title, mode: paper.mode, status: paper.status,
        pool_scope: release?.poolScope ?? paper.poolScope ?? 'category',
        source: assignment ? assignment.source : user.source,
        category_id: assignment ? assignment.categoryId : release?.categoryId ?? paper.categoryId ?? null,
        difficulty: assignment?.difficulty ?? (paper.mode === 'random' && (user.source === 'institution' || user.source === 'external') ? difficultyForSource(user.source) : null),
        ...projectExamRuleMetadata(assignment ? assignment.ruleSnapshot : release?.ruleSnapshot),
        attempts_used: ownedRecords.length,
        max_attempts: maxAttempts,
        attempts_remaining: maxAttempts === null ? null : Math.max(0, maxAttempts - ownedRecords.length),
        active_record_id: active ? String(active.id) : null,
        latest_record_id: latest ? String(latest.id) : null,
      },
    };
  });
}
