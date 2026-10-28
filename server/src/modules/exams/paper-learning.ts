import { EntityManager, In } from 'typeorm';
import { Errors } from '../../common/errors';
import { TrainingCourse } from '../../entities/training-course.entity';
import { VideoLearningRecord } from '../../entities/video-learning-record.entity';
import type { LearnerExamLearning } from '../../common/training-contracts';

type LearningConfig = {
  requiresLearning: boolean | number;
  requiredLearningMinutes?: number | null;
  courseIds?: string[] | null;
};

/** New writes have one switch; disabled hidden fields never remain effective. */
export function normalizePaperLearning(input: LearningConfig) {
  if (!input.requiresLearning) {
    return { requiresLearning: 0, requiredLearningMinutes: null, courseIds: [] as string[] };
  }
  const minutes = input.requiredLearningMinutes;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 2147483647) {
    throw Errors.paperRuleInvalid('开启考前学习要求时，累计学习时长必须为正整数分钟');
  }
  const courseIds = (input.courseIds || []).map(String);
  if (!courseIds.length || new Set(courseIds).size !== courseIds.length) {
    throw Errors.paperRuleInvalid('开启考前学习要求时，至少选择一门课程且不能重复');
  }
  return { requiresLearning: 1, requiredLearningMinutes: minutes, courseIds };
}

export function normalizePaperRemark(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || Array.from(value).length > 1000) {
    throw Errors.param('备注最多1000字符');
  }
  return value.trim() || null;
}

export async function assertPaperLearningCourses(manager: EntityManager, categoryId: string | null, courseIds: string[]): Promise<void> {
  if (!courseIds.length) return;
  const rows = await manager.getRepository(TrainingCourse).findBy({ id: In(courseIds) });
  if (rows.length !== courseIds.length
    || rows.some(row => (categoryId !== null && String(row.categoryId) !== categoryId) || row.status !== 'published')) {
    throw Errors.paperRuleInvalid(categoryId === null ? '考前学习课程必须全部已上架' : '考前学习课程必须全部属于试卷培训类别且已上架');
  }
}

/** Read the same current effective video set for admission and reporting. */
export async function getEffectiveLearningVersionIds(manager: EntityManager, courseIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(courseIds.map(String))];
  if (!ids.length) return [];
  const rows: Array<{ version_id: string }> = await manager.query(`
    SELECT DISTINCT lesson.current_version_id AS version_id
    FROM course_lesson lesson
    INNER JOIN training_course course ON course.id = lesson.course_id
    INNER JOIN lesson_version version ON version.id = lesson.current_version_id AND version.lesson_id = lesson.id
    WHERE course.id IN (${ids.map(() => '?').join(',')}) AND course.status = 'published'
      AND lesson.deleted_at IS NULL AND lesson.lesson_type = 'video' AND version.duration_ms > 0
  `, ids);
  return [...new Set(rows.map(row => String(row.version_id)))];
}

async function creditedLearningMs(manager: EntityManager, userId: string, courseIds: string[]): Promise<bigint> {
  const versionIds = await getEffectiveLearningVersionIds(manager, courseIds);
  const row = versionIds.length ? await manager.getRepository(VideoLearningRecord).createQueryBuilder('record')
    .select('COALESCE(SUM(record.credited_ms), 0)', 'creditedMs')
    .where('record.user_id = :userId', { userId: String(userId) })
    .andWhere('record.lesson_version_id IN (:...versionIds)', { versionIds })
    .getRawOne<{ creditedMs: string }>() : undefined;
  return BigInt(row?.creditedMs || '0');
}

/** A read-only projection of the same millisecond threshold enforced at start. */
export async function readPaperLearningSummary(
  manager: EntityManager,
  userId: string,
  release: (LearningConfig & { businessScope: string }) | null,
): Promise<LearnerExamLearning> {
  if (!release || release.businessScope !== 'training' || !release.requiresLearning || release.requiredLearningMinutes == null) {
    return { required_learning_minutes: null, credited_seconds: null, remaining_seconds: null, courses: [] };
  }
  const requirement = normalizePaperLearning(release);
  const [creditedMs, courses] = await Promise.all([
    creditedLearningMs(manager, userId, requirement.courseIds),
    manager.getRepository(TrainingCourse).findBy({ id: In(requirement.courseIds) }),
  ]);
  const remainingMs = BigInt(requirement.requiredLearningMinutes!) * 60000n - creditedMs;
  return {
    required_learning_minutes: requirement.requiredLearningMinutes,
    credited_seconds: Number(creditedMs / 1000n),
    remaining_seconds: remainingMs > 0n ? Number((remainingMs + 999n) / 1000n) : 0,
    courses: requirement.courseIds.map(id => {
      const course = courses.find(row => String(row.id) === id);
      return { id, title: course?.title ?? null, available: course?.status === 'published' };
    }),
  };
}

/** Use the existing effective-play clock, once per current video version. */
export async function assertPaperLearningEligible(
  manager: EntityManager,
  userId: string,
  release: LearningConfig & { businessScope: string },
): Promise<void> {
  // NULL identifies an old release: never invent or backfill a new requirement.
  if (release.businessScope !== 'training' || !release.requiresLearning || release.requiredLearningMinutes == null) return;
  const requirement = normalizePaperLearning(release);
  // BIGINT sums remain exact even when old learning histories exceed JS integers.
  const creditedMs = await creditedLearningMs(manager, userId, requirement.courseIds);
  const remainingMs = BigInt(requirement.requiredLearningMinutes!) * 60000n - creditedMs;
  if (remainingMs <= 0n) return;
  const remainingMinutes = Number((remainingMs + 59999n) / 60000n);
  throw Errors.notEligible(`还需学习${remainingMinutes}分钟后可开始考试`, {
    reason_code: 'LEARNING_REQUIRED',
    required_learning_minutes: requirement.requiredLearningMinutes,
    credited_seconds: Number(creditedMs / 1000n),
    remaining_seconds: Number((remainingMs + 999n) / 1000n),
    course_ids: requirement.courseIds,
  });
}
