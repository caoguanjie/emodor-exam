import { Errors } from '../../common/errors';
import type { PoolScope } from '../../common/training-contracts';

/** Shared write/read invariant. Absence means the historical category contract. */
export function paperPoolConfig(input: {
  businessScope: string; mode: string; poolScope?: unknown; categoryId?: string | null; regulationIds?: readonly string[] | null;
}): { poolScope: PoolScope; categoryId: string | null } {
  const poolScope = input.poolScope === undefined ? 'category' : input.poolScope;
  if (poolScope !== 'category' && poolScope !== 'public') throw Errors.paperRuleInvalid('题池范围必须为 category 或 public');
  if (poolScope === 'public') {
    if (input.businessScope !== 'training' || input.mode !== 'random' || input.categoryId != null) {
      throw Errors.paperRuleInvalid('公共题池仅支持培训随机卷，培训类别必须为空');
    }
    if (input.regulationIds?.length) throw Errors.paperRuleInvalid('公共随机卷不允许按制度来源限制题池');
    return { poolScope, categoryId: null };
  }
  if (input.businessScope === 'training' && (!input.categoryId || !/^[1-9]\d*$/.test(input.categoryId))) {
    throw Errors.paperRuleInvalid('类别题池必须选择有效培训类别');
  }
  return { poolScope, categoryId: input.categoryId == null ? null : String(input.categoryId) };
}
