import { describe, it, expect } from 'vitest';
import { GradingService } from '../src/modules/exams/grading.service';
import { ShuffleService } from '../src/modules/exams/shuffle.service';
import { creditMs, HEARTBEAT_CAP_MS } from '../src/modules/learning/tolerance';
import { ScrollCoverageUtil } from '../src/entities/learning-record.entity';
import { ExamPaper } from '../src/entities/exam-paper.entity';
import { PaperQuestion } from '../src/entities/paper-question.entity';
import { Question } from '../src/entities/question.entity';

process.env.EXAM_SHUFFLE_SECRET = process.env.EXAM_SHUFFLE_SECRET || 'unit-test-secret-not-a-real-credential';

// ---------- 自动评分（05 册 6.4.5 / README 术语「自动评分」） ----------
function paper(ratio = 0.5, passScore = 60): ExamPaper {
  return {
    id: '1', regulationId: '1', title: 't', totalScore: '100', passScore: String(passScore),
    durationMinutes: 30, maxAttempts: 3, partialCreditRatio: String(ratio), status: 'published',
    createdBy: '1', createdAt: new Date(), updatedAt: new Date(),
  } as ExamPaper;
}
function pq(id: string, score: number): PaperQuestion {
  return { id, paperId: '1', questionId: id, sort: 0, score: String(score) } as PaperQuestion;
}
function q(id: string, type: string, answer: number[]): Question {
  return {
    id, regulationId: '1', versionId: '1', type, stem: 's',
    options: [1, 2, 3, 4].map((i) => ({ key: String.fromCharCode(64 + i), text: `opt${i}` })),
    answer, analysis: 'a', score: '3', status: 'approved', source: 'ai',
    createdBy: '1', createdAt: new Date(), updatedAt: new Date(),
  } as Question;
}

describe('GradingService 自动评分规则', () => {
  const grading = new GradingService();

  it('单选：答对得该题分值，答错 0 分', () => {
    const p = paper();
    const pqs = [pq('101', 3)];
    const qs = new Map([[ '101', q('101', 'single', [1]) ]]);
    const right = grading.grade(new Map([[ '101', [1] ]]), p, pqs, qs);
    expect(right.total).toBe(3);
    expect(right.details[0].is_correct).toBe(1);
    const wrong = grading.grade(new Map([[ '101', [2] ]]), p, pqs, qs);
    expect(wrong.total).toBe(0);
    expect(wrong.details[0].is_correct).toBe(0);
  });

  it('多选三档：全对满分 / 错选 0 分 / 漏选部分分（默认 50%）', () => {
    const p = paper(0.5);
    const pqs = [pq('201', 8)];
    const qs = new Map([[ '201', q('201', 'multiple', [0, 2]) ]]);
    const full = grading.grade(new Map([[ '201', [0, 2] ]]), p, pqs, qs);
    expect(full.total).toBe(8);
    expect(full.details[0].is_correct).toBe(1);
    const wrongPick = grading.grade(new Map([[ '201', [0, 1] ]]), p, pqs, qs);
    expect(wrongPick.total).toBe(0);
    expect(wrongPick.details[0].is_correct).toBe(0);
    const partial = grading.grade(new Map([[ '201', [0] ]]), p, pqs, qs);
    expect(partial.total).toBe(4); // 8 × 0.50
    expect(partial.details[0].is_correct).toBe(0); // 漏选非全对
    expect(partial.details[0].gained_score).toBe(4);
  });

  it('漏选比例可配置：ratio=0 → 0 分；ratio=1 → 满分', () => {
    const pqs = [pq('301', 8)];
    const qs = new Map([[ '301', q('301', 'multiple', [0, 2]) ]]);
    const zero = grading.grade(new Map([[ '301', [0] ]]), paper(0), pqs, qs);
    expect(zero.total).toBe(0);
    const one = grading.grade(new Map([[ '301', [0] ]]), paper(1), pqs, qs);
    expect(one.total).toBe(8);
  });

  it('未作答：0 分且 is_correct = NULL', () => {
    const p = paper();
    const pqs = [pq('401', 3)];
    const qs = new Map([[ '401', q('401', 'single', [1]) ]]);
    const none = grading.grade(new Map([[ '401', null ]]), p, pqs, qs);
    expect(none.total).toBe(0);
    expect(none.details[0].is_correct).toBeNull();
    const empty = grading.grade(new Map([[ '401', [] ]]), p, pqs, qs);
    expect(empty.details[0].is_correct).toBeNull();
  });

  it('及格判定：恰好等于及格线判 passed（FR-EXM-06 验收①）', () => {
    expect(grading.isPassed(60, 60)).toBe(true);
    expect(grading.isPassed(59.99, 60)).toBe(false);
    expect(grading.isPassed(100, 60)).toBe(true);
  });

  it('分数分布：FLOOR(score/10) 分桶、89.50 归 [80,90)、100 归 [90,100]（04 册 §4.8）', () => {
    expect(GradingService.distributionBucket(0)).toBe('[0,60)');
    expect(GradingService.distributionBucket(59.5)).toBe('[0,60)');
    expect(GradingService.distributionBucket(60)).toBe('[60,70)');
    expect(GradingService.distributionBucket(89.5)).toBe('[80,90)');
    expect(GradingService.distributionBucket(90)).toBe('[90,100]');
    expect(GradingService.distributionBucket(100)).toBe('[90,100]');
  });
});

