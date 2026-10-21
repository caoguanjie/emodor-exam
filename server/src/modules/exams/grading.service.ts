import { Injectable } from '@nestjs/common';
import { PaperQuestion } from '../../entities/paper-question.entity';
import { Question } from '../../entities/question.entity';
import { ExamPaper } from '../../entities/exam-paper.entity';

export interface GradedAnswer {
  question_id: number;
  selected: number[] | null;
  is_correct: number | null;
  gained_score: number;
}

/**
 * 评分服务（05 册 6.4.5 / 06 册 4.2，README 术语「自动评分」逐字实现）：
 * 单选答对得该题分值；多选全对满分、错选 0 分、漏选 round(score × partial_credit_ratio, 2)；
 * 未作答 0 分 is_correct=NULL；总分 = Σ gained_score（两位小数）；total ≥ pass_score → passed（恰等判过）。
 * 判分输入全部服务端读取：paper_question.score / question.answer / pass_score / partial_credit_ratio。
 */
@Injectable()
export class GradingService {
  grade(
    answers: Map<string, number[] | null>, // question_id（原始下标还原后）→ selected
    paper: ExamPaper,
    paperQuestions: PaperQuestion[],
    questions: Map<string, Question>,
  ): { total: number; details: GradedAnswer[] } {
    const ratio = Number(paper.partialCreditRatio);
    let total = 0;
    const details: GradedAnswer[] = paperQuestions.map((pq) => {
      const q = questions.get(pq.questionId);
      const selected = answers.get(pq.questionId) ?? null;
      const score = Number(pq.score);
      const answer = (q?.answer || []).map(Number);
      const sel = (selected || []).map(Number);

      let gained = 0;
      let isCorrect: number | null = 0;
      if (!sel.length) {
        // 未作答：[] 或 NULL → 0 分，is_correct=NULL
        gained = 0;
        isCorrect = null;
      } else if (q?.type === 'single') {
        // 单选：selected 等于 answer（恰选且选对）→ 得分
        gained = this.sameSet(sel, answer) ? score : 0;
        isCorrect = gained > 0 ? 1 : 0;
      } else {
        // 多选三档：全对满分 / 错选 0 分 / 漏选部分分
        const hasWrong = sel.some((s) => !answer.includes(s));
        if (this.sameSet(sel, answer)) {
          gained = score; // 全对
          isCorrect = 1;
        } else if (hasWrong) {
          gained = 0; // 错选
          isCorrect = 0;
        } else {
          gained = Math.round(score * ratio * 100) / 100; // 漏选（真子集且非空）
          isCorrect = 0; // 漏选非全对，但得分 > 0
        }
      }
      total += gained;
      return {
        question_id: Number(pq.questionId),
        selected: sel.length ? sel : null,
        is_correct: isCorrect,
        gained_score: gained,
      };
    });
    return { total: Math.round(total * 100) / 100, details };
  }

  private sameSet(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    const sa = [...a].sort((x, y) => x - y);
    const sb = [...b].sort((x, y) => x - y);
    return sa.every((v, i) => v === sb[i]);
  }

  /** 及格判定（实时读 pass_score，恰好等于判 passed，FR-EXM-06 验收①） */
  isPassed(total: number, passScore: number): boolean {
    return total >= passScore;
  }

  /** 分数分布分桶（04 册 §4.8 / 05 册 7.4.1：FLOOR(score/10) 分桶、≥90 归最高桶、左闭右开，89.50 归 [80,90)） */
  static distributionBucket(score: number): string {
    if (score >= 90) return '[90,100]';
    const idx = Math.floor(score / 10); // 0~5 → [0,60)；6/7/8 → 60/70/80 段
    if (idx <= 5) return '[0,60)';
    return ['[60,70)', '[70,80)', '[80,90)'][idx - 6];
  }
}
