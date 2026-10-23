import { EntityManager } from 'typeorm';
import { Errors, ExamStatus } from '../../common/errors';
import { ExamAnswer } from '../../entities/exam-answer.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { LearnerIdentity } from '../../entities/learner-identity.entity';
import { IdentityVerificationSession } from '../../entities/identity-verification-session.entity';

/** Historical timeout rows may already contain a frozen graded result. */
export function isScoredLegacyTimeout(record: ExamRecord): boolean {
  return record.status === ExamStatus.TIMEOUT && record.gradingState === 'finalized'
    && record.score !== null && record.score !== undefined && Boolean(record.submittedAt);
}

export async function assertExamIdentity(manager: EntityManager, userId: string): Promise<void> {
  if (await manager.getRepository(LearnerIdentity).findOne({ where: { userId } })) return;
  const latest = await manager.getRepository(IdentityVerificationSession).findOne({ where: { userId }, order: { createdAt: 'DESC' } });
  const pending = latest && !['verified', 'rejected', 'expired'].includes(latest.status) && new Date(latest.expiresAt).getTime() > Date.now();
  throw Errors.dataForbidden('请先完成实名认证', { reason_code: pending ? 'IDENTITY_PENDING' : 'IDENTITY_REQUIRED' });
}

/** Caller holds the record write lock. Only active records may be changed. */
export async function expireExamRecord(manager: EntityManager, record: ExamRecord): Promise<ExamRecord> {
  if (record.status !== ExamStatus.IN_PROGRESS) return record;
  await manager.getRepository(ExamAnswer).delete({ examRecordId: String(record.id) });
  Object.assign(record, { status: ExamStatus.TIMEOUT, score: '0.00', submittedAt: null, submissionMethod: null, gradingState: 'not_submitted', gradedAt: null, activeAssignmentId: null, draftRevision: 0, draftPayloadHash: null, draftSavedAt: null });
  return manager.getRepository(ExamRecord).save(record);
}
