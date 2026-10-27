import type { SelectQueryBuilder } from 'typeorm';
import { ExamPaper } from '../../entities/exam-paper.entity';
import { ExamRecord } from '../../entities/exam-record.entity';
import { SysUser } from '../../entities/sys-user.entity';

/** Shared administrator record scope, without answer projection or date filters. */
export function applyVisibleExamRecordScope(query: SelectQueryBuilder<ExamRecord>): SelectQueryBuilder<ExamRecord> {
  return query
    .innerJoin(SysUser, 'learner', 'learner.id = record.user_id')
    .innerJoin(ExamPaper, 'paper', 'paper.id = record.paper_id')
    .andWhere("record.status IN ('in_progress', 'passed', 'failed', 'timeout')")
    .andWhere("NOT (record.status = 'timeout' AND record.grading_state = 'finalized' AND record.score IS NOT NULL AND record.submitted_at IS NOT NULL)");
}
