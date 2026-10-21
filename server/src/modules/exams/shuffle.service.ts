import { Injectable } from '@nestjs/common';
import { createHmac, createHash } from 'node:crypto';
import { AppConfig } from '../../config/configuration';

/**
 * 乱序服务（05 册 6.4.2 / 07 册 3.2.1）：
 * seed = HMAC-SHA256(EXAM_SHUFFLE_SECRET, exam_record.id) 确定性派生；
 * 题目序以 paper_question.sort 为基准 Fisher-Yates 洗牌；
 * 选项序 option_seed = SHA-256(seed || ":" || question_id) 前 8 字节 → splitmix64 固定实现 →
 * Fisher-Yates 拒绝采样（非取模，避免模偏差）。legacy 记录可按 seed 重算；C2
 * 个人题单必须持久化映射，避免密钥或实现调整改变已开考卷面。
 */
@Injectable()
export class ShuffleService {
  constructor(private readonly config: AppConfig) {}

  /** seed = HMAC-SHA256(EXAM_SHUFFLE_SECRET, exam_record.id)，返回 hex 字符串 */
  deriveSeed(examRecordId: string | number): string {
    return createHmac('sha256', this.config.examShuffleSecret).update(String(examRecordId)).digest('hex');
  }

  /** splitmix64（固定实现，跨版本重算一致）：输入 64 位 BigInt，输出 64 位 BigInt */
  private splitmix64(state: bigint): bigint {
    const MASK = (1n << 64n) - 1n;
    state = (state + 0x9e3779b97f4a7c15n) & MASK;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    z = z ^ (z >> 31n);
    return z;
  }

  /** 拒绝采样：[0, bound) 均匀整数（不取模，避免模偏差） */
  private nextBelow(state: bigint, bound: number): { value: number; state: bigint } {
    if (bound <= 1) return { value: 0, state };
    let s = state;
    const limit = (1n << 64n) - ((1n << 64n) % BigInt(bound));
    while (true) {
      s = this.splitmix64(s);
      if (s < limit) return { value: Number(s % BigInt(bound)), state: s };
    }
  }

  /** Fisher-Yates 洗牌（确定性）：返回新数组，不修改入参 */
  shuffle<T>(items: T[], seed: string): T[] {
    const arr = [...items];
    let state = BigInt('0x' + createHash('sha256').update(seed).digest('hex').slice(0, 16));
    for (let i = arr.length - 1; i > 0; i--) {
      const r = this.nextBelow(state, i + 1);
      state = r.state;
      const j = r.value;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** 题目序洗牌：seed 直接驱动 */
  shuffleQuestionOrder<T>(questions: T[], seed: string): T[] {
    return this.shuffle(questions, `q:${seed}`);
  }

  /** 选项序洗牌：option_seed = SHA-256(seed || ":" || question_id)（07 册 3.2.1 规范化定义） */
  shuffleOptions<T>(options: T[], seed: string, questionId: string | number): T[] {
    return this.shuffle(options, `opt:${seed}:${questionId}`);
  }

  /** 乱序映射（呈现位置 → 原始下标）：options 数组下标洗牌后，displayPos → originalIdx */
  optionMapping(optionCount: number, seed: string, questionId: string | number): number[] {
    const indexes = Array.from({ length: optionCount }, (_, i) => i);
    return this.shuffle(indexes, `opt:${seed}:${questionId}`);
  }

  /** 判断题固定“正确/错误”语义顺序；其他客观题生成一次后由题单持久化。 */
  snapshotOptionMapping(type: string, optionCount: number, seed: string, questionId: string | number): number[] {
    return type === 'judgment'
      ? Array.from({ length: optionCount }, (_, index) => index)
      : this.optionMapping(optionCount, seed, questionId);
  }

  /** 还原：呈现位置数组（displayPos）→ 原始下标数组 */
  restoreSelection(displayPositions: number[], mapping: number[]): number[] {
    return displayPositions.map((p) => mapping[p]).filter((v) => v !== undefined);
  }
}
