import { EntityManager, In } from 'typeorm';
import { difficultyForSource } from '../../common/question-difficulty';
import type { LearnerExamMetadata, LearnerExamSummary } from '../../common/training-contracts';
import { ExamAssignment } from '../../entities/exam-assignment.entity';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { PaperRelease } from '../../entities/paper-release.entity';
import { SysUser } from '../../entities/sys-user.entity';

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
  };
}

export function latestExamRecord(records: readonly ExamRecord[]): ExamRecord | null {
  return records.reduce<ExamRecord | null>((latest, row) => !latest || BigInt(row.id) > BigInt(latest.id) ? row : latest, null);
}

/** Load release metadata in one batch; deliberately never load published question pools. */
export async function readLearnerExamSummaries(
  manager: EntityManager,
  user: SysUser,
  papers: readonly ExamPaper[],
  assignments: readonly ExamAssignment[],
  records: readonly ExamRecord[],
): Promise<Array<{ view: LearnerExamSummary; release: PaperRelease | null }>> {
  if (!papers.length) return [];
  const releaseRows = await manager.getRepository(PaperRelease).find({
    where: { paperId: In(papers.map(paper => String(paper.id))) },
    select: ['id', 'paperId', 'versionNo', 'businessScope', 'ruleSnapshot', 'requiresLearning', 'requiredLearningMinutes', 'courseIds'],
    order: { versionNo: 'DESC', id: 'DESC' },
  });
  return papers.map(paper => {
    const paperId = String(paper.id);
    const assignment = assignments.find(row => String(row.paperId) === paperId);
    const candidates = releaseRows.filter(row => String(row.paperId) === paperId && row.businessScope === 'training');
    const release = assignment
      ? candidates.find(row => String(row.id) === String(assignment.releaseId)) || null
      : candidates.reduce<PaperRelease | null>((latest, row) => !latest || row.versionNo > latest.versionNo ? row : latest, null);
    const ownedRecords = records.filter(row => String(row.paperId) === paperId);
    const latest = latestExamRecord(ownedRecords);
    const active = latestExamRecord(ownedRecords.filter(row => row.status === 'in_progress'));
    return {
      release,
      view: {
        paper_id: paperId, title: paper.title, mode: paper.mode, status: paper.status,
        source: assignment?.source ?? user.source,
        category_id: assignment?.categoryId ?? (user.categoryId ? String(user.categoryId) : null),
        difficulty: assignment?.difficulty ?? (paper.mode === 'random' && user.source ? difficultyForSource(user.source) : null),
        ...projectExamRuleMetadata(assignment ? assignment.ruleSnapshot : release?.ruleSnapshot),
        active_record_id: active ? String(active.id) : null,
        latest_record_id: latest ? String(latest.id) : null,
      },
    };
  });
}