// ---------- 确定性 seed 乱序（05 册 6.4.2 / 07 册 3.2.1） ----------
describe('ShuffleService 试题与选项乱序', () => {
  const shuffle = new ShuffleService({ examShuffleSecret: 'unit-test-secret-not-a-real-credential' } as any);

  it('确定性：同一 exam_record.id 重算结果一致（断网重进顺序不变，UC-06 A2）', () => {
    const a = shuffle.shuffleQuestionOrder([1, 2, 3, 4, 5], shuffle.deriveSeed('9001'));
    const b = shuffle.shuffleQuestionOrder([1, 2, 3, 4, 5], shuffle.deriveSeed('9001'));
    expect(a).toEqual(b);
  });

  it('不同考生（不同 record id）乱序不同（FR-EXM-02 验收①，大样本）', () => {
    const base = Array.from({ length: 20 }, (_, i) => i);
    const distinct = new Set<string>();
    for (let id = 1; id <= 50; id++) {
      distinct.add(JSON.stringify(shuffle.shuffleQuestionOrder(base, shuffle.deriveSeed(id))));
    }
    expect(distinct.size).toBe(50);
  });

  it('乱序是双射：不丢题、不重题', () => {
    for (let id = 1; id <= 20; id++) {
      const base = Array.from({ length: 25 }, (_, i) => i);
      const shuffled = shuffle.shuffleQuestionOrder(base, shuffle.deriveSeed(id));
      expect([...shuffled].sort((a, b) => a - b)).toEqual(base);
    }
  });

  it('选项乱序映射：还原后与原始语义一致（判分不受乱序影响，FR-EXM-02 验收②）', () => {
    for (let qid = 1; qid <= 20; qid++) {
      const seed = shuffle.deriveSeed('9001');
      const mapping = shuffle.optionMapping(4, seed, qid);
      // mapping[displayPos] = originalIdx，且为双射
      expect([...mapping].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
      const presented = [3, 0, 2]; // 考生按呈现位置选择
      const restored = shuffle.restoreSelection(presented, mapping);
      expect(restored.every((v) => v >= 0 && v < 4)).toBe(true);
      // 再还原回去应得到原呈现位置
      const back = restored.map((orig) => mapping.indexOf(orig));
      expect(back).toEqual(presented);
    }
  });
});

// ---------- 心跳容差（07 册 3.1.2：单次心跳最大计入 45 秒） ----------
describe('心跳时长容差校验', () => {
  it('正常 30 秒心跳按实际计入', () => {
    expect(creditMs(30_000)).toBe(30_000);
  });
  it('高频上报不虚增：每秒一次每次计入 ≈1 秒', () => {
    expect(creditMs(1_000)).toBe(1_000);
  });
  it('断流/低频封顶 45 秒（超出部分不计入有效时长）', () => {
    expect(creditMs(60_000)).toBe(45_000);
    expect(creditMs(300_000)).toBe(45_000);
    expect(HEARTBEAT_CAP_MS).toBe(45_000);
  });
  it('乱序 / 重放心跳（diff <= 0）不计入', () => {
    expect(creditMs(0)).toBe(0);
    expect(creditMs(-5_000)).toBe(0);
  });
});

// ---------- 滚动覆盖位图（03 册 4.4 / 05 册 5.4.4） ----------
describe('滚动覆盖位图', () => {
  it('按位 OR 合并：只增不减、合并幂等、回滚不取消已置位段落', () => {
    const a = ScrollCoverageUtil.normalize({ total_segments: 10, covered_count: 2, segments: [0, 1, 1, 0, 0, 0, 0, 0, 0, 0] });
    const b = ScrollCoverageUtil.normalize({ total_segments: 10, covered_count: 7, segments: [0, 0, 0, 1, 1, 1, 1, 1, 1, 1] });
    const merged = ScrollCoverageUtil.orMerge(a, b);
    expect(merged.segments).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(merged.covered_count).toBe(9);
    const again = ScrollCoverageUtil.orMerge(merged, a);
    expect(again.segments).toEqual(merged.segments); // 幂等
  });

  it('底部段判定：segments[9] === 1（有效学习条件②）', () => {
    const notBottom = ScrollCoverageUtil.normalize({ total_segments: 10, covered_count: 8, segments: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0] });
    expect(ScrollCoverageUtil.bottomCovered(notBottom)).toBe(false);
    const bottom = ScrollCoverageUtil.normalize({ total_segments: 10, covered_count: 9, segments: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1] });
    expect(ScrollCoverageUtil.bottomCovered(bottom)).toBe(true);
  });

  it('normalize：损坏输入降级为空位图且长度恒为 10', () => {
    const empty = ScrollCoverageUtil.normalize(null);
    expect(empty.total_segments).toBe(10);
    expect(empty.segments).toEqual(new Array(10).fill(0));
    const junk = ScrollCoverageUtil.normalize({ total_segments: 10, segments: 'bad' as any });
    expect(junk.segments.length).toBe(10);
  });
});
