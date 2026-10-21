import type {
  ExamDifficulty, LearnerSource, RankRow, RuleSnapshot, ScoreGroup, TrainingCourseCompletion,
  TrainingExamSummary,
} from '../../common/training-contracts';

export interface StatisticsRecord {
  id: string;
  paperId: string;
  releaseId: string | null;
  userId: string;
  categoryId: string | null;
  source: LearnerSource | null;
  difficulty: ExamDifficulty | null;
  ruleSnapshot: RuleSnapshot | null;
  status: string;
  gradingState: string;
  score: number | null;
  startedAt: Date;
  submittedAt: Date | null;
  deadlineAt: Date;
  submissionMethod: 'manual' | 'timeout' | null;
  gradedAt: Date | null;
}

const DIFFICULTIES: ExamDifficulty[] = ['easy', 'medium', 'hard', 'mixed', 'unknown'];

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function ruleKey(rule: RuleSnapshot | null): string {
  return JSON.stringify(canonical(rule));
}

function difficultyOf(record: StatisticsRecord): ExamDifficulty {
  return record.difficulty && DIFFICULTIES.includes(record.difficulty) ? record.difficulty : 'unknown';
}

function compareIds(left: string, right: string): number {
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  } catch {
    return left.localeCompare(right);
  }
}

function compatible(record: StatisticsRecord, releaseId: string | null, rule: RuleSnapshot | null): boolean {
  if (String(record.releaseId || '') !== String(releaseId || '')) return false;
  return ruleKey(record.ruleSnapshot) === ruleKey(rule);
}

function preferredRecord(left: StatisticsRecord, right: StatisticsRecord): StatisticsRecord {
  if (Number(right.score) > Number(left.score)) return right;
  if (Number(right.score) < Number(left.score)) return left;
  if (left.gradedAt && right.gradedAt) {
    const delta = left.gradedAt.getTime() - right.gradedAt.getTime();
    if (delta !== 0) return delta < 0 ? left : right;
  }
  return compareIds(left.id, right.id) <= 0 ? left : right;
}

export function bestFinalizedRecords(
  records: StatisticsRecord[],
  difficulty: ExamDifficulty,
  releaseId: string | null,
  rule: RuleSnapshot | null,
): StatisticsRecord[] {
  const byUser = new Map<string, StatisticsRecord>();
  for (const record of records) {
    if (record.gradingState !== 'finalized' || record.score === null) continue;
    if (difficultyOf(record) !== difficulty || !compatible(record, releaseId, rule)) continue;
    const previous = byUser.get(record.userId);
    byUser.set(record.userId, previous ? preferredRecord(previous, record) : record);
  }
  return [...byUser.values()];
}

export function examDurationSeconds(record: StatisticsRecord): number {
  const end = record.submissionMethod === 'timeout'
    ? record.deadlineAt
    : record.submittedAt || record.deadlineAt;
  return Math.max(0, Math.floor((end.getTime() - record.startedAt.getTime()) / 1000));
}

export function buildRankingRows(
  records: StatisticsRecord[],
  userNames: Map<string, string>,
  difficulty: ExamDifficulty,
  releaseId: string | null,
  rule: RuleSnapshot | null,
): RankRow[] {
  const selected = bestFinalizedRecords(records, difficulty, releaseId, rule)
    .sort((left, right) => {
      const score = Number(right.score) - Number(left.score);
      if (score !== 0) return score;
      if (left.gradedAt && right.gradedAt) {
        const graded = left.gradedAt.getTime() - right.gradedAt.getTime();
        if (graded !== 0) return graded;
      }
      return compareIds(left.id, right.id);
    });
  let previousScore: number | null = null;
  let previousRank = 0;
  return selected.map((record, index) => {
    const score = Number(record.score);
    const rank = previousScore !== null && score === previousScore ? previousRank : index + 1;
    previousScore = score;
    previousRank = rank;
    return {
      rank,
      user_id: record.userId,
      name: userNames.get(record.userId) || '未知学员',
      source: record.source,
      difficulty,
      score,
      duration_seconds: examDurationSeconds(record),
      record_id: record.id,
    };
  });
}

function distribution(scores: number[]) {
  const buckets = [
    { lower: 0, upper: 60, count: 0 },
    { lower: 60, upper: 70, count: 0 },
    { lower: 70, upper: 80, count: 0 },
    { lower: 80, upper: 90, count: 0 },
    { lower: 90, upper: 100, count: 0 },
  ];
  for (const score of scores) {
    const index = score < 60 ? 0 : score < 70 ? 1 : score < 80 ? 2 : score < 90 ? 3 : 4;
    buckets[index].count += 1;
  }
  return buckets;
}

