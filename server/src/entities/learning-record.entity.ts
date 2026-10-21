import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export interface ScrollCoverage {
  total_segments: number;
  covered_count: number;
  segments: number[];
}

/** 滚动覆盖位图工具（03 册 4.4 结构：total_segments / covered_count / segments） */
export class ScrollCoverageUtil {
  static empty(totalSegments = 10): ScrollCoverage {
    return { total_segments: totalSegments, covered_count: 0, segments: new Array(totalSegments).fill(0) };
  }

  static normalize(input: unknown, totalSegments = 10): ScrollCoverage {
    if (!input || typeof input !== 'object') return ScrollCoverageUtil.empty(totalSegments);
    const raw = input as Partial<ScrollCoverage>;
    const size = Number(raw.total_segments) === totalSegments ? totalSegments : totalSegments;
    const segments = Array.from({ length: size }, (_, i) => (Array.isArray(raw.segments) && raw.segments[i] === 1 ? 1 : 0));
    return { total_segments: size, covered_count: segments.reduce((a, b) => a + b, 0), segments };
  }

  /** 按位 OR 合并：覆盖只增不减、合并幂等（03 册 3.3.2 设计说明 3） */
  static orMerge(a: ScrollCoverage, b: ScrollCoverage): ScrollCoverage {
    const size = Math.max(a.total_segments, b.total_segments);
    const segments = Array.from({ length: size }, (_, i) => (a.segments[i] === 1 || b.segments[i] === 1 ? 1 : 0));
    return { total_segments: size, covered_count: segments.reduce((x, y) => x + y, 0), segments };
  }

  /** 有效学习判定条件②：底部段覆盖（segments[total_segments - 1] === 1） */
  static bottomCovered(c: ScrollCoverage): boolean {
    return c.segments[c.total_segments - 1] === 1;
  }

  static coveredCount(segments: number[]): number {
    return segments.reduce((a, b) => a + b, 0);
  }
}

@Entity('learning_record')
export class LearningRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @Column({ name: 'regulation_id', type: 'bigint' })
  regulationId: string;

  @Column({ name: 'version_id', type: 'bigint' })
  versionId: string;

  /** 累计有效学习时长（秒），跨全部会话求和 */
  @Column({ name: 'total_seconds', type: 'int', default: 0 })
  totalSeconds: number;

  @Column({ name: 'max_scroll_percent', type: 'tinyint', default: 0 })
  maxScrollPercent: number;

  @Column({ name: 'scroll_coverage', type: 'json' })
  scrollCoverage: ScrollCoverage;

  /** 有效学习判定结果；一旦置 1 永不回退（03 册 3.3.2） */
  @Column({ name: 'is_valid', type: 'tinyint', width: 1, default: 0 })
  isValid: number;

  @Column({ name: 'valid_at', type: 'datetime', precision: 3, nullable: true })
  validAt: Date | null;

  @Column({ name: 'last_learn_at', type: 'datetime', precision: 3, nullable: true })
  lastLearnAt: Date | null;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