function scoreGroups(records: StatisticsRecord[], releaseId: string | null, rule: RuleSnapshot | null): ScoreGroup[] {
  const present = new Set(records
    .filter((record) => record.gradingState === 'finalized' && record.score !== null && compatible(record, releaseId, rule))
    .map(difficultyOf));
  return DIFFICULTIES.filter((difficulty) => present.has(difficulty)).map((difficulty) => {
    const best = bestFinalizedRecords(records, difficulty, releaseId, rule);
    const scores = best.map((record) => Number(record.score));
    const passed = best.filter((record) => record.status === 'passed').length;
    return {
      difficulty,
      finalized_users: best.length,
      average_score: scores.length
        ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100
        : null,
      pass_rate: best.length ? Math.round((passed / best.length) * 10000) / 10000 : null,
      distribution: distribution(scores),
    };
  });
}

export function buildExamSummary(input: {
  records: StatisticsRecord[];
  eligibleUserIds: Set<string>;
  scoringReleaseId: string | null;
  scoringRule: RuleSnapshot | null;
  course: TrainingCourseCompletion;
  uncompletedReasons?: TrainingExamSummary['uncompleted_reasons'];
  asOf?: Date;
}): TrainingExamSummary {
  const historicalUsers = new Set(input.records.map((record) => record.userId));
  const eligibleStarted = new Set([...historicalUsers].filter((userId) => input.eligibleUserIds.has(userId)));
  const submitted = input.records.filter((record) => record.submittedAt !== null);
  const pending = input.records.filter((record) => record.gradingState === 'pending_manual');
  const finalizedUsers = new Set(input.records
    .filter((record) => record.gradingState === 'finalized' && record.score !== null
      && compatible(record, input.scoringReleaseId, input.scoringRule))
    .map((record) => record.userId));
  const composition = DIFFICULTIES.map((difficulty) => ({
    difficulty,
    users: new Set(input.records.filter((record) => difficultyOf(record) === difficulty).map((record) => record.userId)).size,
  })).filter((item) => item.users > 0);
  return {
    release_id: input.scoringReleaseId,
    eligible_count: input.eligibleUserIds.size,
    eligible_started_count: eligibleStarted.size,
    historical_started_count: historicalUsers.size,
    historical_only_started_count: [...historicalUsers].filter((userId) => !input.eligibleUserIds.has(userId)).length,
    submitted_attempts: submitted.length,
    submitted_users: new Set(submitted.map((record) => record.userId)).size,
    pending_attempts: pending.length,
    pending_users: new Set(pending.map((record) => record.userId)).size,
    finalized_users: finalizedUsers.size,
    participation_rate: input.eligibleUserIds.size
      ? Math.round((eligibleStarted.size / input.eligibleUserIds.size) * 10000) / 10000
      : null,
    score_groups: scoreGroups(input.records, input.scoringReleaseId, input.scoringRule),
    difficulty_composition: composition,
    course_completion: input.course,
    uncompleted_reasons: input.uncompletedReasons || [],
    as_of: (input.asOf || new Date()).toISOString(),
  };
}

export function computeCourseCompletion(input: {
  eligibleUsers: Array<{ id: string; source: LearnerSource | null }>;
  requiredVersionIds: string[];
  completedPairs: Set<string>;
}): TrainingCourseCompletion & { incomplete_user_ids: string[] } {
  const institution = input.eligibleUsers.filter((user) => user.source === 'institution');
  const versions = [...new Set(input.requiredVersionIds.map(String))];
  const incomplete = versions.length
    ? institution.filter((user) => versions.some((versionId) => !input.completedPairs.has(`${user.id}:${versionId}`)))
    : [];
  const completed = versions.length ? institution.length - incomplete.length : 0;
  return {
    eligible_users: institution.length,
    required_lessons: versions.length,
    completed_users: completed,
    completion_rate: institution.length && versions.length
      ? Math.round((completed / institution.length) * 10000) / 10000
      : null,
    incomplete_user_ids: incomplete.map((user) => user.id),
  };
}

function shanghaiDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function buildDashboardTrend(starts: Date[], dates: string[]): Array<{ date: string; count: number }> {
  const counts = new Map(dates.map((date) => [date, 0]));
  for (const startedAt of starts) {
    const date = shanghaiDate(startedAt);
    if (counts.has(date)) counts.set(date, Number(counts.get(date)) + 1);
  }
  return dates.map((date) => ({ date, count: Number(counts.get(date) || 0) }));
}
